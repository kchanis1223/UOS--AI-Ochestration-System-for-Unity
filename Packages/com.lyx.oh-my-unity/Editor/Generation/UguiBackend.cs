using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Video;
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
        private const int MaxScrollTextChunkChars = 6000;
        private const float ScrollTextPaddingLeft = 10f;
        private const float ScrollTextPaddingTop = 8f;
        private const float ScrollTextPaddingRight = 10f;
        private const float ScrollTextPaddingBottom = 8f;

        public CreateScreenResult CreateScreen(PlanningIntentData intent, UndoScope undo)
        {
            var registry = new IdRegistry();
            string screenId = registry.MintScreenId();

            var canvasGo = new GameObject(intent.screenName ?? "Screen");
            undo.RegisterCreated(canvasGo);

            var canvas = AddComponent<Canvas>(canvasGo, undo);
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = AddComponent<CanvasScaler>(canvasGo, undo);
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(intent.referenceCanvas.width, intent.referenceCanvas.height);
            AddComponent<GraphicRaycaster>(canvasGo, undo);

            StampId(canvasGo, screenId, undo);

            float cw = intent.referenceCanvas.width;
            float ch = intent.referenceCanvas.height;

            // First pass: create every element + bind hint->canonical (forward refs allowed).
            var hintToGo = new Dictionary<string, GameObject>();
            var created = new List<(GameObject go, IntentElementData data)>();
            foreach (IntentElementData el in intent.elements)
            {
                string elementId = registry.RegisterElement(el.clientHintId);
                GameObject go = CreateElementObject(el, elementId, undo);
                StampId(go, elementId, undo);
                if (!string.IsNullOrEmpty(el.clientHintId))
                {
                    hintToGo[el.clientHintId] = go;
                }
                created.Add((go, el));
            }

            // Second pass: parent each element (resolved hint parent, else the canvas).
            // A child's normalized rect is interpreted relative to its PARENT's box (not the
            // canvas), so nested elements stay inside their parent at any depth.
            // See docs/feedback/2026-06-02-e2e-jangheung.md (Category C, parent-child coords).
            var hintToData = new Dictionary<string, IntentElementData>();
            foreach (IntentElementData el in intent.elements)
            {
                if (!string.IsNullOrEmpty(el.clientHintId)) hintToData[el.clientHintId] = el;
            }
            var frameCache = new Dictionary<string, Vector2>();

            Vector2 ParentFrameSize(IntentElementData el)
            {
                if (el == null
                    || string.IsNullOrEmpty(el.parentClientHintId)
                    || !hintToData.TryGetValue(el.parentClientHintId, out IntentElementData parentData)
                    || parentData == el
                    || parentData.rect == null)
                {
                    return new Vector2(cw, ch);
                }
                if (frameCache.TryGetValue(parentData.clientHintId, out Vector2 cached)) return cached;
                frameCache[parentData.clientHintId] = new Vector2(cw, ch); // cycle guard
                Vector2 grandparentFrame = ParentFrameSize(parentData);
                var size = new Vector2(parentData.rect.w * grandparentFrame.x, parentData.rect.h * grandparentFrame.y);
                frameCache[parentData.clientHintId] = size;
                return size;
            }

            foreach ((GameObject go, IntentElementData el) in created)
            {
                Transform parent = canvasGo.transform;
                if (!string.IsNullOrEmpty(el.parentClientHintId)
                    && hintToGo.TryGetValue(el.parentClientHintId, out GameObject parentGo))
                {
                    parent = parentGo.transform;
                }
                go.transform.SetParent(parent, false);
                Vector2 frame = ParentFrameSize(el);
                ApplyRect(go, el, frame.x, frame.y);
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

            Transform parent = screen.transform;
            if (!string.IsNullOrEmpty(element.parentElementId))
            {
                GameObject parentGo = FindById(element.parentElementId);
                if (parentGo == null || !IsDescendantOf(parentGo.transform, screen.transform)) return null;
                parent = parentGo.transform;
            }

            string elementId = MintUniqueElementId();
            GameObject go = CreateElementObject(element, elementId, undo);
            StampId(go, elementId, undo);
            go.transform.SetParent(parent, false);

            Canvas canvas = screen.GetComponent<Canvas>();
            var scaler = screen.GetComponent<CanvasScaler>();
            float cw = scaler != null ? scaler.referenceResolution.x : Screen.width;
            float ch = scaler != null ? scaler.referenceResolution.y : Screen.height;
            // Lay the new element out within its parent's box when it is nested under an
            // existing element (point-anchored sizeDelta == parent px size), else the canvas.
            float frameW = cw, frameH = ch;
            if (parent != screen.transform)
            {
                var parentRt = parent.GetComponent<RectTransform>();
                if (parentRt != null
                    && parentRt.sizeDelta.x > 0f && parentRt.sizeDelta.y > 0f
                    && parentRt.anchorMin == parentRt.anchorMax)
                {
                    frameW = parentRt.sizeDelta.x;
                    frameH = parentRt.sizeDelta.y;
                }
            }
            ApplyRect(go, element, frameW, frameH);
            return elementId;
        }

        public bool UpdateElement(string elementId, NormRectData rect, string anchor, ElementProps props, UndoScope undo)
        {
            GameObject go = FindById(elementId);
            if (go == null) return false;

            if (rect != null || !string.IsNullOrEmpty(anchor))
            {
                var rt = go.GetComponent<RectTransform>();
                if (rt == null) return false;
                undo.RecordObject(rt, "Update Element");

                CanvasScaler scaler = go.GetComponentInParent<CanvasScaler>(true);
                float cw = scaler != null ? scaler.referenceResolution.x : Screen.width;
                float ch = scaler != null ? scaler.referenceResolution.y : Screen.height;
                // Resolve against the parent's box for nested elements so updates stay
                // parent-relative (canvas only when the parent is the screen Canvas itself).
                float frameW = cw, frameH = ch;
                if (rt.parent is RectTransform parentRt
                    && parentRt.GetComponent<Canvas>() == null
                    && parentRt.sizeDelta.x > 0f && parentRt.sizeDelta.y > 0f
                    && parentRt.anchorMin == parentRt.anchorMax)
                {
                    frameW = parentRt.sizeDelta.x;
                    frameH = parentRt.sizeDelta.y;
                }
                ApplyRectTransform(rt, rect ?? InspectRect(rt, frameW, frameH), anchor, frameW, frameH);
            }

            if (props != null)
            {
                ApplyProps(go, new IntentElementData
                {
                    type = InferElementType(go),
                    props = props,
                }, undo);
            }
            return true;
        }

        public bool DeleteElement(string elementId, UndoScope undo)
        {
            GameObject go = FindById(elementId);
            if (go == null) return false;
            UnityEditor.Undo.DestroyObjectImmediate(go);
            return true;
        }

        public bool SetActiveScreen(string screenId, UndoScope undo)
        {
            if (string.IsNullOrEmpty(screenId)) return false;
            ScreenFlowController controller = UnityEngine.Object.FindFirstObjectByType<ScreenFlowController>();
            if (controller == null) return false;
            ScreenFlowController.EnsureEventSystem();

            bool found = false;
            IReadOnlyList<string> ids = controller.ScreenIds;
            IReadOnlyList<GameObject> objects = controller.ScreenObjects;
            for (int i = 0; i < ids.Count; i++)
            {
                if (ids[i] == screenId)
                {
                    found = true;
                    break;
                }
            }
            if (!found) return false;

            undo.RecordObject(controller, "Set Active Screen");
            for (int i = 0; i < objects.Count; i++)
            {
                if (objects[i] != null) undo.RecordObject(objects[i], "Set Active Screen");
            }
            return controller.ShowScreen(screenId);
        }

        public IReadOnlyList<string> ListScreens()
        {
            var ids = new List<string>();
            foreach (Canvas canvas in UnityEngine.Object.FindObjectsByType<Canvas>(
                FindObjectsInactive.Include,
                FindObjectsSortMode.None))
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
            AddComponent<RectTransform>(go, undo);

            switch (el.type)
            {
                case "Text":
                    var txt = AddComponent<Text>(go, undo);
                    txt.font = DefaultFont();
                    txt.color = Color.black;
                    break;
                case "Button":
                    AddComponent<Image>(go, undo);
                    AddComponent<Button>(go, undo);
                    break;
                case "Image":
                case "Panel":
                    AddComponent<Image>(go, undo);
                    break;
                case "Video":
                    AddComponent<RawImage>(go, undo);
                    AddComponent<VideoPlayer>(go, undo);
                    AddComponent<AudioSource>(go, undo);
                    EnsureVideoStructure(go, elementId, undo);
                    break;
                case "InputField":
                    AddComponent<Image>(go, undo);
                    AddComponent<InputField>(go, undo);
                    EnsureInputFieldStructure(go, undo);
                    break;
                case "Toggle":
                    AddComponent<Image>(go, undo);
                    AddComponent<Toggle>(go, undo);
                    EnsureToggleStructure(go, undo);
                    break;
                case "Slider":
                    AddComponent<Image>(go, undo);
                    AddComponent<Slider>(go, undo);
                    EnsureSliderStructure(go, undo);
                    break;
                case "ScrollView":
                    AddComponent<Image>(go, undo);
                    AddComponent<ScrollRect>(go, undo);
                    EnsureScrollViewStructure(go, undo);
                    break;
                case "Dropdown":
                    AddComponent<Image>(go, undo);
                    AddComponent<Dropdown>(go, undo);
                    EnsureDropdownStructure(go, undo);
                    break;
                default:
                    AddComponent<Image>(go, undo);
                    break;
            }

            ApplyProps(go, el, undo);
            return go;
        }

        // v0.1.1 props pass — see docs/feedback/2026-06-02-e2e-jangheung.md (Top #1).
        // Per-type interpretation:
        //   Text       — props.text / fontSize / fontStyle / color / align
        //   Button     — props.color → background Image color, props.text → child Label (Text)
        //   Image/Panel → props.color, props.sprite
        //   InputField — props.text → placeholder, props.color → background
        // Missing props leave Unity defaults (a no-op vs the legacy white-wireframe behavior).
        private static void ApplyProps(GameObject go, IntentElementData el, UndoScope undo = null)
        {
            if (el.props == null) return;

            switch (el.type)
            {
                case "Text":
                {
                    var t = go.GetComponent<Text>();
                    if (t == null) return;
                    undo?.RecordObject(t, "Update Text Props");
                    if (!string.IsNullOrEmpty(el.props.text)) t.text = el.props.text;
                    if (el.props.fontSize > 0) t.fontSize = el.props.fontSize;
                    t.fontStyle = ParseFontStyle(el.props.fontStyle, t.fontStyle);
                    if (TryParseColor(el.props.color, out Color tc)) t.color = tc;
                    t.alignment = ParseAlignment(el.props.align, TextAnchor.MiddleCenter);
                    break;
                }
                case "Button":
                {
                    var img = go.GetComponent<Image>();
                    if (img != null) undo?.RecordObject(img, "Update Button Props");
                    if (img != null && TryParseColor(el.props.color, out Color bc)) img.color = bc;
                    Sprite bs = TryLoadSprite(el.props.sprite);
                    if (img != null && bs != null) img.sprite = bs;
                    if (HasTextProps(el.props)) AttachButtonLabel(go, el.props, undo);
                    ApplySelectableProps(go, el.props, undo, "Button");
                    break;
                }
                case "Image":
                case "Panel":
                {
                    var img = go.GetComponent<Image>();
                    if (img == null) return;
                    undo?.RecordObject(img, "Update Image Props");
                    if (TryParseColor(el.props.color, out Color c)) img.color = c;
                    Sprite s = TryLoadSprite(el.props.sprite);
                    if (s != null) img.sprite = s;
                    break;
                }
                case "Video":
                {
                    EnsureVideoStructure(go, string.IsNullOrEmpty(el.clientHintId) ? go.name : el.clientHintId, undo);
                    ApplyVideoProps(go, el.props, undo);
                    break;
                }
                case "InputField":
                {
                    var img = go.GetComponent<Image>();
                    var inputField = go.GetComponent<InputField>();
                    if (img != null) undo?.RecordObject(img, "Update InputField Props");
                    if (img != null && TryParseColor(el.props.color, out Color fc)) img.color = fc;
                    if (HasInputFieldPlaceholderProps(el.props)) AttachInputFieldPlaceholder(go, el.props, undo);
                    if (inputField != null && el.props.inputText != null)
                    {
                        undo?.RecordObject(inputField, "Update InputField Value");
                        inputField.text = el.props.inputText;
                    }
                    ApplySelectableProps(go, el.props, undo, "InputField");
                    break;
                }
                case "Toggle":
                {
                    var toggle = go.GetComponent<Toggle>();
                    var img = go.GetComponent<Image>();
                    if (img != null) undo?.RecordObject(img, "Update Toggle Props");
                    if (img != null && TryParseColor(el.props.color, out Color tc)) img.color = tc;
                    Sprite ts = TryLoadSprite(el.props.sprite);
                    if (img != null && ts != null) img.sprite = ts;
                    if (toggle != null && img != null && toggle.targetGraphic == null) toggle.targetGraphic = img;
                    if (toggle != null && (el.props.hasIsOn || el.props.isOn))
                    {
                        undo?.RecordObject(toggle, "Update Toggle Value");
                        toggle.isOn = el.props.isOn;
                    }
                    if (HasTextProps(el.props)) AttachControlLabel(go, "Label", el.props, undo, TextAnchor.MiddleLeft);
                    ApplySelectableProps(go, el.props, undo, "Toggle");
                    break;
                }
                case "Slider":
                {
                    var slider = go.GetComponent<Slider>();
                    var img = go.GetComponent<Image>();
                    if (img == null && slider == null) return;
                    if (img != null) undo?.RecordObject(img, "Update Control Props");
                    if (slider != null) undo?.RecordObject(slider, "Update Slider Props");
                    if (img != null && TryParseColor(el.props.color, out Color sc)) img.color = sc;
                    Sprite ss = TryLoadSprite(el.props.sprite);
                    if (img != null && ss != null) img.sprite = ss;
                    if (slider != null)
                    {
                        if (el.props.hasMinValue) slider.minValue = el.props.minValue;
                        if (el.props.hasMaxValue) slider.maxValue = el.props.maxValue;
                        if (el.props.hasValue) slider.value = el.props.value;
                    }
                    ApplySelectableProps(go, el.props, undo, "Slider");
                    break;
                }
                case "ScrollView":
                {
                    var img = go.GetComponent<Image>();
                    if (img == null) return;
                    undo?.RecordObject(img, "Update Control Props");
                    if (TryParseColor(el.props.color, out Color sc)) img.color = sc;
                    Sprite ss = TryLoadSprite(el.props.sprite);
                    if (ss != null) img.sprite = ss;
                    if (HasTextProps(el.props)) AttachScrollViewText(go, el.props, undo);
                    break;
                }
                case "Dropdown":
                {
                    var img = go.GetComponent<Image>();
                    if (img != null) undo?.RecordObject(img, "Update Dropdown Props");
                    if (img != null && TryParseColor(el.props.color, out Color dc)) img.color = dc;
                    Sprite ds = TryLoadSprite(el.props.sprite);
                    if (img != null && ds != null) img.sprite = ds;
                    if (HasDropdownProps(el.props)) AttachDropdownCaption(go, el.props, undo);
                    ApplySelectableProps(go, el.props, undo, "Dropdown");
                    break;
                }
            }
        }

        private static bool HasTextProps(ElementProps props)
        {
            return props != null
                && (!string.IsNullOrEmpty(props.text)
                    || props.fontSize > 0
                    || !string.IsNullOrEmpty(props.fontStyle)
                    || !string.IsNullOrEmpty(props.align));
        }

        private static void EnsureVideoStructure(GameObject videoGo, string elementId, UndoScope undo)
        {
            var rawImage = videoGo.GetComponent<RawImage>();
            if (rawImage == null) rawImage = AddComponent<RawImage>(videoGo, undo);
            var player = videoGo.GetComponent<VideoPlayer>();
            if (player == null) player = AddComponent<VideoPlayer>(videoGo, undo);
            var audio = videoGo.GetComponent<AudioSource>();
            if (audio == null) audio = AddComponent<AudioSource>(videoGo, undo);

            undo?.RecordObject(rawImage, "Update Video RawImage");
            undo?.RecordObject(player, "Update Video Player");
            undo?.RecordObject(audio, "Update Video Audio");

            RenderTexture texture = rawImage.texture as RenderTexture;
            if (texture == null)
            {
                texture = CreateVideoRenderTexture(elementId);
                rawImage.texture = texture;
            }

            player.source = VideoSource.VideoClip;
            player.renderMode = VideoRenderMode.RenderTexture;
            player.targetTexture = texture;
            player.audioOutputMode = VideoAudioOutputMode.AudioSource;
            player.SetTargetAudioSource(0, audio);
            player.waitForFirstFrame = true;
            audio.playOnAwake = false;
        }

        private static void ApplyVideoProps(GameObject go, ElementProps props, UndoScope undo = null)
        {
            if (props == null) return;
            var rawImage = go.GetComponent<RawImage>();
            var player = go.GetComponent<VideoPlayer>();
            var audio = go.GetComponent<AudioSource>();
            if (rawImage == null || player == null) return;

            undo?.RecordObject(rawImage, "Update Video RawImage Props");
            undo?.RecordObject(player, "Update Video Player Props");
            if (audio != null) undo?.RecordObject(audio, "Update Video Audio Props");

            if (TryParseColor(props.color, out Color color)) rawImage.color = color;

            VideoClip clip = TryLoadVideoClip(props.video);
            if (clip != null) player.clip = clip;

            if (props.hasLoop) player.isLooping = props.loop;
            if (props.hasPlayOnAwake) player.playOnAwake = props.playOnAwake;
            if (audio != null && props.hasMuted) audio.mute = props.muted;
        }

        private static RenderTexture CreateVideoRenderTexture(string elementId)
        {
            string dir = "Assets/UOS/Generated/VideoRenderTextures";
            EnsureAssetFolder(dir);
            string safeName = string.IsNullOrEmpty(elementId)
                ? "video"
                : System.Text.RegularExpressions.Regex.Replace(elementId, @"[^a-zA-Z0-9_-]+", "_");
            string path = UnityEditor.AssetDatabase.GenerateUniqueAssetPath($"{dir}/{safeName}.renderTexture");
            var texture = new RenderTexture(1920, 1080, 0, RenderTextureFormat.ARGB32)
            {
                name = System.IO.Path.GetFileNameWithoutExtension(path),
            };
            UnityEditor.AssetDatabase.CreateAsset(texture, path);
            UnityEditor.AssetDatabase.ImportAsset(path);
            return texture;
        }

        private static void EnsureAssetFolder(string assetDir)
        {
            string normalized = string.IsNullOrEmpty(assetDir) ? "Assets" : assetDir.Replace('\\', '/').Trim('/');
            if (normalized == "Assets" || UnityEditor.AssetDatabase.IsValidFolder(normalized)) return;
            string[] parts = normalized.Split('/');
            string current = "Assets";
            for (int i = 1; i < parts.Length; i++)
            {
                string next = current + "/" + parts[i];
                if (!UnityEditor.AssetDatabase.IsValidFolder(next))
                {
                    UnityEditor.AssetDatabase.CreateFolder(current, parts[i]);
                }
                current = next;
            }
        }

        private static bool HasInputFieldPlaceholderProps(ElementProps props)
        {
            return HasTextProps(props) || (props != null && !string.IsNullOrEmpty(props.placeholder));
        }

        private static bool HasDropdownProps(ElementProps props)
        {
            return HasTextProps(props)
                || (props != null && props.options != null && props.options.Length > 0)
                || (props != null && props.hasValue);
        }

        private static void ApplySelectableProps(GameObject go, ElementProps props, UndoScope undo, string controlName)
        {
            var selectable = go.GetComponent<Selectable>();
            if (selectable == null || props == null) return;
            if (!props.hasInteractable && !props.interactable) return;
            undo?.RecordObject(selectable, $"Update {controlName} Interactable");
            selectable.interactable = props.interactable;
        }

        private static void AttachButtonLabel(GameObject button, ElementProps props, UndoScope undo = null)
        {
            Transform existing = button.transform.Find("Label");
            GameObject labelGo = existing != null ? existing.gameObject : new GameObject("Label");
            if (existing == null)
            {
                undo?.RegisterCreated(labelGo);
                labelGo.transform.SetParent(button.transform, false);
            }
            var rt = labelGo.GetComponent<RectTransform>();
            if (rt == null) rt = AddComponent<RectTransform>(labelGo, undo);
            undo?.RecordObject(rt, "Update Button Label Rect");
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.sizeDelta = Vector2.zero;
            rt.offsetMin = Vector2.zero;
            rt.offsetMax = Vector2.zero;
            var label = labelGo.GetComponent<Text>();
            if (label == null) label = AddComponent<Text>(labelGo, undo);
            undo?.RecordObject(label, "Update Button Label");
            if (!string.IsNullOrEmpty(props.text)) label.text = props.text;
            label.font = DefaultFont();
            label.alignment = ParseAlignment(props.align, TextAnchor.MiddleCenter);
            if (TryParseColor(props.color, out Color lc)) label.color = Contrast(lc);
            if (props.fontSize > 0) label.fontSize = props.fontSize;
            label.fontStyle = ParseFontStyle(props.fontStyle, label.fontStyle);
        }

        private static void AttachInputFieldPlaceholder(GameObject input, ElementProps props, UndoScope undo = null)
        {
            EnsureInputFieldStructure(input, undo);
            var inputField = input.GetComponent<InputField>();
            if (inputField == null) return;
            undo?.RecordObject(inputField, "Update InputField Placeholder");
            Transform existing = input.transform.Find("Placeholder");
            GameObject phGo = existing != null ? existing.gameObject : new GameObject("Placeholder");
            if (existing == null)
            {
                undo?.RegisterCreated(phGo);
                phGo.transform.SetParent(input.transform, false);
            }
            var rt = phGo.GetComponent<RectTransform>();
            if (rt == null) rt = AddComponent<RectTransform>(phGo, undo);
            undo?.RecordObject(rt, "Update Placeholder Rect");
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.sizeDelta = Vector2.zero;
            rt.offsetMin = new Vector2(8f, 4f);
            rt.offsetMax = new Vector2(-8f, -4f);
            var ph = phGo.GetComponent<Text>();
            if (ph == null) ph = AddComponent<Text>(phGo, undo);
            undo?.RecordObject(ph, "Update Placeholder Text");
            string placeholderText = !string.IsNullOrEmpty(props.placeholder) ? props.placeholder : props.text;
            if (!string.IsNullOrEmpty(placeholderText)) ph.text = placeholderText;
            ph.font = DefaultFont();
            ph.color = new Color(0.5f, 0.5f, 0.5f, 0.7f);
            ph.alignment = ParseAlignment(props.align, TextAnchor.MiddleLeft);
            if (props.fontSize > 0) ph.fontSize = props.fontSize;
            ph.fontStyle = ParseFontStyle(props.fontStyle, ph.fontStyle);
            inputField.placeholder = ph;
        }

        private static Text AttachControlLabel(
            GameObject owner,
            string childName,
            ElementProps props,
            UndoScope undo,
            TextAnchor fallbackAlignment)
        {
            Transform existing = owner.transform.Find(childName);
            GameObject labelGo = existing != null ? existing.gameObject : new GameObject(childName);
            if (existing == null)
            {
                undo?.RegisterCreated(labelGo);
                labelGo.transform.SetParent(owner.transform, false);
            }
            var rt = labelGo.GetComponent<RectTransform>();
            if (rt == null) rt = AddComponent<RectTransform>(labelGo, undo);
            undo?.RecordObject(rt, "Update Control Label Rect");
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.sizeDelta = Vector2.zero;
            rt.offsetMin = new Vector2(8f, 4f);
            rt.offsetMax = new Vector2(-8f, -4f);

            var label = labelGo.GetComponent<Text>();
            if (label == null) label = AddComponent<Text>(labelGo, undo);
            undo?.RecordObject(label, "Update Control Label");
            if (!string.IsNullOrEmpty(props.text)) label.text = props.text;
            label.font = DefaultFont();
            label.alignment = ParseAlignment(props.align, fallbackAlignment);
            if (TryParseColor(props.color, out Color lc)) label.color = Contrast(lc);
            if (props.fontSize > 0) label.fontSize = props.fontSize;
            label.fontStyle = ParseFontStyle(props.fontStyle, label.fontStyle);
            return label;
        }

        private static void AttachDropdownCaption(GameObject dropdown, ElementProps props, UndoScope undo = null)
        {
            EnsureDropdownStructure(dropdown, undo);
            var dd = dropdown.GetComponent<Dropdown>();
            if (dd == null) return;
            Text caption = AttachControlLabel(dropdown, "Caption", props, undo, TextAnchor.MiddleLeft);
            undo?.RecordObject(dd, "Update Dropdown Caption");
            dd.captionText = caption;
            if (props.options != null && props.options.Length > 0)
            {
                dd.options.Clear();
                foreach (string option in props.options)
                {
                    dd.options.Add(new Dropdown.OptionData(option ?? string.Empty));
                }
            }
            else if (!string.IsNullOrEmpty(props.text))
            {
                dd.options.Clear();
                dd.options.Add(new Dropdown.OptionData(props.text));
            }
            if (props.hasValue && dd.options.Count > 0)
            {
                dd.value = Mathf.Clamp(Mathf.RoundToInt(props.value), 0, dd.options.Count - 1);
            }
            if (dd.options.Count > 0)
            {
                dd.value = Mathf.Clamp(dd.value, 0, dd.options.Count - 1);
                dd.RefreshShownValue();
                caption.text = dd.options[Mathf.Clamp(dd.value, 0, dd.options.Count - 1)].text;
            }
        }

        private static void AttachScrollViewText(GameObject scrollGo, ElementProps props, UndoScope undo = null)
        {
            EnsureScrollViewStructure(scrollGo, undo);
            var scroll = scrollGo.GetComponent<ScrollRect>();
            if (scroll == null || scroll.content == null) return;

            Image backgroundImage = scrollGo.GetComponent<Image>();
            Color textColor = Contrast(backgroundImage != null ? backgroundImage.color : Color.white);
            int fontSize = props.fontSize > 0 ? props.fontSize : 24;
            float lineHeight = Mathf.Max(18f, fontSize * 1.35f);
            TextAnchor alignment = ParseAlignment(props.align, TextAnchor.UpperLeft);
            FontStyle fontStyle = ParseFontStyle(props.fontStyle, FontStyle.Normal);
            IReadOnlyList<string> chunks = SplitScrollTextChunks(props.text);

            RemoveUnusedScrollTextChunks(scroll.content, chunks.Count);

            float top = ScrollTextPaddingTop;
            for (int i = 0; i < chunks.Count; i++)
            {
                GameObject textGo = EnsureChild(scroll.content.gameObject, ScrollTextChunkName(i), undo);
                RectTransform rt = EnsureRectTransform(textGo, undo);
                undo?.RecordObject(rt, "Update ScrollView Text Rect");

                Text text = textGo.GetComponent<Text>();
                if (text == null) text = AddComponent<Text>(textGo, undo);
                undo?.RecordObject(text, "Update ScrollView Text");
                text.text = chunks[i];
                text.font = DefaultFont();
                text.fontSize = fontSize;
                text.fontStyle = fontStyle;
                text.alignment = alignment;
                text.horizontalOverflow = HorizontalWrapMode.Wrap;
                text.verticalOverflow = VerticalWrapMode.Overflow;
                text.color = textColor;

                float height = Mathf.Max(24f, CountLines(chunks[i]) * lineHeight);
                LayoutScrollTextChunk(rt, top, height);
                top += height;
            }

            RectTransform content = scroll.content;
            undo?.RecordObject(content, "Update ScrollView Content Size");
            float contentHeight = Mathf.Max(120f, top + ScrollTextPaddingBottom);
            content.sizeDelta = new Vector2(content.sizeDelta.x, contentHeight);
        }

        private static IReadOnlyList<string> SplitScrollTextChunks(string value)
        {
            string text = string.IsNullOrEmpty(value) ? string.Empty : value.Replace("\r\n", "\n").Replace('\r', '\n');
            var chunks = new List<string>();
            if (text.Length == 0)
            {
                chunks.Add(string.Empty);
                return chunks;
            }

            var current = new System.Text.StringBuilder();
            foreach (string rawLine in text.Split('\n'))
            {
                string line = rawLine;
                while (line.Length > MaxScrollTextChunkChars)
                {
                    if (current.Length > 0)
                    {
                        chunks.Add(current.ToString());
                        current.Clear();
                    }
                    chunks.Add(line.Substring(0, MaxScrollTextChunkChars));
                    line = line.Substring(MaxScrollTextChunkChars);
                }

                int nextLength = current.Length == 0 ? line.Length : current.Length + 1 + line.Length;
                if (current.Length > 0 && nextLength > MaxScrollTextChunkChars)
                {
                    chunks.Add(current.ToString());
                    current.Clear();
                }
                if (current.Length > 0) current.Append('\n');
                current.Append(line);
            }

            if (current.Length > 0) chunks.Add(current.ToString());
            if (chunks.Count == 0) chunks.Add(string.Empty);
            return chunks;
        }

        private static string ScrollTextChunkName(int index)
        {
            return index == 0 ? "Text" : $"Text {index + 1}";
        }

        private static void RemoveUnusedScrollTextChunks(RectTransform content, int keepCount)
        {
            if (content == null) return;
            for (int i = content.childCount - 1; i >= 0; i--)
            {
                Transform child = content.GetChild(i);
                if (!TryParseScrollTextChunkName(child.name, out int index)) continue;
                if (index < keepCount) continue;
                UnityEditor.Undo.DestroyObjectImmediate(child.gameObject);
            }
        }

        private static bool TryParseScrollTextChunkName(string name, out int index)
        {
            index = -1;
            if (name == "Text")
            {
                index = 0;
                return true;
            }
            if (string.IsNullOrEmpty(name) || !name.StartsWith("Text ")) return false;
            if (!int.TryParse(name.Substring(5), out int number) || number < 2) return false;
            index = number - 1;
            return true;
        }

        private static void LayoutScrollTextChunk(RectTransform rt, float top, float height)
        {
            if (rt == null) return;
            rt.anchorMin = new Vector2(0f, 1f);
            rt.anchorMax = new Vector2(1f, 1f);
            rt.pivot = new Vector2(0.5f, 1f);
            rt.anchoredPosition = new Vector2(0f, -top);
            rt.sizeDelta = new Vector2(-(ScrollTextPaddingLeft + ScrollTextPaddingRight), height);
        }

        private static void EnsureInputFieldStructure(GameObject input, UndoScope undo)
        {
            var inputField = input.GetComponent<InputField>();
            if (inputField == null) return;

            var bg = input.GetComponent<Image>();
            if (bg != null && inputField.targetGraphic == null) inputField.targetGraphic = bg;

            Text text = EnsureTextChild(input, "Text", undo);
            Stretch(text.GetComponent<RectTransform>(), 8f, 4f, 8f, 4f);
            text.font = DefaultFont();
            text.color = Color.black;
            text.alignment = TextAnchor.MiddleLeft;
            text.supportRichText = false;
            inputField.textComponent = text;

            Text placeholder = EnsureTextChild(input, "Placeholder", undo);
            Stretch(placeholder.GetComponent<RectTransform>(), 8f, 4f, 8f, 4f);
            if (string.IsNullOrEmpty(placeholder.text)) placeholder.text = "Enter text...";
            placeholder.font = DefaultFont();
            placeholder.color = new Color(0.5f, 0.5f, 0.5f, 0.7f);
            placeholder.alignment = TextAnchor.MiddleLeft;
            inputField.placeholder = placeholder;
        }

        private static void EnsureToggleStructure(GameObject toggleGo, UndoScope undo)
        {
            var toggle = toggleGo.GetComponent<Toggle>();
            if (toggle == null) return;

            var rootImage = toggleGo.GetComponent<Image>();
            if (rootImage != null && toggle.targetGraphic == null) toggle.targetGraphic = rootImage;

            GameObject checkmarkGo = EnsureChild(toggleGo, "Checkmark", undo);
            RectTransform checkmarkRt = EnsureRectTransform(checkmarkGo, undo);
            checkmarkRt.anchorMin = new Vector2(0f, 0.5f);
            checkmarkRt.anchorMax = new Vector2(0f, 0.5f);
            checkmarkRt.pivot = new Vector2(0.5f, 0.5f);
            checkmarkRt.anchoredPosition = new Vector2(14f, 0f);
            checkmarkRt.sizeDelta = new Vector2(14f, 14f);
            Image checkmark = EnsureImage(checkmarkGo, undo);
            checkmark.color = Color.white;
            toggle.graphic = checkmark;
        }

        private static void EnsureSliderStructure(GameObject sliderGo, UndoScope undo)
        {
            var slider = sliderGo.GetComponent<Slider>();
            if (slider == null) return;

            var bg = sliderGo.GetComponent<Image>();
            if (bg != null && slider.targetGraphic == null) slider.targetGraphic = bg;

            GameObject fillArea = EnsureChild(sliderGo, "Fill Area", undo);
            Stretch(EnsureRectTransform(fillArea, undo), 8f, 0f, 18f, 0f);
            GameObject fill = EnsureChild(fillArea, "Fill", undo);
            Stretch(EnsureRectTransform(fill, undo), 0f, 0f, 0f, 0f);
            Image fillImage = EnsureImage(fill, undo);
            fillImage.color = new Color(0.25f, 0.5f, 0.95f, 1f);
            slider.fillRect = fill.GetComponent<RectTransform>();

            GameObject handleArea = EnsureChild(sliderGo, "Handle Slide Area", undo);
            Stretch(EnsureRectTransform(handleArea, undo), 8f, 0f, 8f, 0f);
            GameObject handle = EnsureChild(handleArea, "Handle", undo);
            RectTransform handleRt = EnsureRectTransform(handle, undo);
            handleRt.anchorMin = new Vector2(0.5f, 0f);
            handleRt.anchorMax = new Vector2(0.5f, 1f);
            handleRt.pivot = new Vector2(0.5f, 0.5f);
            handleRt.sizeDelta = new Vector2(18f, 0f);
            Image handleImage = EnsureImage(handle, undo);
            handleImage.color = Color.white;
            slider.handleRect = handleRt;
        }

        private static void EnsureScrollViewStructure(GameObject scrollGo, UndoScope undo)
        {
            var scroll = scrollGo.GetComponent<ScrollRect>();
            if (scroll == null) return;

            GameObject viewport = EnsureChild(scrollGo, "Viewport", undo);
            Stretch(EnsureRectTransform(viewport, undo), 6f, 6f, 6f, 6f);
            Image viewportImage = EnsureImage(viewport, undo);
            viewportImage.color = new Color(1f, 1f, 1f, 0.08f);
            if (viewport.GetComponent<RectMask2D>() == null) AddComponent<RectMask2D>(viewport, undo);

            GameObject content = EnsureChild(viewport, "Content", undo);
            RectTransform contentRt = EnsureRectTransform(content, undo);
            contentRt.anchorMin = new Vector2(0f, 1f);
            contentRt.anchorMax = new Vector2(1f, 1f);
            contentRt.pivot = new Vector2(0.5f, 1f);
            contentRt.anchoredPosition = Vector2.zero;
            contentRt.sizeDelta = new Vector2(0f, 120f);

            scroll.viewport = viewport.GetComponent<RectTransform>();
            scroll.content = contentRt;
            scroll.horizontal = false;
            scroll.vertical = true;
        }

        private static void EnsureDropdownStructure(GameObject dropdownGo, UndoScope undo)
        {
            var dropdown = dropdownGo.GetComponent<Dropdown>();
            if (dropdown == null) return;

            var bg = dropdownGo.GetComponent<Image>();
            if (bg != null && dropdown.targetGraphic == null) dropdown.targetGraphic = bg;

            Text caption = EnsureTextChild(dropdownGo, "Caption", undo);
            Stretch(caption.GetComponent<RectTransform>(), 8f, 4f, 24f, 4f);
            caption.font = DefaultFont();
            caption.color = Color.black;
            caption.alignment = TextAnchor.MiddleLeft;
            dropdown.captionText = caption;

            GameObject template = EnsureChild(dropdownGo, "Template", undo);
            RectTransform templateRt = EnsureRectTransform(template, undo);
            templateRt.anchorMin = new Vector2(0f, 0f);
            templateRt.anchorMax = new Vector2(1f, 0f);
            templateRt.pivot = new Vector2(0.5f, 1f);
            templateRt.anchoredPosition = new Vector2(0f, 2f);
            templateRt.sizeDelta = new Vector2(0f, 150f);
            EnsureImage(template, undo).color = Color.white;
            var templateScroll = template.GetComponent<ScrollRect>();
            if (templateScroll == null) templateScroll = AddComponent<ScrollRect>(template, undo);

            GameObject viewport = EnsureChild(template, "Viewport", undo);
            Stretch(EnsureRectTransform(viewport, undo), 0f, 0f, 0f, 0f);
            if (viewport.GetComponent<RectMask2D>() == null) AddComponent<RectMask2D>(viewport, undo);
            GameObject content = EnsureChild(viewport, "Content", undo);
            RectTransform contentRt = EnsureRectTransform(content, undo);
            contentRt.anchorMin = new Vector2(0f, 1f);
            contentRt.anchorMax = new Vector2(1f, 1f);
            contentRt.pivot = new Vector2(0.5f, 1f);
            contentRt.sizeDelta = new Vector2(0f, 30f);

            GameObject item = EnsureChild(content, "Item", undo);
            RectTransform itemRt = EnsureRectTransform(item, undo);
            itemRt.anchorMin = new Vector2(0f, 1f);
            itemRt.anchorMax = new Vector2(1f, 1f);
            itemRt.pivot = new Vector2(0.5f, 1f);
            itemRt.sizeDelta = new Vector2(0f, 30f);
            Toggle itemToggle = item.GetComponent<Toggle>();
            if (itemToggle == null) itemToggle = AddComponent<Toggle>(item, undo);
            Image itemImage = EnsureImage(item, undo);
            itemImage.color = new Color(0.92f, 0.92f, 0.92f, 1f);
            itemToggle.targetGraphic = itemImage;

            Text itemLabel = EnsureTextChild(item, "Item Label", undo);
            Stretch(itemLabel.GetComponent<RectTransform>(), 8f, 2f, 8f, 2f);
            itemLabel.font = DefaultFont();
            itemLabel.color = Color.black;
            itemLabel.alignment = TextAnchor.MiddleLeft;

            templateScroll.viewport = viewport.GetComponent<RectTransform>();
            templateScroll.content = contentRt;
            templateScroll.horizontal = false;
            templateScroll.vertical = true;
            dropdown.template = templateRt;
            dropdown.itemText = itemLabel;
            dropdown.itemImage = itemImage;
            template.SetActive(false);
        }

        private static GameObject EnsureChild(GameObject owner, string name, UndoScope undo)
        {
            Transform existing = owner.transform.Find(name);
            if (existing != null) return existing.gameObject;
            var child = new GameObject(name);
            undo?.RegisterCreated(child);
            child.transform.SetParent(owner.transform, false);
            return child;
        }

        private static RectTransform EnsureRectTransform(GameObject go, UndoScope undo)
        {
            var rt = go.GetComponent<RectTransform>();
            return rt != null ? rt : AddComponent<RectTransform>(go, undo);
        }

        private static Image EnsureImage(GameObject go, UndoScope undo)
        {
            var image = go.GetComponent<Image>();
            return image != null ? image : AddComponent<Image>(go, undo);
        }

        private static Text EnsureTextChild(GameObject owner, string name, UndoScope undo)
        {
            GameObject child = EnsureChild(owner, name, undo);
            EnsureRectTransform(child, undo);
            Text text = child.GetComponent<Text>();
            if (text == null) text = AddComponent<Text>(child, undo);
            return text;
        }

        private static void Stretch(RectTransform rt, float left, float top, float right, float bottom)
        {
            if (rt == null) return;
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = Vector2.zero;
            rt.offsetMin = new Vector2(left, bottom);
            rt.offsetMax = new Vector2(-right, -top);
        }

        private static Font DefaultFont()
        {
            // Unity 6 ships LegacyRuntime.ttf as the built-in legacy Text font.
            Font f = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            return f != null ? f : Resources.GetBuiltinResource<Font>("Arial.ttf");
        }

        private static string InferElementType(GameObject go)
        {
            if (go.GetComponent<Button>() != null) return "Button";
            if (go.GetComponent<InputField>() != null) return "InputField";
            if (go.GetComponent<Toggle>() != null) return "Toggle";
            if (go.GetComponent<Slider>() != null) return "Slider";
            if (go.GetComponent<ScrollRect>() != null) return "ScrollView";
            if (go.GetComponent<Dropdown>() != null) return "Dropdown";
            if (go.GetComponent<Text>() != null) return "Text";
            if (go.GetComponent<Image>() != null) return "Image";
            return "Panel";
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

        private static VideoClip TryLoadVideoClip(string assetPath)
        {
            if (string.IsNullOrEmpty(assetPath)) return null;
            var clip = UnityEditor.AssetDatabase.LoadAssetAtPath<VideoClip>(assetPath);
            if (clip == null) Debug.LogWarning($"[OhMyUnity] video clip not found at \"{assetPath}\"");
            return clip;
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

        private static FontStyle ParseFontStyle(string raw, FontStyle fallback)
        {
            if (string.IsNullOrEmpty(raw)) return fallback;
            string normalized = raw.Trim().Replace(" ", string.Empty).Replace("_", string.Empty).Replace("-", string.Empty);
            switch (normalized.ToLowerInvariant())
            {
                case "normal": return FontStyle.Normal;
                case "bold": return FontStyle.Bold;
                case "italic": return FontStyle.Italic;
                case "bolditalic":
                case "boldanditalic":
                    return FontStyle.BoldAndItalic;
            }
            return Enum.TryParse(normalized, true, out FontStyle style) ? style : fallback;
        }

        // Choose black or white label color depending on background brightness so a Button's
        // text stays readable on any user-chosen background color.
        private static Color Contrast(Color bg)
        {
            float luminance = 0.299f * bg.r + 0.587f * bg.g + 0.114f * bg.b;
            return luminance > 0.5f ? Color.black : Color.white;
        }

        private static int CountLines(string value)
        {
            if (string.IsNullOrEmpty(value)) return 1;
            int count = 1;
            for (int i = 0; i < value.Length; i++)
            {
                if (value[i] == '\n') count++;
            }
            return count;
        }

        private static void ApplyRect(GameObject go, IntentElementData el, float canvasWidth, float canvasHeight)
        {
            var rt = go.GetComponent<RectTransform>();
            if (rt == null) return;
            ApplyRectTransform(rt, el.rect, el.anchor, canvasWidth, canvasHeight);
        }

        private static void ApplyRectTransform(RectTransform rt, NormRectData rect, string anchor, float canvasWidth, float canvasHeight)
        {
            Rect px = CoordinateMapper.NormRectToPx(rect, canvasWidth, canvasHeight);
            Vector2 preset = ParseAnchorPreset(anchor);
            Vector2 anchorRef = new Vector2(preset.x * canvasWidth, (1f - preset.y) * canvasHeight);
            Vector2 pivotPoint = new Vector2(
                px.x + preset.x * px.width,
                px.y + (1f - preset.y) * px.height);

            rt.anchorMin = preset;
            rt.anchorMax = preset;
            rt.pivot = preset;
            rt.sizeDelta = new Vector2(px.width, px.height);
            rt.anchoredPosition = new Vector2(
                pivotPoint.x - anchorRef.x,
                -(pivotPoint.y - anchorRef.y));
        }

        private static NormRectData InspectRect(RectTransform rt, float canvasWidth, float canvasHeight)
        {
            Vector2 anchor = rt.anchorMin;
            float width = rt.sizeDelta.x;
            float height = rt.sizeDelta.y;
            Vector2 anchorRef = new Vector2(anchor.x * canvasWidth, (1f - anchor.y) * canvasHeight);
            Vector2 pivotPoint = new Vector2(
                anchorRef.x + rt.anchoredPosition.x,
                anchorRef.y - rt.anchoredPosition.y);
            float x = pivotPoint.x - rt.pivot.x * width;
            float y = pivotPoint.y - (1f - rt.pivot.y) * height;
            return new NormRectData
            {
                x = x / canvasWidth,
                y = y / canvasHeight,
                w = width / canvasWidth,
                h = height / canvasHeight,
            };
        }

        private static Vector2 ParseAnchorPreset(string raw)
        {
            string normalized = string.IsNullOrEmpty(raw) ? "MiddleCenter" : raw.Trim();
            switch (normalized)
            {
                case "TopLeft":      return new Vector2(0f, 1f);
                case "Top":
                case "TopCenter":    return new Vector2(0.5f, 1f);
                case "TopRight":     return new Vector2(1f, 1f);
                case "Left":
                case "MiddleLeft":   return new Vector2(0f, 0.5f);
                case "Center":
                case "Middle":
                case "MiddleCenter": return new Vector2(0.5f, 0.5f);
                case "Right":
                case "MiddleRight":  return new Vector2(1f, 0.5f);
                case "BottomLeft":   return new Vector2(0f, 0f);
                case "Bottom":
                case "BottomCenter": return new Vector2(0.5f, 0f);
                case "BottomRight":  return new Vector2(1f, 0f);
            }
            return new Vector2(0.5f, 0.5f);
        }

        private static void StampId(GameObject go, string id, UndoScope undo)
        {
            var marker = go.GetComponent<ScreenElementId>();
            if (marker == null) marker = AddComponent<ScreenElementId>(go, undo);
            marker.Assign(id);
        }

        private static T AddComponent<T>(GameObject go, UndoScope undo) where T : Component
        {
            return undo != null ? UnityEditor.Undo.AddComponent<T>(go) : go.AddComponent<T>();
        }

        private static GameObject FindById(string id)
        {
            foreach (ScreenElementId marker in UnityEngine.Object.FindObjectsByType<ScreenElementId>(
                FindObjectsInactive.Include,
                FindObjectsSortMode.None))
            {
                if (marker.ElementId == id) return marker.gameObject;
            }
            return null;
        }

        private static string MintUniqueElementId()
        {
            string id;
            do
            {
                id = "elem-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            } while (FindById(id) != null);
            return id;
        }

        private static bool IsDescendantOf(Transform candidate, Transform root)
        {
            for (Transform current = candidate; current != null; current = current.parent)
            {
                if (current == root) return true;
            }
            return false;
        }

        private static void RegisterWithFlow(string screenId, GameObject screen, UndoScope undo)
        {
            ScreenFlowController controller = UnityEngine.Object.FindFirstObjectByType<ScreenFlowController>();
            if (controller == null)
            {
                var go = new GameObject("ScreenFlow");
                undo.RegisterCreated(go);
                controller = go.AddComponent<ScreenFlowController>();
            }
            undo.RecordObject(controller, "Register Screen");
            controller.RegisterScreen(screenId, screen);
            ScreenFlowController.EnsureEventSystem();
        }
    }
}
