/**
 * read_planning_material — localHandler tool (no Unity proxy).
 *
 * Returns a planning material as an MCP-style resource. For large files,
 * returns a file:// URI; for smaller files, returns inline base64.
 * Ported from mcp-server/src/tools/planningMaterials.ts (readPlanningMaterial).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { extname, isAbsolute, resolve, basename } from "node:path";

const DEFAULT_BASE64_CAP_BYTES = 2 * 1024 * 1024;

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

function guessMimeType(ext: string): string {
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".pdf": return "application/pdf";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".key": return "application/vnd.apple.keynote";
    default: return "application/octet-stream";
  }
}

export default tool({
  description:
    "Return a planning material as an MCP resource (file URI for large files; size-capped base64 fallback otherwise). The client LLM performs the multimodal vision; the server never interprets images.",
  args: {
    path: z.string().describe("File path (absolute, or relative to UNITY_MCP_MATERIALS_DIR or session cwd)."),
  },
  async execute(args, ctx) {
    const root = rootDir(ctx.directory);
    const resolved = resolveCandidate(args.path, root);

    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(resolved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`read_planning_material: cannot stat "${resolved}": ${msg}`);
    }
    if (!stat.isFile()) {
      throw new Error(`read_planning_material: "${resolved}" is not a regular file`);
    }

    const ext = extname(resolved).toLowerCase();
    const mimeType = guessMimeType(ext);
    const isImage = mimeType.startsWith("image/");
    const uri = pathToFileURL(resolved).toString();
    const filename = basename(resolved);

    // ToolAttachment surface: lets the LLM perform multimodal vision on the file
    // instead of seeing only metadata. Images get file:// URLs; non-images
    // (pdf/pptx/key) are exposed too so the LLM can request appropriate handling.
    const attachments = [{ type: "file" as const, mime: mimeType, url: uri, filename }];

    if (stat.size > DEFAULT_BASE64_CAP_BYTES) {
      return {
        title: `read_planning_material: ${filename} (uri, ${stat.size}b)`,
        output:
          `File loaded as attachment for vision (mimeType=${mimeType}, size=${stat.size}b).\n` +
          `Path: ${resolved}\n` +
          `URI: ${uri}`,
        metadata: { ok: true, path: resolved, mimeType, uri, size: stat.size, isImage },
        attachments,
      };
    }

    const bytes = await fs.readFile(resolved);
    const base64Data = bytes.toString("base64");
    return {
      title: `read_planning_material: ${filename} (${mimeType}, ${stat.size}b)`,
      output:
        `File loaded as attachment for vision (mimeType=${mimeType}, size=${stat.size}b).\n` +
        `Path: ${resolved}`,
      metadata: { ok: true, path: resolved, mimeType, base64Data, size: stat.size, isImage },
      attachments,
    };
  },
});
