import { basename, extname } from "node:path";
import {
  createPreparedDocumentScreen,
  formatCreatedDocumentScreen,
  prepareDocumentScreenDraft,
  type CreatedDocumentScreen,
  type DocumentScreenCreator,
} from "./_document_screen";
import type {
  CreateImageScreenResult,
  ImageAssetImporter,
} from "./_image_intent_assets";
import {
  createReferenceScreenFromMaterial,
  formatCreatedMaterialReferenceScreen,
  type CreatedMaterialReferenceScreen,
  type MaterialReferenceKind,
  type MaterialReferenceScreenOptions,
} from "./_material_reference_screen";
import type { PptxAssetImporter } from "./_pptx_intent_assets";
import { validatePlanningIntent, type PlanningIntent } from "./_planning_intent";

export type MaterialScreenKind = MaterialReferenceKind | "document" | "video";
export type MaterialScreenMode = "auto" | "editable" | "reference";

export interface MaterialScreenOptions extends MaterialReferenceScreenOptions {
  kind?: MaterialScreenKind;
  mode?: MaterialScreenMode;
  referenceHeight?: number;
  maxTextElements?: number;
  includeBackground?: boolean;
  includeButtons?: boolean;
}

export interface CreatedMaterialScreen {
  kind: MaterialScreenKind;
  mode: Exclude<MaterialScreenMode, "auto">;
  path: string;
  intent: PlanningIntent;
  created: { screenId: string; elements: Array<{ clientHintId?: string; elementId: string }> };
  source: {
    tool: "create_screen_from_material";
    kind: string;
    mode: Exclude<MaterialScreenMode, "auto">;
    path: string;
    pageNumber?: number;
    slideNumber?: number;
    imageNumber?: number;
    packagePath?: string;
    renderedPath?: string;
    extractedPath?: string;
    assetPaths?: string[];
  };
  importedAsset?: CreatedMaterialReferenceScreen["importedAsset"];
  importedAssets?: CreatedMaterialReferenceScreen["importedAssets"];
  warnings: string[];
  validation: CreatedMaterialReferenceScreen["validation"] | CreatedDocumentScreen["validation"];
  specific: CreatedMaterialReferenceScreen | CreatedDocumentScreen;
}

export async function createScreenFromMaterial(
  filePath: string,
  options: MaterialScreenOptions,
  imageImporter: ImageAssetImporter,
  pptxImporter: PptxAssetImporter,
  creator: DocumentScreenCreator,
): Promise<CreatedMaterialScreen> {
  const kind = options.kind ?? inferMaterialScreenKind(filePath);
  const mode = resolveMode(kind, options.mode);
  if (kind === "video") {
    return createVideoRoute(filePath, options, imageImporter, creator);
  }
  if (mode === "editable" && isDocumentKind(kind)) {
    const documentOptions = {
      screenName: options.screenName,
      referenceWidth: options.referenceWidth,
      referenceHeight: options.referenceHeight,
      maxTextElements: options.maxTextElements,
      includeBackground: options.includeBackground,
      includeButtons: options.includeButtons,
    };
    let prepared;
    try {
      prepared = await prepareDocumentScreenDraft(filePath, documentOptions);
    } catch (err) {
      if (!shouldFallbackToReference(kind, options.mode, err)) throw err;
      const routed = await createReferenceRoute(
        kind,
        "reference",
        filePath,
        options,
        imageImporter,
        pptxImporter,
        creator,
      );
      const message = err instanceof Error ? err.message : String(err);
      routed.warnings = [
        `auto editable document route failed (${message}); fell back to reference mode.`,
        ...routed.warnings,
      ];
      return routed;
    }

    const created = await createPreparedDocumentScreen(prepared, creator);
    return fromDocument(kind, filePath, created);
  }

  if (mode === "reference" && kind === "document") {
    throw new Error(`create_screen_from_material: reference mode is not available for text-only document "${basename(filePath)}"`);
  }

  return createReferenceRoute(
    kind,
    mode,
    filePath,
    options,
    imageImporter,
    pptxImporter,
    creator,
  );
}

async function createVideoRoute(
  filePath: string,
  options: MaterialScreenOptions,
  importer: ImageAssetImporter,
  creator: DocumentScreenCreator,
): Promise<CreatedMaterialScreen> {
  const assetPath = options.assetPath !== undefined && options.assetPath.trim().length > 0
    ? normalizeAssetPath(options.assetPath)
    : `${normalizeAssetDir(options.assetDir ?? "Assets/UOS/Videos")}/${safeFileName(basename(filePath))}`;
  const imported = await importer({
    sourcePath: filePath,
    assetPath,
    importAsSprite: false,
  });
  const referenceWidth = clampInt(options.referenceWidth, 1920, 1, 8192);
  const referenceHeight = clampInt(options.referenceHeight, Math.round(referenceWidth * 9 / 16), 1, 8192);
  const intent: PlanningIntent = {
    version: "1.0.0",
    screenName: options.screenName?.trim() || defaultVideoScreenName(filePath),
    referenceCanvas: {
      width: referenceWidth,
      height: referenceHeight,
    },
    elements: [{
      clientHintId: safeHint(options.clientHintId ?? "content_video"),
      type: "Video",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      props: {
        video: imported.assetPath,
        playOnAwake: false,
        loop: false,
        muted: false,
      },
    }],
  };
  const validation = validatePlanningIntent(intent);
  if (!validation.ok) {
    throw new Error(`create_screen_from_material: generated video PlanningIntent failed validation: ${validation.errors.join("; ")}`);
  }
  const created = await creator(intent);
  return {
    kind: "video",
    mode: "editable",
    path: filePath,
    intent,
    created,
    source: {
      tool: "create_screen_from_material",
      kind: "video",
      mode: "editable",
      path: filePath,
      assetPaths: [imported.assetPath],
    },
    importedAsset: {
      sourcePath: imported.sourcePath ?? filePath,
      assetPath: imported.assetPath,
      importedAsSprite: imported.importedAsSprite,
      assetType: imported.assetType,
    },
    warnings: [
      "Video content is not semantically analyzed; UOS uses the filename and file metadata only.",
      ...validation.warnings,
    ],
    validation,
    specific: {
      kind: "video",
      mode: "editable",
      path: filePath,
      intent,
      created,
      source: {
        tool: "create_screen_from_material",
        kind: "video",
        mode: "editable",
        path: filePath,
        assetPaths: [imported.assetPath],
      },
      importedAsset: imported,
      importedAssets: [imported],
      warnings: validation.warnings,
      validation,
    } as any,
  };
}

async function createReferenceRoute(
  kind: MaterialScreenKind,
  mode: Exclude<MaterialScreenMode, "auto">,
  filePath: string,
  options: MaterialScreenOptions,
  imageImporter: ImageAssetImporter,
  pptxImporter: PptxAssetImporter,
  creator: DocumentScreenCreator,
): Promise<CreatedMaterialScreen> {
  const referenceKind = kind === "document" ? inferReferenceKind(filePath) : kind;
  const created = await createReferenceScreenFromMaterial(
    filePath,
    {
      ...options,
      kind: referenceKind,
      pptxMode: kind === "pptx" ? options.pptxMode ?? "editable" : options.pptxMode,
    },
    imageImporter,
    pptxImporter,
    creator as (intent: PlanningIntent) => Promise<CreateImageScreenResult>,
  );
  return fromReference(kind, mode, filePath, created);
}

export function formatCreatedMaterialScreen(created: CreatedMaterialScreen): string {
  const header = `Screen material route: ${created.kind} ${created.mode} ${created.path}`;
  if (isDocumentResult(created.specific)) {
    return `${header}\n\n${formatCreatedDocumentScreen(created.specific)}`;
  }
  return `${header}\n\n${formatCreatedMaterialReferenceScreen(created.specific)}`;
}

function fromDocument(
  kind: MaterialScreenKind,
  filePath: string,
  created: CreatedDocumentScreen,
): CreatedMaterialScreen {
  return {
    kind,
    mode: "editable",
    path: filePath,
    intent: created.draft.intent,
    created: created.created,
    source: {
      tool: "create_screen_from_material",
      kind: created.source.kind,
      mode: "editable",
      path: created.source.path,
    },
    warnings: created.warnings,
    validation: created.validation,
    specific: created,
  };
}

function fromReference(
  kind: MaterialScreenKind,
  mode: Exclude<MaterialScreenMode, "auto">,
  filePath: string,
  created: CreatedMaterialReferenceScreen,
): CreatedMaterialScreen {
  const source = sourceFromReference(created, kind, mode, filePath);
  return {
    kind,
    mode,
    path: filePath,
    intent: created.intent,
    created: created.created,
    source,
    importedAsset: created.importedAsset,
    importedAssets: created.importedAssets,
    warnings: created.warnings,
    validation: created.validation,
    specific: created,
  };
}

function sourceFromReference(
  created: CreatedMaterialReferenceScreen,
  kind: MaterialScreenKind,
  mode: Exclude<MaterialScreenMode, "auto">,
  filePath: string,
): CreatedMaterialScreen["source"] {
  const specific = created.specific as any;
  return {
    tool: "create_screen_from_material",
    kind: created.kind,
    mode,
    path: filePath,
    pageNumber: numberValue(specific?.pdf?.pageNumber),
    slideNumber: numberValue(specific?.draft?.source?.slideNumber ?? specific?.pptx?.slideNumber),
    imageNumber: numberValue(specific?.docx?.imageNumber),
    packagePath: firstString(specific?.docx?.packagePath, specific?.embeddedImage?.packagePath),
    renderedPath: firstString(specific?.renderedPage?.path, specific?.renderedSlide?.path),
    extractedPath: firstString(specific?.embeddedImage?.path),
    assetPaths: referenceAssetPaths(created),
  };
}

function referenceAssetPaths(created: CreatedMaterialReferenceScreen): string[] | undefined {
  const paths = [
    created.importedAsset?.assetPath,
    ...(created.importedAssets?.map((asset) => asset.assetPath) ?? []),
  ].filter((path): path is string => typeof path === "string" && path.length > 0);
  const unique = [...new Set(paths)];
  return unique.length > 0 ? unique : undefined;
}

function inferMaterialScreenKind(filePath: string): MaterialScreenKind {
  const ext = extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".pptx") return "pptx";
  if ([".txt", ".md", ".markdown", ".csv", ".json"].includes(ext)) return "document";
  throw new Error(`create_screen_from_material: unsupported material type for "${basename(filePath)}"`);
}

function inferReferenceKind(filePath: string): MaterialReferenceKind {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".pptx") return "pptx";
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  throw new Error(`create_screen_from_material: reference mode is not available for "${basename(filePath)}"`);
}

function resolveMode(kind: MaterialScreenKind, requested: MaterialScreenMode | undefined): Exclude<MaterialScreenMode, "auto"> {
  if (kind === "video") return "editable";
  if (requested === "editable") {
    if (kind === "image") return "reference";
    return "editable";
  }
  if (requested === "reference") return "reference";
  if (kind === "image") return "reference";
  if (kind === "pptx") return "editable";
  return "editable";
}

function isDocumentKind(kind: MaterialScreenKind): boolean {
  return kind === "document" || kind === "pdf" || kind === "docx";
}

function shouldFallbackToReference(kind: MaterialScreenKind, requested: MaterialScreenMode | undefined, err: unknown): boolean {
  if (requested !== undefined && requested !== "auto") return false;
  if (kind !== "pdf" && kind !== "docx") return false;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("text extraction failed") || message.includes("no extractable text");
}

function isDocumentResult(value: unknown): value is CreatedDocumentScreen {
  return typeof value === "object" && value !== null && "draft" in value && "extractedText" in value;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAssetPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("Assets/") ? normalized : `Assets/${normalized}`;
}

function normalizeAssetDir(value: string): string {
  return normalizeAssetPath(value).replace(/\/+$/, "");
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim() || "video.mp4";
}

function defaultVideoScreenName(filePath: string): string {
  const stem = basename(filePath, extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
  return `${stem.length > 0 ? stem : "Video"}Screen`;
}

function safeHint(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : "content_video";
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
