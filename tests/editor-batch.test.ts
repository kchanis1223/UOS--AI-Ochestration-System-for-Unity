import { describe, expect, test } from "bun:test";
// @ts-expect-error - shared pure-JS Editor batch helpers (no type declarations).
import {
  assertReadOnlyEditorBatch,
  createEditorBatchProgress,
  editorBatchRequiresApproval,
  nextEditorCommand,
  recordEditorCommandResult,
  startEditorCommand,
  summarizeEditorBatchProgress,
} from "../bin/editor-batch-core.js";

const readOnlyBatch = {
  version: "1.0.0",
  kind: "EditorCommandBatch",
  id: "batch-readonly",
  modeId: "unity-inspection",
  planId: "plan-inspect",
  commands: [
    { id: "ctx", tool: "get_uos_context", args: {}, mutation: false },
    { id: "screens", tool: "list_screens", args: {}, mutation: false },
  ],
};

const writeBatch = {
  version: "1.0.0",
  kind: "EditorCommandBatch",
  id: "batch-write",
  modeId: "kiosk-content",
  planId: "plan-kiosk",
  commands: [
    {
      id: "create-main",
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
    {
      id: "preview-main",
      tool: "capture_preview_from_context",
      args: { screenName: "Main" },
      mutation: true,
      requiresApproval: true,
    },
  ],
};

describe("EditorCommandBatch execution boundary helpers", () => {
  test("allows read-only batches and blocks write tools from read-only execution", () => {
    expect(assertReadOnlyEditorBatch(readOnlyBatch).ok).toBe(true);

    const result = assertReadOnlyEditorBatch({
      ...readOnlyBatch,
      commands: [
        { id: "bad", tool: "create_ui_screen", args: {}, mutation: false },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('batch.commands[0].tool: read-only execution cannot include write tool "create_ui_screen"');
  });

  test("detects approval requirements for mutating batches", () => {
    expect(editorBatchRequiresApproval(readOnlyBatch)).toBe(false);
    expect(editorBatchRequiresApproval(writeBatch)).toBe(true);
  });

  test("creates progress records and exposes the next command", () => {
    const result = createEditorBatchProgress(writeBatch, { now: "2026-06-11T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    expect(result.progress.status).toBe("needs-approval");
    expect(result.progress.approvalRequired).toBe(true);
    expect(result.progress.commands).toHaveLength(2);
    expect(nextEditorCommand(result.progress)?.id).toBe("create-main");

    const approved = createEditorBatchProgress(writeBatch, { approved: true, now: "2026-06-11T00:00:00.000Z" });
    expect(approved.progress.status).toBe("pending");
  });

  test("records command evidence and rolls progress status forward", () => {
    const created = createEditorBatchProgress(writeBatch, { approved: true, now: "2026-06-11T00:00:00.000Z" });
    const started = startEditorCommand(created.progress, "create-main", { now: "2026-06-11T00:00:01.000Z" });
    expect(started.progress.status).toBe("in-progress");
    expect(started.progress.commands[0].status).toBe("in-progress");

    const first = recordEditorCommandResult(started.progress, "create-main", {
      ok: true,
      title: "created",
      metadata: { screenId: "Main_ID", dataUrl: "data:image/png;base64," + "x".repeat(3000) },
    }, { now: "2026-06-11T00:00:02.000Z" });
    expect(first.ok).toBe(true);
    expect(first.progress.commands[0].status).toBe("done");
    expect(first.evidence.metadata.dataUrl).toStartWith("[redacted dataUrl");
    expect(first.progress.status).toBe("in-progress");

    const second = recordEditorCommandResult(first.progress, "preview-main", {
      ok: false,
      title: "preview failed",
      output: "bridge unavailable",
    }, { now: "2026-06-11T00:00:03.000Z" });
    expect(second.progress.status).toBe("blocked");
    expect(second.progress.completedAt).toBe("2026-06-11T00:00:03.000Z");
    expect(summarizeEditorBatchProgress(second.progress)).toContain("blocked 1");
  });
});
