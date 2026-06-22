using System.Linq;
using Lyx.OhMyUnity.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Video;
using UnityEngine.UI;

namespace Lyx.OhMyUnity.Tests
{
    [TestFixture]
    public sealed class UguiBackendTests
    {
        [Test]
        public void UpdateElement_PropsOnly_UpdatesText()
        {
            var go = new GameObject("TextTarget");
            try
            {
                go.AddComponent<RectTransform>();
                var marker = go.AddComponent<ScreenElementId>();
                marker.Assign("elem-text");
                var text = go.AddComponent<Text>();

                using var undo = new UndoScope("Test Text Props");
                bool ok = new UguiBackend().UpdateElement(
                    "elem-text",
                    null,
                    null,
                    new ElementProps { text = "Updated", fontSize = 24, fontStyle = "BoldAndItalic", color = "#112233" },
                    undo);

                Assert.IsTrue(ok);
                Assert.AreEqual("Updated", text.text);
                Assert.AreEqual(24, text.fontSize);
                Assert.AreEqual(FontStyle.BoldAndItalic, text.fontStyle);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void UpdateElement_ButtonText_ReusesExistingLabel()
        {
            var go = new GameObject("ButtonTarget");
            try
            {
                go.AddComponent<RectTransform>();
                var marker = go.AddComponent<ScreenElementId>();
                marker.Assign("elem-button");
                go.AddComponent<Image>();
                go.AddComponent<Button>();

                var backend = new UguiBackend();
                using var undo = new UndoScope("Test Button Props");
                Assert.IsTrue(backend.UpdateElement(
                    "elem-button",
                    null,
                    null,
                    new ElementProps { text = "First", fontStyle = "Bold" },
                    undo));
                Assert.IsTrue(backend.UpdateElement(
                    "elem-button",
                    null,
                    null,
                    new ElementProps { text = "Second", fontStyle = "Italic" },
                    undo));
                Assert.IsTrue(backend.UpdateElement(
                    "elem-button",
                    null,
                    null,
                    new ElementProps { fontStyle = "Bold" },
                    undo));

                var labels = go.transform
                    .Cast<Transform>()
                    .Where(t => t.name == "Label")
                    .ToArray();
                Assert.AreEqual(1, labels.Length);
                Assert.AreEqual("Second", labels[0].GetComponent<Text>().text);
                Assert.AreEqual(FontStyle.Bold, labels[0].GetComponent<Text>().fontStyle);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void CreateAndUpdateElement_HonorsAnchorPreset_WithoutChangingNormalizedRect()
        {
            var backend = new UguiBackend();
            string screenId = null;

            try
            {
                using var undo = new UndoScope("Test Element Anchor");
                CreateScreenResult result = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "AnchorScreen",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 500f },
                    elements = new[]
                    {
                        new IntentElementData
                        {
                            clientHintId = "centered",
                            type = "Panel",
                            anchor = "MiddleCenter",
                            rect = new NormRectData { x = 0.25f, y = 0.4f, w = 0.5f, h = 0.2f },
                        },
                    },
                }, undo);
                screenId = result.ScreenId;
                string elementId = result.Elements.Single(pair => pair.ClientHintId == "centered").ElementId;

                RectTransform rt = FindById(elementId).GetComponent<RectTransform>();
                AssertVector(new Vector2(0.5f, 0.5f), rt.anchorMin);
                AssertVector(new Vector2(0.5f, 0.5f), rt.anchorMax);
                AssertVector(new Vector2(0.5f, 0.5f), rt.pivot);
                AssertVector(Vector2.zero, rt.anchoredPosition);
                AssertVector(new Vector2(500f, 100f), rt.sizeDelta);

                Assert.IsTrue(backend.UpdateElement(elementId, null, "BottomRight", null, undo));
                AssertVector(new Vector2(1f, 0f), rt.anchorMin);
                AssertVector(new Vector2(1f, 0f), rt.anchorMax);
                AssertVector(new Vector2(1f, 0f), rt.pivot);
                AssertVector(new Vector2(-250f, 200f), rt.anchoredPosition);
                AssertVector(new Vector2(500f, 100f), rt.sizeDelta);
            }
            finally
            {
                DestroyById(screenId);
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        [Test]
        public void CreateScreen_ChildRect_IsRelativeToParentBox_NotCanvas()
        {
            var backend = new UguiBackend();
            string screenId = null;

            try
            {
                using var undo = new UndoScope("Test Nested Rect");
                CreateScreenResult result = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "NestedRectScreen",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 1000f },
                    elements = new[]
                    {
                        new IntentElementData
                        {
                            clientHintId = "panel",
                            type = "Panel",
                            anchor = "TopLeft",
                            rect = new NormRectData { x = 0.25f, y = 0.25f, w = 0.5f, h = 0.5f },
                        },
                        new IntentElementData
                        {
                            clientHintId = "child",
                            parentClientHintId = "panel",
                            type = "Panel",
                            anchor = "TopLeft",
                            rect = new NormRectData { x = 0f, y = 0f, w = 1f, h = 1f },
                        },
                    },
                }, undo);
                screenId = result.ScreenId;
                string childId = result.Elements.Single(pair => pair.ClientHintId == "child").ElementId;

                RectTransform childRt = FindById(childId).GetComponent<RectTransform>();
                // Parent panel is 0.5 * 1000 = 500 px. A child of (0,0,1,1) must fill the PARENT
                // (500x500), not the canvas (1000x1000). Regression for the canvas-frame bug.
                AssertVector(new Vector2(500f, 500f), childRt.sizeDelta);
                AssertVector(new Vector2(0f, 1f), childRt.anchorMin);
                AssertVector(Vector2.zero, childRt.anchoredPosition);
            }
            finally
            {
                DestroyById(screenId);
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        [Test]
        public void AddElement_WithParentElementId_ParentsUnderExistingElement_AndUsesUniqueIds()
        {
            var backend = new UguiBackend();
            string screenId = null;

            try
            {
                using var undo = new UndoScope("Test Add Element Parent");
                CreateScreenResult result = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "ParentAddScreen",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 1000f },
                    elements = new[]
                    {
                        new IntentElementData
                        {
                            clientHintId = "panel",
                            type = "Panel",
                            rect = new NormRectData { x = 0.1f, y = 0.1f, w = 0.8f, h = 0.8f },
                        },
                    },
                }, undo);
                screenId = result.ScreenId;
                string panelId = result.Elements.Single(pair => pair.ClientHintId == "panel").ElementId;

                string firstId = backend.AddElement(screenId, new IntentElementData
                {
                    parentElementId = panelId,
                    type = "Text",
                    rect = new NormRectData { x = 0.2f, y = 0.2f, w = 0.3f, h = 0.1f },
                    props = new ElementProps { text = "First" },
                }, undo);
                string secondId = backend.AddElement(screenId, new IntentElementData
                {
                    parentElementId = panelId,
                    type = "Text",
                    rect = new NormRectData { x = 0.2f, y = 0.35f, w = 0.3f, h = 0.1f },
                    props = new ElementProps { text = "Second" },
                }, undo);

                GameObject panel = FindById(panelId);
                GameObject first = FindById(firstId);
                GameObject second = FindById(secondId);

                Assert.IsNotNull(panel);
                Assert.IsNotNull(first);
                Assert.IsNotNull(second);
                Assert.AreNotEqual(firstId, secondId);
                Assert.AreSame(panel.transform, first.transform.parent);
                Assert.AreSame(panel.transform, second.transform.parent);
            }
            finally
            {
                DestroyById(screenId);
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        [Test]
        public void CreateScreen_AppliesCommonControlProps()
        {
            var backend = new UguiBackend();
            string screenId = null;

            try
            {
                using var undo = new UndoScope("Test Common Control Props");
                CreateScreenResult result = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "CommonControlProps",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 1000f },
                    elements = new[]
                    {
                        new IntentElementData
                        {
                            clientHintId = "input",
                            type = "InputField",
                            rect = new NormRectData { x = 0.1f, y = 0.02f, w = 0.4f, h = 0.06f },
                            props = new ElementProps { placeholder = "Player name", inputText = "Lyx", color = "#F2F4F8", fontSize = 18, align = "MiddleLeft", hasInteractable = true, interactable = false },
                        },
                        new IntentElementData
                        {
                            clientHintId = "toggle",
                            type = "Toggle",
                            rect = new NormRectData { x = 0.1f, y = 0.1f, w = 0.3f, h = 0.08f },
                            props = new ElementProps { text = "Remember", color = "#224466", fontSize = 18, align = "MiddleLeft", hasIsOn = true, isOn = true },
                        },
                        new IntentElementData
                        {
                            clientHintId = "slider",
                            type = "Slider",
                            rect = new NormRectData { x = 0.1f, y = 0.25f, w = 0.4f, h = 0.08f },
                            props = new ElementProps { color = "#336699", hasMinValue = true, minValue = 0f, hasMaxValue = true, maxValue = 10f, hasValue = true, value = 7.5f },
                        },
                        new IntentElementData
                        {
                            clientHintId = "scroll",
                            type = "ScrollView",
                            rect = new NormRectData { x = 0.1f, y = 0.4f, w = 0.4f, h = 0.2f },
                            props = new ElementProps { text = "Line one\nLine two\nLine three\nLine four\nLine five\nLine six", color = "#445566", fontSize = 21, align = "UpperLeft" },
                        },
                        new IntentElementData
                        {
                            clientHintId = "dropdown",
                            type = "Dropdown",
                            rect = new NormRectData { x = 0.1f, y = 0.7f, w = 0.4f, h = 0.08f },
                            props = new ElementProps { text = "Choose", color = "#556677", fontSize = 20, align = "MiddleLeft", options = new[] { "Easy", "Normal", "Hard" }, hasValue = true, value = 2f },
                        },
                    },
                }, undo);
                screenId = result.ScreenId;

                GameObject input = FindById(result.Elements.Single(pair => pair.ClientHintId == "input").ElementId);
                var inputField = input.GetComponent<InputField>();
                Assert.IsNotNull(inputField.textComponent);
                Assert.IsNotNull(inputField.placeholder);
                Assert.AreEqual("Player name", ((Text)inputField.placeholder).text);
                Assert.AreEqual("Lyx", inputField.text);
                Assert.IsFalse(inputField.interactable);

                GameObject toggle = FindById(result.Elements.Single(pair => pair.ClientHintId == "toggle").ElementId);
                Assert.AreEqual("#224466FF", "#" + ColorUtility.ToHtmlStringRGBA(toggle.GetComponent<Image>().color));
                Assert.IsNotNull(toggle.GetComponent<Toggle>().graphic);
                Assert.IsTrue(toggle.GetComponent<Toggle>().isOn);
                Assert.AreEqual("Remember", toggle.transform.Find("Label").GetComponent<Text>().text);

                GameObject slider = FindById(result.Elements.Single(pair => pair.ClientHintId == "slider").ElementId);
                Assert.AreEqual("#336699FF", "#" + ColorUtility.ToHtmlStringRGBA(slider.GetComponent<Image>().color));
                Assert.IsNotNull(slider.GetComponent<Slider>().fillRect);
                Assert.IsNotNull(slider.GetComponent<Slider>().handleRect);
                Assert.AreEqual(0f, slider.GetComponent<Slider>().minValue);
                Assert.AreEqual(10f, slider.GetComponent<Slider>().maxValue);
                Assert.AreEqual(7.5f, slider.GetComponent<Slider>().value);

                GameObject scroll = FindById(result.Elements.Single(pair => pair.ClientHintId == "scroll").ElementId);
                Assert.AreEqual("#445566FF", "#" + ColorUtility.ToHtmlStringRGBA(scroll.GetComponent<Image>().color));
                Assert.IsNotNull(scroll.GetComponent<ScrollRect>().viewport);
                Assert.IsNotNull(scroll.GetComponent<ScrollRect>().content);
                Text scrollText = scroll.GetComponent<ScrollRect>().content.Find("Text").GetComponent<Text>();
                Assert.AreEqual("Line one\nLine two\nLine three\nLine four\nLine five\nLine six", scrollText.text);
                Assert.AreEqual(21, scrollText.fontSize);
                Assert.AreEqual(TextAnchor.UpperLeft, scrollText.alignment);
                Assert.Greater(scroll.GetComponent<ScrollRect>().content.sizeDelta.y, 120f);

                GameObject dropdown = FindById(result.Elements.Single(pair => pair.ClientHintId == "dropdown").ElementId);
                Assert.AreEqual("#556677FF", "#" + ColorUtility.ToHtmlStringRGBA(dropdown.GetComponent<Image>().color));
                var dropdownControl = dropdown.GetComponent<Dropdown>();
                Assert.AreEqual(3, dropdownControl.options.Count);
                Assert.AreEqual(2, dropdownControl.value);
                Assert.AreEqual("Hard", dropdownControl.captionText.text);
                Assert.IsNotNull(dropdownControl.template);
                Assert.IsNotNull(dropdownControl.itemText);
                Assert.IsFalse(dropdownControl.template.gameObject.activeSelf);
            }
            finally
            {
                DestroyById(screenId);
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        [Test]
        public void CreateScreen_VideoElement_CreatesPlayableVideoStructure()
        {
            var backend = new UguiBackend();
            string screenId = null;

            try
            {
                using var undo = new UndoScope("Test Video Element");
                CreateScreenResult result = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "VideoScreen",
                    referenceCanvas = new ReferenceCanvasData { width = 1920f, height = 1080f },
                    elements = new[]
                    {
                        new IntentElementData
                        {
                            clientHintId = "video",
                            type = "Video",
                            rect = new NormRectData { x = 0.1f, y = 0.1f, w = 0.8f, h = 0.7f },
                            props = new ElementProps
                            {
                                video = "Assets/UOS/Videos/intro.mp4",
                                hasLoop = true,
                                loop = true,
                                hasPlayOnAwake = true,
                                playOnAwake = true,
                                hasMuted = true,
                                muted = true,
                            },
                        },
                    },
                }, undo);
                screenId = result.ScreenId;

                GameObject video = FindById(result.Elements.Single(pair => pair.ClientHintId == "video").ElementId);
                Assert.IsNotNull(video);
                var rawImage = video.GetComponent<RawImage>();
                var player = video.GetComponent<VideoPlayer>();
                var audio = video.GetComponent<AudioSource>();
                Assert.IsNotNull(rawImage);
                Assert.IsNotNull(player);
                Assert.IsNotNull(audio);
                Assert.IsInstanceOf<RenderTexture>(rawImage.texture);
                Assert.AreSame(rawImage.texture, player.targetTexture);
                Assert.AreEqual(VideoRenderMode.RenderTexture, player.renderMode);
                Assert.AreEqual(VideoAudioOutputMode.AudioSource, player.audioOutputMode);
                Assert.IsTrue(player.isLooping);
                Assert.IsTrue(player.playOnAwake);
                Assert.IsTrue(audio.mute);
            }
            finally
            {
                DestroyById(screenId);
                AssetDatabase.DeleteAsset("Assets/UOS/Generated");
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        [Test]
        public void CreateScreen_SplitsLongScrollViewText_IntoMeshSafeChunks()
        {
            var backend = new UguiBackend();
            string screenId = null;
            string longText = string.Join("\n", Enumerable.Range(1, 420)
                .Select(i => $"Line {i:D3} " + new string('x', 80)));

            try
            {
                using var undo = new UndoScope("Test Long ScrollView Text");
                CreateScreenResult result = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "LongScrollText",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 1000f },
                    elements = new[]
                    {
                        new IntentElementData
                        {
                            clientHintId = "scroll",
                            type = "ScrollView",
                            rect = new NormRectData { x = 0.1f, y = 0.1f, w = 0.8f, h = 0.8f },
                            props = new ElementProps { text = longText, fontSize = 20, align = "UpperLeft" },
                        },
                    },
                }, undo);
                screenId = result.ScreenId;

                GameObject scroll = FindById(result.Elements.Single(pair => pair.ClientHintId == "scroll").ElementId);
                Transform content = scroll.GetComponent<ScrollRect>().content;
                var chunks = content
                    .Cast<Transform>()
                    .Where(t => t.name == "Text" || t.name.StartsWith("Text "))
                    .OrderBy(t => t.name == "Text" ? 0 : int.Parse(t.name.Substring(5)) - 1)
                    .Select(t => t.GetComponent<Text>())
                    .ToArray();

                Assert.Greater(chunks.Length, 1);
                Assert.IsTrue(chunks.All(text => text.text.Length <= 6000));
                Assert.IsTrue(chunks[0].text.StartsWith("Line 001"));
                Assert.IsTrue(chunks[chunks.Length - 1].text.Contains("Line 420"));
                Assert.Greater(content.GetComponent<RectTransform>().sizeDelta.y, 1000f);
            }
            finally
            {
                DestroyById(screenId);
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        [Test]
        public void SetActiveScreen_ActivatesTarget_AndKeepsInactiveScreensListable()
        {
            var backend = new UguiBackend();
            string firstScreenId = null;
            string secondScreenId = null;

            try
            {
                using var undo = new UndoScope("Test Set Active Screen");
                firstScreenId = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "FirstScreen",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 1000f },
                    elements = new IntentElementData[0],
                }, undo).ScreenId;
                secondScreenId = backend.CreateScreen(new PlanningIntentData
                {
                    screenName = "SecondScreen",
                    referenceCanvas = new ReferenceCanvasData { width = 1000f, height = 1000f },
                    elements = new IntentElementData[0],
                }, undo).ScreenId;

                Assert.IsTrue(backend.SetActiveScreen(secondScreenId, undo));

                GameObject first = FindById(firstScreenId);
                GameObject second = FindById(secondScreenId);
                Assert.IsNotNull(first);
                Assert.IsNotNull(second);
                Assert.IsFalse(first.activeSelf);
                Assert.IsTrue(second.activeSelf);
                CollectionAssert.Contains(backend.ListScreens().ToArray(), firstScreenId);
                CollectionAssert.Contains(backend.ListScreens().ToArray(), secondScreenId);

                ScreenFlowController controller = Object.FindFirstObjectByType<ScreenFlowController>();
                Assert.IsNotNull(controller);
                Assert.AreEqual(secondScreenId, controller.ActiveScreenId);
            }
            finally
            {
                DestroyById(firstScreenId);
                DestroyById(secondScreenId);
                foreach (ScreenFlowController controller in Object.FindObjectsByType<ScreenFlowController>(FindObjectsSortMode.None))
                {
                    Object.DestroyImmediate(controller.gameObject);
                }
            }
        }

        private static GameObject FindById(string elementId)
        {
            if (string.IsNullOrEmpty(elementId)) return null;
            return Object.FindObjectsByType<ScreenElementId>(
                    FindObjectsInactive.Include,
                    FindObjectsSortMode.None)
                .FirstOrDefault(marker => marker.ElementId == elementId)
                ?.gameObject;
        }

        private static void DestroyById(string elementId)
        {
            GameObject go = FindById(elementId);
            if (go != null) Object.DestroyImmediate(go);
        }

        private static void AssertVector(Vector2 expected, Vector2 actual)
        {
            Assert.AreEqual(expected.x, actual.x, 1e-4f);
            Assert.AreEqual(expected.y, actual.y, 1e-4f);
        }
    }
}
