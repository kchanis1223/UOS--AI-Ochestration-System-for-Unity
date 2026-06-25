import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
// @ts-expect-error - shared pure-JS artifact contracts (no type declarations).
import {
  editorToolKind,
  uosArtifactPaths,
  validateEditorChangeSet,
  validateEditorCommandBatch,
  validateProductionBlueprint,
  validateWorkPlan,
} from "../bin/artifact-core.js";
// @ts-expect-error - shared pure-JS blueprint persistence helpers (no type declarations).
import {
  listProductionBlueprints,
  productionBlueprintFileName,
  readLatestProductionBlueprint,
  readProductionBlueprint,
  summarizeProductionBlueprints,
  writeProductionBlueprint,
} from "../bin/production-blueprint-core.js";
// @ts-expect-error - shared pure-JS recipe guards (no type declarations).
import { recipeForMode, validateRecipeCompliance } from "../bin/recipe-core.js";

const validPlan = {
  version: "1.0.0",
  kind: "KioskPlan",
  id: "plan-kiosk-main",
  modeId: "kiosk-content",
  title: "Main kiosk",
  goal: "Build a nested kiosk from Ref/main",
  status: "needs-approval",
  approvalRequired: true,
  steps: [
    { id: "scan", title: "Scan folder tree", status: "done" },
    { id: "build", title: "Build approved screens", status: "pending" },
  ],
};

const validBatch = {
  version: "1.0.0",
  kind: "EditorCommandBatch",
  id: "batch-kiosk-main-1",
  modeId: "kiosk-content",
  planId: "plan-kiosk-main",
  commands: [
    {
      id: "ctx",
      tool: "get_uos_context",
      args: {},
      mutation: false,
    },
    {
      id: "screen-main",
      tool: "create_ui_screen",
      args: {
        intent: {
          version: "1.0.0",
          screenName: "Main",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [],
        },
      },
      mutation: true,
      requiresApproval: true,
    },
  ],
};

const validBlueprint = {
  version: "1.0.0",
  kind: "ProductionBlueprint",
  id: "blueprint-kiosk-main",
  modeId: "kiosk-content",
  recipeId: "kiosk",
  title: "Main kiosk production blueprint",
  goal: "Align the approved kiosk experience before broad Unity screen generation",
  status: "needs-approval",
  experience: {
    summary: "Nested exhibition kiosk with home, menu, and detail screens.",
  },
  sources: [
    { id: "ref-main", path: "D:/Unity/MyGame/Ref/main", kind: "folder" },
  ],
  screens: [
    { id: "home", title: "Home", role: "menu" },
    { id: "detail", title: "Detail", role: "detail" },
  ],
  interactions: [
    { from: "home", to: "detail", kind: "drilldown" },
  ],
  assumptions: [],
  risks: [],
  ambiguity: {
    estimate: 20,
    drivers: [],
  },
  approval: {
    required: true,
    status: "needs-approval",
  },
  recipe: {
    kiosk: {
      navigation: "drilldown/back/home",
    },
  },
  evidence: [],
};

describe("UOS Plan/Build/Editor artifact contracts", () => {
  test("validates a minimal ProductionBlueprint artifact", () => {
    const result = validateProductionBlueprint(validBlueprint);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.blueprint.kind).toBe("ProductionBlueprint");
    expect(result.blueprint.recipeId).toBe("kiosk");
  });

  test("allows non-recipe ProductionBlueprint artifacts", () => {
    const { recipeId, recipe, ...nonRecipeBlueprint } = validBlueprint;
    const result = validateProductionBlueprint({
      ...nonRecipeBlueprint,
      id: "blueprint-single-screen",
      modeId: "screen-from-material",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.blueprint.recipeId).toBeUndefined();
  });

  test("persists, reads, lists, and summarizes ProductionBlueprint artifacts", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-blueprint-persistence");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      expect(productionBlueprintFileName("blueprint:kiosk/main")).toBe("blueprint-kiosk-main.json");

      const written = await writeProductionBlueprint(projectDir, validBlueprint);
      expect(written.ok).toBe(true);
      expect(written.errors).toEqual([]);
      expect(written.path?.replace(/\\/g, "/")).toEndWith("/.uos/ochestrator/blueprints/blueprint-kiosk-main.json");

      const raw = JSON.parse(await readFile(written.path!, "utf8"));
      expect(raw.kind).toBe("ProductionBlueprint");
      expect(raw.id).toBe("blueprint-kiosk-main");

      const read = await readProductionBlueprint(projectDir, "blueprint-kiosk-main");
      expect(read.ok).toBe(true);
      expect(read.blueprint?.id).toBe("blueprint-kiosk-main");

      const listed = await listProductionBlueprints(projectDir);
      expect(listed).toHaveLength(1);
      expect(listed[0].blueprint?.status).toBe("needs-approval");

      const latest = await readLatestProductionBlueprint(projectDir);
      expect(latest?.blueprint?.id).toBe("blueprint-kiosk-main");

      const summary = await summarizeProductionBlueprints(projectDir);
      expect(summary).toMatchObject({
        count: 1,
        latest: {
          ok: true,
          id: "blueprint-kiosk-main",
          kind: "ProductionBlueprint",
          modeId: "kiosk-content",
          recipeId: "kiosk",
          status: "needs-approval",
          approvalStatus: "needs-approval",
          ambiguityEstimate: 20,
        },
        active: {
          id: "blueprint-kiosk-main",
        },
        invalid: [],
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("does not persist invalid ProductionBlueprint artifacts", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-blueprint-invalid");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      const result = await writeProductionBlueprint(projectDir, {
        ...validBlueprint,
        status: "approved",
        ambiguity: { estimate: 80, drivers: ["flow unclear"] },
        approval: { required: true, status: "approved" },
      });
      expect(result.ok).toBe(false);
      expect(result.path).toBeUndefined();
      expect(result.errors).toContain("blueprint.ambiguity.estimate: approved blueprint must be 20 or less");

      const listed = await listProductionBlueprints(projectDir);
      expect(listed).toEqual([]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("rejects malformed ProductionBlueprint shape", () => {
    const result = validateProductionBlueprint({
      ...validBlueprint,
      version: "2.0.0",
      kind: "WorkPlan",
      title: "",
      experience: [],
      sources: {},
      evidence: "none",
      recipe: "kiosk",
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('blueprint.version: must be "1.0.0"');
    expect(result.errors).toContain('blueprint.kind: must be "ProductionBlueprint"');
    expect(result.errors).toContain("blueprint.title: must be a non-empty string");
    expect(result.errors).toContain("blueprint.experience: must be an object");
    expect(result.errors).toContain("blueprint.sources: must be an array");
    expect(result.errors).toContain("blueprint.evidence: must be an array");
    expect(result.errors).toContain("blueprint.recipe: must be an object when present");
  });

  test("rejects approved ProductionBlueprint when ambiguity remains too high", () => {
    const result = validateProductionBlueprint({
      ...validBlueprint,
      status: "approved",
      ambiguity: { estimate: 21, drivers: ["screen flow still unclear"] },
      approval: { required: true, status: "approved" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("blueprint.ambiguity.estimate: approved blueprint must be 20 or less");
  });

  test("rejects approved ProductionBlueprint without approved approval state", () => {
    const result = validateProductionBlueprint({
      ...validBlueprint,
      status: "approved",
      ambiguity: { estimate: 10, drivers: [] },
      approval: { required: true, status: "needs-approval" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('blueprint.approval.status: must be "approved" when blueprint.status is "approved"');
  });

  test("rejects duplicate ProductionBlueprint screen ids", () => {
    const result = validateProductionBlueprint({
      ...validBlueprint,
      screens: [
        { id: "home", title: "Home" },
        { id: "home", title: "Duplicate Home" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('blueprint.screens[1].id: duplicate screen id "home"');
  });

  test("validates a mode-specific WorkPlan artifact", () => {
    const result = validateWorkPlan(validPlan);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.plan.kind).toBe("KioskPlan");
  });

  test("rejects malformed plans and duplicate step ids", () => {
    const result = validateWorkPlan({
      ...validPlan,
      version: "2.0.0",
      steps: [
        { id: "scan", title: "Scan", status: "done" },
        { id: "scan", title: "Scan again", status: "pending" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('plan.version: must be "1.0.0"');
    expect(result.errors).toContain('plan.steps[1].id: duplicate step id "scan"');
  });

  test("validates an EditorCommandBatch with read and write tools", () => {
    const result = validateEditorCommandBatch(validBatch);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.batch.commands).toHaveLength(2);
  });

  test("guards Editor boundary for read-only tools marked as mutations", () => {
    const result = validateEditorCommandBatch({
      ...validBatch,
      commands: [
        {
          id: "bad-context",
          tool: "get_uos_context",
          args: {},
          mutation: true,
          requiresApproval: true,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('batch.commands[0].mutation: read-only tool "get_uos_context" cannot set mutation=true');
  });

  test("warns when mutating Editor commands lack approval", () => {
    const result = validateEditorCommandBatch({
      ...validBatch,
      commands: [
        {
          id: "save",
          tool: "save_scene",
          args: { path: "Assets/UOS_Generated.unity" },
          mutation: true,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("batch.commands[0].requiresApproval: mutating command should usually require approval");
  });

  test("validates an EditorChangeSet and enforces batch plan/mode consistency", () => {
    const ok = validateEditorChangeSet({
      version: "1.0.0",
      kind: "EditorChangeSet",
      id: "changes-kiosk-main",
      modeId: "kiosk-content",
      planId: "plan-kiosk-main",
      batches: [validBatch],
      evidence: [],
    });
    expect(ok.ok).toBe(true);

    const bad = validateEditorChangeSet({
      version: "1.0.0",
      kind: "EditorChangeSet",
      id: "changes-kiosk-main",
      modeId: "kiosk-content",
      planId: "plan-kiosk-main",
      batches: [{ ...validBatch, planId: "other-plan" }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toContain("changeSet.batches[0].planId: must match changeSet.planId");
  });

  test("soft-checks kiosk recipe compliance without blocking artifacts", () => {
    expect(recipeForMode("kiosk-content")?.id).toBe("kiosk");

    const missingSource = {
      version: "1.0.0",
      kind: "EditorChangeSet",
      id: "changes-kiosk-main",
      modeId: "kiosk-content",
      planId: "plan-kiosk-main",
      batches: [validBatch],
      evidence: [],
    };
    const soft = validateRecipeCompliance(missingSource);
    expect(soft.ok).toBe(true);
    expect(soft.errors).toEqual([]);
    expect(soft.warnings).toContain('recipe.source: mode "kiosk-content" should record recipe source metadata');

    const compliant = validateRecipeCompliance({
      ...missingSource,
      source: {
        tool: "build_kiosk_from_plan",
        recipeId: "kiosk",
        recipeFile: ".opencode/recipes/kiosk.md",
        recipeGuardVersion: "1.0.0",
        counts: { screens: 1 },
      },
    });
    expect(compliant.ok).toBe(true);
    expect(compliant.warnings).toEqual([]);
  });

  test("classifies Editor tools and defines ochestrator persistence paths", () => {
    expect(editorToolKind("get_uos_context")).toBe("read");
    expect(editorToolKind("create_ui_screen")).toBe("write");
    expect(editorToolKind("some_future_tool")).toBe("unknown");

    const paths = uosArtifactPaths("D:/Unity/MyGame");
    expect(paths.contextDir.replace(/\\/g, "/")).toBe("D:/Unity/MyGame/.uos");
    expect(paths.progressFile.replace(/\\/g, "/")).toBe("D:/Unity/MyGame/.uos/ochestrator/progress.json");
    expect(paths.blueprintsDir.replace(/\\/g, "/")).toBe("D:/Unity/MyGame/.uos/ochestrator/blueprints");
    expect(paths.plansDir.replace(/\\/g, "/")).toBe("D:/Unity/MyGame/.uos/ochestrator/plans");
    expect(paths.buildsDir.replace(/\\/g, "/")).toBe("D:/Unity/MyGame/.uos/ochestrator/builds");
  });
});
