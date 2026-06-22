/**
 * editor-batch-core - Editor execution boundary helpers.
 *
 * These helpers do not call Unity. They validate EditorCommandBatch artifacts,
 * enforce read-only boundaries, and standardize progress/evidence records for
 * the layer that applies commands through bridge tools.
 */

import { ARTIFACT_VERSION, editorToolKind, validateEditorCommandBatch } from "./artifact-core.js";

export function editorBatchRequiresApproval(batch) {
  const commands = Array.isArray(batch?.commands) ? batch.commands : [];
  return commands.some((command) => command?.mutation === true || command?.requiresApproval === true);
}

export function assertReadOnlyEditorBatch(batch) {
  const validation = validateEditorCommandBatch(batch);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  if (validation.ok) {
    batch.commands.forEach((command, index) => {
      const kind = editorToolKind(command.tool);
      if (command.mutation === true) {
        errors.push(`batch.commands[${index}].mutation: read-only execution cannot include mutation=true`);
      }
      if (kind === "write") {
        errors.push(`batch.commands[${index}].tool: read-only execution cannot include write tool "${command.tool}"`);
      }
    });
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    batch: errors.length === 0 ? batch : undefined,
  };
}

export function createEditorBatchProgress(batch, options = {}) {
  const validation = validateEditorCommandBatch(batch);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, warnings: validation.warnings, progress: undefined };
  }

  const approvalRequired = editorBatchRequiresApproval(batch);
  const approved = options.approved === true;
  const now = timestamp(options.now);
  const progress = {
    version: ARTIFACT_VERSION,
    kind: "EditorBatchProgress",
    id: nonBlank(options.id) ?? `${batch.id}-progress`,
    batchId: batch.id,
    modeId: batch.modeId,
    planId: batch.planId,
    status: approvalRequired && !approved ? "needs-approval" : "pending",
    approvalRequired,
    approved,
    startedAt: undefined,
    updatedAt: now,
    completedAt: undefined,
    commands: batch.commands.map((command, index) => ({
      id: command.id,
      index,
      tool: command.tool,
      mutation: command.mutation === true,
      requiresApproval: command.requiresApproval === true,
      status: "pending",
      startedAt: undefined,
      completedAt: undefined,
      evidenceIds: [],
    })),
    evidence: [],
    warnings: validation.warnings,
  };

  return { ok: true, errors: [], warnings: validation.warnings, progress };
}

export function nextEditorCommand(progress) {
  if (!isProgress(progress)) return undefined;
  return progress.commands.find((command) => command.status === "pending" || command.status === "in-progress");
}

export function startEditorCommand(progress, commandId, options = {}) {
  return updateCommand(progress, commandId, "in-progress", {}, options);
}

export function recordEditorCommandResult(progress, commandId, result, options = {}) {
  if (!isProgress(progress)) {
    return { ok: false, errors: ["progress: must be an EditorBatchProgress object"], progress: undefined };
  }
  const command = progress.commands.find((item) => item.id === commandId);
  if (command === undefined) {
    return { ok: false, errors: [`commandId: unknown command "${commandId}"`], progress: undefined };
  }

  const now = timestamp(options.now);
  const ok = result?.ok !== false;
  const evidenceId = nonBlank(result?.evidenceId) ?? `${command.id}-evidence-${progress.evidence.length + 1}`;
  const evidence = {
    id: evidenceId,
    commandId: command.id,
    tool: command.tool,
    ok,
    title: nonBlank(result?.title),
    output: nonBlank(result?.output),
    metadata: sanitizeEvidenceMetadata(result?.metadata),
    recordedAt: now,
  };

  const next = clone(progress);
  const target = next.commands.find((item) => item.id === commandId);
  target.status = ok ? "done" : "blocked";
  target.startedAt ??= now;
  target.completedAt = now;
  target.evidenceIds = [...new Set([...(target.evidenceIds ?? []), evidenceId])];
  next.evidence.push(evidence);
  next.updatedAt = now;
  next.startedAt ??= now;
  next.status = next.commands.some((item) => item.status === "blocked")
    ? "blocked"
    : next.commands.every((item) => item.status === "done" || item.status === "skipped")
      ? "done"
      : "in-progress";
  if (next.status === "done" || next.status === "blocked") next.completedAt = now;

  return { ok: true, errors: [], progress: next, evidence };
}

export function summarizeEditorBatchProgress(progress) {
  if (!isProgress(progress)) return "No Editor batch progress.";
  const counts = progress.commands.reduce((acc, command) => {
    acc[command.status] = (acc[command.status] ?? 0) + 1;
    return acc;
  }, {});
  return [
    `Editor batch ${progress.batchId}: ${progress.status}`,
    `Commands: pending ${counts.pending ?? 0}, in-progress ${counts["in-progress"] ?? 0}, done ${counts.done ?? 0}, blocked ${counts.blocked ?? 0}, skipped ${counts.skipped ?? 0}`,
    `Evidence: ${progress.evidence.length}`,
    progress.approvalRequired ? `Approval: ${progress.approved ? "approved" : "required"}` : "Approval: not required",
  ].join("\n");
}

function updateCommand(progress, commandId, status, patch, options) {
  if (!isProgress(progress)) {
    return { ok: false, errors: ["progress: must be an EditorBatchProgress object"], progress: undefined };
  }
  const next = clone(progress);
  const command = next.commands.find((item) => item.id === commandId);
  if (command === undefined) {
    return { ok: false, errors: [`commandId: unknown command "${commandId}"`], progress: undefined };
  }
  const now = timestamp(options.now);
  Object.assign(command, patch, { status });
  if (status === "in-progress") command.startedAt ??= now;
  next.startedAt ??= now;
  next.updatedAt = now;
  if (next.status === "pending" || next.status === "needs-approval") next.status = "in-progress";
  return { ok: true, errors: [], progress: next };
}

function isProgress(value) {
  return value !== undefined
    && value !== null
    && typeof value === "object"
    && value.kind === "EditorBatchProgress"
    && Array.isArray(value.commands)
    && Array.isArray(value.evidence);
}

function timestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim().length > 0) return value;
  return new Date().toISOString();
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeEvidenceMetadata(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") return value;
  const copy = clone(value);
  return redactLargeFields(copy);
}

function redactLargeFields(value) {
  if (Array.isArray(value)) return value.map(redactLargeFields);
  if (value === undefined || value === null || typeof value !== "object") return value;
  for (const [key, item] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (typeof item === "string" && (item.length > 2048 || lowered.includes("base64") || lowered.includes("dataurl"))) {
      value[key] = `[redacted ${key}, ${item.length} chars]`;
    } else {
      value[key] = redactLargeFields(item);
    }
  }
  return value;
}
