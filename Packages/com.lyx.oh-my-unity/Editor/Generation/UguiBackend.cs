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
                    go.AddComponent<Text>();
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
            return go;
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
