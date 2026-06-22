import { basename, extname } from "node:path";
import type { EmbeddedImage } from "./_embedded_images";
import { extractEmbeddedImages } from "./_embedded_images";
import {
  draftPlanningIntentFromPptxLayout,
  type DraftAssetMapEntry,
  type PptxIntentDraft,
} from "./_intent_draft";
import { validatePlanningIntent, type PlanningIntentValidation } from "./_planning_intent";
import { extractPptxLayout } from "./_pptx_layout";

export interface ImportedPptxAsset {
  clientHintId?: string;
  mediaPath: string;
  packagePath: string;
  sourcePath: string;
  assetPath: string;
  importedAsSprite?: boolean;
  assetType?: string;
}

export interface PptxIntentWithAssetsOptions {
  slideNumber?: number;
  screenName?: string;
  referenceWidth?: number;
  includeImagePlaceholders?: boolean;
  includeShapePanels?: boolean;
  embeddedOutputDir?: string;
  assetDir?: string;
  maxImages?: number;
}

export interface ImportPptxAssetRequest {
  sourcePath: string;
  assetPath: string;
  importAsSprite: true;
  mediaPath: string;
  packagePath: string;
}

export interface ImportPptxAssetResult {
  assetPath: string;
  importedAsSprite?: boolean;
  assetType?: string;
}

export type PptxAssetImporter = (request: ImportPptxAssetRequest) => Promise<ImportPptxAssetResult>;

export interface CreatePptxScreenResult {
  screenId: string;
  elements: Array<{ clientHintId?: string; elementId: string }>;
}

export type PptxScreenCreator = (intent: PptxIntentDraft["intent"]) => Promise<CreatePptxScreenResult>;

export interface PptxIntentWithAssets {
  draft: PptxIntentDraft;
  importedAssets: ImportedPptxAsset[];
  assetMap: DraftAssetMapEntry[];
  embeddedImages: EmbeddedImage[];
  warnings: string[];
}

export interface PptxScreenWithAssets extends PptxIntentWithAssets {
  created: CreatePptxScreenResult;
  validation: PlanningIntentValidation;
}

export interface CreatePptxDeckScreensOptions extends PptxIntentWithAssetsOptions {
  slideNumbers?: number[];
  firstSlide?: number;
  lastSlide?: number;
  maxSlides?: number;
  screenNamePrefix?: string;
  createTransitions?: boolean;
  transitionTriggerPrefix?: string;
  activateFirst?: boolean;
}

export interface PptxDeckScreenSource {
  tool: "create_pptx_deck_screens";
  kind: "pptx";
  mode: "editable";
  path: string;
  slideNumber: number;
  assetPaths?: string[];
}

export interface PptxDeckScreenWithAssets extends PptxScreenWithAssets {
  slideNumber: number;
  screenName: string;
  screenId: string;
  source: PptxDeckScreenSource;
}

export interface CreatePptxDeckTransitionRequest {
  fromId: string;
  toId: string;
  trigger: string;
}

export interface CreatePptxDeckTransitionResult {
  ok?: boolean;
  fromId?: string;
  toId?: string;
  trigger?: string;
}

export type PptxDeckTransitionCreator = (
  request: CreatePptxDeckTransitionRequest,
) => Promise<CreatePptxDeckTransitionResult>;

export type PptxDeckActiveScreenSetter = (
  screenId: string,
) => Promise<{ screenId?: string; active?: boolean; ok?: boolean }>;

export interface PptxDeckTransition {
  fromId: string;
  toId: string;
  trigger: string;
  ok?: boolean;
}

export interface PptxDeckScreensWithAssets {
  path: string;
  slideNumbers: number[];
  screens: PptxDeckScreenWithAssets[];
  transitions: PptxDeckTransition[];
  activeScreenId?: string;
  warnings: string[];
}

export async function preparePptxIntentWithAssets(
  filePath: string,
  options: PptxIntentWithAssetsOptions,
  importer: PptxAssetImporter,
): Promise<PptxIntentWithAssets> {
  const layout = await extractPptxLayout(filePath, {
    pages: options.slideNumber !== undefined ? [options.slideNumber] : undefined,
  });
  const embedded = await extractEmbeddedImages(filePath, {
    outputDir: options.embeddedOutputDir,
    maxImages: options.maxImages,
  });

  const slide = layout.slides[0];
  const warnings: string[] = [];
  const importedAssets: ImportedPptxAsset[] = [];
  const assetMap: DraftAssetMapEntry[] = [];
  const assetDir = normalizeAssetDir(options.assetDir ?? "Assets/UOS/Imported");

  for (const item of slide?.items ?? []) {
    if (item.kind !== "picture" || item.mediaPath === undefined) continue;
    const embeddedImage = embedded.images.find((image) => normalizePackagePath(image.packagePath) === normalizePackagePath(item.mediaPath));
    if (embeddedImage === undefined) {
      warnings.push(`slide ${slide.slideNumber} picture "${item.name ?? item.mediaPath}" did not match an extracted image`);
      continue;
    }

    const assetPath = `${assetDir}/${safeAssetStem(filePath)}-slide${slide.slideNumber}-${safeFileName(basename(embeddedImage.packagePath))}`;
    const imported = await importer({
      sourcePath: embeddedImage.path,
      assetPath,
      importAsSprite: true,
      mediaPath: item.mediaPath,
      packagePath: embeddedImage.packagePath,
    });
    const record = {
      mediaPath: item.mediaPath,
      packagePath: embeddedImage.packagePath,
      sourcePath: embeddedImage.path,
      assetPath: imported.assetPath,
      importedAsSprite: imported.importedAsSprite,
      assetType: imported.assetType,
    };
    importedAssets.push(record);
    assetMap.push({
      mediaPath: item.mediaPath,
      packagePath: embeddedImage.packagePath,
      assetPath: imported.assetPath,
    });
  }

  const draft = draftPlanningIntentFromPptxLayout(layout, {
    slideNumber: options.slideNumber,
    screenName: options.screenName,
    referenceWidth: options.referenceWidth,
    includeImagePlaceholders: options.includeImagePlaceholders,
    includeShapePanels: options.includeShapePanels,
    embeddedImages: embedded.images,
    assetMap,
  });
  warnings.push(...draft.warnings);

  return {
    draft: { ...draft, warnings },
    importedAssets,
    assetMap,
    embeddedImages: embedded.images,
    warnings,
  };
}

export async function createPptxScreenWithAssets(
  filePath: string,
  options: PptxIntentWithAssetsOptions,
  importer: PptxAssetImporter,
  creator: PptxScreenCreator,
): Promise<PptxScreenWithAssets> {
  const prepared = await preparePptxIntentWithAssets(filePath, options, importer);
  const validation = validatePlanningIntent(prepared.draft.intent);
  if (!validation.ok) {
    throw new Error(`create_pptx_slide_screen: draft validation failed: ${validation.errors.join("; ")}`);
  }
  const created = await creator(prepared.draft.intent);
  return {
    ...prepared,
    created,
    validation,
    warnings: [...prepared.warnings, ...validation.warnings],
    draft: {
      ...prepared.draft,
      warnings: [...prepared.draft.warnings, ...validation.warnings],
    },
  };
}

export async function createPptxDeckScreensWithAssets(
  filePath: string,
  options: CreatePptxDeckScreensOptions,
  importer: PptxAssetImporter,
  creator: PptxScreenCreator,
  transitionCreator?: PptxDeckTransitionCreator,
  activeSetter?: PptxDeckActiveScreenSetter,
): Promise<PptxDeckScreensWithAssets> {
  const layout = await extractPptxLayout(filePath);
  const selection = selectDeckSlideNumbers(layout.slides.map((slide) => slide.slideNumber), options);
  const screens: PptxDeckScreenWithAssets[] = [];
  const warnings = [...selection.warnings];

  for (const slideNumber of selection.slideNumbers) {
    const created = await createPptxScreenWithAssets(
      filePath,
      {
        slideNumber,
        screenName: screenNameForDeckSlide(options, slideNumber, selection.slideNumbers.length),
        referenceWidth: options.referenceWidth,
        includeImagePlaceholders: options.includeImagePlaceholders,
        includeShapePanels: options.includeShapePanels,
        embeddedOutputDir: options.embeddedOutputDir,
        assetDir: options.assetDir,
        maxImages: options.maxImages,
      },
      importer,
      creator,
    );
    const assetPaths = uniqueStrings(created.importedAssets.map((asset) => asset.assetPath));
    screens.push({
      ...created,
      slideNumber: created.draft.source.slideNumber,
      screenName: created.draft.intent.screenName,
      screenId: created.created.screenId,
      source: {
        tool: "create_pptx_deck_screens",
        kind: "pptx",
        mode: "editable",
        path: filePath,
        slideNumber: created.draft.source.slideNumber,
        ...(assetPaths.length > 0 ? { assetPaths } : {}),
      },
    });
    warnings.push(...created.warnings);
  }

  const transitions: PptxDeckTransition[] = [];
  if (options.createTransitions === true && screens.length > 1) {
    if (transitionCreator === undefined) {
      throw new Error("create_pptx_deck_screens: transition creator is required when createTransitions is true");
    }
    const triggerPrefix = nonBlank(options.transitionTriggerPrefix) ?? "next-slide";
    for (let index = 0; index < screens.length - 1; index++) {
      const from = screens[index];
      const to = screens[index + 1];
      const request = {
        fromId: from.screenId,
        toId: to.screenId,
        trigger: `${triggerPrefix}-${from.slideNumber}`,
      };
      const transition = await transitionCreator(request);
      transitions.push({
        fromId: transition.fromId ?? request.fromId,
        toId: transition.toId ?? request.toId,
        trigger: transition.trigger ?? request.trigger,
        ok: transition.ok,
      });
    }
  }

  let activeScreenId: string | undefined;
  if (options.activateFirst === true && screens.length > 0) {
    if (activeSetter === undefined) {
      throw new Error("create_pptx_deck_screens: active screen setter is required when activateFirst is true");
    }
    const activated = await activeSetter(screens[0].screenId);
    activeScreenId = activated.screenId ?? screens[0].screenId;
  }

  return {
    path: filePath,
    slideNumbers: selection.slideNumbers,
    screens,
    transitions,
    activeScreenId,
    warnings: uniqueStrings(warnings),
  };
}

export function formatCreatedPptxScreen(created: PptxScreenWithAssets): string {
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
    `Created PPTX slide screen "${created.draft.intent.screenName}" (id=${created.created.screenId}).`,
    `Source: ${created.draft.source.path} slide ${created.draft.source.slideNumber}`,
    `Imported sprites: ${created.importedAssets.length}`,
    `Reference canvas: ${created.draft.intent.referenceCanvas.width}x${created.draft.intent.referenceCanvas.height}`,
  ].join("\n") + mappingTable + warningText;
}

export function formatCreatedPptxDeckScreens(created: PptxDeckScreensWithAssets): string {
  const screenRows = created.screens
    .map((screen) =>
      `| ${screen.slideNumber} | ${screen.screenName} | ${screen.screenId} | ${screen.importedAssets.length} | ${screen.created.elements.length} |`)
    .join("\n");
  const screenTable = screenRows.length > 0
    ? `\n\n| slide | screenName | screenId | sprites | elements |\n|---|---|---|---:|---:|\n${screenRows}`
    : "";
  const transitionText = created.transitions.length > 0
    ? `\n\nTransitions:\n${created.transitions.map((transition) => `- ${transition.fromId} -> ${transition.toId} (${transition.trigger})`).join("\n")}`
    : "";
  const activeText = created.activeScreenId !== undefined
    ? `\n\nActive screen: ${created.activeScreenId}`
    : "";
  const warningText = created.warnings.length > 0
    ? `\n\nWarnings:\n${created.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  return [
    `Created ${created.screens.length} PPTX deck screen(s).`,
    `Source: ${created.path}`,
    `Slides: ${created.slideNumbers.join(", ")}`,
  ].join("\n") + screenTable + transitionText + activeText + warningText;
}

function selectDeckSlideNumbers(
  availableSlideNumbers: number[],
  options: CreatePptxDeckScreensOptions,
): { slideNumbers: number[]; warnings: string[] } {
  if (availableSlideNumbers.length === 0) {
    throw new Error("create_pptx_deck_screens: no slides found in PPTX");
  }
  const available = new Set(availableSlideNumbers);
  const warnings: string[] = [];
  let selected: number[];

  if (options.slideNumbers !== undefined && options.slideNumbers.length > 0) {
    const requested = uniqueNumbers(options.slideNumbers.map((value) => Math.trunc(value)).filter((value) => value > 0));
    selected = requested.filter((slideNumber) => available.has(slideNumber));
    const missing = requested.filter((slideNumber) => !available.has(slideNumber));
    if (missing.length > 0) {
      warnings.push(`requested slide(s) not found and skipped: ${missing.join(", ")}`);
    }
  } else {
    const first = positiveInt(options.firstSlide);
    const last = positiveInt(options.lastSlide);
    selected = availableSlideNumbers.filter((slideNumber) =>
      (first === undefined || slideNumber >= first) &&
      (last === undefined || slideNumber <= last)
    );
  }

  const maxSlides = clampInt(options.maxSlides, 20, 1, 200);
  if (selected.length > maxSlides) {
    warnings.push(`selected ${selected.length} slide(s); truncated to maxSlides=${maxSlides}`);
    selected = selected.slice(0, maxSlides);
  }
  if (selected.length === 0) {
    throw new Error("create_pptx_deck_screens: no matching slides selected");
  }
  return { slideNumbers: selected, warnings };
}

function screenNameForDeckSlide(
  options: CreatePptxDeckScreensOptions,
  slideNumber: number,
  selectedCount: number,
): string | undefined {
  const prefix = nonBlank(options.screenNamePrefix);
  if (prefix !== undefined) return `${prefix} Slide ${slideNumber}`;
  const screenName = nonBlank(options.screenName);
  if (screenName === undefined) return undefined;
  return selectedCount === 1 ? screenName : `${screenName} Slide ${slideNumber}`;
}

function normalizeAssetDir(value: string): string {
  let dir = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (dir.length === 0) dir = "Assets/UOS/Imported";
  if (!dir.startsWith("Assets/") && dir !== "Assets") dir = `Assets/${dir.replace(/^\/+/, "")}`;
  return dir;
}

function normalizePackagePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeAssetStem(filePath: string): string {
  return safeFileName(basename(filePath, extname(filePath)));
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "asset";
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function positiveInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined && value.length > 0))];
}
