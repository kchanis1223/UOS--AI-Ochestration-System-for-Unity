import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { extname, isAbsolute, resolve, basename } from "node:path";

/**
 * Sidecar-local handlers for the planning-material tools. These deliberately do
 * NOT proxy to Unity: planning materials (mockup PNGs, slide decks) live on the
 * host filesystem and Unity has no privileged access to them. The client LLM
 * does the multimodal vision; the server only serves bytes.
 *
 * Default search root is $UNITY_MCP_MATERIALS_DIR (or process.cwd() if unset).
 * Absolute paths are honored as-is; relative paths resolve against the root.
 */

const SUPPORTED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".pdf", ".pptx", ".key",
]);

// Default base64 cap mirrors the Unity-side capture_preview cap (~2MB). Above
// the cap we return a file:// URI instead so the client can stream it.
const DEFAULT_BASE64_CAP_BYTES = 2 * 1024 * 1024;

export interface MaterialEntry {
  name: string;
  path: string;
  size: number;
  ext: string;
}

export interface ListMaterialsResult {
  root: string;
  entries: MaterialEntry[];
}

export interface ReadMaterialResult {
  path: string;
  mimeType: string;
  // Exactly one of `uri` or `base64Data` is set; `uri` is preferred for files
  // larger than the inline cap.
  uri?: string;
  base64Data?: string;
  size: number;
}

function rootDir(): string {
  const fromEnv = process.env["UNITY_MCP_MATERIALS_DIR"]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : process.cwd();
}

function resolveCandidate(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("path is empty");
  return isAbsolute(trimmed) ? trimmed : resolve(rootDir(), trimmed);
}

export async function listPlanningMaterials(
  args: Record<string, unknown>,
): Promise<ListMaterialsResult> {
  const dirArg = typeof args["dir"] === "string" && (args["dir"] as string).trim().length > 0
    ? (args["dir"] as string)
    : undefined;
  const root = dirArg !== undefined ? resolveCandidate(dirArg) : rootDir();

  let dirEntries: import("node:fs").Dirent[];
  try {
    dirEntries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`list_planning_materials: cannot read "${root}": ${msg}`);
  }

  const entries: MaterialEntry[] = [];
  for (const entry of dirEntries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    const full = resolve(root, entry.name);
    const stat = await fs.stat(full);
    entries.push({ name: entry.name, path: full, size: stat.size, ext });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { root, entries };
}

export async function readPlanningMaterial(
  args: Record<string, unknown>,
): Promise<ReadMaterialResult> {
  const pathArg = args["path"];
  if (typeof pathArg !== "string" || pathArg.trim().length === 0) {
    throw new Error("read_planning_material: missing path");
  }
  const resolved = resolveCandidate(pathArg);
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
  if (stat.size > DEFAULT_BASE64_CAP_BYTES) {
    return {
      path: resolved,
      mimeType,
      uri: pathToFileURL(resolved).toString(),
      size: stat.size,
    };
  }
  const bytes = await fs.readFile(resolved);
  return {
    path: resolved,
    mimeType,
    base64Data: bytes.toString("base64"),
    size: stat.size,
  };
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

/**
 * v1 punt: the deck/image preprocessing pipeline relies on external native
 * libraries (libreoffice/sharp) we deliberately don't pull in. Surface a clear
 * "not implemented" error rather than silently no-op'ing or proxying to a
 * Unity-side stub that would just throw NotSupportedException.
 */
export async function pptxToImagesNotImplemented(
  args: Record<string, unknown>,
): Promise<never> {
  const path = typeof args["path"] === "string" ? basename(args["path"] as string) : "<missing>";
  throw new Error(
    `pptx_to_images is not implemented in v1 (would require libreoffice/poppler for "${path}"). ` +
    `Workaround: pre-render slides to PNG/JPG on disk and use list_planning_materials + read_planning_material.`,
  );
}

export async function preprocessImageNotImplemented(
  args: Record<string, unknown>,
): Promise<never> {
  const path = typeof args["path"] === "string" ? basename(args["path"] as string) : "<missing>";
  throw new Error(
    `preprocess_image is not implemented in v1 (would require sharp for "${path}"). ` +
    `Workaround: pre-process images on disk before calling read_planning_material.`,
  );
}
