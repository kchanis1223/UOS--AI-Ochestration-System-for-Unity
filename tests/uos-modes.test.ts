import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
// @ts-expect-error - shared pure-JS mode registry (no type declarations).
import { getUosMode, listUosModes, selectUosMode } from "../bin/mode-core.js";

const requiredSubmodels = new Set([
  "material-understanding",
  "ui-screen-builder",
  "scene-object-editor",
  "code-editor",
  "visual-verification",
  "unity-inspection",
  "general-editor",
]);

describe("UOS mode registry", () => {
  test("registers routing modes with functional submodel and recipe metadata", () => {
    const modes = listUosModes();
    expect(modes.length).toBeGreaterThanOrEqual(7);
    expect(modes.map((mode: any) => mode.id)).toContain("kiosk-content");
    expect(modes.map((mode: any) => mode.id)).toContain("code-editor");
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));

    for (const mode of modes as any[]) {
      expect(mode.specialist).toBeTruthy();
      expect(Array.isArray(mode.submodels)).toBe(true);
      expect(mode.submodels.length).toBeGreaterThan(0);
      expect(Array.isArray(mode.submodelFiles)).toBe(true);
      expect(mode.handoffFile).toStartWith(".opencode/submodels/");
      expect(existsSync(join(repoRoot, mode.handoffFile))).toBe(true);

      for (const submodel of mode.submodels) {
        expect(requiredSubmodels.has(submodel)).toBe(true);
        expect(existsSync(join(repoRoot, ".opencode", "submodels", `${submodel}.md`))).toBe(true);
      }
      for (const submodelFile of mode.submodelFiles) {
        expect(submodelFile).toStartWith(".opencode/submodels/");
        expect(existsSync(join(repoRoot, submodelFile))).toBe(true);
      }
      if (mode.recipeFile !== undefined) {
        expect(mode.recipeFile).toStartWith(".opencode/recipes/");
        expect(existsSync(join(repoRoot, mode.recipeFile))).toBe(true);
      }

      expect(mode.planArtifact).toBeTruthy();
      expect(mode.buildArtifact).toBeTruthy();
      expect(Array.isArray(mode.primaryTools)).toBe(true);
    }

    const kiosk = getUosMode("kiosk-content") as any;
    expect(kiosk.recipe).toBe("kiosk");
    expect(kiosk.recipeFile).toBe(".opencode/recipes/kiosk.md");
    expect(kiosk.submodels).toEqual([
      "material-understanding",
      "ui-screen-builder",
      "visual-verification",
    ]);
    expect(kiosk.submodels).not.toContain("kiosk-content");
  });

  test("selects kiosk-content for nested kiosk folder work", () => {
    const selected = selectUosMode({
      request: "Build kiosk screens from a Ref/main folder tree with drilldown, back, and home navigation.",
      materialsDir: "D:/Unity/JangHeungKiosk/Ref/main",
    });
    expect(selected.selectedMode.id).toBe("kiosk-content");
    expect(selected.confidence).toBe("high");
    expect(selected.nextActions.join("\n")).toContain("Orchestrator-owned Task Packets");
    expect(selected.nextActions.join("\n")).toContain("context and handoff overhead");
    expect(selected.nextActions.join("\n")).toContain("KioskStructurePlan and Main folder candidates");
    expect(selected.nextActions.join("\n")).toContain("FolderStructurePlan and MaterialPlacementPlan");
  });

  test("selects screen-from-material for one-off UI screen generation", () => {
    const selected = selectUosMode({
      request: "Read this PPTX material and create an editable Unity UI screen.",
      attachedFiles: ["D:/Plans/lobby.pptx"],
    });
    expect(selected.selectedMode.id).toBe("screen-from-material");
    expect(selected.score).toBeGreaterThan(0);
  });

  test("selects screen-from-material for playable video content media", () => {
    const selected = selectUosMode({
      request: "Place this video on a Unity screen so it can play in the kiosk.",
      attachedFiles: ["D:/Plans/intro.mp4"],
    });
    expect(selected.selectedMode.id).toBe("screen-from-material");
    expect(selected.selectedMode.primaryTools).toContain("import_asset");
    expect(selected.score).toBeGreaterThan(0);
  });

  test("selects scene-object for non-UI GameObject work", () => {
    const selected = selectUosMode({
      request: "Place a Cube and a Point Light in the scene and adjust their transforms.",
    });
    expect(selected.selectedMode.id).toBe("scene-object");
  });

  test("selects visual-repair for preview/reference comparison loops", () => {
    const selected = selectUosMode({
      request: "Compare the current preview against the reference image and repair the mismatch.",
    });
    expect(selected.selectedMode.id).toBe("visual-repair");
  });

  test("selects unity-inspection for read-only status requests", () => {
    const selected = selectUosMode({
      request: "Inspect the current project screen list and hierarchy status.",
    });
    expect(selected.selectedMode.id).toBe("unity-inspection");
  });

  test("selects code-editor for scripts, diagnostics, and project file work", () => {
    const selected = selectUosMode({
      request: "Fix the C# MonoBehaviour compile error from the Unity console and update the asmdef if needed.",
      attachedFiles: ["D:/Unity/MyGame/Assets/Scripts/PlayerController.cs"],
    });
    expect(selected.selectedMode.id).toBe("code-editor");
    expect(selected.selectedMode.submodels).toEqual(["code-editor"]);
    expect(selected.score).toBeGreaterThan(0);
  });

  test("falls back to general-editor when no specialist signal matches", () => {
    const selected = selectUosMode({
      request: "Do the ordinary Unity task I mentioned earlier.",
    });
    expect(selected.selectedMode.id).toBe("general-editor");
    expect(selected.confidence).toBe("fallback");
    expect(getUosMode("general-editor")?.specialist).toBe("general-editor");
    expect(selected.nextActions.join("\n")).toContain("Confirm why no specialist submodel owns this request");
    expect(selected.nextActions.join("\n")).toContain("promotion candidates");
  });

  test("keeps general-editor metadata constrained to fallback execution", () => {
    const mode = getUosMode("general-editor") as any;
    expect(mode.summary).toContain("Constrained fallback executor");
    expect(mode.editorRole).toContain("why no specialist submodel owns the task");
    expect(mode.primaryTools).toContain("get_uos_context");
    expect(mode.primaryTools).toContain("get_project_info");
    expect(mode.primaryTools).not.toContain("create_ui_screen");
    expect(mode.primaryTools).not.toContain("update_ui_element");
    expect(mode.primaryTools).not.toContain("create_scene_object");
    expect(mode.primaryTools).not.toContain("update_scene_object");
  });
});
