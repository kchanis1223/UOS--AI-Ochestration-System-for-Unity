using System;
using UnityEngine;

namespace Lyx.UnityConvMcp
{
    /// <summary>
    /// Deterministic normalized&lt;-&gt;px coordinate mapping (decision E1). Mirrors the sidecar's
    /// reference implementation (mcp-server/src/core/coordinates.ts) so both ends agree on the
    /// fidelity contract. Output px space is top-left origin (layout space); the RectTransform
    /// placement (pivot/anchor specifics) is applied by UguiBackend on top of this.
    /// Pure UnityEngine math, no UnityEditor dependency -> EditMode testable.
    /// </summary>
    public static class CoordinateMapper
    {
        public static Rect NormRectToPx(NormRectData rect, float canvasWidth, float canvasHeight)
        {
            if (rect == null) throw new ArgumentNullException(nameof(rect));
            AssertCanvas(canvasWidth, canvasHeight);
            return new Rect(
                rect.x * canvasWidth,
                rect.y * canvasHeight,
                rect.w * canvasWidth,
                rect.h * canvasHeight);
        }

        public static NormRectData PxRectToNorm(Rect px, float canvasWidth, float canvasHeight)
        {
            AssertCanvas(canvasWidth, canvasHeight);
            return new NormRectData
            {
                x = px.x / canvasWidth,
                y = px.y / canvasHeight,
                w = px.width / canvasWidth,
                h = px.height / canvasHeight,
            };
        }

        /// <summary>The px point an anchor preset references within the canvas (top-left origin).</summary>
        public static Vector2 AnchorReferencePoint(string anchor, float canvasWidth, float canvasHeight)
        {
            AssertCanvas(canvasWidth, canvasHeight);
            string a = string.IsNullOrEmpty(anchor) ? "MiddleCenter" : anchor;
            float horiz = a.EndsWith("Left") ? 0f
                : a.EndsWith("Right") ? canvasWidth
                : canvasWidth / 2f;
            float vert = a.StartsWith("Top") ? 0f
                : a.StartsWith("Bottom") ? canvasHeight
                : canvasHeight / 2f;
            return new Vector2(horiz, vert);
        }

        /// <summary>
        /// Max relative error between expected and actual px rects, normalized by canvas dims.
        /// Returns a fraction (0.05 == 5%). Supports the AC-2 / AC-7 fidelity check.
        /// </summary>
        public static float RelativeRectError(Rect expected, Rect actual, float canvasWidth, float canvasHeight)
        {
            AssertCanvas(canvasWidth, canvasHeight);
            float ex = Mathf.Abs(expected.x - actual.x) / canvasWidth;
            float ey = Mathf.Abs(expected.y - actual.y) / canvasHeight;
            float ew = Mathf.Abs(expected.width - actual.width) / canvasWidth;
            float eh = Mathf.Abs(expected.height - actual.height) / canvasHeight;
            return Mathf.Max(Mathf.Max(ex, ey), Mathf.Max(ew, eh));
        }

        public static bool WithinTolerance(Rect expected, Rect actual, float canvasWidth, float canvasHeight, float tolerance = 0.05f)
        {
            return RelativeRectError(expected, actual, canvasWidth, canvasHeight) <= tolerance;
        }

        private static void AssertCanvas(float width, float height)
        {
            if (!(width > 0f) || !(height > 0f) || float.IsNaN(width) || float.IsNaN(height))
            {
                throw new ArgumentException($"referenceCanvas must have positive dimensions, got {width}x{height}");
            }
        }
    }
}
