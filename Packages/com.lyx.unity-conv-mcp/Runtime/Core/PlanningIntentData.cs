using System;

namespace Lyx.UnityConvMcp
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
}
