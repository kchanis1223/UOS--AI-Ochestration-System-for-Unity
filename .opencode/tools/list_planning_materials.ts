/**
 * list_planning_materials — localHandler tool (no Unity proxy).
 *
 * Lists planning materials (PPTX, images, PDF) in the configured root directory.
 * Default search root: $UNITY_MCP_MATERIALS_DIR | ctx.directory.
 * Absolute paths are honored as-is; relative paths resolve against the root.
 *
 * Ported from mcp-server/src/tools/planningMaterials.ts → Bun + Zod + opencode plugin API.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".pdf", ".pptx", ".key",
]);

function rootDir(ctxDirectory: string): string {
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["UNITY_MCP_MATERIALS_DIR"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return ctxDirectory;
}

function resolveCandidate(input: string, root: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("path is empty");
  return isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
}

export default tool({
  description:
    "List planning materials (PPTX/PNG/JPG/PDF/etc.) in a directory. Defaults to $UNITY_MCP_MATERIALS_DIR or the current session directory.",
  args: {
    dir: z
      .string()
      .optional()
      .describe(
        "Optional directory (absolute or relative to root). When omitted, uses UNITY_MCP_MATERIALS_DIR or session cwd.",
      ),
  },
  async execute(args, ctx) {
    const root = rootDir(ctx.directory);
    const target = args.dir !== undefined && args.dir.trim().length > 0
      ? resolveCandidate(args.dir, root)
      : root;

    let dirEntries: import("node:fs").Dirent[];
    try {
      dirEntries = await fs.readdir(target, { withFileTypes: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`list_planning_materials: cannot read "${target}": ${msg}`);
    }

    const entries: Array<{ name: string; path: string; size: number; ext: string }> = [];
    for (const entry of dirEntries) {
      if (!entry.isFile()) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const full = resolve(target, entry.name);
      const stat = await fs.stat(full);
      entries.push({ name: entry.name, path: full, size: stat.size, ext });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const summary =
      entries.length === 0
        ? `No planning materials found in ${target}`
        : `Found ${entries.length} planning material(s) in ${target}:\n` +
          entries.map((e) => `  - ${e.name} (${e.ext}, ${e.size} bytes)`).join("\n");

    return {
      title: `list_planning_materials: ${entries.length} found`,
      output: summary,
      metadata: { root: target, count: entries.length, entries },
    };
  },
});
