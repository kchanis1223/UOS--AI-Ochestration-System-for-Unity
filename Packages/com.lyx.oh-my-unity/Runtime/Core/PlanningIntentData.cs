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

        /// <summary>One of: Panel, Text, Button, Image, InputField, Toggle, Slider, ScrollView, Dropdown.</summary>
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
        /// <summary>Text label (Text content, Button label, InputField placeholder).</summary>
        public string text;

        /// <summary>Foreground/background color as "#RRGGBB" or "#RRGGBBAA". Empty = leave default.</summary>
        public string color;

        /// <summary>Text font size in pt. 0 = leave default.</summary>
        public int fontSize;

        /// <summary>Sprite asset path (e.g. "Assets/UI/btn.png"). Resolved via AssetDatabase.LoadAssetAtPath.</summary>
        public string sprite;

        /// <summary>TextAnchor preset name (Left/Center/Right or MiddleCenter etc.). Empty = MiddleCenter default.</summary>
        public string align;
    }
}
