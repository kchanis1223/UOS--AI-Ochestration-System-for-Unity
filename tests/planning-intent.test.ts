import { describe, expect, test } from "bun:test";
import {
  normalizeAddElementForBridge,
  normalizeElementPropsForBridge,
  normalizeIntentForBridge,
  validateAddElement,
  validatePlanningIntent,
} from "../.opencode/tools/_planning_intent.ts";

const validIntent = {
  version: "1.0.0",
  screenName: "MainMenu",
  referenceCanvas: { width: 1920, height: 1080 },
  elements: [
    {
      clientHintId: "panel",
      type: "Panel",
      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      props: { color: "#111111" },
    },
    {
      clientHintId: "title",
      parentClientHintId: "panel",
      type: "Text",
      rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.12 },
      props: { text: "Main Menu", fontSize: 48, fontStyle: "Bold", color: "#ffffff" },
    },
  ],
};

describe("PlanningIntent preflight validation", () => {
  const uiScreenBuilderHandoff = new URL("../.opencode/submodels/ui-screen-builder.md", import.meta.url);

  test("planner prompt documents supported PlanningIntent props", async () => {
    const prompt = await Bun.file(uiScreenBuilderHandoff).text();
    for (const prop of [
      "text",
      "placeholder",
      "inputText",
      "color",
      "fontSize",
      "fontStyle",
      "sprite",
      "video",
      "align",
      "value",
      "minValue",
      "maxValue",
      "isOn",
      "interactable",
      "options",
      "loop",
      "playOnAwake",
      "muted",
    ]) {
      expect(prompt).toContain(`\`${prop}\``);
    }
    expect(prompt).toContain("Internal bridge compatibility flags");
    expect(prompt).toContain("omit them in");
  });

  test("planner prompt requires context before live mutations", async () => {
    const prompt = await Bun.file(uiScreenBuilderHandoff).text();
    const contextIndex = prompt.indexOf("1. Call `get_uos_context` before any Unity mutation");
    const projectInfoIndex = prompt.indexOf("2. Identify live Editor capabilities with `get_project_info`");

    expect(contextIndex).toBeGreaterThanOrEqual(0);
    expect(projectInfoIndex).toBeGreaterThan(contextIndex);
    expect(prompt).toContain("confirm the\n   selected Unity project");
  });

  test("ui-screen-builder handoff is scoped as an internal submodel", async () => {
    const prompt = await Bun.file(uiScreenBuilderHandoff).text();
    expect(prompt).toContain("material-to-screen specialist method");
    expect(prompt).toContain("not a user-selectable");
    expect(prompt).toContain("You are not the top-level");
    expect(prompt).toContain("Ochestrator owns broad\ntask understanding");
    expect(prompt).toContain("submodel responsibility is narrower");
  });

  test("accepts a normalized create_ui_screen intent", () => {
    const result = validatePlanningIntent(validIntent);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.intent?.screenName).toBe("MainMenu");
    expect(result.intent?.elements[1].props?.fontStyle).toBe("Bold");
  });

  test("accepts interactive control props and marks explicit bridge values", () => {
    const result = validatePlanningIntent({
      ...validIntent,
      elements: [
        {
          clientHintId: "toggle",
          type: "Toggle",
          rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.08 },
          props: { text: "Remember", isOn: false, interactable: false },
        },
        {
          clientHintId: "slider",
          type: "Slider",
          rect: { x: 0.1, y: 0.22, w: 0.4, h: 0.08 },
          props: { minValue: 0, maxValue: 10, value: 0 },
        },
        {
          clientHintId: "dropdown",
          type: "Dropdown",
          rect: { x: 0.1, y: 0.34, w: 0.4, h: 0.08 },
          props: { options: ["Easy", "Normal", "Hard"], value: 2 },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const bridgeIntent = normalizeIntentForBridge(result.intent!);
    expect(bridgeIntent.elements[0].props).toMatchObject({
      isOn: false,
      hasIsOn: true,
      interactable: false,
      hasInteractable: true,
    });
    expect(bridgeIntent.elements[1].props).toMatchObject({
      minValue: 0,
      hasMinValue: true,
      maxValue: 10,
      hasMaxValue: true,
      value: 0,
      hasValue: true,
    });
    expect(bridgeIntent.elements[2].props).toMatchObject({
      options: ["Easy", "Normal", "Hard"],
      value: 2,
      hasValue: true,
    });
  });

  test("accepts video props and marks explicit bridge values", () => {
    const result = validatePlanningIntent({
      ...validIntent,
      elements: [
        {
          clientHintId: "intro_video",
          type: "Video",
          rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.6 },
          props: {
            video: "Assets/UOS/Videos/intro.mp4",
            loop: false,
            playOnAwake: false,
            muted: true,
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const bridgeIntent = normalizeIntentForBridge(result.intent!);
    expect(bridgeIntent.elements[0].props).toMatchObject({
      video: "Assets/UOS/Videos/intro.mp4",
      loop: false,
      hasLoop: true,
      playOnAwake: false,
      hasPlayOnAwake: true,
      muted: true,
      hasMuted: true,
    });
  });

  test("normalizes add/update props without mutating absent explicit fields", () => {
    expect(normalizeElementPropsForBridge({ color: "#fff" })).toEqual({ color: "#fff" });
    expect(normalizeElementPropsForBridge({ isOn: false, value: 0, interactable: false })).toEqual({
      isOn: false,
      hasIsOn: true,
      value: 0,
      hasValue: true,
      interactable: false,
      hasInteractable: true,
    });
    expect(normalizeElementPropsForBridge({ loop: false, playOnAwake: false, muted: false })).toEqual({
      loop: false,
      hasLoop: true,
      playOnAwake: false,
      hasPlayOnAwake: true,
      muted: false,
      hasMuted: true,
    });
    expect(normalizeAddElementForBridge({
      type: "Slider",
      rect: { x: 0, y: 0, w: 0.5, h: 0.1 },
      props: { value: 0 },
    }).props).toMatchObject({ value: 0, hasValue: true });
  });

  test("reports schema paths for invalid intent fields", () => {
    const result = validatePlanningIntent({
      ...validIntent,
      version: "0.9.0",
      referenceCanvas: { width: 0, height: 1080 },
      elements: [
        {
          type: "Text",
          rect: { x: -1, y: 0, w: 0.5, h: 0.1 },
          props: { typo: "discarded" },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('version: Invalid input: expected "1.0.0"');
    expect(result.errors).toContain("referenceCanvas.width: Too small: expected number to be >0");
    expect(result.errors).toContain("elements[0].rect.x: Too small: expected number to be >=0");
    expect(result.errors).toContain('elements[0].props: Unrecognized key: "typo"');
  });

  test("rejects duplicate, missing, self, and cyclic parent hints", () => {
    expect(validatePlanningIntent({
      ...validIntent,
      elements: [
        { clientHintId: "dup", type: "Panel", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        { clientHintId: "dup", type: "Text", rect: { x: 0, y: 0, w: 0.5, h: 0.1 } },
      ],
    }).errors).toContain('duplicate clientHintId "dup"');

    expect(validatePlanningIntent({
      ...validIntent,
      elements: [
        { clientHintId: "child", parentClientHintId: "missing", type: "Text", rect: { x: 0, y: 0, w: 0.5, h: 0.1 } },
      ],
    }).errors).toContain('elements[0] parentClientHintId "missing" does not match any clientHintId');

    expect(validatePlanningIntent({
      ...validIntent,
      elements: [
        { clientHintId: "self", parentClientHintId: "self", type: "Panel", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      ],
    }).errors).toContain('elements[0] ("self") references itself as parent');

    expect(validatePlanningIntent({
      ...validIntent,
      elements: [
        { clientHintId: "a", parentClientHintId: "b", type: "Panel", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        { clientHintId: "b", parentClientHintId: "a", type: "Panel", rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
      ],
    }).errors[0]).toStartWith("cycle detected in parent references");
  });

  test("warns about likely off-canvas layout without blocking valid schema", () => {
    const result = validatePlanningIntent({
      ...validIntent,
      elements: [
        {
          type: "Image",
          rect: { x: 0.8, y: 0.8, w: 0.4, h: 0.4 },
          props: { sprite: "C:/mockups/banner.png" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("elements[0] rect extends past the right edge; x + w is 1.2");
    expect(result.warnings).toContain("elements[0] rect extends past the bottom edge; y + h is 1.2");
    expect(result.warnings).toContain("elements[0] props.sprite should usually be a Unity asset path under Assets/");
  });

  test("rejects parentClientHintId in follow-up add_ui_element calls", () => {
    const result = validateAddElement({
      parentClientHintId: "panel",
      type: "Text",
      rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 },
      props: { text: "Late child" },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "element.parentClientHintId is only valid inside create_ui_screen; use element.parentElementId for follow-up add_ui_element calls",
    );
  });
});
