import sharp from "sharp";
import { basename, extname } from "node:path";
import type { PlanningIntent } from "./_planning_intent";
import { validatePlanningIntent, type PlanningIntentValidation } from "./_planning_intent";
import { guessMimeType } from "./_materials";

export interface ImageIntentWithAssetOptions {
  screenName?: string;
  referenceWidth?: number;
  clientHintId?: string;
  assetPath?: string;
  assetDir?: string;
}

export interface ImportImageAssetRequest {
  sourcePath: string;
  assetPath: string;
  importAsSprite: boolean;
}

export interface ImportImageAssetResult {
  sourcePath?: string;
  assetPath: string;
  importedAsSprite?: boolean;
  assetType?: string;
}

export type ImageAssetImporter = (request: ImportImageAssetRequest) => Promise<ImportImageAssetResult>;

export interface CreateImageScreenResult {
  screenId: string;
  elements: Array<{ clientHintId?: string; elementId: string }>;
}

export type ImageScreenCreator = (intent: PlanningIntent) => Promise<CreateImageScreenResult>;

export interface PreparedImageUiDraft {
  intent: PlanningIntent;
  source: {
    path: string;
    width: number;
    height: number;
    format?: string;
    mimeType: string;
  };
  importedAsset: {
    sourcePath: string;
    assetPath: string;
    importedAsSprite?: boolean;
    assetType?: string;
  };
  warnings: string[];
}

export interface CreatedImageReferenceScreen extends PreparedImageUiDraft {
  created: CreateImageScreenResult;
  validation: PlanningIntentValidation;
}

export async function prepareImageIntentWithAsset(
  filePath: string,
  options: ImageIntentWithAssetOptions,
  importer: ImageAssetImporter,
): Promise<PreparedImageUiDraft> {
  const metadata = await sharp(filePath, { failOn: "warning" }).metadata();
  if (metadata.width === undefined || metadata.height === undefined) {
    throw new Error(`prepare_image_ui_draft: cannot read image dimensions for "${filePath}"`);
  }

  const assetPath = options.assetPath !== undefined && options.assetPath.trim().length > 0
    ? normalizeAssetPath(options.assetPath)
    : `${normalizeAssetDir(options.assetDir ?? "Assets/UOS/Imported")}/${safeFileName(basename(filePath))}`;
  const imported = await importer({
    sourcePath: filePath,
    assetPath,
    importAsSprite: true,
  });

  const referenceWidth = clampInt(options.referenceWidth, metadata.width, 1, 8192);
  const referenceHeight = Math.max(1, Math.round(referenceWidth * (metadata.height / metadata.width)));
  const intent: PlanningIntent = {
    version: "1.0.0",
    screenName: options.screenName?.trim() || defaultScreenName(filePath),
    referenceCanvas: {
      width: referenceWidth,
      height: referenceHeight,
    },
    elements: [{
      clientHintId: safeHint(options.clientHintId ?? "reference_image"),
      type: "Image",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      anchor: "TopLeft",
      props: { sprite: imported.assetPath },
    }],
  };

  const validation = validatePlanningIntent(intent);
  const warnings = [...validation.warnings];
  if (!validation.ok) {
    warnings.push(...validation.errors.map((error) => `draft validation: ${error}`));
  }

  return {
    intent,
    source: {
      path: filePath,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      mimeType: guessMimeType(extname(filePath)),
    },
    importedAsset: {
      sourcePath: imported.sourcePath ?? filePath,
      assetPath: imported.assetPath,
      importedAsSprite: imported.importedAsSprite,
      assetType: imported.assetType,
    },
    warnings,
  };
}

export async function createImageReferenceScreenWithAsset(
  filePath: string,
  options: ImageIntentWithAssetOptions,
  importer: ImageAssetImporter,
  creator: ImageScreenCreator,
): Promise<CreatedImageReferenceScreen> {
  const prepared = await prepareImageIntentWithAsset(filePath, options, importer);
  const validation = validatePlanningIntent(prepared.intent);
  if (!validation.ok) {
    throw new Error(`create_image_reference_screen: draft validation failed: ${validation.errors.join("; ")}`);
  }
  const created = await creator(prepared.intent);
  return {
    ...prepared,
    created,
    validation,
    warnings: [...prepared.warnings, ...validation.warnings],
  };
}

export function formatImageIntentDraft(prepared: PreparedImageUiDraft): string {
  const lines = [
    `Draft PlanningIntent from ${prepared.source.path}`,
    `sourceImage: ${prepared.source.width}x${prepared.source.height}${prepared.source.format ? ` ${prepared.source.format}` : ""}`,
    `screenName: ${prepared.intent.screenName}`,
    `referenceCanvas: ${prepared.intent.referenceCanvas.width}x${prepared.intent.referenceCanvas.height}`,
    `spriteAsset: ${prepared.importedAsset.assetPath}`,
    `elements: ${prepared.intent.elements.length}`,
  ];
  if (prepared.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of prepared.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push("PlanningIntent JSON:");
  lines.push(JSON.stringify(prepared.intent, null, 2));
  return lines.join("\n");
}

export function formatCreatedImageReferenceScreen(created: CreatedImageReferenceScreen): string {
  const mappingRows = created.created.elements
    .map((pair, index) => `| ${index + 1} | ${pair.clientHintId ?? "(none)"} | ${pair.elementId} |`)
    .join("\n");
  const mappingTable = created.created.elements.length > 0
    ? `\n\n| # | clientHintId | elementId |\n|---|---|---|\n${mappingRows}`
    : "";
  const warningText = created.warnings.length > 0
    ? `\n\nWarnings:\n${created.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  return [
    `Created image reference screen "${created.intent.screenName}" (id=${created.created.screenId}).`,
    `Imported sprite: ${created.importedAsset.assetPath}`,
    `Source image: ${created.source.width}x${created.source.height}${created.source.format ? ` ${created.source.format}` : ""}`,
    `Reference canvas: ${created.intent.referenceCanvas.width}x${created.intent.referenceCanvas.height}`,
  ].join("\n") + mappingTable + warningText;
}

function normalizeAssetDir(value: string): string {
  let dir = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (dir.length === 0) dir = "Assets/UOS/Imported";
  if (!dir.startsWith("Assets/") && dir !== "Assets") dir = `Assets/${dir.replace(/^\/+/, "")}`;
  return dir;
}

function normalizeAssetPath(value: string): string {
  const path = value.trim().replace(/\\/g, "/");
  if (path.length === 0) throw new Error("prepare_image_ui_draft: assetPath is empty");
  if (!path.startsWith("Assets/")) {
    throw new Error(`prepare_image_ui_draft: assetPath must be under Assets/: ${value}`);
  }
  return path;
}

function defaultScreenName(filePath: string): string {
  const stem = basename(filePath, extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
  return stem.length > 0 ? `${stem}ImageScreen` : "ImageScreen";
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "image.png";
}

function safeHint(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "reference_image";
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
