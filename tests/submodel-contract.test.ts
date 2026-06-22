import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const requiredSubmodels = [
  "material-understanding",
  "ui-screen-builder",
  "scene-object-editor",
  "code-editor",
  "visual-verification",
  "unity-inspection",
  "general-editor",
];

const requiredSubmodelSections = [
  "## Responsibility",
  "## Inputs",
  "## Outputs",
  "## Allowed Tools",
  "## Workflow",
  "## Approval Gates",
  "## Evidence",
];

describe("UOS submodel contract", () => {
  test("defines capability submodels, specific-menu recipes, and common production pipeline", async () => {
    const contract = await Bun.file(new URL("../docs/uos-submodel-contract.md", import.meta.url)).text();
    expect(contract).toContain("Submodel = capability");
    expect(contract).toContain("Recipe = specific content menu");
    expect(contract).toContain("The common UOS production process is not a recipe");
    expect(contract).toContain("## Common Production Pipeline");
    expect(contract).toContain("recipe-agnostic pipeline");
    expect(contract).toContain("Draft a `ProductionBlueprint`");
    expect(contract).toContain("ProductionBlueprint` is a common UOS artifact, not a recipe");
    expect(contract).toContain("user-approved source of truth");
    expect(contract).toContain("recipe.kiosk");
    expect(contract).toContain("user-facing views of the blueprint, not\nthe internal source of truth");
    expect(contract).toContain("Production agreement: `ProductionBlueprint`");
    expect(contract).toContain("## ProductionBlueprint Artifact");
    expect(contract).toContain('"kind": "ProductionBlueprint"');
    expect(contract).toContain('"status": "draft | needs-approval | approved | blocked | cancelled"');
    expect(contract).toContain('"ambiguity"');
    expect(contract).toContain('"approval"');
    expect(contract).toContain("Approved blueprints must have\n`ambiguity.estimate` at 20 or less");
    expect(contract).toContain("Users must not be asked to choose a\nsubmodel");
    expect(contract).toContain("Unity mutation must\nstill pass through the Editor execution layer");
    expect(contract).toContain("`general-editor` is not a fallback Orchestrator");
    expect(contract).toContain("routing remains Orchestrator-owned");
    expect(contract).toContain("specific menu/workflow rule set");
    expect(contract).toContain("`ProductionBlueprint` approval gate");
    expect(contract).toContain("The Orchestrator reads the whole selected recipe");
    expect(contract).toContain("decomposes it into Task\nPackets");
    expect(contract).toContain("bounded handoff unit sized by submodel ownership");
    expect(contract).toContain("execute only the recipe slice included in their handoff");
  });

  test("documents all required functional submodels with standard sections", async () => {
    const readme = await Bun.file(new URL("../.opencode/submodels/README.md", import.meta.url)).text();
    for (const submodel of requiredSubmodels) {
      expect(readme).toContain(`\`${submodel}\``);
      const fileUrl = new URL(`../.opencode/submodels/${submodel}.md`, import.meta.url);
      expect(existsSync(fileUrl)).toBe(true);
      const doc = await Bun.file(fileUrl).text();
      for (const section of requiredSubmodelSections) {
        expect(doc).toContain(section);
      }
      expect(doc).toContain("not a user-selectable");
    }
  });

  test("keeps kiosk as a recipe instead of a submodel", async () => {
    expect(existsSync(new URL("../.opencode/submodels/kiosk-content.md", import.meta.url))).toBe(false);

    const recipeUrl = new URL("../.opencode/recipes/kiosk.md", import.meta.url);
    expect(existsSync(recipeUrl)).toBe(true);
    const recipe = await Bun.file(recipeUrl).text();
    for (const section of [
      "## Domain",
      "## Uses Functional Submodels",
      "## Orchestration Model",
      "## Recipe Workflow",
      "## Artifacts",
      "## Evidence",
    ]) {
      expect(recipe).toContain(section);
    }
    expect(recipe).toContain("This is a recipe, not a submodel");
    expect(recipe).toContain("decomposes kiosk work into Task\nPackets");
    expect(recipe).toContain("A Task Packet is a bounded handoff unit");
    expect(recipe).toContain("context packet");
    expect(recipe).toContain("handoff overhead is larger than the work itself");
    expect(recipe).toContain("Task Packet: Planning Understanding");
    expect(recipe).toContain("Task Packet: Editor Build Plan");
    expect(recipe).toContain("Submodels may read the recipe, but they execute only the recipe slice");
    expect(recipe).toContain("KioskStructurePlan");
    expect(recipe).toContain("FolderStructurePlan");
    expect(recipe).toContain("MaterialPlacementPlan");
    expect(recipe).toContain("UnityHierarchyPlan");
    expect(recipe).toContain("Preserve the original Ref materials by default");
    expect(recipe).toContain("Main folders are the logical kiosk information architecture");
    expect(recipe).toContain("material-understanding");
    expect(recipe).toContain("ui-screen-builder");
    expect(recipe).toContain("visual-verification");
  });

  test("material-understanding records MVP input and confirmation gates", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/material-understanding.md", import.meta.url)).text();
    for (const inputType of ["image files", "PPTX", "PDF", "DOCX"]) {
      expect(doc).toContain(inputType);
    }
    for (const field of [
      "\"version\": \"1.0.0\"",
      "\"sources\": []",
      "\"sourceType\": \"image | video | pptx | pdf | docx | mixed\"",
      "\"detectedScreens\": []",
      "\"layoutReferences\": []",
      "\"contentMedia\": []",
      "\"textRequirements\": []",
      "\"navigationHints\": []",
      "\"assumptions\": []",
      "\"ambiguity\"",
      "\"clarificationRequest\"",
      "\"recommendedNextSubmodels\": []",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    for (const classification of [
      "`layoutReferences`",
      "`contentMedia`",
      "`textRequirements`",
      "`navigationHints`",
      "`unsupportedInput`",
    ]) {
      expect(doc).toContain(classification);
    }
    expect(doc).toContain("Do not auto-progress directly to screen building or mutation");
    expect(doc).toContain("ambiguity remains above 20 percent");
    expect(doc).toContain("2-3 concrete choices");
    expect(doc).toContain("arrow-key/Enter UI");
    expect(doc).toContain("free-form answer");
    expect(doc).toContain("## Failure Handling");
    expect(doc).toContain("## Handoff Rules");
    expect(doc).toContain("does not need to describe every Unity element, pixel, or");
    expect(doc).toContain("implementation-level interpretation without changing semantic meaning");
  });

  test("submodel definition plan marks material-understanding as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `material-understanding` | Defined |");
    expect(plan).toContain("Confirmed artifact schema");
    expect(plan).toContain("Confirmed classification criteria");
    expect(plan).toContain("Confirmed failure handling");
    expect(plan).toContain("Confirmed handoff rules");
  });

  test("ui-screen-builder records build plan, modes, and gates", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/ui-screen-builder.md", import.meta.url)).text();
    expect(doc).toContain("MVP UI backend is UGUI");
    expect(doc).toContain("User-confirmed interpretation");
    expect(doc).toContain("below 20 percent");
    expect(doc).toContain("## Interpretation Boundary");
    expect(doc).toContain("implementation-level interpretation");
    expect(doc).toContain("Forbidden semantic reinterpretation");
    expect(doc).toContain("silently change meaning");
    for (const field of [
      "\"kind\": \"UIScreenBuildPlan\"",
      "\"source\": \"MaterialUnderstanding | direct-user-intent | existing-PlanningIntent\"",
      "\"buildMode\": \"editable | reference | hybrid\"",
      "\"targetScreens\": []",
      "\"planningIntents\": []",
      "\"transitions\": []",
      "\"approval\"",
      "\"verification\"",
      "\"assumptions\": []",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    for (const mode of ["`editable`", "`reference`", "`hybrid`"]) {
      expect(doc).toContain(mode);
    }
    for (const elementType of [
      "`Panel`",
      "`Text`",
      "`Button`",
      "`Image`",
      "`InputField`",
      "`Toggle`",
      "`Slider`",
      "`ScrollView`",
      "`Dropdown`",
    ]) {
      expect(doc).toContain(elementType);
    }
    expect(doc).toContain("Always return to the Orchestrator for approval");
    expect(doc).toContain("PlanningIntent` validation fails");
    expect(doc).toContain("## Handoff Rules");
  });

  test("submodel definition plan marks ui-screen-builder as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `ui-screen-builder` | Defined |");
    expect(plan).toContain("Confirmed `UIScreenBuildPlan` schema");
    expect(plan).toContain("Confirmed `PlanningIntent` rules");
    expect(plan).toContain("Confirmed MVP element types");
    expect(plan).toContain("Confirmed approval gates");
  });

  test("visual-verification records report schema, verdicts, and repair limits", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/visual-verification.md", import.meta.url)).text();
    expect(doc).toContain("must not semantically reinterpret confirmed");
    for (const field of [
      "\"kind\": \"VisualVerificationReport\"",
      "\"target\"",
      "\"reference\"",
      "\"preview\"",
      "\"comparison\"",
      "\"verdict\": \"close | needs review | different | unavailable\"",
      "\"meanAbsoluteError\": 0",
      "\"rootMeanSquareError\": 0",
      "\"mismatchRatio\": 0",
      "\"aspectRatioDelta\": 0",
      "\"diffPath\": \"\"",
      "\"diagnostics\": []",
      "\"repair\"",
      "\"strategy\": \"none | targeted | return-to-ui-screen-builder | needs-user-input\"",
      "\"iterations\": 0",
      "\"residualRisk\": []",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    for (const verdict of ["`close`", "`needs review`", "`different`", "`unavailable`"]) {
      expect(doc).toContain(verdict);
    }
    expect(doc).toContain("at most 3 repair iterations per screen");
    expect(doc).toContain("Always return to the Orchestrator for approval");
    expect(doc).toContain("Hand off to `ui-screen-builder`");
    expect(doc).toContain("Hand off to `material-understanding` only");
  });

  test("submodel definition plan marks visual-verification as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `visual-verification` | Defined |");
    expect(plan).toContain("Confirmed `VisualVerificationReport` schema");
    expect(plan).toContain("Baseline verdicts are `close`, `needs review`, `different`, and");
    expect(plan).toContain("MVP repair loops are limited to at most 3 iterations per screen");
    expect(plan).toContain("Confirmed failure handling");
  });

  test("unity-inspection records read-only report and target selection boundaries", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/unity-inspection.md", import.meta.url)).text();
    expect(doc).toContain("read-only baseline");
    expect(doc).toContain("silently switching targets");
    for (const field of [
      "\"kind\": \"UnityInspectionReport\"",
      "\"target\"",
      "\"liveProjects\": []",
      "\"bridge\"",
      "\"readiness\"",
      "\"inspection\": \"ready | warning | blocked | unknown\"",
      "\"editing\": \"ready | warning | blocked | unknown\"",
      "\"context\"",
      "\"activeOrchestratorProgress\": false",
      "\"screens\": []",
      "\"hierarchy\"",
      "\"sceneObjects\": []",
      "\"recommendations\": []",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    expect(doc).toContain("## Target Selection Boundary");
    expect(doc).toContain("does not mutate Unity content");
    expect(doc).toContain("Always call `get_uos_context` after switching target");
    expect(doc).toContain("Inspection may succeed while editing is blocked");
    expect(doc).toContain("Do not record or echo bridge tokens");
    expect(doc).toContain("Forbidden in this submodel");
  });

  test("submodel definition plan marks unity-inspection as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `unity-inspection` | Defined |");
    expect(plan).toContain("Confirmed `UnityInspectionReport` schema");
    expect(plan).toContain("Inspection readiness and editing readiness are separate");
    expect(plan).toContain("Explicit user choice required before ambiguous target switching");
    expect(plan).toContain("Bridge tokens must never be recorded or echoed");
  });

  test("scene-object-editor records plan schema, tools, and mutation gates", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/scene-object-editor.md", import.meta.url)).text();
    expect(doc).toContain("non-UI Unity scene GameObjects");
    expect(doc).toContain("## SceneObjectPlan Artifact");
    for (const field of [
      "\"kind\": \"SceneObjectPlan\"",
      "\"modeId\": \"scene-object-editor\"",
      "\"target\"",
      "\"scope\": \"create | update | delete | inspect | mixed\"",
      "\"steps\": []",
      "\"operations\"",
      "\"action\": \"create | update | delete | resolve | list | save\"",
      "\"selector\": {}",
      "\"requiresApproval\": true",
      "\"verification\"",
      "\"readbackTools\": [\"list_scene_objects\"]",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    for (const type of [
      "`Empty`",
      "`Cube`",
      "`Sphere`",
      "`Capsule`",
      "`Cylinder`",
      "`Plane`",
      "`Quad`",
      "`Camera`",
      "`PointLight`",
      "`DirectionalLight`",
      "`SpotLight`",
    ]) {
      expect(doc).toContain(type);
    }
    expect(doc).toContain("Use direct `update_scene_object` and `delete_scene_object` only when the exact");
    expect(doc).toContain("Use context-based update/delete when the");
    expect(doc).toContain("Always return to the Orchestrator for approval before");
    expect(doc).toContain("deleting any object");
    expect(doc).toContain("saving a scene");
    expect(doc).toContain("using `latest` to resolve among multiple matching objects");
    expect(doc).toContain("Forbidden in this submodel");
    expect(doc).toContain("UI screen and UI element tools");
    expect(doc).toContain("target object cannot be resolved to exactly one canonical object");
    expect(doc).toContain("Hand off to `code-editor`");
  });

  test("submodel definition plan marks scene-object-editor as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `scene-object-editor` | Defined |");
    expect(plan).toContain("Confirmed `SceneObjectPlan` schema");
    expect(plan).toContain("Supported MVP creation types are `Empty`, `Cube`, `Sphere`");
    expect(plan).toContain("Use `list_scene_objects` or `resolve_scene_object_from_context` before");
    expect(plan).toContain("mutating an object not created or tracked by UOS");
    expect(plan).toContain("Stop when requested object type is unsupported");
  });

  test("code-editor records edit/report artifacts and filesystem gates", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/code-editor.md", import.meta.url)).text();
    expect(doc).toContain("Modify Unity project files when bridge tools are insufficient");
    expect(doc).toContain("## CodeEditPlan Artifact");
    expect(doc).toContain("## CodeEditReport Artifact");
    for (const field of [
      "\"kind\": \"CodeEditPlan\"",
      "\"modeId\": \"code-editor\"",
      "\"workspaceRoot\": \"\"",
      "\"unityProjectPath\": \"\"",
      "\"uosPackagePath\": \"\"",
      "\"scope\": \"unity-project | uos-package | uos-local-tooling | mixed\"",
      "\"role\": \"source | editor-source | test | config | package | generated | docs\"",
      "\"operation\": \"create | update | delete | inspect\"",
      "\"validation\"",
      "\"unityBatchmode\": false",
      "\"kind\": \"CodeEditReport\"",
      "\"changedFiles\"",
      "\"status\": \"passed | failed | skipped\"",
      "\"requiresUnityBridge\": false",
      "\"residualRisk\": []",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    expect(doc).toContain("Manual edits use `apply_patch`");
    expect(doc).toContain("Forbidden in this submodel");
    expect(doc).toContain("Unity bridge mutation tools");
    expect(doc).toContain("ad hoc shell file writes for manual edits");
    expect(doc).toContain("reverting unrelated user changes");
    expect(doc).toContain("deleting, renaming, or moving user-authored files");
    expect(doc).toContain("dependency upgrades, package installation, or network downloads");
    expect(doc).toContain("existing user changes overlap the intended patch");
    expect(doc).toContain("Hand off to `visual-verification`");
  });

  test("submodel definition plan marks code-editor as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `code-editor` | Defined |");
    expect(plan).toContain("Confirmed `CodeEditPlan` schema");
    expect(plan).toContain("Confirmed `CodeEditReport` schema");
    expect(plan).toContain("Manual edits use `apply_patch`");
    expect(plan).toContain("editing Unity `ProjectSettings`, `Packages/manifest.json`, lockfiles");
    expect(plan).toContain("Stop when target root cannot be determined");
  });

  test("general-editor records fallback executor boundary and promotion rules", async () => {
    const doc = await Bun.file(new URL("../.opencode/submodels/general-editor.md", import.meta.url)).text();
    expect(doc).toContain("constrained fallback executor, not a fallback Orchestrator");
    expect(doc).toContain("The Orchestrator owns user");
    expect(doc).toContain("Use it only after the Orchestrator has checked");
    for (const field of [
      "\"kind\": \"WorkPlan\"",
      "\"modeId\": \"general-editor\"",
      "\"fallback\"",
      "\"reason\": \"\"",
      "\"excludedSubmodels\"",
      "\"promotionCandidate\": false",
      "\"kind\": \"FallbackExecutionReport\"",
      "\"commands\": []",
      "\"status\": \"passed | failed | skipped\"",
      "\"promotion\"",
      "\"suggestedSubmodel\": \"\"",
      "\"suggestedRecipe\": \"\"",
      "\"residualRisk\": []",
      "\"evidence\": []",
    ]) {
      expect(doc).toContain(field);
    }
    expect(doc).toContain("Forbidden in this submodel");
    expect(doc).toContain("`select_uos_mode`, routing, or submodel choice");
    expect(doc).toContain("UI screen or UI element mutation tools");
    expect(doc).toContain("scene-object mutation tools");
    expect(doc).toContain("code/file edit tools");
    expect(doc).toContain("Stop and return a blocker to the Orchestrator when");
    expect(doc).toContain("same fallback pattern appears repeatedly");
    expect(doc).toContain("Return to the Orchestrator instead of routing directly");
  });

  test("submodel definition plan marks general-editor as defined", async () => {
    const plan = await Bun.file(new URL("../docs/uos-submodel-definition-plan.md", import.meta.url)).text();
    expect(plan).toContain("| `general-editor` | Defined |");
    expect(plan).toContain("All seven active submodels are defined");
    expect(plan).toContain("Confirmed `FallbackExecutionReport` schema");
    expect(plan).toContain("Orchestrator owns routing, ambiguity reduction, approval");
    expect(plan).toContain("Stop when any specialist submodel clearly owns the task");
    expect(plan).toContain("Recommend a new submodel or recipe when fallback work repeats");
  });
});
