/**
 * artifact-core - shared UOS Plan/Build/Editor artifact contracts.
 *
 * These contracts let modes plan/build without directly mutating Unity. The
 * Editor layer consumes EditorCommandBatch/EditorChangeSet artifacts and is the
 * only layer allowed to apply bridge write tools.
 */

import { join } from "node:path";

export const ARTIFACT_VERSION = "1.0.0";

export const WORK_PLAN_KINDS = new Set([
  "WorkPlan",
  "KioskPlan",
  "PlanningIntent",
  "SceneObjectPlan",
  "VisualRepairPlan",
  "InspectionPlan",
]);

export const PLAN_STATUSES = new Set([
  "draft",
  "needs-approval",
  "approved",
  "in-progress",
  "blocked",
  "done",
  "cancelled",
]);

export const PRODUCTION_BLUEPRINT_STATUSES = new Set([
  "draft",
  "needs-approval",
  "approved",
  "blocked",
  "cancelled",
]);

export const STEP_STATUSES = new Set([
  "pending",
  "in-progress",
  "blocked",
  "done",
  "skipped",
]);

export const READ_ONLY_EDITOR_TOOLS = new Set([
  "get_uos_context",
  "select_uos_mode",
  "get_project_info",
  "list_screens",
  "get_scene_hierarchy",
  "get_scene_hierarchy_from_context",
  "list_scene_objects",
  "resolve_uos_context_target",
  "resolve_scene_object_from_context",
  "analyze_planning_materials",
  "list_planning_materials",
  "read_planning_material",
  "plan_kiosk_structure",
  "validate_planning_intent",
  "compare_images",
  "inspect_screen_feedback_from_context",
]);

export const WRITE_EDITOR_TOOLS = new Set([
  "create_ui_screen",
  "add_ui_element",
  "add_ui_element_from_context",
  "update_ui_element",
  "update_ui_element_from_context",
  "move_ui_element",
  "move_ui_element_from_context",
  "delete_ui_element",
  "delete_ui_element_from_context",
  "create_screen_transition",
  "create_screen_transition_from_context",
  "set_active_screen",
  "set_active_screen_from_context",
  "create_screen_from_material",
  "create_reference_screen_from_material",
  "create_document_screen",
  "create_image_reference_screen",
  "create_pdf_page_reference_screen",
  "create_docx_image_reference_screen",
  "create_pptx_slide_screen",
  "create_pptx_deck_screens",
  "import_asset",
  "capture_preview",
  "capture_preview_from_context",
  "verify_screen_against_reference",
  "verify_screen_against_reference_from_context",
  "verify_screens_against_references_from_context",
  "create_scene_object",
  "update_scene_object",
  "update_scene_object_from_context",
  "delete_scene_object",
  "delete_scene_object_from_context",
  "save_scene",
]);

export function uosArtifactPaths(projectDir) {
  const root = requiredString(projectDir, "projectDir");
  const contextDir = join(root, ".uos");
  const orchestratorDir = join(contextDir, "orchestrator");
  return {
    contextDir,
    orchestratorDir,
    progressFile: join(orchestratorDir, "progress.json"),
    blueprintsDir: join(orchestratorDir, "blueprints"),
    plansDir: join(orchestratorDir, "plans"),
    buildsDir: join(orchestratorDir, "builds"),
    evidenceDir: join(orchestratorDir, "evidence"),
  };
}

export function validateWorkPlan(input) {
  const errors = [];
  const warnings = [];
  if (!isObject(input)) return invalid("plan", "must be an object");

  requireLiteral(input.version, ARTIFACT_VERSION, "plan.version", errors);
  requireMember(input.kind, WORK_PLAN_KINDS, "plan.kind", errors);
  requireNonBlank(input.id, "plan.id", errors);
  requireNonBlank(input.modeId, "plan.modeId", errors);
  requireNonBlank(input.title, "plan.title", errors);
  requireNonBlank(input.goal, "plan.goal", errors);
  requireMember(input.status, PLAN_STATUSES, "plan.status", errors);
  requireArray(input.steps, "plan.steps", errors);

  if (Array.isArray(input.steps)) {
    const ids = new Set();
    input.steps.forEach((step, index) => {
      const path = `plan.steps[${index}]`;
      if (!isObject(step)) {
        errors.push(`${path}: must be an object`);
        return;
      }
      requireNonBlank(step.id, `${path}.id`, errors);
      requireNonBlank(step.title, `${path}.title`, errors);
      requireMember(step.status, STEP_STATUSES, `${path}.status`, errors);
      if (typeof step.id === "string") {
        if (ids.has(step.id)) errors.push(`${path}.id: duplicate step id "${step.id}"`);
        ids.add(step.id);
      }
    });
    if (input.steps.length === 0) warnings.push("plan.steps: empty plan has no executable steps");
  }

  if (input.approvalRequired === true && input.status === "approved") {
    warnings.push("plan.approvalRequired: approved plan still has approvalRequired=true");
  }

  return result(errors, warnings, "plan", input);
}

export function validateProductionBlueprint(input) {
  const errors = [];
  const warnings = [];
  if (!isObject(input)) return invalid("blueprint", "must be an object");

  requireLiteral(input.version, ARTIFACT_VERSION, "blueprint.version", errors);
  requireLiteral(input.kind, "ProductionBlueprint", "blueprint.kind", errors);
  requireNonBlank(input.id, "blueprint.id", errors);
  requireNonBlank(input.modeId, "blueprint.modeId", errors);
  requireNonBlank(input.title, "blueprint.title", errors);
  requireNonBlank(input.goal, "blueprint.goal", errors);
  requireMember(input.status, PRODUCTION_BLUEPRINT_STATUSES, "blueprint.status", errors);
  requireObject(input.experience, "blueprint.experience", errors);
  requireObject(input.ambiguity, "blueprint.ambiguity", errors);
  requireObject(input.approval, "blueprint.approval", errors);
  requireArray(input.sources, "blueprint.sources", errors);
  requireArray(input.screens, "blueprint.screens", errors);
  requireArray(input.interactions, "blueprint.interactions", errors);
  requireArray(input.assumptions, "blueprint.assumptions", errors);
  requireArray(input.risks, "blueprint.risks", errors);
  requireArray(input.evidence, "blueprint.evidence", errors);

  if (input.recipeId !== undefined) requireNonBlank(input.recipeId, "blueprint.recipeId", errors);
  if (input.recipe !== undefined && !isObject(input.recipe)) {
    errors.push("blueprint.recipe: must be an object when present");
  }

  if (isObject(input.ambiguity)) {
    const estimate = input.ambiguity.estimate;
    if (typeof estimate !== "number" || !Number.isFinite(estimate) || estimate < 0 || estimate > 100) {
      errors.push("blueprint.ambiguity.estimate: must be a number from 0 to 100");
    } else if (input.status === "approved" && estimate > 20) {
      errors.push("blueprint.ambiguity.estimate: approved blueprint must be 20 or less");
    }
  }

  if (isObject(input.approval)) {
    if (input.approval.required !== undefined && typeof input.approval.required !== "boolean") {
      errors.push("blueprint.approval.required: must be boolean when present");
    }
    if (input.approval.status !== undefined && typeof input.approval.status !== "string") {
      errors.push("blueprint.approval.status: must be string when present");
    }
    if (input.status === "approved" && input.approval.status !== "approved") {
      errors.push('blueprint.approval.status: must be "approved" when blueprint.status is "approved"');
    }
  }

  if (Array.isArray(input.screens)) {
    const ids = new Set();
    input.screens.forEach((screen, index) => {
      if (!isObject(screen) || screen.id === undefined) return;
      if (typeof screen.id !== "string" || screen.id.trim().length === 0) {
        errors.push(`blueprint.screens[${index}].id: must be a non-empty string when present`);
        return;
      }
      const id = screen.id.trim();
      if (ids.has(id)) errors.push(`blueprint.screens[${index}].id: duplicate screen id "${id}"`);
      ids.add(id);
    });
  }

  return result(errors, warnings, "blueprint", input);
}

export function validateEditorCommandBatch(input) {
  const errors = [];
  const warnings = [];
  if (!isObject(input)) return invalid("batch", "must be an object");

  requireLiteral(input.version, ARTIFACT_VERSION, "batch.version", errors);
  requireLiteral(input.kind, "EditorCommandBatch", "batch.kind", errors);
  requireNonBlank(input.id, "batch.id", errors);
  requireNonBlank(input.modeId, "batch.modeId", errors);
  requireNonBlank(input.planId, "batch.planId", errors);
  requireArray(input.commands, "batch.commands", errors);

  if (Array.isArray(input.commands)) {
    const ids = new Set();
    input.commands.forEach((command, index) => validateCommand(command, index, errors, warnings, ids));
    if (input.commands.length === 0) warnings.push("batch.commands: empty batch has nothing for Editor to apply");
  }

  return result(errors, warnings, "batch", input);
}

export function validateEditorChangeSet(input) {
  const errors = [];
  const warnings = [];
  if (!isObject(input)) return invalid("changeSet", "must be an object");

  requireLiteral(input.version, ARTIFACT_VERSION, "changeSet.version", errors);
  requireLiteral(input.kind, "EditorChangeSet", "changeSet.kind", errors);
  requireNonBlank(input.id, "changeSet.id", errors);
  requireNonBlank(input.modeId, "changeSet.modeId", errors);
  requireNonBlank(input.planId, "changeSet.planId", errors);
  requireArray(input.batches, "changeSet.batches", errors);

  if (Array.isArray(input.batches)) {
    input.batches.forEach((batch, index) => {
      const validation = validateEditorCommandBatch(batch);
      for (const error of validation.errors) errors.push(`changeSet.batches[${index}].${error}`);
      for (const warning of validation.warnings) warnings.push(`changeSet.batches[${index}].${warning}`);
      if (isObject(batch) && batch.planId !== input.planId) {
        errors.push(`changeSet.batches[${index}].planId: must match changeSet.planId`);
      }
      if (isObject(batch) && batch.modeId !== input.modeId) {
        errors.push(`changeSet.batches[${index}].modeId: must match changeSet.modeId`);
      }
    });
    if (input.batches.length === 0) warnings.push("changeSet.batches: empty change set has no Editor work");
  }

  if (input.evidence !== undefined && !Array.isArray(input.evidence)) {
    errors.push("changeSet.evidence: must be an array when present");
  }

  return result(errors, warnings, "changeSet", input);
}

export function editorToolKind(tool) {
  if (WRITE_EDITOR_TOOLS.has(tool)) return "write";
  if (READ_ONLY_EDITOR_TOOLS.has(tool)) return "read";
  return "unknown";
}

function validateCommand(command, index, errors, warnings, ids) {
  const path = `batch.commands[${index}]`;
  if (!isObject(command)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  requireNonBlank(command.id, `${path}.id`, errors);
  requireNonBlank(command.tool, `${path}.tool`, errors);
  if (typeof command.id === "string") {
    if (ids.has(command.id)) errors.push(`${path}.id: duplicate command id "${command.id}"`);
    ids.add(command.id);
  }
  if (command.args !== undefined && !isObject(command.args)) {
    errors.push(`${path}.args: must be an object when present`);
  }
  if (command.mutation !== undefined && typeof command.mutation !== "boolean") {
    errors.push(`${path}.mutation: must be boolean when present`);
  }
  if (command.requiresApproval !== undefined && typeof command.requiresApproval !== "boolean") {
    errors.push(`${path}.requiresApproval: must be boolean when present`);
  }

  const kind = typeof command.tool === "string" ? editorToolKind(command.tool) : "unknown";
  const mutation = command.mutation === true;
  if (kind === "unknown") warnings.push(`${path}.tool: unknown Editor tool "${command.tool}"`);
  if (kind === "write" && !mutation) {
    warnings.push(`${path}.mutation: write tool "${command.tool}" should set mutation=true`);
  }
  if (kind === "read" && mutation) {
    errors.push(`${path}.mutation: read-only tool "${command.tool}" cannot set mutation=true`);
  }
  if (mutation && command.requiresApproval !== true) {
    warnings.push(`${path}.requiresApproval: mutating command should usually require approval`);
  }
}

function result(errors, warnings, artifactKey, artifact) {
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    [artifactKey]: errors.length === 0 ? artifact : undefined,
  };
}

function invalid(key, message) {
  return { ok: false, errors: [`${key}: ${message}`], warnings: [], [key]: undefined };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireLiteral(value, expected, path, errors) {
  if (value !== expected) errors.push(`${path}: must be "${expected}"`);
}

function requireMember(value, allowed, path, errors) {
  if (typeof value !== "string" || !allowed.has(value)) {
    errors.push(`${path}: must be one of ${[...allowed].join(", ")}`);
  }
}

function requireNonBlank(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path}: must be a non-empty string`);
  }
}

function requireArray(value, path, errors) {
  if (!Array.isArray(value)) errors.push(`${path}: must be an array`);
}

function requireObject(value, path, errors) {
  if (!isObject(value)) errors.push(`${path}: must be an object`);
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path}: must be a non-empty string`);
  }
  return value;
}
