import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const promptFile = new URL("../.opencode/agents/orchestrator.md", import.meta.url);
const agentsDir = new URL("../.opencode/agents/", import.meta.url);
const opencodeConfigFile = new URL("../opencode.json", import.meta.url);

describe("UOS Orchestrator agent prompt", () => {
  test("keeps Orchestrator as the only user-facing UOS agent", async () => {
    const agents = (await readdir(agentsDir))
      .filter((name) => name.endsWith(".md"))
      .sort();
    expect(agents).toEqual(["orchestrator.md"]);
  });

  test("disables opencode native Build and Plan primary agents", async () => {
    const config = await Bun.file(opencodeConfigFile).json();
    expect(config.default_agent).toBe("orchestrator");
    expect(config.agent?.build?.disable).toBe(true);
    expect(config.agent?.plan?.disable).toBe(true);
  });

  test("keeps low-risk shell permissions quiet while preserving approval for broad bash", async () => {
    const config = await Bun.file(opencodeConfigFile).json();
    const prompt = await Bun.file(promptFile).text();
    expect(config.permission?.read).toBe("allow");
    expect(config.permission?.glob).toBe("allow");
    expect(config.permission?.grep).toBe("allow");
    expect(config.permission?.bash?.["rg *"]).toBe("allow");
    expect(config.permission?.bash?.["git status*"]).toBe("allow");
    expect(config.permission?.bash?.["bun test*"]).toBe("allow");
    expect(config.permission?.bash?.["uos doctor*"]).toBe("allow");
    expect(config.permission?.bash?.["*"]).toBe("ask");
    expect(config.permission?.webfetch).toBe("ask");
    expect(prompt).toContain('"rg *": allow');
    expect(prompt).toContain('"git status*": allow');
    expect(prompt).toContain('"bun test*": allow');
    expect(prompt).toContain('"*": ask');
  });

  test("requires context and explicit mode selection before mutation", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("Call `get_uos_context` before any Unity mutation");
    expect(prompt).toContain("Call `select_uos_mode`");
    expect(prompt).toContain("Do not mutate Unity until the selected target and intent are clear");
  });

  test("documents Orchestrator, internal submodel, Plan, Build, and Editor boundaries", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("Orchestrator: intent, mode choice");
    expect(prompt).toContain("Internal submodel: reusable functional capability");
    expect(prompt).toContain("Recipe: a specific content workflow/menu");
    expect(prompt).toContain("not the common pipeline itself");
    expect(prompt).toContain("reads the whole recipe");
    expect(prompt).toContain("bounded Task Packets");
    expect(prompt).toContain("relevant recipe slice");
    expect(prompt).toContain("ProductionBlueprint: recipe-agnostic");
    expect(prompt).toContain("Recipe-specific\n  details live inside the blueprint's recipe section");
    expect(prompt).toContain("Plan: structured description");
    expect(prompt).toContain("Build: converts an approved plan");
    expect(prompt).toContain("Editor: the only layer that mutates Unity");
    expect(prompt).toContain("not a user-selectable opencode agent");
  });

  test("defines the common ProductionBlueprint workflow before Plan and Build", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("## Common Production Pipeline");
    expect(prompt).toContain("Use this recipe-agnostic pipeline");
    expect(prompt).toContain("Draft a `ProductionBlueprint`");
    expect(prompt).toContain("Call `draft_production_blueprint`");
    expect(prompt).toContain("then show it in planner-friendly form");
    expect(prompt).toContain("Convert only an approved `ProductionBlueprint`");
    expect(prompt).toContain("PPTX, boards, rendered previews");
    expect(prompt).toContain("views of the blueprint, not\nthe internal source of truth");
    expect(prompt).toContain("Minimum `ProductionBlueprint` fields");
    expect(prompt).toContain("`experience`, `sources`, `screens`, `interactions`");
    expect(prompt).toContain("`recipeId` and `recipe`");
    expect(prompt).toContain("Do not continue to Plan/Build from an unapproved blueprint");
    expect(prompt).toContain('`status: "approved"`');
    expect(prompt).toContain("`source.blueprintId` and `source.blueprintPath`");
    expect(prompt).toContain('`ProductionBlueprint` with `recipeId: "kiosk"`');
    expect(prompt).toContain("produce or load `KioskPlan` from the approved blueprint");
  });

  test("defines broad-work blueprint gate while preserving small edit fast path", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("Broad work requires a `ProductionBlueprint` approval gate before Plan/Build");
    expect(prompt).toContain("creating or modifying 2 or more screens");
    expect(prompt).toContain("using any recipe");
    expect(prompt).toContain("importing many assets");
    expect(prompt).toContain("generating multiple transitions or navigation links");
    expect(prompt).toContain("interpreting the user's planning intent");
    expect(prompt).toContain("Small single edits may keep the fast path without a `ProductionBlueprint`");
    expect(prompt).toContain("one text change");
  });

  test("standardizes blueprint approval choices", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("The blueprint approval question must offer 2-3 choices");
    expect(prompt).toContain("승인하고 제작 진행");
    expect(prompt).toContain("일부 수정");
    expect(prompt).toContain("중단 또는 나중에 진행");
  });

  test("lists routing modes, functional submodels, and kiosk recipe", async () => {
    const prompt = await Bun.file(promptFile).text();
    for (const mode of [
      "kiosk-content",
      "screen-from-material",
      "scene-object",
      "visual-repair",
      "unity-inspection",
      "code-editor",
      "general-editor",
    ]) {
      expect(prompt).toContain(mode);
    }
    for (const submodel of [
      "material-understanding",
      "ui-screen-builder",
      "scene-object-editor",
      "code-editor",
      "visual-verification",
      "unity-inspection",
      "general-editor",
    ]) {
      expect(prompt).toContain(submodel);
    }
    expect(prompt).toContain(".opencode/recipes/kiosk.md");
    expect(prompt).toContain("Treat this as the `kiosk` recipe, not a kiosk-specific submodel");
    expect(prompt).toContain("split it into bounded Task");
    expect(prompt).toContain("context-sized handoff unit");
    expect(prompt).toContain("context packet size");
    expect(prompt).toContain("handoff overhead");
    expect(prompt).toContain("KioskStructurePlan");
    expect(prompt).toContain("FolderStructurePlan");
    expect(prompt).toContain("MaterialPlacementPlan");
    expect(prompt).toContain("Preserve the original Ref materials by default");
    expect(prompt).toContain("Mirror the approved Main folder logic");
    expect(prompt).toContain("Do not collapse kiosk-specific rules into submodels or the global workflow");
    expect(prompt).not.toContain(".opencode/submodels/kiosk-content.md");
  });

  test("requires progress reporting fields", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("selected mode");
    expect(prompt).toContain("active or latest `ProductionBlueprint` id/status/path");
    expect(prompt).toContain("current plan/build/verify step");
    expect(prompt).toContain("evidence produced");
    expect(prompt).toContain("blockers or approval needs");
  });

  test("defines planner-friendly user-facing UX rules", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("## User-Facing UX Contract");
    expect(prompt).toContain("planner using Unity for the first time");
    expect(prompt).toContain("show a short recommended task menu");
    expect(prompt).toContain("show example prompts");
    expect(prompt).toContain("Use planner-facing language first");
    expect(prompt).toContain("say `screen` before `Scene` or `Canvas`");
    expect(prompt).toContain("do not expose submodel names");
  });

  test("standardizes clarification, safety confirmation, and completion summaries", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("present 2-3 concrete choices plus optional free-form input");
    expect(prompt).toContain("arrow keys and Enter");
    expect(prompt).toContain("20 percent or less");
    expect(prompt).toContain("request explicit approval before saving, deleting");
    expect(prompt).toContain("include target, planned action, expected impact");
    expect(prompt).toContain("never treat silence or a vague response as approval");
    expect(prompt).toContain("Completion summaries should use this shape");
    expect(prompt).toContain("whether the scene/project was saved");
  });

  test("keeps general-editor as fallback executor instead of fallback orchestrator", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("constrained fallback executor");
    expect(prompt).toContain("Orchestrator still owns routing");
    expect(prompt).toContain("Do not delegate routing, ambiguity reduction, or next-submodel decisions");
    expect(prompt).toContain("Provide the fallback reason and excluded specialist submodels");
    expect(prompt).toContain("candidate for a new submodel or");
  });

  test("routes code and diagnostics work to code-editor mode", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("`code-editor`: scripts, Editor scripts, asmdefs");
    expect(prompt).toContain("When mode is `code-editor`");
    expect(prompt).toContain("Do not use Unity bridge mutation tools for code edits");
    expect(prompt).toContain("produce a follow-up");
  });

  test("requires EditorCommandBatch review and EditorBatchProgress evidence", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("EditorCommandBatch");
    expect(prompt).toContain("EditorChangeSet");
    expect(prompt).toContain("read-only/write-tool");
    expect(prompt).toContain("EditorBatchProgress");
    expect(prompt).toContain("build_kiosk_from_plan");
  });

  test("uses persisted OrchestratorProgress for resumed sessions", async () => {
    const prompt = await Bun.file(promptFile).text();
    expect(prompt).toContain("activeOrchestratorProgress");
    expect(prompt).toContain(".uos/orchestrator/progress.json");
    expect(prompt).toContain("OrchestratorProgress");
    expect(prompt).toContain("get_uos_context");
    expect(prompt).toContain("resume from that");
  });
});
