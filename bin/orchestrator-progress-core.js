/**
 * orchestrator-progress-core - persisted UOS Orchestrator progress records.
 *
 * The progress file lives at <project>/.uos/orchestrator/progress.json and is
 * intentionally independent from the existing screen/journal context. It lets a
 * resumed Orchestrator report mode, current step, evidence, blockers, and next
 * action without rereading the whole conversation.
 */

import { promises as fs } from "node:fs";
import { ARTIFACT_VERSION, uosArtifactPaths } from "./artifact-core.js";

export const ORCHESTRATOR_PROGRESS_KIND = "OrchestratorProgress";

export const ORCHESTRATOR_PROGRESS_STATUSES = new Set([
  "pending",
  "planning",
  "needs-approval",
  "building",
  "verifying",
  "blocked",
  "done",
  "cancelled",
]);

export const ORCHESTRATOR_STEP_STATUSES = new Set([
  "pending",
  "in-progress",
  "blocked",
  "done",
  "skipped",
]);

export function createOrchestratorProgress(input = {}, options = {}) {
  const now = timestamp(options.now);
  const steps = normalizeSteps(input.steps);
  const progress = {
    version: ARTIFACT_VERSION,
    kind: ORCHESTRATOR_PROGRESS_KIND,
    id: nonBlank(input.id) ?? `uos-progress-${now.replace(/[^0-9]/g, "").slice(0, 14)}`,
    taskTitle: nonBlank(input.taskTitle) ?? "UOS task",
    status: normalizeStatus(input.status, "pending"),
    mode: normalizeMode(input.mode ?? input.modeId),
    blueprint: normalizeArtifactRef(input.blueprint),
    plan: normalizeArtifactRef(input.plan),
    build: normalizeArtifactRef(input.build),
    editorProgress: normalizeEditorProgress(input.editorProgress),
    steps,
    evidence: normalizeEvidence(input.evidence),
    blockers: normalizeBlockers(input.blockers),
    nextAction: nonBlank(input.nextAction),
    createdAt: nonBlank(input.createdAt) ?? now,
    updatedAt: nonBlank(input.updatedAt) ?? now,
  };
  return progress;
}

export function validateOrchestratorProgress(input) {
  const errors = [];
  const warnings = [];
  if (!isObject(input)) return invalid("progress", "must be an object");

  if (input.version !== ARTIFACT_VERSION) errors.push(`progress.version: must be "${ARTIFACT_VERSION}"`);
  if (input.kind !== ORCHESTRATOR_PROGRESS_KIND) {
    errors.push(`progress.kind: must be "${ORCHESTRATOR_PROGRESS_KIND}"`);
  }
  requireNonBlank(input.id, "progress.id", errors);
  requireNonBlank(input.taskTitle, "progress.taskTitle", errors);
  if (!ORCHESTRATOR_PROGRESS_STATUSES.has(input.status)) {
    errors.push(`progress.status: must be one of ${[...ORCHESTRATOR_PROGRESS_STATUSES].join(", ")}`);
  }
  if (!isObject(input.mode)) errors.push("progress.mode: must be an object");
  else requireNonBlank(input.mode.id, "progress.mode.id", errors);
  if (input.blueprint !== undefined && !isObject(input.blueprint)) {
    errors.push("progress.blueprint: must be an object when present");
  }
  if (!Array.isArray(input.steps)) errors.push("progress.steps: must be an array");
  if (!Array.isArray(input.evidence)) errors.push("progress.evidence: must be an array");
  if (!Array.isArray(input.blockers)) errors.push("progress.blockers: must be an array");

  if (Array.isArray(input.steps)) {
    const ids = new Set();
    input.steps.forEach((step, index) => {
      const path = `progress.steps[${index}]`;
      if (!isObject(step)) {
        errors.push(`${path}: must be an object`);
        return;
      }
      requireNonBlank(step.id, `${path}.id`, errors);
      requireNonBlank(step.title, `${path}.title`, errors);
      if (!ORCHESTRATOR_STEP_STATUSES.has(step.status)) {
        errors.push(`${path}.status: must be one of ${[...ORCHESTRATOR_STEP_STATUSES].join(", ")}`);
      }
      if (typeof step.id === "string") {
        if (ids.has(step.id)) errors.push(`${path}.id: duplicate step id "${step.id}"`);
        ids.add(step.id);
      }
    });
    if (input.steps.length === 0) warnings.push("progress.steps: empty progress has no resumable steps");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    progress: errors.length === 0 ? input : undefined,
  };
}

export function summarizeOrchestratorProgress(progress) {
  const validation = validateOrchestratorProgress(progress);
  if (!validation.ok) {
    return {
      ok: false,
      status: "invalid",
      errors: validation.errors,
    };
  }

  const steps = progress.steps;
  const completedSteps = steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  const currentStep = steps.find((step) => step.status === "in-progress")
    ?? steps.find((step) => step.status === "blocked")
    ?? steps.find((step) => step.status === "pending");
  const editor = progress.editorProgress;
  const editorCommands = Array.isArray(editor?.commands) ? editor.commands : [];
  const editorCompletedCommands = editorCommands.filter((command) =>
    command.status === "done" || command.status === "skipped"
  ).length;

  return {
    ok: true,
    id: progress.id,
    taskTitle: progress.taskTitle,
    status: progress.status,
    modeId: progress.mode.id,
    modeTitle: progress.mode.title,
    blueprintId: progress.blueprint?.id,
    blueprintKind: progress.blueprint?.kind,
    blueprintStatus: progress.blueprint?.status,
    blueprintPath: progress.blueprint?.path,
    planId: progress.plan?.id,
    planKind: progress.plan?.kind,
    buildId: progress.build?.id,
    buildKind: progress.build?.kind,
    currentStep,
    completedSteps,
    totalSteps: steps.length,
    evidenceCount: progress.evidence.length + (Array.isArray(editor?.evidence) ? editor.evidence.length : 0),
    blockerCount: progress.blockers.length,
    blockers: progress.blockers,
    nextAction: progress.nextAction,
    editorBatchId: editor?.batchId,
    editorStatus: editor?.status,
    editorCompletedCommands,
    editorTotalCommands: editorCommands.length,
    updatedAt: progress.updatedAt,
  };
}

export function formatOrchestratorProgress(progress) {
  const summary = summarizeOrchestratorProgress(progress);
  if (!summary.ok) {
    return `[uos context] orchestratorProgress: invalid (${summary.errors.join("; ")})`;
  }

  const lines = [
    `[uos context] orchestratorProgress: ${summary.status} task="${summary.taskTitle}" mode=${summary.modeId}`,
    `  - progress: ${summary.completedSteps}/${summary.totalSteps} step(s) complete` +
      (summary.currentStep !== undefined
        ? `, current=${summary.currentStep.id}(${summary.currentStep.status})`
        : ""),
  ];
  if (summary.blueprintId !== undefined) {
    lines.push(
      `  - blueprint: ${summary.blueprintKind ?? "ProductionBlueprint"} ${summary.blueprintId}` +
        (summary.blueprintStatus !== undefined ? ` status=${summary.blueprintStatus}` : "") +
        (summary.blueprintPath !== undefined ? ` path=${summary.blueprintPath}` : ""),
    );
  }
  if (summary.planId !== undefined) {
    lines.push(`  - plan: ${summary.planKind ?? "Plan"} ${summary.planId}`);
  }
  if (summary.buildId !== undefined) {
    lines.push(`  - build: ${summary.buildKind ?? "Build"} ${summary.buildId}`);
  }
  if (summary.editorBatchId !== undefined) {
    lines.push(
      `  - editor: ${summary.editorBatchId} status=${summary.editorStatus ?? "unknown"} ` +
        `commands=${summary.editorCompletedCommands}/${summary.editorTotalCommands}`,
    );
  }
  lines.push(`  - evidence: ${summary.evidenceCount}`);
  if (summary.blockerCount > 0) {
    lines.push(`  - blockers: ${summary.blockerCount}`);
    for (const blocker of summary.blockers.slice(0, 5)) {
      lines.push(`    * ${blocker.message}${blocker.id !== undefined ? ` (${blocker.id})` : ""}`);
    }
  }
  if (summary.nextAction !== undefined) {
    lines.push(`  - next: ${summary.nextAction}`);
  }
  if (summary.updatedAt !== undefined) {
    lines.push(`  - updatedAt: ${summary.updatedAt}`);
  }
  return lines.join("\n");
}

export function isActiveOrchestratorProgress(progress) {
  return progress?.kind === ORCHESTRATOR_PROGRESS_KIND
    && progress.status !== "done"
    && progress.status !== "cancelled";
}

export async function readOrchestratorProgress(projectDir) {
  const file = uosArtifactPaths(projectDir).progressFile;
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
  const validation = validateOrchestratorProgress(parsed);
  return validation.ok ? parsed : {
    version: ARTIFACT_VERSION,
    kind: ORCHESTRATOR_PROGRESS_KIND,
    id: "invalid-progress",
    taskTitle: "Invalid persisted progress",
    status: "blocked",
    mode: { id: "unknown" },
    blueprint: undefined,
    steps: [],
    evidence: [],
    blockers: validation.errors.map((message, index) => ({ id: `invalid-${index + 1}`, message })),
    nextAction: "Fix or remove .uos/orchestrator/progress.json.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function writeOrchestratorProgress(projectDir, progress) {
  const validation = validateOrchestratorProgress(progress);
  if (!validation.ok) {
    throw new Error(`orchestrator progress invalid: ${validation.errors.join("; ")}`);
  }
  const paths = uosArtifactPaths(projectDir);
  await fs.mkdir(paths.orchestratorDir, { recursive: true });
  await fs.writeFile(paths.progressFile, JSON.stringify(progress, null, 2), "utf8");
  return paths.progressFile;
}

export function updateOrchestratorProgress(progress, patch = {}, options = {}) {
  const next = {
    ...progress,
    ...patch,
    mode: normalizeMode(patch.mode ?? patch.modeId ?? progress.mode),
    blueprint: patch.blueprint !== undefined ? normalizeArtifactRef(patch.blueprint) : progress.blueprint,
    plan: patch.plan !== undefined ? normalizeArtifactRef(patch.plan) : progress.plan,
    build: patch.build !== undefined ? normalizeArtifactRef(patch.build) : progress.build,
    editorProgress: patch.editorProgress !== undefined
      ? normalizeEditorProgress(patch.editorProgress)
      : progress.editorProgress,
    steps: patch.steps !== undefined ? normalizeSteps(patch.steps) : progress.steps,
    evidence: patch.evidence !== undefined ? normalizeEvidence(patch.evidence) : progress.evidence,
    blockers: patch.blockers !== undefined ? normalizeBlockers(patch.blockers) : progress.blockers,
    nextAction: patch.nextAction !== undefined ? nonBlank(patch.nextAction) : progress.nextAction,
    updatedAt: timestamp(options.now),
  };
  return next;
}

function normalizeStatus(value, fallback) {
  return ORCHESTRATOR_PROGRESS_STATUSES.has(value) ? value : fallback;
}

function normalizeMode(value) {
  if (typeof value === "string") return { id: value };
  if (!isObject(value)) return { id: "general-editor" };
  return {
    id: nonBlank(value.id) ?? "general-editor",
    title: nonBlank(value.title),
  };
}

function normalizeArtifactRef(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return { id: value };
  if (!isObject(value)) return undefined;
  return {
    id: nonBlank(value.id),
    kind: nonBlank(value.kind),
    status: nonBlank(value.status),
    summary: nonBlank(value.summary),
    path: nonBlank(value.path),
  };
}

function normalizeEditorProgress(value) {
  if (!isObject(value)) return undefined;
  return value;
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return [];
  return value.map((step, index) => ({
    id: nonBlank(step?.id) ?? `step-${index + 1}`,
    title: nonBlank(step?.title) ?? `Step ${index + 1}`,
    status: ORCHESTRATOR_STEP_STATUSES.has(step?.status) ? step.status : "pending",
    evidenceIds: Array.isArray(step?.evidenceIds)
      ? step.evidenceIds.filter((item) => typeof item === "string" && item.length > 0)
      : [],
  }));
}

function normalizeEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item, index) => ({
      id: nonBlank(item.id) ?? `evidence-${index + 1}`,
      title: nonBlank(item.title),
      tool: nonBlank(item.tool),
      path: nonBlank(item.path),
      ts: nonBlank(item.ts),
    }));
}

function normalizeBlockers(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isObject(item) || typeof item === "string")
    .map((item, index) => typeof item === "string"
      ? { id: `blocker-${index + 1}`, message: item }
      : {
          id: nonBlank(item.id) ?? `blocker-${index + 1}`,
          message: nonBlank(item.message) ?? "Blocked",
          ts: nonBlank(item.ts),
        });
}

function invalid(key, message) {
  return { ok: false, errors: [`${key}: ${message}`], warnings: [], progress: undefined };
}

function requireNonBlank(value, path, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path}: must be a non-empty string`);
  }
}

function timestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim().length > 0) return value;
  return new Date().toISOString();
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
