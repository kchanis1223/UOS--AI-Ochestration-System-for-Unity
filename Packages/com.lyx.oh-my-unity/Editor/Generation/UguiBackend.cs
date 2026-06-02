using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// uGUI implementation of <see cref="IUiBackend"/> (decision B1/C1). Builds a Canvas per screen
    /// with a child element tree, converts normalized coords to px via <see cref="CoordinateMapper"/>,
    /// stamps every node with a server-minted <see cref="ScreenElementId"/>, and registers screens
    /// with a <see cref="ScreenFlowController"/> for panel-toggle navigation.
    ///
    /// Editor-runtime behavior (actual GameObject creation) is the human-verified boundary; the
    /// coordinate math and id authority it depends on are unit-tested separately.
    /// </summary>
    public sealed class UguiBackend : IUiBackend
    {
        public CreateScreenResult CreateScreen(PlanningIntentData intent, UndoScope undo)
        {
            var registry = new IdRegistry();
            string screenId = registry.MintScreenId();

            var canvasGo = new GameObject(intent.screenName ?? "Screen");
            undo.RegisterCreated(canvasGo);

            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(intent.referenceCanvas.width, intent.referenceCanvas.height);
            canvasGo.AddComponent<GraphicRaycaster>();

            StampId(canvasGo, screenId);

            float cw = intent.referenceCanvas.width;
            float ch = intent.referenceCanvas.height;

            // First pass: create every element + bind hint->canonical (forward refs allowed).
            var hintToGo = new Dictionary<string, GameObject>();
            var created = new List<(GameObject go, IntentElementData data)>();
            foreach (IntentElementData el in intent.elements)
            {
                string elementId = registry.RegisterElement(el.clientHintId);
                GameObject go = CreateElementObject(el, elementId, undo);
                StampId(go, elementId);
                if (!string.IsNullOrEmpty(el.clientHintId))
                {
                    hintToGo[el.clientHintId] = go;
                }
                created.Add((go, el));
            }

            // Second pass: parent each element (resolved hint parent, else the canvas).
            foreach ((GameObject go, IntentElementData el) in created)
            {
                Transform parent = canvasGo.transform;
                if (!string.IsNullOrEmpty(el.parentClientHintId)
                    && hintToGo.TryGetValue(el.parentClientHintId, out GameObject parentGo))
                {
                    parent = parentGo.transform;
                }
                go.transform.SetParent(parent, false);
                ApplyRect(go, el, cw, ch);
            }

            var result = new CreateScreenResult { ScreenId = screenId };
            foreach (HintCanonicalPair pair in registry.Pairs)
            {
                result.Elements.Add(pair);
            }

            RegisterWithFlow(screenId, canvasGo, undo);
            return result;
        }

        public string AddElement(string screenId, IntentElementData element, UndoScope undo)
        {
            GameObject screen = FindById(screenId);
            if (screen == null) return null;

            var registry = new IdRegistry();
            string elementId = registry.RegisterElement(element.clientHintId);
            GameObject go = CreateElementObject(element, elementId, undo);
            StampId(go, elementId);
            go.transform.SetParent(screen.transform, false);

            Canvas canvas = screen.GetComponent<Canvas>();
            var scaler = screen.GetComponent<CanvasScaler>();
            float cw = scaler != null ? scaler.referenceResolution.x : Screen.width;
            float ch = scaler != null ? scaler.referenceResolution.y : Screen.height;
            ApplyRect(go, element, cw, ch);
            return elementId;
        }

        public bool UpdateElement(string elementId, NormRectData rect, string anchor, UndoScope undo)
        {
            GameObject go = FindById(elementId);
            if (go == null) return false;

            var rt = go.GetComponent<RectTransform>();
            if (rt == null) return false;
            undo.RecordObject(rt, "Update Element");

            CanvasScaler scaler = go.GetComponentInParent<CanvasScaler>();
            float cw = scaler != null ? scaler.referenceResolution.x : Screen.width;
            float ch = scaler != null ? scaler.referenceResolution.y : Screen.height;
            ApplyRectTransform(rt, rect, cw, ch);
            return true;
        }

        public bool DeleteElement(string elementId, UndoScope undo)
        {
            GameObject go = FindById(elementId);
            if (go == null) return false;
            UnityEditor.Undo.DestroyObjectImmediate(go);
            return true;
        }

        public IReadOnlyList<string> ListScreens()
        {
            var ids = new List<string>();
            foreach (Canvas canvas in Object.FindObjectsByType<Canvas>(FindObjectsSortMode.None))
            {
                var marker = canvas.GetComponent<ScreenElementId>();
                if (marker != null && !string.IsNullOrEmpty(marker.ElementId))
                {
                    ids.Add(marker.ElementId);
                }
            }
            return ids;
        }

        private static GameObject CreateElementObject(IntentElementData el, string elementId, UndoScope undo)
        {
            var go = new GameObject(string.IsNullOrEmpty(el.clientHintId) ? el.type : el.clientHintId);
            undo.RegisterCreated(go);
            go.AddComponent<RectTransform>();

            switch (el.type)
            {
                case "Text":
                    var txt = go.AddComponent<Text>();
                    txt.font = DefaultFont();
                    txt.color = Color.black;
                    break;
                case "Button":
                    go.AddComponent<Image>();
                    go.AddComponent<Button>();
                    break;
                case "Image":
                case "Panel":
                    go.AddComponent<Image>();
                    break;
                case "InputField":
                    go.AddComponent<Image>();
                    go.AddComponent<InputField>();
                    break;
                case "Toggle":
                    go.AddComponent<Toggle>();
                    break;
                case "Slider":
                    go.AddComponent<Slider>();
                    break;
                case "ScrollView":
                    go.AddComponent<Image>();
                    go.AddComponent<ScrollRect>();
                    break;
                case "Dropdown":
                    go.AddComponent<Image>();
                    go.AddComponent<Dropdown>();
                    break;
                default:
                    go.AddComponent<Image>();
                    break;
            }

            ApplyProps(go, el);
            return go;
        }

        // v0.1.1 props pass — see docs/feedback/2026-06-02-e2e-jangheung.md (Top #1).
        // Per-type interpretation:
        //   Text       — props.text / fontSize / color / align
        //   Button     — props.color → background Image color, props.text → child Label (Text)
        //   Image/Panel → props.color, props.sprite
        //   InputField — props.text → placeholder, props.color → background
        // Missing props leave Unity defaults (a no-op vs the legacy white-wireframe behavior).
        private static void ApplyProps(GameObject go, IntentElementData el)
        {
            if (el.props == null) return;

            switch (el.type)
            {
                case "Text":
                {
                    var t = go.GetComponent<Text>();
                    if (t == null) return;
                    if (!string.IsNullOrEmpty(el.props.text)) t.text = el.props.text;
                    if (el.props.fontSize > 0) t.fontSize = el.props.fontSize;
                    if (TryParseColor(el.props.color, out Color tc)) t.color = tc;
                    t.alignment = ParseAlignment(el.props.align, TextAnchor.MiddleCenter);
                    break;
                }
                case "Button":
                {
                    var img = go.GetComponent<Image>();
                    if (img != null && TryParseColor(el.props.color, out Color bc)) img.color = bc;
                    Sprite bs = TryLoadSprite(el.props.sprite);
                    if (img != null && bs != null) img.sprite = bs;
                    if (!string.IsNullOrEmpty(el.props.text)) AttachButtonLabel(go, el.props);
                    break;
                }
                case "Image":
                case "Panel":
                {
                    var img = go.GetComponent<Image>();
                    if (img == null) return;
                    if (TryParseColor(el.props.color, out Color c)) img.color = c;
                    Sprite s = TryLoadSprite(el.props.sprite);
                    if (s != null) img.sprite = s;
                    break;
                }
                case "InputField":
                {
                    var img = go.GetComponent<Image>();
                    if (img != null && TryParseColor(el.props.color, out Color fc)) img.color = fc;
                    if (!string.IsNullOrEmpty(el.props.text)) AttachInputFieldPlaceholder(go, el.props);
                    break;
                }
            }
        }

        private static void AttachButtonLabel(GameObject button, ElementProps props)
        {
            var labelGo = new GameObject("Label");
            labelGo.transform.SetParent(button.transform, false);
            var rt = labelGo.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.sizeDelta = Vector2.zero;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
            var label = labelGo.AddComponent<Text>();
            label.text = props.text;
            label.font = DefaultFont();
            label.alignment = ParseAlignment(props.align, TextAnchor.MiddleCenter);
            label.color = TryParseColor(props.color, out Color lc) ? Contrast(lc) : Color.black;
            if (props.fontSize > 0) label.fontSize = props.fontSize;
        }

        private static void AttachInputFieldPlaceholder(GameObject input, ElementProps props)
        {
            var inputField = input.GetComponent<InputField>();
            if (inputField == null) return;
            var phGo = new GameObject("Placeholder");
            phGo.transform.SetParent(input.transform, false);
            var rt = phGo.AddComponent<RectTransform>();
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.sizeDelta = Vector2.zero;
            rt.offsetMin = new Vector2(8f, 4f);
            rt.offsetMax = new Vector2(-8f, -4f);
            var ph = phGo.AddComponent<Text>();
            ph.text = props.text;
            ph.font = DefaultFont();
            ph.color = new Color(0.5f, 0.5f, 0.5f, 0.7f);
            ph.alignment = ParseAlignment(props.align, TextAnchor.MiddleLeft);
            if (props.fontSize > 0) ph.fontSize = props.fontSize;
            inputField.placeholder = ph;
        }

        private static Font DefaultFont()
        {
            // Unity 6 ships LegacyRuntime.ttf as the built-in legacy Text font.
            Font f = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            return f != null ? f : Resources.GetBuiltinResource<Font>("Arial.ttf");
        }

        private static bool TryParseColor(string raw, out Color color)
        {
            color = default;
            if (string.IsNullOrEmpty(raw)) return false;
            return ColorUtility.TryParseHtmlString(raw, out color);
        }

        private static Sprite TryLoadSprite(string assetPath)
        {
            if (string.IsNullOrEmpty(assetPath)) return null;
            var sprite = UnityEditor.AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
            if (sprite == null) Debug.LogWarning($"[OhMyUnity] sprite not found at \"{assetPath}\"");
            return sprite;
        }

        private static TextAnchor ParseAlignment(string raw, TextAnchor fallback)
        {
            if (string.IsNullOrEmpty(raw)) return fallback;
            string normalized = raw.Trim();
            switch (normalized)
            {
                case "Left":         return TextAnchor.MiddleLeft;
                case "Center":       return TextAnchor.MiddleCenter;
                case "Right":        return TextAnchor.MiddleRight;
                case "Top":          return TextAnchor.UpperCenter;
                case "Bottom":       return TextAnchor.LowerCenter;
                case "TopLeft":      return TextAnchor.UpperLeft;
                case "TopRight":     return TextAnchor.UpperRight;
                case "BottomLeft":   return TextAnchor.LowerLeft;
                case "BottomRight":  return TextAnchor.LowerRight;
                case "MiddleLeft":   return TextAnchor.MiddleLeft;
                case "MiddleCenter": return TextAnchor.MiddleCenter;
                case "MiddleRight":  return TextAnchor.MiddleRight;
                case "UpperCenter":  return TextAnchor.UpperCenter;
                case "LowerCenter":  return TextAnchor.LowerCenter;
            }
            return Enum.TryParse(normalized, true, out TextAnchor anchor) ? anchor : fallback;
        }

        // Choose black or white label color depending on background brightness so a Button's
        // text stays readable on any user-chosen background color.
        private static Color Contrast(Color bg)
        {
            float luminance = 0.299f * bg.r + 0.587f * bg.g + 0.114f * bg.b;
            return luminance > 0.5f ? Color.black : Color.white;
        }

        private static void ApplyRect(GameObject go, IntentElementData el, float canvasWidth, float canvasHeight)
        {
            var rt = go.GetComponent<RectTransform>();
            if (rt == null) return;
            ApplyRectTransform(rt, el.rect, canvasWidth, canvasHeight);
        }

        // v1 baseline: top-left anchored placement matching the CoordinateMapper layout space.
        // Anchor-preset refinement (honoring el.anchor) is a documented follow-up.
        private static void ApplyRectTransform(RectTransform rt, NormRectData rect, float canvasWidth, float canvasHeight)
        {
            Rect px = CoordinateMapper.NormRectToPx(rect, canvasWidth, canvasHeight);
            rt.anchorMin = new Vector2(0f, 1f);
            rt.anchorMax = new Vector2(0f, 1f);
            rt.pivot = new Vector2(0f, 1f);
            rt.sizeDelta = new Vector2(px.width, px.height);
            rt.anchoredPosition = new Vector2(px.x, -px.y);
        }

        private static void StampId(GameObject go, string id)
        {
            var marker = go.GetComponent<ScreenElementId>();
            if (marker == null) marker = go.AddComponent<ScreenElementId>();
            marker.Assign(id);
        }

        private static GameObject FindById(string id)
        {
            foreach (ScreenElementId marker in Object.FindObjectsByType<ScreenElementId>(FindObjectsSortMode.None))
            {
                if (marker.ElementId == id) return marker.gameObject;
            }
            return null;
        }

        private static void RegisterWithFlow(string screenId, GameObject screen, UndoScope undo)
        {
            ScreenFlowController controller = Object.FindFirstObjectByType<ScreenFlowController>();
            if (controller == null)
            {
                var go = new GameObject("ScreenFlow");
                undo.RegisterCreated(go);
                controller = go.AddComponent<ScreenFlowController>();
            }
            undo.RecordObject(controller, "Register Screen");
            controller.RegisterScreen(screenId, screen);
        }
    }
}
