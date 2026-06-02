using NUnit.Framework;
using UnityEngine;

namespace Lyx.UnityConvMcp.Tests
{
    /// <summary>
    /// Mirrors mcp-server/test/coordinates.test.ts to keep the fidelity contract pinned on both sides.
    /// </summary>
    [TestFixture]
    public sealed class CoordinateMapperTests
    {
        private const float CW = 1920f;
        private const float CH = 1080f;

        [Test]
        public void NormRectToPx_ScalesByCanvas()
        {
            NormRectData rect = new NormRectData { x = 0.5f, y = 0.25f, w = 0.1f, h = 0.2f };
            Rect px = CoordinateMapper.NormRectToPx(rect, CW, CH);
            Assert.AreEqual(960f, px.x, 1e-4f);
            Assert.AreEqual(270f, px.y, 1e-4f);
            Assert.AreEqual(192f, px.width, 1e-4f);
            Assert.AreEqual(216f, px.height, 1e-4f);
        }

        [Test]
        public void NormRectToPx_FullCanvasMapsToCanvasDims()
        {
            NormRectData full = new NormRectData { x = 0f, y = 0f, w = 1f, h = 1f };
            Rect px = CoordinateMapper.NormRectToPx(full, CW, CH);
            Assert.AreEqual(new Rect(0f, 0f, CW, CH), px);
        }

        [Test]
        public void NormRectToPx_RejectsNonPositiveCanvas()
        {
            NormRectData full = new NormRectData { x = 0f, y = 0f, w = 1f, h = 1f };
            Assert.Throws<System.ArgumentException>(() => CoordinateMapper.NormRectToPx(full, 0f, 100f));
        }

        [Test]
        public void PxRectToNorm_RoundTripsNormRectToPx()
        {
            NormRectData rect = new NormRectData { x = 0.3f, y = 0.7f, w = 0.25f, h = 0.15f };
            Rect px = CoordinateMapper.NormRectToPx(rect, CW, CH);
            NormRectData back = CoordinateMapper.PxRectToNorm(px, CW, CH);
            Assert.AreEqual(rect.x, back.x, 1e-5f);
            Assert.AreEqual(rect.y, back.y, 1e-5f);
            Assert.AreEqual(rect.w, back.w, 1e-5f);
            Assert.AreEqual(rect.h, back.h, 1e-5f);
        }

        [Test]
        public void AnchorReferencePoint_ResolvesCornersAndCenters()
        {
            Assert.AreEqual(new Vector2(0f, 0f), CoordinateMapper.AnchorReferencePoint("TopLeft", CW, CH));
            Assert.AreEqual(new Vector2(CW, CH), CoordinateMapper.AnchorReferencePoint("BottomRight", CW, CH));
            Assert.AreEqual(new Vector2(CW / 2f, CH / 2f),
                CoordinateMapper.AnchorReferencePoint("MiddleCenter", CW, CH));
            Assert.AreEqual(new Vector2(CW / 2f, 0f),
                CoordinateMapper.AnchorReferencePoint("TopCenter", CW, CH));
            Assert.AreEqual(new Vector2(0f, CH / 2f),
                CoordinateMapper.AnchorReferencePoint("MiddleLeft", CW, CH));
            Assert.AreEqual(new Vector2(CW / 2f, CH / 2f),
                CoordinateMapper.AnchorReferencePoint("Stretch", CW, CH));
        }

        [Test]
        public void RelativeRectError_IsZeroForIdenticalRects()
        {
            Rect px = new Rect(100f, 100f, 50f, 50f);
            Assert.AreEqual(0f, CoordinateMapper.RelativeRectError(px, px, CW, CH));
            Assert.IsTrue(CoordinateMapper.WithinTolerance(px, px, CW, CH));
        }

        [Test]
        public void RelativeRectError_FivePercentBoundary()
        {
            Rect expected = new Rect(0f, 0f, 0f, 0f);
            Rect actual = new Rect(96f, 0f, 0f, 0f); // 96 / 1920 = 5%
            Assert.AreEqual(0.05f, CoordinateMapper.RelativeRectError(expected, actual, CW, CH), 1e-5f);
            Assert.IsTrue(CoordinateMapper.WithinTolerance(expected, actual, CW, CH, 0.05f));
        }

        [Test]
        public void WithinTolerance_FailsWhenErrorExceedsTolerance()
        {
            Rect expected = new Rect(0f, 0f, 0f, 0f);
            Rect actual = new Rect(0f, 108f, 0f, 0f); // 10% of 1080
            Assert.IsFalse(CoordinateMapper.WithinTolerance(expected, actual, CW, CH, 0.05f));
        }
    }
}
