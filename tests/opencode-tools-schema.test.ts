import { describe, expect, test } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tool } from "@opencode-ai/plugin";
import draftProductionBlueprintTool from "../.opencode/tools/draft_production_blueprint.ts";
import { formatProjectInfoOutput } from "../.opencode/tools/get_project_info.ts";

describe("opencode tool schemas", () => {
  test("all public tool args convert to JSON Schema", async () => {
    const toolsDir = join(import.meta.dir, "..", ".opencode", "tools");
    const files = (await readdir(toolsDir))
      .filter((file) => file.endsWith(".ts") && !file.startsWith("_"))
      .sort((a, b) => a.localeCompare(b));
    const z = tool.schema;
    const failures: string[] = [];

    for (const file of files) {
      try {
        const moduleUrl = pathToFileURL(join(toolsDir, file)).toString();
        const mod = await import(moduleUrl);
        z.toJSONSchema(z.object(mod.default?.args ?? {}));
      } catch (error) {
        failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(failures).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
  });
});

describe("get_project_info output", () => {
  test("distinguishes empty bridge capability lists from missing metadata", () => {
    const output = formatProjectInfoOutput({
      projectName: "Hub Test",
      supportedTools: [],
      writeTools: [],
    });

    expect(output).toContain("projectName:  Hub Test");
    expect(output).toContain("tools:        0 supported");
    expect(output).toContain("writeTools:   0 write tools");
    expect(output).not.toContain("tools:        (unknown)");
    expect(output).not.toContain("writeTools:   (unknown)");
  });

  test("keeps unknown bridge capability output for legacy metadata", () => {
    const output = formatProjectInfoOutput({
      projectName: "Legacy Bridge",
    });

    expect(output).toContain("tools:        (unknown)");
    expect(output).toContain("writeTools:   (unknown)");
  });
});

describe("draft_production_blueprint tool", () => {
  test("persists a valid ProductionBlueprint without mutating Unity", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "draft-production-blueprint-tool");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      const result = await draftProductionBlueprintTool.execute({
        projectDir,
        blueprint: {
          version: "1.0.0",
          kind: "ProductionBlueprint",
          id: "blueprint-tool-test",
          modeId: "screen-from-material",
          title: "Tool test blueprint",
          goal: "Persist a blueprint through the opencode tool",
          status: "approved",
          experience: { summary: "Approved one-screen experience" },
          sources: [{ id: "brief", path: "D:/Plans/brief.md", kind: "document" }],
          screens: [{ id: "main", title: "Main" }],
          interactions: [],
          assumptions: [],
          risks: [],
          ambiguity: { estimate: 10, drivers: [] },
          approval: { required: true, status: "approved" },
          evidence: [],
        },
      }, { directory: "C:/WrongDirectory" });

      expect(result.metadata).toMatchObject({
        ok: true,
        projectDir,
        blueprint: {
          id: "blueprint-tool-test",
          status: "approved",
        },
      });
      expect(result.output).toContain("Next: convert this approved ProductionBlueprint");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
