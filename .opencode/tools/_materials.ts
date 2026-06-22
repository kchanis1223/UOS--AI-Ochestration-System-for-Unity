import JSZip from "jszip";
import { promises as fs } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import sharp from "sharp";

export const DEFAULT_BASE64_CAP_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TEXT_CAP_CHARS = 80_000;

export const SUPPORTED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".mp4", ".mov", ".webm", ".m4v",
  ".pdf", ".pptx", ".docx", ".txt", ".md", ".markdown", ".csv", ".json",
]);
export const DEFAULT_MATERIAL_IGNORE_DIRS = new Set([
  ".git", ".omx", ".opencode", ".uos",
  "Library", "Temp", "Obj", "Logs", "UserSettings",
  "node_modules", "Build", "Builds",
]);

export function rootDir(ctxDirectory: string): string {
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["UNITY_MCP_MATERIALS_DIR"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return ctxDirectory;
}

export function resolveCandidate(input: string, root: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("path is empty");
  return isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
}

export function guessMimeType(extOrPath: string): string {
  const ext = extname(extOrPath).toLowerCase() || extOrPath.toLowerCase();
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".webm": return "video/webm";
    case ".m4v": return "video/x-m4v";
    case ".pdf": return "application/pdf";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt": return "text/plain";
    case ".md":
    case ".markdown": return "text/markdown";
    case ".csv": return "text/csv";
    case ".json": return "application/json";
    default: return "application/octet-stream";
  }
}

export interface TextExtraction {
  ok: boolean;
  kind: "plain-text" | "pdf" | "docx" | "pptx" | "unsupported" | "failed";
  text?: string;
  chars?: number;
  truncated?: boolean;
  error?: string;
}

export interface PlanningMaterialSummary {
  path: string;
  ext: string;
  mimeType: string;
  size: number;
  kind: "image" | "video" | "pdf" | "pptx" | "docx" | "text" | "unknown";
  isImage: boolean;
  width?: number;
  height?: number;
  imageFormat?: string;
  slideCount?: number;
  embeddedImageCount?: number;
}

export interface ListedPlanningMaterial extends PlanningMaterialSummary {
  name: string;
  relativePath: string;
}

export interface ListPlanningMaterialsOptions {
  recursive?: boolean;
  maxDepth?: number;
  maxFiles?: number;
  ignoreDirs?: Iterable<string>;
}

export async function listPlanningMaterialFiles(
  target: string,
  options: ListPlanningMaterialsOptions = {},
): Promise<{ entries: ListedPlanningMaterial[]; truncated: boolean; searchedRoot: string }> {
  const searchedRoot = resolve(target);
  const recursive = options.recursive === true;
  const maxDepth = recursive ? clampInt(options.maxDepth, 4, 0, 20) : 0;
  const maxFiles = clampInt(options.maxFiles, 500, 1, 5000);
  const ignored = new Set(options.ignoreDirs ?? DEFAULT_MATERIAL_IGNORE_DIRS);
  const entries: ListedPlanningMaterial[] = [];
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (entries.length >= maxFiles) {
      truncated = true;
      return;
    }

    let dirEntries: import("node:fs").Dirent[];
    try {
      dirEntries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entries.length >= maxFiles) {
        truncated = true;
        return;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && depth < maxDepth && !ignored.has(entry.name)) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(full);
      const summary = await inspectPlanningMaterial(full, stat);
      entries.push({
        name: basename(full),
        relativePath: normalizeRelativePath(relative(searchedRoot, full)),
        ...summary,
      });
    }
  }

  await walk(searchedRoot, 0);
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { entries, truncated, searchedRoot };
}

export async function inspectPlanningMaterial(filePath: string, stat?: import("node:fs").Stats): Promise<PlanningMaterialSummary> {
  const resolvedStat = stat ?? await fs.stat(filePath);
  const ext = extname(filePath).toLowerCase();
  const mimeType = guessMimeType(ext);
  const summary: PlanningMaterialSummary = {
    path: filePath,
    ext,
    mimeType,
    size: resolvedStat.size,
    kind: materialKind(ext),
    isImage: mimeType.startsWith("image/"),
  };

  if (summary.isImage) {
    try {
      const metadata = await sharp(filePath).metadata();
      summary.width = metadata.width;
      summary.height = metadata.height;
      summary.imageFormat = metadata.format;
    } catch {
      // Keep the file usable as an attachment even if metadata parsing fails.
    }
  }

  if (ext === ".pptx" || ext === ".docx") {
    try {
      const zip = await JSZip.loadAsync(await fs.readFile(filePath));
      if (ext === ".pptx") {
        summary.slideCount = Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .length;
        summary.embeddedImageCount = Object.keys(zip.files)
          .filter((n) => /^ppt\/media\/.+\.(png|jpe?g|webp|gif|bmp)$/i.test(n))
          .length;
      } else {
        summary.embeddedImageCount = Object.keys(zip.files)
          .filter((n) => /^word\/media\/.+\.(png|jpe?g|webp|gif|bmp)$/i.test(n))
          .length;
      }
    } catch {
      // Bad Office zip files are reported later by text/image extraction.
    }
  }

  return summary;
}

export function formatMaterialSummary(summary: PlanningMaterialSummary): string {
  const parts = [
    `kind=${summary.kind}`,
    `mimeType=${summary.mimeType}`,
    `size=${summary.size}b`,
    summary.width !== undefined && summary.height !== undefined
      ? `dimensions=${summary.width}x${summary.height}`
      : undefined,
    summary.slideCount !== undefined ? `slides=${summary.slideCount}` : undefined,
    summary.embeddedImageCount !== undefined ? `embeddedImages=${summary.embeddedImageCount}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(", ");
}

export async function extractPlanningText(filePath: string, capChars = DEFAULT_TEXT_CAP_CHARS): Promise<TextExtraction> {
  const ext = extname(filePath).toLowerCase();
  try {
    if ([".txt", ".md", ".markdown", ".csv", ".json"].includes(ext)) {
      return capText(await fs.readFile(filePath, "utf8"), "plain-text", capChars);
    }
    if (ext === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: await fs.readFile(filePath) });
      try {
        const result = await parser.getText();
        return capText(result.text ?? "", "pdf", capChars);
      } finally {
        await parser.destroy();
      }
    }
    if (ext === ".docx") {
      const zip = await JSZip.loadAsync(await fs.readFile(filePath));
      const pieces: string[] = [];
      for (const name of [
        "word/document.xml",
        ...Object.keys(zip.files).filter((n) => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(n)),
      ]) {
        const file = zip.file(name);
        if (file === null) continue;
        const text = textFromWordXml(await file.async("string"));
        if (text.length > 0) pieces.push(text);
      }
      return capText(pieces.join("\n\n"), "docx", capChars);
    }
    if (ext === ".pptx") {
      const zip = await JSZip.loadAsync(await fs.readFile(filePath));
      const slideNames = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort(naturalSort);
      const slides: string[] = [];
      for (const name of slideNames) {
        const file = zip.file(name);
        if (file === null) continue;
        const number = name.match(/slide(\d+)\.xml$/)?.[1] ?? String(slides.length + 1);
        const text = textFromDrawingXml(await file.async("string"));
        slides.push(`Slide ${number}\n${text || "(no extracted text)"}`);
      }
      return capText(slides.join("\n\n"), "pptx", capChars);
    }
    return { ok: false, kind: "unsupported" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "failed", error };
  }
}

function capText(text: string, kind: TextExtraction["kind"], capChars: number): TextExtraction {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = normalized.length > capChars;
  const capped = truncated ? normalized.slice(0, capChars) : normalized;
  return { ok: capped.length > 0, kind, text: capped, chars: normalized.length, truncated };
}

function materialKind(ext: string): PlanningMaterialSummary["kind"] {
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if (ext === ".pptx") return "pptx";
  if (ext === ".docx") return "docx";
  if ([".txt", ".md", ".markdown", ".csv", ".json"].includes(ext)) return "text";
  return "unknown";
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function textFromWordXml(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|[\t\n]/g)
    ?.map((part) => {
      if (part === "\t" || part === "\n") return part;
      return decodeXmlEntities(part.replace(/^<w:t\b[^>]*>/, "").replace(/<\/w:t>$/, ""));
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim() ?? "";
}

function textFromDrawingXml(xml: string): string {
  return [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((m) => decodeXmlEntities(m[1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function naturalSort(a: string, b: string): number {
  const na = Number.parseInt(a.match(/(\d+)(?=\.xml$)/)?.[1] ?? "0", 10);
  const nb = Number.parseInt(b.match(/(\d+)(?=\.xml$)/)?.[1] ?? "0", 10);
  return na - nb || a.localeCompare(b);
}
