import { describe, it, expect } from "vitest";
import {
  validatePlanningIntentSchema,
  isPlanningIntent,
  PLANNING_INTENT_SCHEMA_ID,
  PLANNING_INTENT_VERSION,
} from "../src/core/schema.js";

const validIntent = {
  version: "1.0.0",
  screenName: "Login",
  referenceCanvas: { width: 1920, height: 1080 },
  elements: [
    {
      clientHintId: "panel",
      type: "Panel",
      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      anchor: "MiddleCenter",
    },
    {
      clientHintId: "title",
      parentClientHintId: "panel",
      type: "Text",
      rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.1 },
      props: { text: "Sign in" },
    },
  ],
};

describe("schema metadata", () => {
  it("exposes a fixed $id and version", () => {
    expect(PLANNING_INTENT_SCHEMA_ID).toBe(
      "https://lyx.dev/unity-conv-mcp/schemas/planning-intent/v1.json",
    );
    expect(PLANNING_INTENT_VERSION).toBe("1.0.0");
  });
});

describe("validatePlanningIntentSchema", () => {
  it("accepts a well-formed intent (AC-1)", () => {
    const result = validatePlanningIntentSchema(validIntent);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(isPlanningIntent(validIntent)).toBe(true);
  });

  it("rejects a wrong version const", () => {
    const result = validatePlanningIntentSchema({ ...validIntent, version: "2.0.0" });
    expect(result.ok).toBe(false);
  });

  it("rejects missing required referenceCanvas", () => {
    const { referenceCanvas, ...rest } = validIntent;
    void referenceCanvas;
    expect(validatePlanningIntentSchema(rest).ok).toBe(false);
  });

  it("rejects normalized coords outside 0..1", () => {
    const bad = {
      ...validIntent,
      elements: [{ type: "Panel", rect: { x: 1.5, y: 0, w: 0.5, h: 0.5 } }],
    };
    expect(validatePlanningIntentSchema(bad).ok).toBe(false);
  });

  it("rejects an unknown element type", () => {
    const bad = {
      ...validIntent,
      elements: [{ type: "Hologram", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
    };
    expect(validatePlanningIntentSchema(bad).ok).toBe(false);
  });

  it("rejects additional top-level properties", () => {
    expect(validatePlanningIntentSchema({ ...validIntent, rogue: true }).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validatePlanningIntentSchema(null).ok).toBe(false);
    expect(validatePlanningIntentSchema("nope").ok).toBe(false);
  });
});
