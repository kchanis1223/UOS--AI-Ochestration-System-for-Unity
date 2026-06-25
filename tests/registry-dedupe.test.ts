import { describe, expect, test } from "bun:test";
// @ts-expect-error - pure JS module, no type declarations.
import { dedupeEditorsByProject, normalizeProjectKey, isPreferredEditor } from "../bin/registry-dedupe.js";

const P = "D:\\UnityProject\\UOS_Test";

describe("dedupeEditorsByProject", () => {
  test("collapses duplicate live entries for one project to a single bridge", () => {
    const editors = [
      { instanceId: "a", projectPath: P, host: "127.0.0.1", port: 8402, updatedAtUtc: "2026-06-08T05:00:00.000Z" },
      { instanceId: "b", projectPath: P, host: "127.0.0.1", port: 8403, updatedAtUtc: "2026-06-08T05:10:00.000Z" },
      { instanceId: "c", projectPath: P, host: "127.0.0.1", port: 17801, uosPackageVersion: "0.1.0", updatedAtUtc: "2026-06-08T05:30:00.000Z" },
    ];
    const out = dedupeEditorsByProject(editors);
    expect(out).toHaveLength(1);
    expect(out[0].port).toBe(17801); // the entry with a UOS package version wins
  });

  test("prefers the entry reporting a UOS package version even if older", () => {
    const editors = [
      { projectPath: P, port: 9000, uosPackageVersion: "0.1.0", updatedAtUtc: "2026-06-08T01:00:00.000Z" },
      { projectPath: P, port: 9001, updatedAtUtc: "2026-06-08T09:00:00.000Z" },
    ];
    const out = dedupeEditorsByProject(editors);
    expect(out).toHaveLength(1);
    expect(out[0].port).toBe(9000);
  });

  test("prefers GUI-launched bridge entries over generic entries", () => {
    const editors = [
      { projectPath: P, port: 9000, uosPackageVersion: "0.1.0", updatedAtUtc: "2026-06-08T09:00:00.000Z" },
      { projectPath: P, port: 9001, uosPackageVersion: "0.1.0", uosGuiSessionId: "gui-1", updatedAtUtc: "2026-06-08T01:00:00.000Z" },
    ];
    const out = dedupeEditorsByProject(editors);
    expect(out).toHaveLength(1);
    expect(out[0].port).toBe(9001);
  });

  test("breaks ties by freshest updatedAtUtc when UOS version status is equal", () => {
    const editors = [
      { projectPath: P, port: 1, uosPackageVersion: "0.1.0", updatedAtUtc: "2026-06-08T01:00:00.000Z" },
      { projectPath: P, port: 2, uosPackageVersion: "0.1.0", updatedAtUtc: "2026-06-08T02:00:00.000Z" },
    ];
    expect(dedupeEditorsByProject(editors)[0].port).toBe(2);
  });

  test("keeps distinct projects separate and preserves first-seen order", () => {
    const editors = [
      { projectPath: "D:/A", port: 1, updatedAtUtc: "2026-06-08T01:00:00.000Z" },
      { projectPath: "D:/B", port: 2, updatedAtUtc: "2026-06-08T01:00:00.000Z" },
      { projectPath: "D:/A", port: 3, updatedAtUtc: "2026-06-08T02:00:00.000Z" },
    ];
    const out = dedupeEditorsByProject(editors);
    expect(out.map((e: any) => normalizeProjectKey(e.projectPath))).toEqual(["d:/a", "d:/b"]);
    expect(out[0].port).toBe(3); // freshest A
  });

  test("normalizes slashes, trailing slash, and case to one key", () => {
    expect(normalizeProjectKey("D:\\UnityProject\\UOS_Test")).toBe("d:/unityproject/uos_test");
    expect(normalizeProjectKey("D:/UnityProject/UOS_Test/")).toBe("d:/unityproject/uos_test");
    const editors = [
      { projectPath: "D:\\UnityProject\\UOS_Test", port: 1, updatedAtUtc: "2026-06-08T01:00:00.000Z" },
      { projectPath: "d:/unityproject/uos_test/", port: 2, updatedAtUtc: "2026-06-08T02:00:00.000Z" },
    ];
    expect(dedupeEditorsByProject(editors)).toHaveLength(1);
  });

  test("never merges entries without a project path", () => {
    const editors = [
      { port: 1 },
      { port: 2 },
    ];
    expect(dedupeEditorsByProject(editors)).toHaveLength(2);
  });

  test("handles empty / non-array input", () => {
    expect(dedupeEditorsByProject([])).toEqual([]);
    // @ts-expect-error testing defensive guard
    expect(dedupeEditorsByProject(undefined)).toEqual([]);
  });

  test("isPreferredEditor exposes the comparison", () => {
    expect(isPreferredEditor({ uosPackageVersion: "0.1.0" }, {})).toBe(true);
    expect(isPreferredEditor({}, { uosPackageVersion: "0.1.0" })).toBe(false);
  });
});
