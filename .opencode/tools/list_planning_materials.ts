/**
 * list_planning_materials - local handler tool (no Unity proxy).
 *
 * Lists planning materials (PPTX, images, video, PDF) in the configured root directory.
 * Default search root: $UNITY_MCP_MATERIALS_DIR | ctx.directory.
 * Absolute paths are honored as-is; relative paths resolve against the root.
 *
 * Ported from mcp-server/src/tools/planningMaterials.ts to Bun + Zod + opencode plugin API.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { promises as fs } from "node:fs";
import {
  formatMaterialSummary,
  listPlanningMaterialFiles,
  resolveCandidate,
  rootDir,
} from "./_materials";

export default tool({
  description:
    "List planning materials (PPTX/PNG/JPG/MP4/MOV/PDF/etc.) in a directory. Defaults to $UNITY_MCP_MATERIALS_DIR or the current session directory.",
  args: {
    dir: z
      .string()
      .optional()
      .describe(
        "Optional directory (absolute or relative to root). When omitted, uses UNITY_MCP_MATERIALS_DIR or session cwd.",
      ),
    recursive: z
      .boolean()
      .optional()
      .describe("Search subdirectories. Skips Unity/generated folders such as Library, Temp, Obj, Logs, .git, node_modules, and .uos."),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Maximum recursion depth when recursive=true. Defaults to 4."),
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(5000)
      .optional()
      .describe("Maximum material files to return. Defaults to 500."),
  },
  async execute(args, ctx) {
    const root = rootDir(ctx.directory);
    const target = args.dir !== undefined && args.dir.trim().length > 0
      ? resolveCandidate(args.dir, root)
      : root;

    try {
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) {
        throw new Error(`not a directory`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`list_planning_materials: cannot read "${target}": ${msg}`);
    }

    const { entries, truncated } = await listPlanningMaterialFiles(target, {
      recursive: args.recursive,
      maxDepth: args.maxDepth,
      maxFiles: args.maxFiles,
    });

    const summary =
      entries.length === 0
        ? `No planning materials found in ${target}`
        : `Found ${entries.length} planning material(s) in ${target}:\n` +
          entries
            .map((e) => `  - ${e.relativePath} (${formatMaterialSummary(e)})`)
            .join("\n") +
          (truncated ? "\n  ... results truncated; narrow dir or raise maxFiles." : "");

    return {
      title: `list_planning_materials: ${entries.length} found`,
      output: summary,
      metadata: {
        root: target,
        count: entries.length,
        recursive: args.recursive === true,
        maxDepth: args.maxDepth,
        maxFiles: args.maxFiles,
        truncated,
        entries,
      },
    };
  },
});
