/**
 * recipe-core - soft compliance checks for UOS domain recipes.
 *
 * Recipe guards are intentionally soft at this stage: they return warnings and
 * metadata, but they do not block execution. The Editor boundary still owns
 * mutation safety; recipes add domain workflow traceability.
 */

export const RECIPE_GUARD_VERSION = "1.0.0";

export const UOS_RECIPES = [
  {
    id: "kiosk",
    title: "Kiosk Recipe",
    recipeFile: ".opencode/recipes/kiosk.md",
    modeIds: ["kiosk-content"],
    planArtifact: "KioskPlan",
    buildArtifact: "EditorChangeSet",
    planningTool: "plan_kiosk_structure",
    buildTool: "build_kiosk_from_plan",
    expectedSubmodels: ["material-understanding", "ui-screen-builder", "visual-verification"],
  },
];

export function listRecipes() {
  return UOS_RECIPES.map((recipe) => ({
    ...recipe,
    modeIds: [...recipe.modeIds],
    expectedSubmodels: [...recipe.expectedSubmodels],
  }));
}

export function getRecipe(id) {
  return UOS_RECIPES.find((recipe) => recipe.id === id);
}

export function recipeForMode(modeId) {
  return UOS_RECIPES.find((recipe) => recipe.modeIds.includes(modeId));
}

export function validateRecipeCompliance(artifact, options = {}) {
  const warnings = [];
  if (!isObject(artifact)) {
    return {
      ok: true,
      errors: [],
      warnings: ["recipe: artifact is not an object; compliance could not be checked"],
      recipe: undefined,
    };
  }

  const modeId = stringValue(artifact.modeId);
  const source = isObject(artifact.source) ? artifact.source : undefined;
  const explicitRecipeId = stringValue(options.recipeId) ?? stringValue(artifact.recipeId) ?? stringValue(source?.recipeId);
  const modeRecipe = modeId !== undefined ? recipeForMode(modeId) : undefined;
  const recipe = explicitRecipeId !== undefined ? getRecipe(explicitRecipeId) : modeRecipe;

  if (modeRecipe !== undefined) {
    if (source === undefined) {
      warnings.push(`recipe.source: mode "${modeId}" should record recipe source metadata`);
    } else if (stringValue(source.recipeId) === undefined) {
      warnings.push(`recipe.source.recipeId: mode "${modeId}" should record recipeId "${modeRecipe.id}"`);
    }
  }

  if (explicitRecipeId !== undefined && recipe === undefined) {
    warnings.push(`recipe.id: unknown recipe "${explicitRecipeId}"`);
  }
  if (modeRecipe !== undefined && explicitRecipeId !== undefined && explicitRecipeId !== modeRecipe.id) {
    warnings.push(`recipe.id: mode "${modeId}" expects recipe "${modeRecipe.id}", got "${explicitRecipeId}"`);
  }
  if (recipe === undefined) {
    return { ok: true, errors: [], warnings, recipe: undefined };
  }

  if (recipe.id === "kiosk") {
    warnings.push(...validateKioskRecipeArtifact(artifact, recipe, source));
  }

  return {
    ok: true,
    errors: [],
    warnings,
    recipe,
  };
}

function validateKioskRecipeArtifact(artifact, recipe, source) {
  const warnings = [];
  if (artifact.modeId !== "kiosk-content") {
    warnings.push(`recipe.kiosk.modeId: expected "kiosk-content", got "${artifact.modeId ?? "(missing)"}"`);
  }
  if (artifact.kind !== recipe.buildArtifact) {
    warnings.push(`recipe.kiosk.kind: expected "${recipe.buildArtifact}", got "${artifact.kind ?? "(missing)"}"`);
  }
  if (source === undefined) return warnings;

  if (stringValue(source.tool) !== recipe.buildTool) {
    warnings.push(`recipe.kiosk.source.tool: expected "${recipe.buildTool}", got "${source.tool ?? "(missing)"}"`);
  }
  if (stringValue(source.recipeFile) !== recipe.recipeFile) {
    warnings.push(`recipe.kiosk.source.recipeFile: expected "${recipe.recipeFile}", got "${source.recipeFile ?? "(missing)"}"`);
  }
  if (source.recipeGuardVersion !== RECIPE_GUARD_VERSION) {
    warnings.push(`recipe.kiosk.source.recipeGuardVersion: expected "${RECIPE_GUARD_VERSION}", got "${source.recipeGuardVersion ?? "(missing)"}"`);
  }
  if (!isObject(source.counts)) {
    warnings.push("recipe.kiosk.source.counts: expected KioskPlan counts metadata");
  }

  const commands = artifactCommands(artifact);
  const screenCreationCommands = commands.filter((command) => [
    "create_ui_screen",
    "create_screen_from_material",
    "create_reference_screen_from_material",
  ].includes(command.tool));
  if (screenCreationCommands.length > 1 && stringValue(source.tool) !== recipe.buildTool) {
    warnings.push("recipe.kiosk.workflow: multi-screen kiosk creation should come from build_kiosk_from_plan");
  }
  for (const [index, command] of commands.entries()) {
    if (command?.mutation === true && command.requiresApproval !== true) {
      warnings.push(`recipe.kiosk.commands[${index}].requiresApproval: kiosk mutation should require approval`);
    }
  }
  return warnings;
}

function artifactCommands(artifact) {
  if (Array.isArray(artifact.commands)) return artifact.commands;
  if (!Array.isArray(artifact.batches)) return [];
  return artifact.batches.flatMap((batch) => Array.isArray(batch?.commands) ? batch.commands : []);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
