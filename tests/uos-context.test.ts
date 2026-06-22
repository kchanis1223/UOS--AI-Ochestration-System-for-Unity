import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  comparisonAttachmentsForContext,
  contextWithLiveHierarchy,
  contextWithLiveSceneObjects,
  formatUosContext,
  launchMaterialAttachmentsForContext,
  loadUosContext,
  previewAttachmentsForContext,
  recommendedLaunchWorkflow,
  sourceMaterialAttachmentsForContext,
  sourceReferenceAttachmentsForContext,
} from "../.opencode/tools/_uos_context.ts";
import { resolveContextAddTarget, resolveContextScreen } from "../.opencode/tools/add_ui_element_from_context.ts";
import { resolveContextTransition } from "../.opencode/tools/create_screen_transition_from_context.ts";
import {
  feedbackAttachments,
  formatScreenFeedback,
  screenFeedbackFromContext,
} from "../.opencode/tools/inspect_screen_feedback_from_context.ts";
import { resolveUosContextTarget } from "../.opencode/tools/resolve_uos_context_target.ts";
import { resolveContextVerification } from "../.opencode/tools/verify_screen_against_reference_from_context.ts";
import { resolveContextVerificationBatch } from "../.opencode/tools/verify_screens_against_references_from_context.ts";
import { resolveContextElement } from "../.opencode/tools/update_ui_element_from_context.ts";
import { shouldRefreshLiveHierarchy } from "../.opencode/tools/_live_hierarchy_context.ts";
import { resolveContextSceneObject } from "../.opencode/tools/_scene_object_context.ts";
import getUosContextTool from "../.opencode/tools/get_uos_context.ts";
import { writeActiveUnityTarget } from "../.opencode/tools/_unity_target_state.ts";
// @ts-expect-error - shared pure-JS progress helpers (no type declarations).
import { createOrchestratorProgress, writeOrchestratorProgress } from "../bin/orchestrator-progress-core.js";
// @ts-expect-error - shared pure-JS blueprint persistence helpers (no type declarations).
import { writeProductionBlueprint } from "../bin/production-blueprint-core.js";

describe("UOS persisted context", () => {
  test("refresh policy preserves dry-run no-Unity semantics by default", () => {
    expect(shouldRefreshLiveHierarchy({})).toBe(true);
    expect(shouldRefreshLiveHierarchy({ refreshHierarchy: false })).toBe(false);
    expect(shouldRefreshLiveHierarchy({ dryRun: true })).toBe(false);
    expect(shouldRefreshLiveHierarchy({ dryRun: true, refreshHierarchy: true })).toBe(true);
  });

  test("merges live hierarchy into target resolution context", () => {
    const context = {
      projectDir: "C:/Game",
      contextDir: "C:/Game/.uos",
      hasContext: true,
      attachedFiles: [],
      screens: [
        {
          screenId: "Main_ID",
          screenName: "Main",
          elementCount: 1,
          deletedElementCount: 0,
          previewCount: 0,
          comparisonCount: 0,
          active: undefined,
          updatedAt: "2026-06-04T01:00:00.000Z",
          elements: [
            {
              elementId: "Element_Title",
              clientHintId: "title",
              type: "Text",
              props: { text: "Old Title" },
              updatedAt: "2026-06-04T01:00:00.000Z",
            },
          ],
          previews: [],
          comparisons: [],
        },
        {
          screenId: "Shop_ID",
          screenName: "Shop",
          elementCount: 0,
          deletedElementCount: 0,
          previewCount: 0,
          comparisonCount: 0,
          active: true,
          updatedAt: "2026-06-04T01:00:00.000Z",
          elements: [],
          previews: [],
          comparisons: [],
        },
      ],
      activeScreenId: "Shop_ID",
      transitionCount: 0,
      importedAssets: [],
      recentJournal: [],
    };

    const refreshed = contextWithLiveHierarchy(context, {
      nodes: [
        {
          elementId: "Main_ID",
          rootScreenId: "Main_ID",
          rootScreenName: "Main",
          depth: 0,
          type: "Screen",
          active: true,
        },
        {
          elementId: "Element_Title",
          rootScreenId: "Main_ID",
          rootScreenName: "Main",
          parentElementId: "Main_ID",
          depth: 1,
          type: "Text",
          props: { text: "Live Title", fontSize: 40 },
          rect: { x: 0.2, y: 0.1, w: 0.6, h: 0.12 },
          anchor: "TopCenter",
        },
        {
          elementId: "Element_ManualButton",
          rootScreenId: "Main_ID",
          rootScreenName: "Main",
          parentElementId: "Main_ID",
          depth: 1,
          type: "Button",
          props: { text: "Continue" },
          rect: { x: 0.35, y: 0.7, w: 0.3, h: 0.1 },
        },
      ],
    }, "2026-06-04T02:00:00.000Z");

    expect(refreshed.activeScreenId).toBe("Main_ID");
    expect(resolveContextElement(refreshed, { screenQuery: "current screen", text: "Live Title" })).toMatchObject({
      ok: true,
      candidate: { elementId: "Element_Title", text: "Live Title" },
    });
    expect(resolveContextElement(refreshed, { screenQuery: "current screen", query: "continue button" })).toMatchObject({
      ok: true,
      candidate: { elementId: "Element_ManualButton", type: "Button", text: "Continue" },
    });
    expect(refreshed.screens.find((screen) => screen.screenId === "Shop_ID")?.active).toBeUndefined();
  });

  test("merges and resolves scene objects for conversational follow-up edits", () => {
    const context = {
      projectDir: "C:/Game",
      contextDir: "C:/Game/.uos",
      hasContext: true,
      attachedFiles: [],
      screens: [],
      sceneObjects: [
        {
          objectId: "SceneObject_OldCube",
          name: "Old Cube",
          type: "Cube",
          active: true,
          updatedAt: "2026-06-04T01:00:00.000Z",
        },
        {
          objectId: "SceneObject_StaleLight",
          name: "Stale Light",
          type: "PointLight",
          active: true,
          updatedAt: "2026-06-04T01:00:00.000Z",
        },
      ],
      transitionCount: 0,
      importedAssets: [],
      recentJournal: [],
    };

    const refreshed = contextWithLiveSceneObjects(context, {
      objects: [
        {
          objectId: "SceneObject_OldCube",
          name: "Conversation Cube",
          type: "Cube",
          path: "Conversation Cube",
          active: true,
          transform: {
            position: { x: 2, y: 0, z: -1 },
            rotation: { x: 0, y: 30, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          components: ["Transform", "MeshFilter", "MeshRenderer", "SceneObjectId"],
        },
        {
          objectId: "SceneObject_MainCamera",
          name: "Main Shot Camera",
          type: "Camera",
          path: "Main Shot Camera",
          active: true,
          transform: { position: { x: 0, y: 4, z: -8 } },
          components: ["Transform", "Camera", "SceneObjectId"],
        },
      ],
    }, "2026-06-04T02:00:00.000Z");

    expect(refreshed.sceneObjects.find((object) => object.objectId === "SceneObject_StaleLight")?.deleted).toBe(true);
    expect(resolveContextSceneObject(refreshed, { query: "conversation cube" })).toMatchObject({
      ok: true,
      candidate: {
        objectId: "SceneObject_OldCube",
        name: "Conversation Cube",
        transform: { position: { x: 2, y: 0, z: -1 } },
      },
    });
    expect(resolveContextSceneObject(refreshed, { query: "main camera" })).toMatchObject({
      ok: true,
      candidate: { objectId: "SceneObject_MainCamera", type: "Camera" },
    });
    expect(resolveContextSceneObject(refreshed, { query: "큐브" })).toMatchObject({
      ok: true,
      candidate: { objectId: "SceneObject_OldCube", type: "Cube" },
    });
    expect(resolveContextSceneObject(refreshed, { query: "카메라" })).toMatchObject({
      ok: true,
      candidate: { objectId: "SceneObject_MainCamera", type: "Camera" },
    });
    expect(resolveContextSceneObject(refreshed, { type: "Cube" })).toMatchObject({
      ok: true,
      candidate: { objectId: "SceneObject_OldCube" },
    });
    expect(resolveContextSceneObject(refreshed, { query: "object" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("multiple matching scene objects"),
    });
    expect(resolveContextSceneObject(refreshed, { query: "object", latest: true })).toMatchObject({
      ok: true,
      candidate: { objectId: "SceneObject_OldCube" },
    });
  });

  test("loads project, screen index, and recent journal entries", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-test");
    const uos = join(dir, ".uos");
    await rm(dir, { recursive: true, force: true });
    await mkdir(uos, { recursive: true });

    await writeFile(join(uos, "project.json"), JSON.stringify({
      projectName: "ContextGame",
      projectPath: dir,
      updatedAt: "2026-06-04T01:00:00.000Z",
    }));
    const previewNewPath = join(dir, "preview-MainScreen_ID-new.png");
    const sourceReferencePath = join(dir, "source-lobby-slide2.png");
    const diffPath = join(dir, "diff-MainScreen_ID.png");
    await writeFile(previewNewPath, "png bytes");
    await writeFile(sourceReferencePath, "png bytes");
    await writeFile(diffPath, "png bytes");
    await writeFile(join(uos, "screens.json"), JSON.stringify({
      version: "1.0.0",
      updatedAt: "2026-06-04T01:00:00.000Z",
      screens: {
        MainScreen_ID: {
          screenId: "MainScreen_ID",
          screenName: "MainScreen",
          updatedAt: "2026-06-04T01:00:00.000Z",
          active: true,
          source: {
            tool: "create_reference_screen_from_material",
            kind: "pptx",
            path: "D:/PlanningDecks/lobby.pptx",
            slideNumber: 2,
            renderedPath: sourceReferencePath,
            assetPaths: ["Assets/UOS/PPTX/lobby-slide2-hero.png"],
            ts: "2026-06-04T01:00:00.000Z",
          },
          previews: [
            {
              savedPath: "C:/Temp/oh-my-unity/previews/preview-MainScreen_ID-old.png",
              uri: "file:///C:/Temp/oh-my-unity/previews/preview-MainScreen_ID-old.png",
              mimeType: "image/png",
              width: 960,
              height: 540,
              size: 11111,
              ts: "2026-06-04T01:01:00.000Z",
            },
            {
              savedPath: previewNewPath,
              uri: "file:///C:/Temp/oh-my-unity/previews/preview-MainScreen_ID-new.png",
              mimeType: "image/png",
              width: 1280,
              height: 720,
              size: 22222,
              ts: "2026-06-04T01:03:00.000Z",
            },
          ],
          comparisons: [
            {
              referencePath: sourceReferencePath,
              candidatePath: previewNewPath,
              diffPath,
              diffMimeType: "image/png",
              verdict: "needs review",
              compareWidth: 1024,
              compareHeight: 576,
              meanAbsoluteError: 0.1,
              rootMeanSquareError: 0.12,
              mismatchRatio: 0.2,
              maxChannelDelta: 180,
              aspectRatioDelta: 0,
              threshold: 0.05,
              ts: "2026-06-04T01:04:00.000Z",
            },
          ],
          elements: {
            Element_1: {
              elementId: "Element_1",
              clientHintId: "cta",
              type: "Button",
              rect: { x: 0.25, y: 0.6, w: 0.5, h: 0.12 },
              props: {
                text: "Start Game",
                color: "#2563eb",
                fontSize: 28,
                fontStyle: "Bold",
                isOn: false,
                interactable: true,
                value: 2,
                options: ["Easy", "Normal", "Hard"],
              },
              updatedAt: "2026-06-04T01:00:00.000Z",
            },
            Element_2: { elementId: "Element_2", deleted: true, updatedAt: "2026-06-04T01:00:00.000Z" },
          },
        },
      },
      sceneObjects: {
        SceneObject_Cube: {
          objectId: "SceneObject_Cube",
          name: "Conversation Cube",
          type: "Cube",
          path: "Conversation Cube",
          active: true,
          transform: {
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 45, z: 0 },
            scale: { x: 2, y: 2, z: 2 },
          },
          components: ["Transform", "MeshFilter", "MeshRenderer", "SceneObjectId"],
          updatedAt: "2026-06-04T01:05:00.000Z",
        },
        SceneObject_Deleted: {
          objectId: "SceneObject_Deleted",
          name: "Deleted Sphere",
          type: "Sphere",
          deleted: true,
          updatedAt: "2026-06-04T01:06:00.000Z",
        },
      },
      activeScreenId: "MainScreen_ID",
      transitions: [{ fromId: "MainScreen_ID", toId: "ShopScreen_ID", ts: "2026-06-04T01:00:00.000Z" }],
      importedAssets: [{ assetPath: "Assets/UOS/Imported/logo.png", importedAsSprite: true, ts: "2026-06-04T01:00:00.000Z" }],
      lastSavedScenePath: "Assets/UOS_Generated.unity",
      lastSavedAt: "2026-06-04T01:02:00.000Z",
    }));
    await writeFile(join(uos, "work-journal.jsonl"), [
      JSON.stringify({ ts: "2026-06-04T01:00:00.000Z", tool: "create_ui_screen", result: { screenId: "MainScreen_ID" }, title: "created" }),
      "not json",
      JSON.stringify({ ts: "2026-06-04T01:01:00.000Z", tool: "update_ui_element", args: { elementId: "Element_1" }, title: "updated" }),
      JSON.stringify({ ts: "2026-06-04T01:02:00.000Z", tool: "save_scene", result: { path: "Assets/UOS.unity" }, title: "saved" }),
      "",
    ].join("\n"));

    try {
      const context = await loadUosContext({ projectDir: dir, maxJournalEntries: 2 });
      expect(context.hasContext).toBe(true);
      expect(context.project?.projectName).toBe("ContextGame");
      expect(context.screens).toHaveLength(1);
      expect(context.screens[0].screenName).toBe("MainScreen");
      expect(context.activeScreenId).toBe("MainScreen_ID");
      expect(context.screens[0].active).toBe(true);
      expect(context.screens[0].elementCount).toBe(1);
      expect(context.screens[0].deletedElementCount).toBe(1);
      expect(context.screens[0].previewCount).toBe(2);
      expect(context.screens[0].comparisonCount).toBe(1);
      expect(context.screens[0].source?.kind).toBe("pptx");
      expect(context.screens[0].source?.slideNumber).toBe(2);
      expect(context.screens[0].lastPreviewAt).toBe("2026-06-04T01:03:00.000Z");
      expect(context.screens[0].lastComparedAt).toBe("2026-06-04T01:04:00.000Z");
      expect(context.screens[0].previews[0].savedPath).toContain("preview-MainScreen_ID-new.png");
      expect(context.screens[0].comparisons[0].diffPath).toBe(diffPath);
      expect(context.screens[0].elements[0].props?.text).toBe("Start Game");
      expect(context.screens[0].elements[0].props?.fontStyle).toBe("Bold");
      expect(context.screens[0].elements[0].props?.isOn).toBe(false);
      expect(context.screens[0].elements[0].props?.value).toBe(2);
      expect(context.screens[0].elements[0].props?.options).toEqual(["Easy", "Normal", "Hard"]);
      expect(context.sceneObjects).toHaveLength(2);
      expect(context.sceneObjects[0]).toMatchObject({
        objectId: "SceneObject_Cube",
        name: "Conversation Cube",
        type: "Cube",
        active: true,
        transform: { position: { x: 1, y: 2, z: 3 } },
      });
      expect(context.sceneObjects[1]).toMatchObject({ objectId: "SceneObject_Deleted", deleted: true });
      expect(context.transitionCount).toBe(1);
      expect(context.importedAssets).toHaveLength(1);
      expect(context.lastSavedScenePath).toBe("Assets/UOS_Generated.unity");
      expect(context.recentJournal.map((entry) => entry.tool)).toEqual(["update_ui_element", "save_scene"]);

      const output = formatUosContext(context);
      expect(output).toContain("ContextGame");
      expect(output).toContain("MainScreen_ID");
      expect(output).toContain("activeScreen: MainScreen_ID");
      expect(output).toContain("elements=1, active");
      expect(output).toContain("source: pptx D:/PlanningDecks/lobby.pptx slide=2");
      expect(output).toContain('selector: screenQuery="lobby slide 2" sourceKind="pptx" sourcePathContains="lobby.pptx" slideNumber=2 latest=true');
      expect(output).toContain("Start Game");
      expect(output).toContain("fontStyle=Bold");
      expect(output).toContain("isOn=false");
      expect(output).toContain('options="Easy"|"Normal"|"Hard"');
      expect(output).toContain("previews=2");
      expect(output).toContain("comparisons=1");
      expect(output).toContain("comparison: verdict=needs review");
      expect(output).toContain("mismatch=0.2");
      expect(output).toContain("feedback: verdict=needs review");
      expect(output).toContain("diagnostics=moderate-mismatch");
      expect(output).toContain("next=inspect_screen_feedback_from_context, get_scene_hierarchy_from_context, update_ui_element_from_context");
      expect(output).toContain("preview-MainScreen_ID-new.png");
      expect(output).toContain("scene objects: 1, deleted=1");
      expect(output).toContain("SceneObject_Cube");
      expect(output).toContain('name="Conversation Cube"');
      expect(output).toContain("pos=(1,2,3)");
      expect(output).toContain("rot=(0,45,0)");
      expect(output).toContain("Assets/UOS/Imported/logo.png");
      expect(output).toContain("recent journal entries: 2");

      const attachments = await previewAttachmentsForContext(context);
      expect(attachments).toHaveLength(1);
      expect(attachments[0].screenId).toBe("MainScreen_ID");
      expect(attachments[0].filename).toBe("preview-MainScreen_ID-new.png");
      expect(attachments[0].mime).toBe("image/png");
      const sourceAttachments = await sourceReferenceAttachmentsForContext(context);
      expect(sourceAttachments).toHaveLength(1);
      expect(sourceAttachments[0].screenId).toBe("MainScreen_ID");
      expect(sourceAttachments[0].filename).toBe("source-lobby-slide2.png");
      expect(sourceAttachments[0].sourceKind).toBe("pptx");
      const comparisonAttachments = await comparisonAttachmentsForContext(context);
      expect(comparisonAttachments).toHaveLength(1);
      expect(comparisonAttachments[0].screenId).toBe("MainScreen_ID");
      expect(comparisonAttachments[0].filename).toBe("diff-MainScreen_ID.png");
      expect(comparisonAttachments[0].role).toBe("comparison-diff");
      await expect(resolveContextVerification(context, {
        screenName: "Main",
      })).resolves.toMatchObject({
        ok: true,
        screenId: "MainScreen_ID",
        referencePath: sourceReferencePath,
        referenceSource: "persisted-source",
      });
      await expect(resolveContextVerification(context, {
        screenName: "Main",
        referencePath: "D:/Manual/mockup.png",
      })).resolves.toMatchObject({
        ok: true,
        screenId: "MainScreen_ID",
        referencePath: "D:/Manual/mockup.png",
        referenceSource: "argument",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports missing context without failing", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-missing");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const context = await loadUosContext({ projectDir: dir });
      expect(context.hasContext).toBe(false);
      expect(context.attachedFiles).toHaveLength(0);
      expect(context.screens).toHaveLength(0);
      expect(formatUosContext(context)).toContain("No persisted UOS context");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("surfaces persisted ProductionBlueprint summaries for resumed sessions", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-blueprints");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const write = await writeProductionBlueprint(dir, {
        version: "1.0.0",
        kind: "ProductionBlueprint",
        id: "blueprint-lobby",
        modeId: "screen-from-material",
        title: "Lobby screen",
        goal: "Create a reviewable lobby screen from planning material",
        status: "needs-approval",
        experience: { summary: "Single lobby entry screen" },
        sources: [{ id: "brief", path: "D:/Plans/lobby.md", kind: "document" }],
        screens: [{ id: "lobby", title: "Lobby", role: "entry" }],
        interactions: [],
        assumptions: [],
        risks: [],
        ambiguity: { estimate: 15, drivers: [] },
        approval: { required: true, status: "needs-approval" },
        evidence: [],
      });
      expect(write.ok).toBe(true);

      const context = await loadUosContext({ projectDir: dir });
      expect(context.hasContext).toBe(true);
      expect(context.productionBlueprints).toMatchObject({
        count: 1,
        latest: {
          id: "blueprint-lobby",
          status: "needs-approval",
          approvalStatus: "needs-approval",
          ambiguityEstimate: 15,
        },
      });

      const output = formatUosContext(context);
      expect(output).toContain("productionBlueprints: 1");
      expect(output).toContain("latest: blueprint-lobby status=needs-approval");
      expect(output).toContain("next: show the latest blueprint to the user for approval");

      const toolResult = await getUosContextTool.execute({ projectDir: dir }, { directory: "C:/WrongDirectory" });
      const metadata = toolResult.metadata as any;
      expect(metadata.productionBlueprints.latest.id).toBe("blueprint-lobby");
      expect(toolResult.output).toContain("productionBlueprints: 1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports invalid ProductionBlueprint artifacts as context blockers", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-invalid-blueprints");
    const blueprintsDir = join(dir, ".uos", "orchestrator", "blueprints");
    await rm(dir, { recursive: true, force: true });
    await mkdir(blueprintsDir, { recursive: true });

    try {
      await writeFile(join(blueprintsDir, "bad.json"), JSON.stringify({
        version: "1.0.0",
        kind: "ProductionBlueprint",
        id: "bad",
        modeId: "screen-from-material",
        title: "Bad blueprint",
        goal: "Missing required fields",
        status: "approved",
      }));

      const context = await loadUosContext({ projectDir: dir });
      const output = formatUosContext(context);
      expect(context.hasContext).toBe(true);
      expect(context.productionBlueprints).toMatchObject({
        count: 1,
        invalid: [{ path: expect.stringContaining("bad.json") }],
      });
      expect(output).toContain("productionBlueprints: 1");
      expect(output).toContain("invalid ProductionBlueprint artifact(s)");
      expect(output).toContain("do not continue to Plan/Build until fixed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("surfaces active orchestrator progress for resumed sessions", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-orchestrator-progress");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const progress = createOrchestratorProgress({
        id: "progress-kiosk-resume",
        taskTitle: "장흥 키오스크 생성",
        status: "building",
        mode: { id: "kiosk-content", title: "Kiosk Content Builder" },
        plan: { id: "plan-jangheung", kind: "KioskPlan", status: "approved" },
        build: { id: "changes-jangheung", kind: "EditorChangeSet", status: "pending" },
        editorProgress: {
          kind: "EditorBatchProgress",
          batchId: "batch-jangheung",
          status: "in-progress",
          commands: [
            { id: "create-root", status: "done" },
            { id: "create-detail", status: "pending" },
          ],
          evidence: [{ id: "ev-screen-root" }],
        },
        steps: [
          { id: "plan", title: "Plan kiosk", status: "done" },
          { id: "build", title: "Build screens", status: "in-progress" },
        ],
        evidence: [{ id: "ev-plan", title: "Plan approved" }],
        nextAction: "Continue applying EditorCommandBatch.",
      }, { now: "2026-06-11T02:00:00.000Z" });
      await writeOrchestratorProgress(dir, progress);

      const context = await loadUosContext({ projectDir: dir });
      expect(context.hasContext).toBe(true);
      expect(context.activeOrchestratorProgress).toMatchObject({
        id: "progress-kiosk-resume",
        status: "building",
        mode: { id: "kiosk-content" },
      });

      const output = formatUosContext(context);
      expect(output).toContain("orchestratorProgress: building");
      expect(output).toContain("task=\"장흥 키오스크 생성\"");
      expect(output).toContain("mode=kiosk-content");
      expect(output).toContain("current=build(in-progress)");
      expect(output).toContain("editor: batch-jangheung status=in-progress commands=1/2");
      expect(output).toContain("next: Continue applying EditorCommandBatch.");

      const toolResult = await getUosContextTool.execute({ projectDir: dir }, { directory: "C:/WrongDirectory" });
      const metadata = toolResult.metadata as any;
      expect(metadata.activeOrchestratorProgress).toMatchObject({
        id: "progress-kiosk-resume",
        status: "building",
      });
      expect(toolResult.output).toContain("orchestratorProgress: building");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("attaches persisted source material files for follow-up sessions", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-source-materials");
    const uos = join(dir, ".uos");
    await rm(dir, { recursive: true, force: true });
    await mkdir(uos, { recursive: true });
    await mkdir(join(dir, "Plans"), { recursive: true });
    const deck = join(dir, "Plans", "lobby.pptx");
    const doc = join(dir, "Plans", "brief.md");
    const rendered = join(dir, "Plans", "lobby-slide-001.png");
    await writeFile(deck, "pptx bytes");
    await writeFile(doc, "# Brief");
    await writeFile(rendered, "png bytes");
    await writeFile(join(uos, "screens.json"), JSON.stringify({
      version: "1.0.0",
      updatedAt: "2026-06-04T02:00:00.000Z",
      screens: {
        Lobby_ID: {
          screenId: "Lobby_ID",
          screenName: "Lobby",
          updatedAt: "2026-06-04T02:00:00.000Z",
          source: {
            tool: "create_screen_from_material",
            kind: "pptx",
            mode: "editable",
            path: deck,
            slideNumber: 1,
            renderedPath: rendered,
          },
          elements: {},
        },
        Brief_ID: {
          screenId: "Brief_ID",
          screenName: "Brief",
          updatedAt: "2026-06-04T02:01:00.000Z",
          source: {
            tool: "create_screen_from_material",
            kind: "md",
            mode: "editable",
            path: doc,
          },
          elements: {},
        },
        Missing_ID: {
          screenId: "Missing_ID",
          source: {
            tool: "create_screen_from_material",
            kind: "pdf",
            path: join(dir, "Plans", "missing.pdf"),
          },
          elements: {},
        },
      },
    }));

    try {
      const context = await loadUosContext({ projectDir: dir });
      const sourceMaterials = await sourceMaterialAttachmentsForContext(context);
      expect(sourceMaterials.map((attachment) => attachment.filename)).toEqual(["brief.md", "lobby.pptx"]);
      expect(sourceMaterials[0]).toMatchObject({
        screenId: "Brief_ID",
        role: "source-material",
        sourceKind: "md",
        mime: "text/markdown",
      });
      expect(sourceMaterials[1]).toMatchObject({
        screenId: "Lobby_ID",
        role: "source-material",
        sourceKind: "pptx",
      });
      expect(sourceMaterials[1].mime).toContain("presentationml.presentation");

      const sourceReferences = await sourceReferenceAttachmentsForContext(context);
      expect(sourceReferences).toHaveLength(1);
      expect(sourceReferences[0].filename).toBe("lobby-slide-001.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resolves context elements for conversational follow-up edits", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-element-resolution");
    const uos = join(dir, ".uos");
    await rm(dir, { recursive: true, force: true });
    await mkdir(uos, { recursive: true });
    await writeFile(join(uos, "screens.json"), JSON.stringify({
      version: "1.0.0",
      updatedAt: "2026-06-04T02:30:00.000Z",
      screens: {
        Main_ID: {
          screenId: "Main_ID",
          screenName: "Main Menu",
          active: true,
          updatedAt: "2026-06-04T02:30:00.000Z",
          source: {
            tool: "create_pptx_deck_screens",
            kind: "pptx",
            mode: "editable",
            path: "D:/Plans/lobby-deck.pptx",
            slideNumber: 1,
          },
          elements: {
            Element_Panel: {
              elementId: "Element_Panel",
              clientHintId: "panel",
              type: "Panel",
              updatedAt: "2026-06-04T02:30:00.000Z",
            },
            Element_Play: {
              elementId: "Element_Play",
              clientHintId: "cta_primary",
              type: "Button",
              props: { text: "Play Now" },
              updatedAt: "2026-06-04T02:30:00.000Z",
            },
            Element_Settings: {
              elementId: "Element_Settings",
              clientHintId: "cta_settings",
              type: "Button",
              props: { text: "설정" },
              updatedAt: "2026-06-04T02:30:00.000Z",
            },
          },
        },
        Shop_ID: {
          screenId: "Shop_ID",
          screenName: "Shop",
          updatedAt: "2026-06-04T02:31:00.000Z",
          source: {
            tool: "create_pptx_deck_screens",
            kind: "pptx",
            mode: "editable",
            path: "D:/Plans/lobby-deck.pptx",
            slideNumber: 2,
          },
          elements: {
            Element_Buy: {
              elementId: "Element_Buy",
              clientHintId: "cta_primary",
              type: "Button",
              props: { text: "Buy" },
              updatedAt: "2026-06-04T02:31:00.000Z",
            },
          },
        },
      },
      activeScreenId: "Main_ID",
    }));

    try {
      const context = await loadUosContext({ projectDir: dir });
      expect(resolveContextElement(context, {
        screenName: "Main",
        clientHintId: "cta_primary",
      })).toMatchObject({
        ok: true,
        candidate: {
          screenId: "Main_ID",
          elementId: "Element_Play",
          text: "Play Now",
        },
      });
      expect(resolveContextElement(context, { clientHintId: "cta_primary" })).toMatchObject({
        ok: true,
        candidate: {
          screenId: "Main_ID",
          elementId: "Element_Play",
          text: "Play Now",
        },
      });
      expect(resolveContextElement({
        ...context,
        activeScreenId: undefined,
      }, { clientHintId: "cta_primary" })).toMatchObject({
        ok: true,
        candidate: {
          screenId: "Main_ID",
          elementId: "Element_Play",
        },
      });
      expect(resolveContextElement({
        ...context,
        activeScreenId: undefined,
        screens: context.screens.map((screen) =>
          screen.screenId === "Shop_ID" ? { ...screen, active: true } : screen),
      }, { clientHintId: "cta_primary" })).toMatchObject({
        ok: false,
        reason: expect.stringContaining("multiple matching"),
      });
      expect(resolveContextElement(context, { screenName: "Shop", textContains: "buy" })).toMatchObject({
        ok: true,
        candidate: { elementId: "Element_Buy" },
      });
      expect(resolveContextScreen(context, {
        sourceKind: "pptx",
        sourcePathContains: "deck.pptx",
        slideNumber: 2,
      })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID" },
      });
      expect(resolveContextScreen(context, {
        sourceKind: "pptx",
        sourcePathContains: "lobby deck",
        slideNumber: 2,
      })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID" },
      });
      expect(resolveContextScreen(context, { screenQuery: "deck slide 2" })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID" },
      });
      expect(resolveContextScreen(context, { screenQuery: "2번 슬라이드" })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID" },
      });
      expect(resolveContextScreen(context, { screenQuery: "현재 화면" })).toMatchObject({
        ok: true,
        screen: { screenId: "Main_ID", active: true },
      });
      expect(resolveContextScreen(context, { screenQuery: "current screen" })).toMatchObject({
        ok: true,
        screen: { screenId: "Main_ID", active: true },
      });
      expect(resolveContextScreen(context, { sourceKind: "pptx", latest: true })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID" },
      });
      expect(resolveContextElement(context, { slideNumber: 2, query: "buy button" })).toMatchObject({
        ok: true,
        candidate: { screenId: "Shop_ID", elementId: "Element_Buy" },
      });
      expect(resolveContextElement(context, { sourcePathContains: "lobby deck", query: "buy button" })).toMatchObject({
        ok: true,
        candidate: { screenId: "Shop_ID", elementId: "Element_Buy" },
      });
      expect(resolveContextElement(context, { screenQuery: "2번째 슬라이드", query: "buy button" })).toMatchObject({
        ok: true,
        candidate: { screenId: "Shop_ID", elementId: "Element_Buy" },
      });
      expect(resolveContextElement(context, { screenQuery: "활성 화면", query: "play button" })).toMatchObject({
        ok: true,
        candidate: { screenId: "Main_ID", elementId: "Element_Play" },
      });
      expect(resolveContextElement(context, { screenQuery: "current screen", query: "settings button" })).toMatchObject({
        ok: true,
        candidate: { screenId: "Main_ID", elementId: "Element_Settings" },
      });
      expect(resolveContextElement(context, { screenQuery: "현재 화면", query: "설정 버튼" })).toMatchObject({
        ok: true,
        candidate: { screenId: "Main_ID", elementId: "Element_Settings", text: "설정" },
      });
      expect(resolveUosContextTarget(context, { screenQuery: "deck slide 2" })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID", screenName: "Shop" },
      });
      expect(resolveUosContextTarget(context, { screenQuery: "2번 슬라이드" })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID", screenName: "Shop" },
      });
      expect(resolveUosContextTarget(context, { screenQuery: "지금 화면" })).toMatchObject({
        ok: true,
        screen: { screenId: "Main_ID", active: true },
      });
      expect(resolveUosContextTarget(context, { slideNumber: 2, query: "buy button" })).toMatchObject({
        ok: true,
        screen: { screenId: "Shop_ID" },
        element: { screenId: "Shop_ID", elementId: "Element_Buy" },
      });
      expect(resolveUosContextTarget(context, { slideNumber: 2, requireElement: true })).toMatchObject({
        ok: false,
        reason: expect.stringContaining("no element selector"),
      });
      expect(resolveContextElement(context, { query: "play button" })).toMatchObject({
        ok: true,
        candidate: {
          screenId: "Main_ID",
          elementId: "Element_Play",
        },
      });
      expect(resolveContextElement(context, { query: "primary CTA" })).toMatchObject({
        ok: true,
        candidate: {
          screenId: "Main_ID",
          elementId: "Element_Play",
        },
      });
      expect(resolveContextElement(context, { query: "shop buy button" })).toMatchObject({
        ok: true,
        candidate: {
          screenId: "Shop_ID",
          elementId: "Element_Buy",
        },
      });
      expect(resolveContextElement(context, { query: "button" })).toMatchObject({
        ok: false,
        reason: expect.stringContaining("multiple matching"),
      });
      expect(resolveContextElement(context, { screenName: "Missing", textContains: "buy" })).toMatchObject({
        ok: false,
        reason: expect.stringContaining("no matching"),
      });
      expect(resolveContextAddTarget(context, {
        screenName: "Main",
        parentClientHintId: "panel",
      })).toMatchObject({
        ok: true,
        screenId: "Main_ID",
        parent: {
          elementId: "Element_Panel",
          clientHintId: "panel",
        },
      });
      expect(resolveContextAddTarget(context, {
        screenName: "Main",
        parentQuery: "main panel",
      })).toMatchObject({
        ok: true,
        screenId: "Main_ID",
        parent: {
          elementId: "Element_Panel",
          clientHintId: "panel",
        },
      });
      expect(resolveContextAddTarget(context, {
        sourcePathContains: "deck.pptx",
        slideNumber: 1,
        parentQuery: "main panel",
      })).toMatchObject({
        ok: true,
        screenId: "Main_ID",
        parent: {
          elementId: "Element_Panel",
          clientHintId: "panel",
        },
      });
      expect(resolveContextAddTarget(context, { screenName: "Shop" })).toMatchObject({
        ok: true,
        screenId: "Shop_ID",
      });
      expect(resolveContextScreen(context, {})).toMatchObject({
        ok: true,
        screen: {
          screenId: "Main_ID",
          active: true,
        },
      });
      expect(resolveContextAddTarget(context, {})).toMatchObject({
        ok: true,
        screenId: "Main_ID",
      });
      expect(resolveContextTransition(context, {
        toScreenName: "Shop",
        triggerTextContains: "play",
      })).toMatchObject({
        ok: true,
        fromId: "Main_ID",
        toId: "Shop_ID",
        trigger: "Element_Play",
        triggerElement: {
          elementId: "Element_Play",
          text: "Play Now",
        },
      });
      expect(resolveContextTransition(context, {
        toScreenName: "Shop",
        triggerQuery: "play button",
      })).toMatchObject({
        ok: true,
        fromId: "Main_ID",
        toId: "Shop_ID",
        trigger: "Element_Play",
      });
      expect(resolveContextTransition(context, {
        toSourcePathContains: "deck.pptx",
        toSlideNumber: 2,
        triggerQuery: "play button",
      })).toMatchObject({
        ok: true,
        fromId: "Main_ID",
        toId: "Shop_ID",
        trigger: "Element_Play",
      });
      expect(resolveContextTransition(context, {
        fromScreenQuery: "current screen",
        toScreenQuery: "deck slide 2",
        triggerQuery: "settings button",
      })).toMatchObject({
        ok: true,
        fromId: "Main_ID",
        toId: "Shop_ID",
        trigger: "Element_Settings",
      });
      expect(resolveContextTransition(context, {
        fromScreenName: "Shop",
        toScreenQuery: "active screen",
        trigger: "OnBack",
      })).toMatchObject({
        ok: true,
        fromId: "Shop_ID",
        toId: "Main_ID",
        trigger: "OnBack",
      });
      expect(resolveContextTransition(context, {
        fromScreenName: "Main",
        toScreenName: "Shop",
        trigger: "OnOpenShop",
      })).toMatchObject({
        ok: true,
        trigger: "OnOpenShop",
      });
      expect(resolveContextTransition(context, {
        fromScreenName: "Main",
        trigger: "Element_Play",
      })).toMatchObject({
        ok: false,
        reason: expect.stringContaining("target screen is required"),
      });
      expect(resolveContextTransition(context, {
        fromScreenName: "Main",
        toScreenName: "Missing",
        trigger: "Element_Play",
      })).toMatchObject({
        ok: false,
        reason: expect.stringContaining("target no matching screen"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("summarizes latest screen feedback with diff/source/preview attachments", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-screen-feedback");
    const uos = join(dir, ".uos");
    await rm(dir, { recursive: true, force: true });
    await mkdir(uos, { recursive: true });
    const sourceReferencePath = join(dir, "source.png");
    const oldPreviewPath = join(dir, "preview-old.png");
    const latestPreviewPath = join(dir, "preview-latest.png");
    const diffPath = join(dir, "diff.png");
    await writeFile(sourceReferencePath, "source png");
    await writeFile(oldPreviewPath, "old preview");
    await writeFile(latestPreviewPath, "latest preview");
    await writeFile(diffPath, "diff png");
    await writeFile(join(uos, "screens.json"), JSON.stringify({
      version: "1.0.0",
      updatedAt: "2026-06-05T01:00:00.000Z",
      screens: {
        Feedback_ID: {
          screenId: "Feedback_ID",
          screenName: "Feedback Screen",
          active: true,
          updatedAt: "2026-06-05T01:00:00.000Z",
          source: {
            tool: "create_reference_screen_from_material",
            kind: "image",
            mode: "reference",
            path: sourceReferencePath,
          },
          previews: [
            {
              savedPath: oldPreviewPath,
              mimeType: "image/png",
              width: 640,
              height: 360,
              ts: "2026-06-05T01:01:00.000Z",
            },
            {
              savedPath: latestPreviewPath,
              mimeType: "image/png",
              width: 1920,
              height: 1080,
              ts: "2026-06-05T01:03:00.000Z",
            },
          ],
          comparisons: [
            {
              referencePath: sourceReferencePath,
              candidatePath: latestPreviewPath,
              diffPath,
              diffMimeType: "image/png",
              verdict: "different",
              compareWidth: 1024,
              compareHeight: 576,
              meanAbsoluteError: 0.2,
              rootMeanSquareError: 0.25,
              mismatchRatio: 0.55,
              aspectRatioDelta: 0.04,
              threshold: 0.05,
              ts: "2026-06-05T01:04:00.000Z",
            },
          ],
          elements: {
            Element_Title: {
              elementId: "Element_Title",
              type: "Text",
              props: { text: "Feedback" },
            },
          },
        },
      },
      activeScreenId: "Feedback_ID",
    }));

    try {
      const context = await loadUosContext({ projectDir: dir });
      const feedback = screenFeedbackFromContext(context, context.screens[0]);
      expect(feedback.screen.screenId).toBe("Feedback_ID");
      expect(feedback.latestPreview?.savedPath).toBe(latestPreviewPath);
      expect(feedback.latestComparison?.diffPath).toBe(diffPath);
      expect(feedback.sourceReferencePath).toBe(sourceReferencePath);
      expect(feedback.recommendedTools).toEqual([
        "inspect_screen_feedback_from_context",
        "get_scene_hierarchy_from_context",
        "update_ui_element_from_context",
        "move_ui_element_from_context",
        "add_ui_element_from_context",
        "delete_ui_element_from_context",
        "verify_screen_against_reference_from_context",
      ]);
      expect(feedback.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "aspect-ratio-delta",
        "large-mismatch",
      ]);
      expect(feedback.diagnostics[0]).toMatchObject({
        severity: "medium",
        evidence: { aspectRatioDelta: 0.04 },
      });
      expect(feedback.diagnostics[1]).toMatchObject({
        severity: "high",
        evidence: {
          verdict: "different",
          mismatchRatio: 0.55,
          meanAbsoluteError: 0.2,
        },
      });
      expect(feedback.recommendations.join("\n")).toContain("Inspect the attached diff/source/preview images");
      expect(feedback.recommendations.join("\n")).toContain("Aspect ratio differs");
      expect(feedback.recommendations.join("\n")).toContain("Large mismatch detected");

      const output = formatScreenFeedback(feedback, 3);
      expect(output).toContain("Feedback_ID");
      expect(output).toContain("verdict=different");
      expect(output).toContain("mismatch=0.55");
      expect(output).toContain("diagnostics:");
      expect(output).toContain("medium/aspect-ratio-delta");
      expect(output).toContain("high/large-mismatch");
      expect(output).toContain("recommended tools: inspect_screen_feedback_from_context, get_scene_hierarchy_from_context, update_ui_element_from_context");
      expect(output).toContain("attached image(s): 3");

      const attachments = await feedbackAttachments(feedback);
      expect(attachments.map((attachment) => attachment.role)).toEqual([
        "comparison-diff",
        "source-reference",
        "latest-preview",
      ]);
      expect(attachments.map((attachment) => attachment.filename)).toEqual([
        "diff.png",
        "source.png",
        "preview-latest.png",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("recommends capture and hierarchy tools before visual feedback exists", () => {
    const feedback = screenFeedbackFromContext({
      projectDir: "C:/Game",
      contextDir: "C:/Game/.uos",
      hasContext: true,
      attachedFiles: [],
      materialCandidates: [],
      screens: [],
      sceneObjects: [],
      transitionCount: 0,
      importedAssets: [],
      recentJournal: [],
    }, {
      screenId: "Fresh_ID",
      screenName: "Fresh",
      active: true,
      elementCount: 0,
      previewCount: 0,
      comparisonCount: 0,
      elements: [],
      previews: [],
      comparisons: [],
    });

    expect(feedback.recommendedTools).toEqual([
      "capture_preview_from_context",
      "get_scene_hierarchy_from_context",
    ]);
    expect(feedback.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "preview-missing",
      "reference-missing",
    ]);
    expect(formatScreenFeedback(feedback)).toContain("recommended tools: capture_preview_from_context, get_scene_hierarchy_from_context");
  });

  test("resolves batch screen verification plans from source references", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-batch-verification");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const slide1 = join(dir, "deck-slide-001.png");
    const slide2 = join(dir, "deck-slide-002.png");
    await writeFile(slide1, "slide 1");
    await writeFile(slide2, "slide 2");

    try {
      const context = {
        projectDir: dir,
        contextDir: join(dir, ".uos"),
        hasContext: true,
        attachedFiles: [],
        screens: [
          {
            screenId: "Deck_1",
            screenName: "Lobby Slide 1",
            source: {
              tool: "create_reference_screen_from_material",
              kind: "pptx",
              mode: "rendered",
              path: join(dir, "lobby-deck.pptx"),
              slideNumber: 1,
              renderedPath: slide1,
            },
            elementCount: 1,
            deletedElementCount: 0,
            previewCount: 0,
            comparisonCount: 0,
            updatedAt: "2026-06-05T01:00:00.000Z",
            elements: [],
            previews: [],
            comparisons: [],
          },
          {
            screenId: "Deck_2",
            screenName: "Lobby Slide 2",
            source: {
              tool: "create_reference_screen_from_material",
              kind: "pptx",
              mode: "rendered",
              path: join(dir, "lobby-deck.pptx"),
              slideNumber: 2,
              renderedPath: slide2,
            },
            elementCount: 1,
            deletedElementCount: 0,
            previewCount: 0,
            comparisonCount: 0,
            updatedAt: "2026-06-05T01:02:00.000Z",
            elements: [],
            previews: [],
            comparisons: [],
          },
          {
            screenId: "Deck_3",
            screenName: "Lobby Slide 3",
            source: {
              tool: "create_reference_screen_from_material",
              kind: "pptx",
              mode: "rendered",
              path: join(dir, "lobby-deck.pptx"),
              slideNumber: 3,
              renderedPath: join(dir, "missing-slide-003.png"),
            },
            elementCount: 1,
            deletedElementCount: 0,
            previewCount: 0,
            comparisonCount: 0,
            updatedAt: "2026-06-05T01:03:00.000Z",
            elements: [],
            previews: [],
            comparisons: [],
          },
        ],
        sceneObjects: [],
        transitionCount: 0,
        importedAssets: [],
        journal: [],
      };

      const resolved = await resolveContextVerificationBatch(context, {
        sourceKind: "pptx",
        sourcePathContains: "lobby deck",
        maxScreens: 5,
      });
      expect(resolved.ok).toBe(true);
      expect(resolved.plans.map((plan) => plan.screenId)).toEqual(["Deck_2", "Deck_1"]);
      expect(resolved.plans.map((plan) => plan.referencePath)).toEqual([slide2, slide1]);
      expect(resolved.skipped).toMatchObject([
        { screenId: "Deck_3", reason: expect.stringContaining("not readable") },
      ]);

      const latest = await resolveContextVerificationBatch(context, {
        sourceKind: "pptx",
        latest: true,
      });
      expect(latest.ok).toBe(false);
      expect(latest.reason).toContain("none had a readable reference");
      expect(latest.skipped[0].screenId).toBe("Deck_3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports launch planning inputs without persisted context", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-launch-inputs");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const deck = join(dir, "lobby.pptx");
      const mockup = join(dir, "mockup.png");
      await writeFile(deck, "pptx bytes");
      await writeFile(mockup, "png bytes");
      const context = await loadUosContext({
        projectDir: dir,
        planningMaterialsDir: "D:/PlanningDecks",
        attachedFiles: [deck, mockup, join(dir, "missing.pdf")],
      });
      expect(context.hasContext).toBe(false);
      expect(context.planningMaterialsDir).toBe("D:/PlanningDecks");
      expect(context.attachedFiles).toEqual([deck, mockup, join(dir, "missing.pdf")]);
      expect(context.attachedMaterialFiles).toEqual([
        expect.objectContaining({ path: deck, readable: true, supported: true, kind: "pptx" }),
        expect.objectContaining({ path: mockup, readable: true, supported: true, kind: "image" }),
        expect.objectContaining({ path: join(dir, "missing.pdf"), readable: false, supported: false, reason: "missing" }),
      ]);
      expect(context.materialCandidates).toHaveLength(2);
      expect(context.materialCandidates.map((candidate) => candidate.kind)).toEqual(["pptx", "image"]);

      const output = formatUosContext(context);
      expect(output).toContain("planningMaterialsDir: D:/PlanningDecks");
      expect(output).toContain("attached material files: 3");
      expect(output).toContain("1 attached file(s) are unavailable or unsupported");
      expect(output).toContain(join(dir, "missing.pdf"));
      expect(output).toContain("lobby.pptx");
      expect(output).toContain("planningMaterialCandidates: 2 (image=1, pptx=1)");
      expect(output).toContain("lobby.pptx [pptx, file]");
      expect(output).toContain("mockup.png [image, file]");
      expect(output).toContain("tools=read_planning_material, create_screen_from_material, create_pptx_deck_screens");
      expect(output).toContain("launch input workflow:");
      expect(output).toContain("Read attached files first");
      expect(output).toContain(`read_planning_material({ path: "${deck.replace(/\\/g, "\\\\")}" })`);
      expect(output).toContain("create_pptx_deck_screens");
      expect(output).toContain(`read_planning_material({ path: "${mockup.replace(/\\/g, "\\\\")}" })`);
      expect(output).toContain("prepare_image_ui_draft");
      expect(output).not.toContain(`read_planning_material({ path: "${join(dir, "missing.pdf").replace(/\\/g, "\\\\")}" })`);
      expect(output).toContain("create_reference_screen_from_material");
      expect(output).toContain("verify_screen_against_reference");
      expect(output).toContain("Use list_planning_materials");
      expect(output).toContain("skip 1 unavailable/unsupported attached file");
      expect(output).toContain("Start by reading attached files");

      const workflow = recommendedLaunchWorkflow(context);
      expect(workflow).toMatchObject({
        hasLaunchInputs: true,
        summary: expect.stringContaining("Read attached files first"),
      });
      expect(workflow.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          phase: "read",
          tool: "read_planning_material",
          args: { path: deck },
        }),
        expect.objectContaining({
          phase: "read",
          tool: "read_planning_material",
          args: { path: mockup },
        }),
        expect.objectContaining({
          phase: "scan",
          tool: "analyze_planning_materials",
          args: { dir: "D:/PlanningDecks", recursive: true },
        }),
        expect.objectContaining({
          phase: "verify",
          tool: "verify_screen_against_reference",
        }),
      ]));
      expect(workflow.actions).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          phase: "read",
          args: { path: join(dir, "missing.pdf") },
        }),
      ]));
      const pptxCreateAction = workflow.actions.find((action) => (
        action.phase === "create" && action.candidateKind === "pptx"
      ));
      expect(pptxCreateAction?.recommendedTools).toEqual(expect.arrayContaining([
        "read_planning_material",
        "create_screen_from_material",
        "create_pptx_deck_screens",
      ]));
      expect(pptxCreateAction?.alternativeTools).toContain("create_pptx_deck_screens");
      expect(pptxCreateAction?.alternativeTools).not.toContain("read_planning_material");

      const imageCreateAction = workflow.actions.find((action) => (
        action.phase === "create" && action.candidateKind === "image"
      ));
      expect(imageCreateAction?.recommendedTools).toEqual(expect.arrayContaining([
        "create_reference_screen_from_material",
        "prepare_image_ui_draft",
        "verify_screen_against_reference",
      ]));
      expect(imageCreateAction?.alternativeTools).toEqual(expect.arrayContaining([
        "create_reference_screen_from_material",
        "prepare_image_ui_draft",
      ]));
      expect(imageCreateAction?.alternativeTools).not.toContain("verify_screen_against_reference");

      const attachments = await launchMaterialAttachmentsForContext(context);
      expect(attachments).toHaveLength(2);
      expect(attachments.map((attachment) => attachment.filename)).toEqual(["lobby.pptx", "mockup.png"]);
      expect(attachments[0].mime).toContain("presentationml.presentation");
      expect(attachments[1].mime).toBe("image/png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps readable attached files independent from material candidate limits", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-attached-limit");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const deck = join(dir, "lobby.pptx");
      const mockup = join(dir, "mockup.png");
      await writeFile(deck, "pptx bytes");
      await writeFile(mockup, "png bytes");

      const context = await loadUosContext({
        projectDir: dir,
        attachedFiles: [deck, mockup],
        maxMaterialCandidates: 1,
      });
      expect(context.materialCandidates).toHaveLength(1);
      expect(context.attachedMaterialFiles).toEqual([
        expect.objectContaining({ path: deck, readable: true, supported: true }),
        expect.objectContaining({ path: mockup, readable: true, supported: true }),
      ]);

      const workflow = recommendedLaunchWorkflow(context);
      expect(workflow.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          phase: "read",
          tool: "read_planning_material",
          args: { path: deck },
        }),
        expect.objectContaining({
          phase: "read",
          tool: "read_planning_material",
          args: { path: mockup },
        }),
      ]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not recommend reads or verification for unavailable attached files", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-missing-attachments");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const missing = join(dir, "missing.pdf");
      const context = await loadUosContext({
        projectDir: dir,
        attachedFiles: [missing],
      });
      expect(context.attachedFiles).toEqual([missing]);
      expect(context.materialCandidates).toEqual([]);

      const output = formatUosContext(context);
      expect(output).toContain("1 attached file(s) are unavailable or unsupported");
      expect(output).toContain("No launch-attached planning files are currently readable");
      expect(output).not.toContain(`read_planning_material({ path: "${missing.replace(/\\/g, "\\\\")}" })`);

      const workflow = recommendedLaunchWorkflow(context);
      expect(workflow).toMatchObject({
        hasLaunchInputs: true,
        summary: expect.stringContaining("No launch-attached planning files are currently readable"),
        actions: [],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("guides material directory sessions before persisted context exists", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-materials-only");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "Plans", "Library"), { recursive: true });

    try {
      await writeFile(join(dir, "Plans", "brief.md"), "# Brief");
      await writeFile(join(dir, "Plans", "deck.pptx"), "pptx bytes");
      await writeFile(join(dir, "Plans", "Library", "ignored.png"), "ignored");
      const context = await loadUosContext({
        projectDir: dir,
        planningMaterialsDir: join(dir, "Plans"),
      });
      expect(context.hasContext).toBe(false);
      expect(context.planningMaterialsDir).toBe(join(dir, "Plans"));
      expect(context.attachedFiles).toHaveLength(0);
      expect(context.materialCandidates.map((candidate) => candidate.relativePath)).toEqual(["deck.pptx", "brief.md"]);

      const output = formatUosContext(context);
      expect(output).toContain(`planningMaterialsDir: ${join(dir, "Plans")}`);
      expect(output).toContain("planningMaterialCandidates: 2 (document=1, pptx=1)");
      expect(output).toContain("deck.pptx [pptx, directory]");
      expect(output).toContain("brief.md [document, directory]");
      expect(output).not.toContain("ignored.png");
      expect(output).toContain("launch input workflow:");
      expect(output).toContain("analyze_planning_materials");
      expect(output).toContain("create_reference_screen_from_material");
      expect(output).toContain("verify_screen_against_reference");
      expect(output).toContain("Use list_planning_materials");
      expect(output).toContain("Then read the highest-ranked material candidates before mutating Unity");
      expect(output).toContain(`read_planning_material({ path: "${join(dir, "Plans", "deck.pptx").replace(/\\/g, "\\\\")}" })`);
      expect(output).toContain(`read_planning_material({ path: "${join(dir, "Plans", "brief.md").replace(/\\/g, "\\\\")}" })`);
      expect(output).toContain("Start by listing planning materials");

      const workflow = recommendedLaunchWorkflow(context);
      expect(workflow.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          phase: "scan",
          tool: "analyze_planning_materials",
          args: { dir: join(dir, "Plans"), recursive: true },
        }),
        expect.objectContaining({
          phase: "read",
          tool: "read_planning_material",
          args: { path: join(dir, "Plans", "deck.pptx") },
          candidateKind: "pptx",
        }),
        expect.objectContaining({
          phase: "read",
          tool: "read_planning_material",
          args: { path: join(dir, "Plans", "brief.md") },
          candidateKind: "document",
        }),
        expect.objectContaining({
          phase: "create",
          tool: "create_screen_from_material",
          candidateKind: "pptx",
        }),
      ]));
      const deckRead = workflow.actions.find((action) => (
        action.phase === "read" && action.candidateKind === "pptx"
      ));
      const deckCreate = workflow.actions.find((action) => (
        action.phase === "create" && action.candidateKind === "pptx"
      ));
      expect(deckRead?.order).toBeLessThan(deckCreate?.order ?? 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("get_uos_context uses launcher material scan limit environment defaults", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-env-material-limits");
    const envKeys = [
      "UOS_PROJECT_DIR",
      "UNITY_MCP_MATERIALS_DIR",
      "UOS_ATTACHED_FILES",
      "UOS_MAX_MATERIAL_CANDIDATES",
      "UOS_MAX_MATERIAL_DEPTH",
      "UOS_MAX_MATERIAL_SCAN_FILES",
    ];
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "Plans"), { recursive: true });

    try {
      await writeFile(join(dir, "Plans", "brief.md"), "# Brief");
      await writeFile(join(dir, "Plans", "deck.pptx"), "pptx bytes");
      process.env.UOS_PROJECT_DIR = dir;
      process.env.UNITY_MCP_MATERIALS_DIR = join(dir, "Plans");
      process.env.UOS_ATTACHED_FILES = "";
      process.env.UOS_MAX_MATERIAL_CANDIDATES = "1";
      process.env.UOS_MAX_MATERIAL_DEPTH = "4";
      process.env.UOS_MAX_MATERIAL_SCAN_FILES = "500";

      const result = await getUosContextTool.execute({}, { directory: dir });
      const metadata = result.metadata as any;
      expect(metadata.materialCandidates).toHaveLength(1);
      expect(metadata.materialCandidates[0]).toMatchObject({
        relativePath: "deck.pptx",
        kind: "pptx",
        source: "directory",
      });
      expect(metadata.recommendedLaunchWorkflow).toMatchObject({
        hasLaunchInputs: true,
        actions: expect.arrayContaining([
          expect.objectContaining({
            phase: "scan",
            tool: "analyze_planning_materials",
            args: { dir: join(dir, "Plans"), recursive: true },
          }),
          expect.objectContaining({
            phase: "read",
            tool: "read_planning_material",
            args: { path: join(dir, "Plans", "deck.pptx") },
            candidateKind: "pptx",
          }),
          expect.objectContaining({
            phase: "create",
            tool: "create_screen_from_material",
            candidateKind: "pptx",
            alternativeTools: expect.arrayContaining(["create_pptx_deck_screens"]),
          }),
        ]),
      });
      expect(result.output).toContain("planningMaterialCandidates: 1 (pptx=1)");
      expect(result.output).toContain("deck.pptx [pptx, directory]");
      expect(result.output).not.toContain("brief.md [document, directory]");
    } finally {
      for (const key of envKeys) {
        const previous = previousEnv.get(key);
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("get_uos_context reports selected Unity bridge metadata without leaking token", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-selected-unity");
    const envKeys = [
      "UOS_PROJECT_DIR",
      "UOS_PROJECT_NAME",
      "UOS_EDITOR_INSTANCE_ID",
      "UNITY_MCP_HOST",
      "UNITY_MCP_PORT",
      "UNITY_MCP_TOKEN",
      "UOS_BRIDGE_SUPPORTED_TOOLS",
      "UOS_BRIDGE_WRITE_TOOLS",
      "UOS_BRIDGE_CAPABILITY_ERROR",
    ];
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, ".uos"), { recursive: true });

    try {
      process.env.UOS_PROJECT_DIR = dir;
      process.env.UOS_PROJECT_NAME = "SelectedGame";
      process.env.UOS_EDITOR_INSTANCE_ID = "editor-123";
      process.env.UNITY_MCP_HOST = "127.0.0.1";
      process.env.UNITY_MCP_PORT = "19001";
      process.env.UNITY_MCP_TOKEN = "secret-token";
      process.env.UOS_BRIDGE_SUPPORTED_TOOLS = JSON.stringify(["get_project_info", "create_ui_screen", "save_scene"]);
      process.env.UOS_BRIDGE_WRITE_TOOLS = JSON.stringify(["create_ui_screen", "save_scene"]);

      const result = await getUosContextTool.execute({}, { directory: "C:/WrongDirectory" });
      const metadata = result.metadata as any;
      expect(metadata.selectedUnity).toMatchObject({
        projectDir: dir,
        projectName: "SelectedGame",
        editorInstanceId: "editor-123",
        hasBridgeEnv: true,
        bridge: {
          host: "127.0.0.1",
          port: "19001",
        },
        supportedTools: ["get_project_info", "create_ui_screen", "save_scene"],
        writeTools: ["create_ui_screen", "save_scene"],
        bridgeReadiness: {
          ready: false,
          missingTools: expect.arrayContaining(["list_screens", "add_ui_element"]),
          missingWriteTools: expect.arrayContaining(["add_ui_element", "import_asset"]),
          requiredTools: expect.arrayContaining(["get_project_info", "create_ui_screen"]),
          requiredWriteTools: expect.arrayContaining(["create_ui_screen", "save_scene"]),
        },
      });
      expect(result.output).toContain("[uos context] selectedUnity: SelectedGame");
      expect(result.output).toContain(dir);
      expect(result.output).toContain("editor=editor-123");
      expect(result.output).toContain("bridge=127.0.0.1:19001");
      expect(result.output).toContain("tools=3 supported");
      expect(result.output).toContain("writeTools=create_ui_screen,save_scene");
      expect(result.output).toContain("requiredTools=");
      expect(result.output).toContain("missingTools=");
      expect(result.output).toContain("requiredWriteTools=");
      expect(result.output).toContain("missingWriteTools=");
      expect(result.output).toContain("[uos context] bridgeReadiness: blocked");
      expect(result.output).toContain("blocker: Unity bridge missing required tool(s)");
      expect(result.output).toContain("do not mutate Unity until the selected bridge reports the required editing tools");
      expect(result.output).not.toContain("secret-token");
      expect(JSON.stringify(metadata)).not.toContain("secret-token");

      process.env.UOS_BRIDGE_SUPPORTED_TOOLS = JSON.stringify([]);
      process.env.UOS_BRIDGE_WRITE_TOOLS = JSON.stringify([]);
      const emptyResult = await getUosContextTool.execute({}, { directory: "C:/WrongDirectory" });
      const emptyMetadata = emptyResult.metadata as any;
      expect(emptyMetadata.selectedUnity.supportedTools).toEqual([]);
      expect(emptyMetadata.selectedUnity.writeTools).toEqual([]);
      expect(emptyMetadata.selectedUnity.bridgeReadiness.ready).toBe(false);
      expect(emptyMetadata.selectedUnity.bridgeReadiness.missingTools).toContain("create_ui_screen");
      expect(emptyMetadata.selectedUnity.bridgeReadiness.missingWriteTools).toContain("create_ui_screen");
      expect(emptyResult.output).toContain("tools=0 supported");
      expect(emptyResult.output).toContain("writeTools=0");
      expect(emptyResult.output).toContain("missingTools=");
      expect(emptyResult.output).toContain("missingWriteTools=");
      expect(emptyResult.output).toContain("[uos context] bridgeReadiness: blocked");

      delete process.env.UOS_BRIDGE_SUPPORTED_TOOLS;
      delete process.env.UOS_BRIDGE_WRITE_TOOLS;
      const legacyResult = await getUosContextTool.execute({}, { directory: "C:/WrongDirectory" });
      const legacyMetadata = legacyResult.metadata as any;
      expect(legacyMetadata.selectedUnity.bridgeReadiness.ready).toBe(true);
      expect(legacyMetadata.selectedUnity.bridgeReadiness.warnings).toEqual(expect.arrayContaining([
        "Unity bridge did not report supportedTools",
        "Unity bridge did not report writeTools",
      ]));
      expect(legacyResult.output).toContain("[uos context] bridgeReadiness: warning");
      expect(legacyResult.output).toContain("warning: Unity bridge did not report supportedTools");
      expect(legacyResult.output).toContain("call get_project_info before write operations");
    } finally {
      for (const key of envKeys) {
        const previous = previousEnv.get(key);
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("get_uos_context follows session-selected Unity target", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-session-selected-unity");
    const alphaDir = join(dir, "AlphaGame");
    const bravoDir = join(dir, "BravoGame");
    const stateFile = join(dir, "target-session.json");
    const envKeys = [
      "UOS_PROJECT_DIR",
      "UOS_PROJECT_NAME",
      "UOS_EDITOR_INSTANCE_ID",
      "UOS_CONTEXT_DIR",
      "UOS_TARGET_SESSION_FILE",
      "UNITY_MCP_HOST",
      "UNITY_MCP_PORT",
      "UNITY_MCP_TOKEN",
    ];
    const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(alphaDir, ".uos"), { recursive: true });
    await mkdir(join(bravoDir, ".uos"), { recursive: true });
    await writeFile(join(alphaDir, ".uos", "project.json"), JSON.stringify({ projectName: "AlphaGame" }));
    await writeFile(join(bravoDir, ".uos", "project.json"), JSON.stringify({ projectName: "BravoGame" }));

    try {
      process.env.UOS_PROJECT_DIR = alphaDir;
      process.env.UOS_PROJECT_NAME = "AlphaGame";
      process.env.UOS_EDITOR_INSTANCE_ID = "alpha-id";
      process.env.UOS_CONTEXT_DIR = join(alphaDir, ".uos");
      process.env.UOS_TARGET_SESSION_FILE = stateFile;
      process.env.UNITY_MCP_HOST = "127.0.0.1";
      process.env.UNITY_MCP_PORT = "19001";
      process.env.UNITY_MCP_TOKEN = "alpha-token";

      await writeActiveUnityTarget({
        instanceId: "bravo-id",
        projectName: "BravoGame",
        projectPath: bravoDir,
        host: "127.0.0.1",
        port: 19002,
        token: "bravo-token",
      }, { env: process.env, stateFile });

      const result = await getUosContextTool.execute({}, { directory: "C:/WrongDirectory" });
      const metadata = result.metadata as any;
      expect(metadata.projectDir).toBe(bravoDir);
      expect(metadata.project?.projectName).toBe("BravoGame");
      expect(metadata.selectedUnity).toMatchObject({
        projectDir: bravoDir,
        projectName: "BravoGame",
        editorInstanceId: "bravo-id",
        selectionSource: "session",
        targetStateFile: stateFile,
        bridge: {
          host: "127.0.0.1",
          port: "19002",
        },
      });
      expect(result.output).toContain("selectedUnity: BravoGame");
      expect(result.output).toContain("source=session");
      expect(result.output).toContain("state=");
      expect(result.output).not.toContain("bravo-token");
      expect(JSON.stringify(metadata)).not.toContain("bravo-token");
    } finally {
      for (const key of envKeys) {
        const previous = previousEnv.get(key);
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
