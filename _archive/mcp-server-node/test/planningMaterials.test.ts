import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dispatchToolCall, type BridgeCaller } from "../src/tools/dispatch.js";
import {
  listPlanningMaterials,
  readPlanningMaterial,
} from "../src/tools/planningMaterials.js";

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "unity-mcp-mats-"));
  writeFileSync(join(workDir, "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(workDir, "b.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  writeFileSync(join(workDir, "ignored.txt"), "not a planning material");
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("listPlanningMaterials", () => {
  it("lists only supported extensions, sorted by name", async () => {
    const result = await listPlanningMaterials({ dir: workDir });
    expect(result.root).toBe(workDir);
    expect(result.entries.map((e) => e.name)).toEqual(["a.png", "b.jpg"]);
    expect(result.entries[0]?.size).toBeGreaterThan(0);
  });

  it("rejects an unreadable directory", async () => {
    await expect(listPlanningMaterials({ dir: join(workDir, "_nope") })).rejects.toThrow(
      /cannot read/,
    );
  });
});

describe("readPlanningMaterial", () => {
  it("inlines small files as base64", async () => {
    const result = await readPlanningMaterial({ path: join(workDir, "a.png") });
    expect(result.mimeType).toBe("image/png");
    expect(result.base64Data?.length).toBeGreaterThan(0);
    expect(result.uri).toBeUndefined();
  });

  it("returns a file:// URI for files past the inline cap", async () => {
    // Synthesize an oversized file to trigger the URI branch.
    const big = join(workDir, "big.png");
    writeFileSync(big, Buffer.alloc(3 * 1024 * 1024, 0x00));
    const result = await readPlanningMaterial({ path: big });
    expect(result.uri).toBe(pathToFileURL(big).toString());
    expect(result.base64Data).toBeUndefined();
  });

  it("rejects missing path arg", async () => {
    await expect(readPlanningMaterial({})).rejects.toThrow(/missing path/);
  });
});

describe("dispatch — localHandler routing", () => {
  it("runs the local handler for list_planning_materials and never touches the bridge", async () => {
    const caller: BridgeCaller = vi.fn();
    const outcome = await dispatchToolCall(
      "list_planning_materials",
      { dir: workDir },
      caller,
    );
    expect(outcome.isError).toBe(false);
    expect(caller).not.toHaveBeenCalled();
  });

  it("surfaces the v1 not-implemented message for pptx_to_images", async () => {
    const caller: BridgeCaller = vi.fn();
    const outcome = await dispatchToolCall(
      "pptx_to_images",
      { path: "deck.pptx" },
      caller,
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/not implemented in v1/);
    expect(caller).not.toHaveBeenCalled();
  });
});
