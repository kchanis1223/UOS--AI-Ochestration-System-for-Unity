import type { Anchor, NormRect, PxRect, ReferenceCanvas } from "./types.js";

/**
 * Coordinate contract (decision E1):
 *  - Intent rects are normalized 0..1, top-left origin, expressed relative to referenceCanvas.
 *  - This module is the canonical, deterministic reference implementation of the
 *    normalized<->px mapping. The Unity C# UguiBackend performs the authoritative
 *    in-Editor conversion into RectTransform space; this mirror exists so the
 *    contract is unit-testable and reusable for validation / preview echoing.
 *  - Output px space is top-left origin (image/layout space), NOT Unity's pivot space.
 */

function assertFinite(name: string, v: number): void {
  if (!Number.isFinite(v)) {
    throw new RangeError(`${name} must be a finite number, got ${v}`);
  }
}

function assertCanvas(canvas: ReferenceCanvas): void {
  assertFinite("referenceCanvas.width", canvas.width);
  assertFinite("referenceCanvas.height", canvas.height);
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new RangeError(
      `referenceCanvas must have positive dimensions, got ${canvas.width}x${canvas.height}`,
    );
  }
}

/** Convert a normalized 0..1 rect to a px rect against the reference canvas. */
export function normRectToPx(rect: NormRect, canvas: ReferenceCanvas): PxRect {
  assertCanvas(canvas);
  assertFinite("rect.x", rect.x);
  assertFinite("rect.y", rect.y);
  assertFinite("rect.w", rect.w);
  assertFinite("rect.h", rect.h);
  return {
    x: rect.x * canvas.width,
    y: rect.y * canvas.height,
    w: rect.w * canvas.width,
    h: rect.h * canvas.height,
  };
}

/** Inverse of normRectToPx. Round-trips within floating point precision. */
export function pxRectToNorm(px: PxRect, canvas: ReferenceCanvas): NormRect {
  assertCanvas(canvas);
  assertFinite("px.x", px.x);
  assertFinite("px.y", px.y);
  assertFinite("px.w", px.w);
  assertFinite("px.h", px.h);
  return {
    x: px.x / canvas.width,
    y: px.y / canvas.height,
    w: px.w / canvas.width,
    h: px.h / canvas.height,
  };
}

/**
 * The px point (top-left origin) that an anchor preset references within the canvas.
 * "Stretch" has no single point; it resolves to the canvas center for distance math.
 */
export function anchorReferencePoint(
  anchor: Anchor,
  canvas: ReferenceCanvas,
): { x: number; y: number } {
  assertCanvas(canvas);
  const horiz =
    anchor.endsWith("Left") ? 0 : anchor.endsWith("Right") ? canvas.width : canvas.width / 2;
  const vert =
    anchor.startsWith("Top") ? 0 : anchor.startsWith("Bottom") ? canvas.height : canvas.height / 2;
  return { x: horiz, y: vert };
}

/**
 * Max relative error between an expected and actual px rect, normalized by the
 * reference canvas dimensions. Returns a fraction (0.05 == 5%). Supports the
 * AC-2 / AC-7 "within +/-5% relative to reference" fidelity check.
 */
export function relativeRectError(
  expected: PxRect,
  actual: PxRect,
  canvas: ReferenceCanvas,
): number {
  assertCanvas(canvas);
  const ex = Math.abs(expected.x - actual.x) / canvas.width;
  const ey = Math.abs(expected.y - actual.y) / canvas.height;
  const ew = Math.abs(expected.w - actual.w) / canvas.width;
  const eh = Math.abs(expected.h - actual.h) / canvas.height;
  return Math.max(ex, ey, ew, eh);
}

/** Convenience predicate for the +/-5% fidelity contract. */
export function withinTolerance(
  expected: PxRect,
  actual: PxRect,
  canvas: ReferenceCanvas,
  tolerance = 0.05,
): boolean {
  return relativeRectError(expected, actual, canvas) <= tolerance;
}
