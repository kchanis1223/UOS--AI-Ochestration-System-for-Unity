import sharp from "sharp";
import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

export type ImageOutputFormat = "png" | "jpeg" | "webp";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreprocessImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  crop?: CropRect;
  format?: ImageOutputFormat;
  quality?: number;
  outputPath?: string;
}

export interface PreprocessImageResult {
  path: string;
  mimeType: string;
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface CompareImagesOptions {
  maxWidth?: number;
  maxHeight?: number;
  threshold?: number;
  outputPath?: string;
}

export interface CompareImagesResult {
  referencePath: string;
  candidatePath: string;
  diffPath: string;
  diffMimeType: string;
  referenceWidth: number;
  referenceHeight: number;
  candidateWidth: number;
  candidateHeight: number;
  compareWidth: number;
  compareHeight: number;
  meanAbsoluteError: number;
  rootMeanSquareError: number;
  mismatchRatio: number;
  maxChannelDelta: number;
  aspectRatioDelta: number;
  threshold: number;
  size: number;
}

export interface VisionImageAttachmentOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  outputDir?: string;
  quality?: number;
}

export interface VisionImageAttachmentResult {
  path: string;
  mimeType: string;
  width?: number;
  height?: number;
  format?: string;
  size: number;
  originalPath: string;
  originalWidth?: number;
  originalHeight?: number;
  originalFormat?: string;
  originalSize: number;
  resized: boolean;
  capSatisfied: boolean;
}

const DEFAULT_VISION_MAX_WIDTH = 1600;
const DEFAULT_VISION_MAX_HEIGHT = 1600;
const DEFAULT_VISION_MAX_BYTES = 950 * 1024;

export async function preprocessImageFile(
  inputPath: string,
  options: PreprocessImageOptions = {},
): Promise<PreprocessImageResult> {
  let pipeline = sharp(inputPath, { failOn: "warning" }).rotate();

  if (options.crop !== undefined) {
    pipeline = pipeline.extract({
      left: Math.max(0, Math.round(options.crop.x)),
      top: Math.max(0, Math.round(options.crop.y)),
      width: Math.max(1, Math.round(options.crop.width)),
      height: Math.max(1, Math.round(options.crop.height)),
    });
  }

  if (options.maxWidth !== undefined || options.maxHeight !== undefined) {
    pipeline = pipeline.resize({
      width: options.maxWidth !== undefined ? Math.max(1, Math.round(options.maxWidth)) : undefined,
      height: options.maxHeight !== undefined ? Math.max(1, Math.round(options.maxHeight)) : undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const format = options.format ?? "png";
  const quality = options.quality !== undefined
    ? Math.min(100, Math.max(1, Math.round(options.quality)))
    : undefined;
  switch (format) {
    case "jpeg":
      pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: quality ?? 88 });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: quality ?? 88 });
      break;
    case "png":
      pipeline = pipeline.png();
      break;
  }

  const outputPath = options.outputPath ?? await defaultOutputPath(inputPath, format);
  await mkdir(dirname(outputPath), { recursive: true });
  const info = await pipeline.toFile(outputPath);
  return {
    path: outputPath,
    mimeType: mimeTypeForFormat(format),
    width: info.width,
    height: info.height,
    format: info.format,
    size: info.size,
  };
}

export async function prepareVisionImageAttachment(
  inputPath: string,
  options: VisionImageAttachmentOptions = {},
): Promise<VisionImageAttachmentResult> {
  const sourceStat = await stat(inputPath);
  const sourceMeta = await sharp(inputPath, { failOn: "warning" }).metadata();
  const maxWidth = clampInteger(options.maxWidth, DEFAULT_VISION_MAX_WIDTH, 1, 4096);
  const maxHeight = clampInteger(options.maxHeight, DEFAULT_VISION_MAX_HEIGHT, 1, 4096);
  const maxBytes = clampInteger(options.maxBytes, DEFAULT_VISION_MAX_BYTES, 64 * 1024, 16 * 1024 * 1024);
  const sourceWidth = sourceMeta.width;
  const sourceHeight = sourceMeta.height;
  const fitsDimensions = (sourceWidth === undefined || sourceWidth <= maxWidth)
    && (sourceHeight === undefined || sourceHeight <= maxHeight);

  if (sourceStat.size <= maxBytes && fitsDimensions) {
    return {
      path: inputPath,
      mimeType: mimeTypeForImageFormat(sourceMeta.format, inputPath),
      width: sourceWidth,
      height: sourceHeight,
      format: sourceMeta.format,
      size: sourceStat.size,
      originalPath: inputPath,
      originalWidth: sourceWidth,
      originalHeight: sourceHeight,
      originalFormat: sourceMeta.format,
      originalSize: sourceStat.size,
      resized: false,
      capSatisfied: true,
    };
  }

  const quality = clampInteger(options.quality, 86, 35, 95);
  const attempts = [
    { width: maxWidth, height: maxHeight, quality },
    { width: Math.min(maxWidth, 1280), height: Math.min(maxHeight, 1280), quality: Math.min(quality, 82) },
    { width: Math.min(maxWidth, 1024), height: Math.min(maxHeight, 1024), quality: Math.min(quality, 78) },
    { width: Math.min(maxWidth, 768), height: Math.min(maxHeight, 768), quality: Math.min(quality, 72) },
  ];
  let last: PreprocessImageResult | undefined;
  for (const attempt of attempts) {
    const outputPath = await defaultVisionAttachmentPath(inputPath, options.outputDir, attempt.width, attempt.quality);
    const result = await preprocessImageFile(inputPath, {
      maxWidth: attempt.width,
      maxHeight: attempt.height,
      format: "jpeg",
      quality: attempt.quality,
      outputPath,
    });
    last = result;
    if (result.size <= maxBytes) {
      return visionAttachmentResult(inputPath, sourceStat.size, sourceMeta, result, true, true);
    }
  }

  if (last === undefined) {
    throw new Error(`prepareVisionImageAttachment: failed to preprocess "${inputPath}"`);
  }
  return visionAttachmentResult(inputPath, sourceStat.size, sourceMeta, last, true, last.size <= maxBytes);
}

function visionAttachmentResult(
  inputPath: string,
  sourceSize: number,
  sourceMeta: sharp.Metadata,
  result: PreprocessImageResult,
  resized: boolean,
  capSatisfied: boolean,
): VisionImageAttachmentResult {
  return {
    path: result.path,
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    format: result.format,
    size: result.size,
    originalPath: inputPath,
    originalWidth: sourceMeta.width,
    originalHeight: sourceMeta.height,
    originalFormat: sourceMeta.format,
    originalSize: sourceSize,
    resized,
    capSatisfied,
  };
}

function mimeTypeForFormat(format: ImageOutputFormat): string {
  switch (format) {
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "png": return "image/png";
  }
}

async function defaultOutputPath(inputPath: string, format: ImageOutputFormat): Promise<string> {
  const dir = join(tmpdir(), "oh-my-unity", "preprocessed");
  await mkdir(dir, { recursive: true });
  const stem = basename(inputPath, extname(inputPath)).replace(/[^a-zA-Z0-9._-]+/g, "_") || "image";
  return join(dir, `${stem}-${Date.now()}.${format === "jpeg" ? "jpg" : format}`);
}

async function defaultVisionAttachmentPath(
  inputPath: string,
  outputDir: string | undefined,
  maxWidth: number,
  quality: number,
): Promise<string> {
  const dir = outputDir ?? join(tmpdir(), "oh-my-unity", "vision-attachments");
  await mkdir(dir, { recursive: true });
  const stem = basename(inputPath, extname(inputPath)).replace(/[^a-zA-Z0-9._-]+/g, "_") || "image";
  return join(dir, `${stem}-vision-${maxWidth}w-q${quality}-${Date.now()}.jpg`);
}

function mimeTypeForImageFormat(format: string | undefined, inputPath: string): string {
  switch ((format ?? extname(inputPath).slice(1)).toLowerCase()) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "bmp": return "image/bmp";
    case "png":
    default:
      return "image/png";
  }
}

export async function compareImageFiles(
  referencePath: string,
  candidatePath: string,
  options: CompareImagesOptions = {},
): Promise<CompareImagesResult> {
  const referenceMeta = await sharp(referencePath).metadata();
  const candidateMeta = await sharp(candidatePath).metadata();
  if (referenceMeta.width === undefined || referenceMeta.height === undefined) {
    throw new Error(`compare_images: cannot read reference dimensions for "${referencePath}"`);
  }
  if (candidateMeta.width === undefined || candidateMeta.height === undefined) {
    throw new Error(`compare_images: cannot read candidate dimensions for "${candidatePath}"`);
  }

  const compareSize = boundedCompareSize(
    referenceMeta.width,
    referenceMeta.height,
    options.maxWidth,
    options.maxHeight,
  );
  const reference = await normalizedRaw(referencePath, compareSize.width, compareSize.height);
  const candidate = await normalizedRaw(candidatePath, compareSize.width, compareSize.height);
  const threshold = clampNumber(options.threshold, 0.05, 0, 1);

  let absoluteSum = 0;
  let squareSum = 0;
  let mismatchPixels = 0;
  let maxChannelDelta = 0;
  const pixelCount = compareSize.width * compareSize.height;
  const diff = Buffer.alloc(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const dr = Math.abs(reference[offset] - candidate[offset]);
    const dg = Math.abs(reference[offset + 1] - candidate[offset + 1]);
    const db = Math.abs(reference[offset + 2] - candidate[offset + 2]);
    absoluteSum += dr + dg + db;
    squareSum += dr * dr + dg * dg + db * db;
    maxChannelDelta = Math.max(maxChannelDelta, dr, dg, db);

    const pixelDelta = (dr + dg + db) / (3 * 255);
    if (pixelDelta > threshold) mismatchPixels++;
    const heat = Math.round(pixelDelta * 255);
    diff[offset] = heat;
    diff[offset + 1] = Math.max(0, 48 - Math.round(heat * 0.15));
    diff[offset + 2] = Math.max(0, 255 - heat);
    diff[offset + 3] = 255;
  }

  const outputPath = options.outputPath ?? await defaultDiffPath(referencePath, candidatePath);
  await mkdir(dirname(outputPath), { recursive: true });
  const info = await sharp(diff, {
    raw: { width: compareSize.width, height: compareSize.height, channels: 4 },
  }).png().toFile(outputPath);

  return {
    referencePath,
    candidatePath,
    diffPath: outputPath,
    diffMimeType: "image/png",
    referenceWidth: referenceMeta.width,
    referenceHeight: referenceMeta.height,
    candidateWidth: candidateMeta.width,
    candidateHeight: candidateMeta.height,
    compareWidth: compareSize.width,
    compareHeight: compareSize.height,
    meanAbsoluteError: roundMetric(absoluteSum / (pixelCount * 3 * 255)),
    rootMeanSquareError: roundMetric(Math.sqrt(squareSum / (pixelCount * 3)) / 255),
    mismatchRatio: roundMetric(mismatchPixels / pixelCount),
    maxChannelDelta,
    aspectRatioDelta: roundMetric(Math.abs((referenceMeta.width / referenceMeta.height) - (candidateMeta.width / candidateMeta.height))),
    threshold,
    size: info.size,
  };
}

export function verdictForImageComparison(result: Pick<CompareImagesResult, "meanAbsoluteError" | "mismatchRatio">): "close" | "needs review" | "different" {
  return result.meanAbsoluteError <= 0.03 && result.mismatchRatio <= 0.1
    ? "close"
    : result.meanAbsoluteError <= 0.12 && result.mismatchRatio <= 0.35
      ? "needs review"
      : "different";
}

async function normalizedRaw(filePath: string, width: number, height: number): Promise<Buffer> {
  return await sharp(filePath, { failOn: "warning" })
    .rotate()
    .ensureAlpha()
    .resize({ width, height, fit: "fill" })
    .raw()
    .toBuffer();
}

function boundedCompareSize(width: number, height: number, maxWidth?: number, maxHeight?: number): { width: number; height: number } {
  const boundedMaxWidth = clampInteger(maxWidth, 1024, 1, 4096);
  const boundedMaxHeight = clampInteger(maxHeight, 1024, 1, 4096);
  const scale = Math.min(1, boundedMaxWidth / width, boundedMaxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function roundMetric(value: number): number {
  return Number.parseFloat(value.toFixed(6));
}

async function defaultDiffPath(referencePath: string, candidatePath: string): Promise<string> {
  const dir = join(tmpdir(), "oh-my-unity", "comparisons");
  await mkdir(dir, { recursive: true });
  const refStem = safeStem(referencePath);
  const candidateStem = safeStem(candidatePath);
  return join(dir, `diff-${refStem}-vs-${candidateStem}-${Date.now()}.png`);
}

function safeStem(filePath: string): string {
  return basename(filePath, extname(filePath)).replace(/[^a-zA-Z0-9._-]+/g, "_") || "image";
}
