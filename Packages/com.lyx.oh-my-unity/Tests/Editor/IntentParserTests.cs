using NUnit.Framework;

namespace Lyx.OhMyUnity.Tests
{
    /// <summary>
    /// Mirrors mcp-server/test/intentValidation.test.ts so the Unity-side defense-in-depth
    /// validator stays in lockstep with the sidecar's preflight.
    /// </summary>
    [TestFixture]
    public sealed class IntentParserTests
    {
        private static PlanningIntentData MakeIntent(params IntentElementData[] elements)
        {
            return new PlanningIntentData
            {
                version = PlanningIntentData.ExpectedVersion,
                screenName = "Test",
                referenceCanvas = new ReferenceCanvasData { width = 1920f, height = 1080f },
                elements = elements,
            };
        }

        private static IntentElementData MakeElement(
            string type = "Panel",
            string hint = null,
            string parentHint = null,
            NormRectData rect = null)
        {
            return new IntentElementData
            {
                type = type,
                clientHintId = hint,
                parentClientHintId = parentHint,
                rect = rect ?? new NormRectData { x = 0f, y = 0f, w = 0.5f, h = 0.5f },
            };
        }

        [Test]
        public void Validate_NullIntent_Fails()
        {
            IntentValidationResult r = IntentParser.Validate(null);
            Assert.IsFalse(r.Ok);
            Assert.IsTrue(r.Errors.Exists(e => e.Contains("intent is null")));
        }

        [Test]
        public void Validate_WellFormedIntent_Succeeds()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "root"),
                MakeElement(hint: "child", parentHint: "root"));
            IntentValidationResult r = IntentParser.Validate(intent);
            CollectionAssert.IsEmpty(r.Errors);
            Assert.IsTrue(r.Ok);
        }

        [Test]
        public void Validate_ForwardReferencedParent_Succeeds()
        {
            // Parent comes after child in the array.
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "child", parentHint: "root"),
                MakeElement(hint: "root"));
            Assert.IsTrue(IntentParser.Validate(intent).Ok);
        }

        [Test]
        public void Validate_WrongVersion_Fails()
        {
            PlanningIntentData intent = MakeIntent(MakeElement());
            intent.version = "2.0.0";
            IntentValidationResult r = IntentParser.Validate(intent);
            Assert.IsFalse(r.Ok);
        }

        [Test]
        public void Validate_MissingScreenName_Fails()
        {
            PlanningIntentData intent = MakeIntent(MakeElement());
            intent.screenName = string.Empty;
            Assert.IsFalse(IntentParser.Validate(intent).Ok);
        }

        [Test]
        public void Validate_NonPositiveCanvas_Fails()
        {
            PlanningIntentData intent = MakeIntent(MakeElement());
            intent.referenceCanvas = new ReferenceCanvasData { width = 0f, height = 1080f };
            Assert.IsFalse(IntentParser.Validate(intent).Ok);
        }

        [Test]
        public void Validate_UnknownElementType_Fails()
        {
            PlanningIntentData intent = MakeIntent(MakeElement(type: "Hologram"));
            IntentValidationResult r = IntentParser.Validate(intent);
            Assert.IsFalse(r.Ok);
            Assert.IsTrue(r.Errors.Exists(e => e.Contains("unknown type")));
        }

        [Test]
        public void Validate_RectOutsideNormRange_Fails()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(rect: new NormRectData { x = 1.5f, y = 0f, w = 0.5f, h = 0.5f }));
            Assert.IsFalse(IntentParser.Validate(intent).Ok);
        }

        [Test]
        public void Validate_ZeroSizeRect_Fails()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(rect: new NormRectData { x = 0f, y = 0f, w = 0f, h = 0.5f }));
            Assert.IsFalse(IntentParser.Validate(intent).Ok);
        }

        [Test]
        public void Validate_DuplicateHint_Fails()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "dup"),
                MakeElement(hint: "dup"));
            IntentValidationResult r = IntentParser.Validate(intent);
            Assert.IsFalse(r.Ok);
            Assert.IsTrue(r.Errors.Exists(e => e.Contains("duplicate clientHintId")));
        }

        [Test]
        public void Validate_UnresolvedParent_Fails()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "child", parentHint: "ghost"));
            IntentValidationResult r = IntentParser.Validate(intent);
            Assert.IsFalse(r.Ok);
            Assert.IsTrue(r.Errors.Exists(e => e.Contains("does not match any clientHintId")));
        }

        [Test]
        public void Validate_SelfParent_Fails()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "x", parentHint: "x"));
            IntentValidationResult r = IntentParser.Validate(intent);
            Assert.IsFalse(r.Ok);
            Assert.IsTrue(r.Errors.Exists(e => e.Contains("references itself as parent")));
        }

        [Test]
        public void Validate_CycleInParents_Fails()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "a", parentHint: "b"),
                MakeElement(hint: "b", parentHint: "a"));
            IntentValidationResult r = IntentParser.Validate(intent);
            Assert.IsFalse(r.Ok);
            Assert.IsTrue(r.Errors.Exists(e => e.Contains("cycle detected")));
        }

        [Test]
        public void Validate_DeepLinearChain_Succeeds()
        {
            PlanningIntentData intent = MakeIntent(
                MakeElement(hint: "a"),
                MakeElement(hint: "b", parentHint: "a"),
                MakeElement(hint: "c", parentHint: "b"),
                MakeElement(hint: "d", parentHint: "c"));
            Assert.IsTrue(IntentParser.Validate(intent).Ok);
        }
    }
}
