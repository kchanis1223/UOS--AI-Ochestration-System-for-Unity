import JSZip from "jszip";
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { guessMimeType } from "./_materials";

const RASTER_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"]);

export interface EmbeddedImage {
  packagePath: string;
  path: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface EmbeddedImageResult {
  ok: boolean;
  sourcePath: string;
  outputDir: string;
  images: EmbeddedImage[];
  skipped: string[];
}

export interface EmbeddedImageOptions {
  outputDir?: string;
  maxImages?: number;
}

export async function extractEmbeddedImages(
  filePath: string,
  options: EmbeddedImageOptions = {},
): Promise<EmbeddedImageResult> {
  const ext = extname(filePath).toLowerCase();
  if (ext !== ".docx" && ext !== ".pptx") {
    throw new Error(`extract_embedded_images: expected .docx or .pptx, got "${basename(filePath)}"`);
  }

  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const prefix = ext === ".docx" ? "word/media/" : "ppt/media/";
  const mediaNames = Object.keys(zip.files)
    .filter((name) => name.startsWith(prefix) && !zip.files[name].dir)
    .sort(naturalSort);
  const outputDir = options.outputDir ?? await defaultOutputDir(filePath);
  await fs.mkdir(outputDir, { recursive: true });

  const maxImages = clampInt(options.maxImages, 100, 1, 500);
  const images: EmbeddedImage[] = [];
  const skipped: string[] = [];

  for (const name of mediaNames) {
    if (images.length >= maxImages) {
      skipped.push(name);
      continue;
    }

    const imageExt = extname(name).toLowerCase();
    if (!RASTER_IMAGE_EXTENSIONS.has(imageExt)) {
      skipped.push(name);
      continue;
    }

    const file = zip.file(name);
    if (file === null) {
      skipped.push(name);
      continue;
    }

    const bytes = await file.async("nodebuffer");
    const filename = `${String(images.length + 1).padStart(3, "0")}-${safeName(basename(name))}`;
    const outputPath = join(outputDir, filename);
    await fs.writeFile(outputPath, bytes);

    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(bytes).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // Keep the file even if metadata inspection fails.
    }

    images.push({
      packagePath: name,
      path: outputPath,
      filename,
      mimeType: guessMimeType(imageExt),
      size: bytes.length,
      width,
      height,
    });
  }

  return {
    ok: images.length > 0,
    sourcePath: filePath,
    outputDir,
    images,
    skipped,
  };
}

async function defaultOutputDir(filePath: string): Promise<string> {
  const stem = safeStem(basename(filePath, extname(filePath)));
  const dir = join(tmpdir(), "oh-my-unity", "embedded-images", `${stem}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function safeName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "image";
}

function safeStem(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "document";
}

function naturalSort(a: string, b: string): number {
  const na = Number.parseInt(a.match(/(\d+)(?=\.[^.]+$)/)?.[1] ?? "0", 10);
  const nb = Number.parseInt(b.match(/(\d+)(?=\.[^.]+$)/)?.[1] ?? "0", 10);
  return na - nb || a.localeCompare(b);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, n));
}
