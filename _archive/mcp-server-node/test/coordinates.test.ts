import { describe, it, expect } from "vitest";
import {
  normRectToPx,
  pxRectToNorm,
  anchorReferencePoint,
  relativeRectError,
  withinTolerance,
} from "../src/core/coordinates.js";
import type { NormRect, ReferenceCanvas } from "../src/core/types.js";

const canvas: ReferenceCanvas = { width: 1920, height: 1080 };

describe("normRectToPx", () => {
  it("scales a normalized rect by the reference canvas", () => {
    const rect: NormRect = { x: 0.5, y: 0.25, w: 0.1, h: 0.2 };
    expect(normRectToPx(rect, canvas)).toEqual({ x: 960, y: 270, w: 192, h: 216 });
  });

  it("maps full-canvas rect to canvas dimensions", () => {
    expect(normRectToPx({ x: 0, y: 0, w: 1, h: 1 }, canvas)).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
    });
  });

  it("rejects a non-positive canvas", () => {
    expect(() => normRectToPx({ x: 0, y: 0, w: 1, h: 1 }, { width: 0, height: 100 })).toThrow();
  });

  it("rejects non-finite rect values", () => {
    expect(() => normRectToPx({ x: NaN, y: 0, w: 1, h: 1 }, canvas)).toThrow();
  });
});

describe("pxRectToNorm round-trip", () => {
  it("inverts normRectToPx", () => {
    const rect: NormRect = { x: 0.3, y: 0.7, w: 0.25, h: 0.15 };
    const px = normRectToPx(rect, canvas);
    const back = pxRectToNorm(px, canvas);
    expect(back.x).toBeCloseTo(rect.x, 10);
    expect(back.y).toBeCloseTo(rect.y, 10);
    expect(back.w).toBeCloseTo(rect.w, 10);
    expect(back.h).toBeCloseTo(rect.h, 10);
  });
});

describe("anchorReferencePoint", () => {
  it("resolves corner anchors", () => {
    expect(anchorReferencePoint("TopLeft", canvas)).toEqual({ x: 0, y: 0 });
    expect(anchorReferencePoint("BottomRight", canvas)).toEqual({ x: 1920, y: 1080 });
  });

  it("resolves center anchors", () => {
    expect(anchorReferencePoint("MiddleCenter", canvas)).toEqual({ x: 960, y: 540 });
    expect(anchorReferencePoint("TopCenter", canvas)).toEqual({ x: 960, y: 0 });
    expect(anchorReferencePoint("MiddleLeft", canvas)).toEqual({ x: 0, y: 540 });
  });

  it("treats Stretch as center for distance math", () => {
    expect(anchorReferencePoint("Stretch", canvas)).toEqual({ x: 960, y: 540 });
  });
});

describe("relativeRectError / withinTolerance", () => {
  it("is zero for identical rects", () => {
    const px = { x: 100, y: 100, w: 50, h: 50 };
    expect(relativeRectError(px, px, canvas)).toBe(0);
    expect(withinTolerance(px, px, canvas)).toBe(true);
  });

  it("computes max relative error normalized by canvas", () => {
    const expected = { x: 0, y: 0, w: 0, h: 0 };
    // 96px on a 1920 width == 5% exactly
    const actual = { x: 96, y: 0, w: 0, h: 0 };
    expect(relativeRectError(expected, actual, canvas)).toBeCloseTo(0.05, 10);
    expect(withinTolerance(expected, actual, canvas, 0.05)).toBe(true);
  });

  it("fails when error exceeds tolerance", () => {
    const expected = { x: 0, y: 0, w: 0, h: 0 };
    const actual = { x: 0, y: 108, w: 0, h: 0 }; // 10% of 1080 height
    expect(withinTolerance(expected, actual, canvas, 0.05)).toBe(false);
  });
});
