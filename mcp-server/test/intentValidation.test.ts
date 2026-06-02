import { describe, it, expect } from "vitest";
import { validateIntentTree } from "../src/core/intentValidation.js";
import type { IntentElement, PlanningIntent } from "../src/core/types.js";

function intent(elements: IntentElement[]): PlanningIntent {
  return {
    version: "1.0.0",
    screenName: "Test",
    referenceCanvas: { width: 1920, height: 1080 },
    elements,
  };
}

function el(partial: Partial<IntentElement>): IntentElement {
  return { type: "Panel", rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, ...partial };
}

describe("validateIntentTree", () => {
  it("accepts a valid tree with forward-referenced parent", () => {
    const result = validateIntentTree(
      intent([
        el({ clientHintId: "child", parentClientHintId: "root" }),
        el({ clientHintId: "root" }),
      ]),
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts elements without hints", () => {
    expect(validateIntentTree(intent([el({}), el({})])).ok).toBe(true);
  });

  it("flags duplicate clientHintIds", () => {
    const result = validateIntentTree(
      intent([el({ clientHintId: "dup" }), el({ clientHintId: "dup" })]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/duplicate clientHintId "dup"/);
  });

  it("flags an unresolved parent reference", () => {
    const result = validateIntentTree(
      intent([el({ clientHintId: "child", parentClientHintId: "ghost" })]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/does not match any element's clientHintId/);
  });

  it("flags a self-parent", () => {
    const result = validateIntentTree(
      intent([el({ clientHintId: "x", parentClientHintId: "x" })]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/references itself as parent/);
  });

  it("detects a cycle", () => {
    const result = validateIntentTree(
      intent([
        el({ clientHintId: "a", parentClientHintId: "b" }),
        el({ clientHintId: "b", parentClientHintId: "a" }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/cycle detected/);
  });

  it("accepts a deep linear chain", () => {
    const result = validateIntentTree(
      intent([
        el({ clientHintId: "a" }),
        el({ clientHintId: "b", parentClientHintId: "a" }),
        el({ clientHintId: "c", parentClientHintId: "b" }),
        el({ clientHintId: "d", parentClientHintId: "c" }),
      ]),
    );
    expect(result.ok).toBe(true);
  });
});
