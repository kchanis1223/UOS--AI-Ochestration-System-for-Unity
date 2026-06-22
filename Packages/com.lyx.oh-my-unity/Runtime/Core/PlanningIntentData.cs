using System;

namespace Lyx.OhMyUnity
{
    /// <summary>
    /// Plain serializable mirror of the PlanningIntent JSON Schema (schemas/planning-intent.schema.json).
    /// Resolution-independent, backend-neutral. Coordinates are normalized 0..1 relative to
    /// <see cref="ReferenceCanvasData"/>. The boundary contract between client interpretation and
    /// Unity-side generation. Marked [Serializable] for UnityEngine.JsonUtility round-tripping.
    /// </summary>
    [Serializable]
    public class PlanningIntentData
    {
        public const string ExpectedVersion = "1.0.0";

        public string version;
        public string screenName;
        public ReferenceCanvasData referenceCanvas;
        public IntentElementData[] elements;
    }

    [Serializable]
    public class ReferenceCanvasData
    {
        public float width;
        public float height;
    }

    [Serializable]
    public class IntentElementData
    {
        /// <summary>Advisory client id. Authoritative ONLY for intra-call parent linkage.</summary>
        public string clientHintId;

        /// <summary>clientHintId of the parent within this same intent (empty for a root element).</summary>
        public string parentClientHintId;

        /// <summary>Canonical parent element id for follow-up add_ui_element calls against an existing screen.</summary>
        public string parentElementId;

        /// <summary>One of: Panel, Text, Button, Image, InputField, Toggle, Slider, ScrollView, Dropdown, Video.</summary>
        public string type;

        public NormRectData rect;

        /// <summary>RectTransform anchor preset name (default MiddleCenter).</summary>
        public string anchor;

        /// <summary>
        /// Style/content properties applied per element type. Optional; null = wireframe (legacy v0.1 behavior).
        /// Concrete handling lives in UguiBackend.ApplyProps. Use a fixed-field type instead of a free-form
        /// dictionary so JsonUtility (which silently drops unknown fields) can round-trip it.
        /// </summary>
        public ElementProps props;
    }

    /// <summary>Normalized rectangle, top-left origin, 0..1 fraction of the reference canvas.</summary>
    [Serializable]
    public class NormRectData
    {
        public float x;
        public float y;
        public float w;
        public float h;
    }

    /// <summary>
    /// Fixed-field style/content props. JsonUtility-compatible (no dictionaries). Each field is optional;
    /// empty/zero means "leave default". See UguiBackend.ApplyProps for per-type interpretation.
    /// </summary>
    [Serializable]
    public class ElementProps
    {
        /// <summary>Text label (Text content, Button label, ScrollView body text, legacy InputField placeholder).</summary>
        public string text;

        /// <summary>InputField placeholder text. Empty = use text/default.</summary>
        public string placeholder;

        /// <summary>InputField current text value. Empty = leave default/empty.</summary>
        public string inputText;

        /// <summary>Foreground/background color as "#RRGGBB" or "#RRGGBBAA". Empty = leave default.</summary>
        public string color;

        /// <summary>Text font size in pt. 0 = leave default.</summary>
        public int fontSize;

        /// <summary>Sprite asset path (e.g. "Assets/UI/btn.png"). Resolved via AssetDatabase.LoadAssetAtPath.</summary>
        public string sprite;

        /// <summary>VideoClip asset path (e.g. "Assets/UOS/Videos/intro.mp4").</summary>
        public string video;

        /// <summary>TextAnchor preset name (Left/Center/Right or MiddleCenter etc.). Empty = MiddleCenter default.</summary>
        public string align;

        /// <summary>Unity FontStyle preset (Normal, Bold, Italic, BoldAndItalic). Empty = leave default.</summary>
        public string fontStyle;

        /// <summary>Numeric control value (Slider value or Dropdown selected index).</summary>
        public float value;

        /// <summary>True when value was explicitly supplied by the bridge client.</summary>
        public bool hasValue;

        /// <summary>Slider minimum value.</summary>
        public float minValue;

        /// <summary>True when minValue was explicitly supplied by the bridge client.</summary>
        public bool hasMinValue;

        /// <summary>Slider maximum value.</summary>
        public float maxValue;

        /// <summary>True when maxValue was explicitly supplied by the bridge client.</summary>
        public bool hasMaxValue;

        /// <summary>Toggle checked state.</summary>
        public bool isOn;

        /// <summary>True when isOn was explicitly supplied by the bridge client.</summary>
        public bool hasIsOn;

        /// <summary>Selectable control interactable state.</summary>
        public bool interactable;

        /// <summary>True when interactable was explicitly supplied by the bridge client.</summary>
        public bool hasInteractable;

        /// <summary>Dropdown option labels. Null/empty = leave existing/default options.</summary>
        public string[] options;

        /// <summary>VideoPlayer loop flag.</summary>
        public bool loop;

        /// <summary>True when loop was explicitly supplied by the bridge client.</summary>
        public bool hasLoop;

        /// <summary>VideoPlayer play-on-awake flag.</summary>
        public bool playOnAwake;

        /// <summary>True when playOnAwake was explicitly supplied by the bridge client.</summary>
        public bool hasPlayOnAwake;

        /// <summary>Video audio mute flag.</summary>
        public bool muted;

        /// <summary>True when muted was explicitly supplied by the bridge client.</summary>
        public bool hasMuted;
    }
}
