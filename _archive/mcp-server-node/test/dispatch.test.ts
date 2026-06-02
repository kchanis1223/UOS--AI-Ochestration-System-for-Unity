import { describe, it, expect, vi } from "vitest";
import { dispatchToolCall, type BridgeCaller } from "../src/tools/dispatch.js";
import { TOOL_DEFINITIONS } from "../src/tools/definitions.js";

const validIntentArgs = {
  intent: {
    version: "1.0.0",
    screenName: "Home",
    referenceCanvas: { width: 1920, height: 1080 },
    elements: [{ clientHintId: "p", type: "Panel", rect: { x: 0, y: 0, w: 1, h: 1 } }],
  },
};

describe("tool surface", () => {
  it("exposes the full v1 tool surface (AC-5)", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_planning_materials",
        "read_planning_material",
        "pptx_to_images",
        "preprocess_image",
        "create_ui_screen",
        "add_ui_element",
        "create_screen_transition",
        "update_ui_element",
        "move_ui_element",
        "delete_ui_element",
        "list_screens",
        "get_scene_hierarchy",
        "capture_preview",
      ]),
    );
  });

  it("every tool has a description and object inputSchema", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema["type"]).toBe("object");
    }
  });
});

describe("dispatchToolCall", () => {
  it("returns an error for an unknown tool", async () => {
    const caller: BridgeCaller = vi.fn();
    const outcome = await dispatchToolCall("does_not_exist", {}, caller);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/unknown tool/);
    expect(caller).not.toHaveBeenCalled();
  });

  it("proxies a simple call to the bridge", async () => {
    const caller: BridgeCaller = vi.fn(async () => ({ screens: ["Home"] }));
    const outcome = await dispatchToolCall("list_screens", {}, caller);
    expect(outcome.isError).toBe(false);
    expect(caller).toHaveBeenCalledWith("list_screens", {});
    expect(outcome.data).toEqual({ screens: ["Home"] });
  });

  it("runs preflight and proxies a valid create_ui_screen", async () => {
    const caller: BridgeCaller = vi.fn(async () => ({
      screenId: "screen-1",
      elements: [{ clientHintId: "p", elementId: "elem-1" }],
    }));
    const outcome = await dispatchToolCall("create_ui_screen", validIntentArgs, caller);
    expect(outcome.isError).toBe(false);
    expect(caller).toHaveBeenCalledOnce();
    expect(outcome.data).toMatchObject({ screenId: "screen-1" });
  });

  it("short-circuits an invalid intent without hitting the bridge", async () => {
    const caller: BridgeCaller = vi.fn();
    const bad = { intent: { version: "1.0.0", screenName: "X", referenceCanvas: { width: 0, height: 1 }, elements: [] } };
    const outcome = await dispatchToolCall("create_ui_screen", bad, caller);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/preflight failed/);
    expect(caller).not.toHaveBeenCalled();
  });

  it("short-circuits a structurally broken tree (unresolved parent)", async () => {
    const caller: BridgeCaller = vi.fn();
    const bad = {
      intent: {
        version: "1.0.0",
        screenName: "X",
        referenceCanvas: { width: 100, height: 100 },
        elements: [{ clientHintId: "c", parentClientHintId: "ghost", type: "Text", rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
      },
    };
    const outcome = await dispatchToolCall("create_ui_screen", bad, caller);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/tree:/);
    expect(caller).not.toHaveBeenCalled();
  });

  it("surfaces a bridge error as an error outcome (e.g. busy lock, AC-6)", async () => {
    const caller: BridgeCaller = vi.fn(async () => {
      throw new Error("busy: single-writer lock held");
    });
    const outcome = await dispatchToolCall("list_screens", {}, caller);
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/busy/);
  });
});
