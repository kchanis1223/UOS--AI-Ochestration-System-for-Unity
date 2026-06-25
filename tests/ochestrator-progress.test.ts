import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - shared pure-JS progress helpers (no type declarations).
import {
  createOchestratorProgress,
  formatOchestratorProgress,
  isActiveOchestratorProgress,
  readOchestratorProgress,
  summarizeOchestratorProgress,
  updateOchestratorProgress,
  validateOchestratorProgress,
  writeOchestratorProgress,
} from "../bin/ochestrator-progress-core.js";

describe("UOS Ochestrator progress records", () => {
  test("creates, validates, summarizes, and formats progress", () => {
    const progress = createOchestratorProgress({
      id: "progress-kiosk",
      taskTitle: "Build kiosk",
      status: "building",
      mode: { id: "kiosk-content", title: "Kiosk Content Builder" },
      blueprint: {
        id: "blueprint-kiosk",
        kind: "ProductionBlueprint",
        status: "approved",
        path: "D:/Unity/MyGame/.uos/ochestrator/blueprints/blueprint-kiosk.json",
      },
      plan: { id: "plan-kiosk", kind: "KioskPlan", status: "approved" },
      build: { id: "build-kiosk", kind: "EditorChangeSet", status: "pending" },
      editorProgress: {
        kind: "EditorBatchProgress",
        batchId: "batch-kiosk",
        status: "in-progress",
        commands: [
          { id: "create-main", status: "done" },
          { id: "create-detail", status: "pending" },
        ],
        evidence: [{ id: "ev-editor-1" }],
      },
      steps: [
        { id: "plan", title: "Plan kiosk", status: "done" },
        { id: "build", title: "Build screens", status: "in-progress" },
      ],
      evidence: [{ id: "ev-plan", title: "Plan approved" }],
      nextAction: "Apply remaining Editor commands.",
    }, { now: "2026-06-11T00:00:00.000Z" });

    expect(validateOchestratorProgress(progress).ok).toBe(true);
    expect(isActiveOchestratorProgress(progress)).toBe(true);

    const summary = summarizeOchestratorProgress(progress);
    expect(summary).toMatchObject({
      ok: true,
      status: "building",
      modeId: "kiosk-content",
      blueprintId: "blueprint-kiosk",
      blueprintStatus: "approved",
      currentStep: { id: "build", status: "in-progress" },
      completedSteps: 1,
      totalSteps: 2,
      evidenceCount: 2,
      editorBatchId: "batch-kiosk",
      editorCompletedCommands: 1,
      editorTotalCommands: 2,
    });

    const formatted = formatOchestratorProgress(progress);
    expect(formatted).toContain("ochestratorProgress: building");
    expect(formatted).toContain("mode=kiosk-content");
    expect(formatted).toContain("blueprint: ProductionBlueprint blueprint-kiosk status=approved");
    expect(formatted).toContain("current=build(in-progress)");
    expect(formatted).toContain("editor: batch-kiosk status=in-progress commands=1/2");
    expect(formatted).toContain("next: Apply remaining Editor commands.");
  });

  test("persists progress under .uos/ochestrator/progress.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uos-progress-"));
    try {
      await mkdir(dir, { recursive: true });
      const progress = createOchestratorProgress({
        id: "progress-persisted",
        taskTitle: "Resume me",
        status: "needs-approval",
        modeId: "screen-from-material",
        blueprint: { id: "blueprint-lobby", kind: "ProductionBlueprint", status: "needs-approval" },
        steps: [{ id: "approve", title: "Approve plan", status: "pending" }],
        nextAction: "Wait for user approval.",
      }, { now: "2026-06-11T01:00:00.000Z" });

      const file = await writeOchestratorProgress(dir, progress);
      expect(file.replace(/\\/g, "/")).toEndWith("/.uos/ochestrator/progress.json");

      const loaded = await readOchestratorProgress(dir);
      expect(loaded).toMatchObject({
        id: "progress-persisted",
        status: "needs-approval",
        mode: { id: "screen-from-material" },
        blueprint: { id: "blueprint-lobby", status: "needs-approval" },
        nextAction: "Wait for user approval.",
      });

      const updated = updateOchestratorProgress(loaded, {
        status: "done",
        blueprint: { id: "blueprint-lobby", kind: "ProductionBlueprint", status: "approved" },
        steps: [{ id: "approve", title: "Approve plan", status: "done" }],
      }, { now: "2026-06-11T01:01:00.000Z" });
      expect(updated.status).toBe("done");
      expect(updated.blueprint.status).toBe("approved");
      expect(updated.updatedAt).toBe("2026-06-11T01:01:00.000Z");
      expect(isActiveOchestratorProgress(updated)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed progress records", () => {
    const result = validateOchestratorProgress({
      version: "2.0.0",
      kind: "Other",
      id: "",
      taskTitle: "",
      status: "mystery",
      mode: {},
      steps: [
        { id: "dup", title: "One", status: "done" },
        { id: "dup", title: "Two", status: "pending" },
      ],
      evidence: [],
      blockers: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('progress.version: must be "1.0.0"');
    expect(result.errors).toContain('progress.kind: must be "OchestratorProgress"');
    expect(result.errors).toContain('progress.steps[1].id: duplicate step id "dup"');
  });
});
