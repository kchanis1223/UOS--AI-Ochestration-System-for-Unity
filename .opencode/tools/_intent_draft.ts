import { basename, extname } from "node:path";
import type { PlanningIntent } from "./_planning_intent";
import type { PptxLayout, PptxLayoutItem, PptxSlideLayout } from "./_pptx_layout";
import { validatePlanningIntent } from "./_planning_intent";

export interface DraftEmbeddedImage {
  packagePath: string;
  path: string;
  filename?: string;
}

export interface DraftAssetMapEntry {
  clientHintId?: string;
  mediaPath?: string;
  packagePath?: string;
  assetPath: string;
}

export interface PptxIntentDraftOptions {
  slideNumber?: number;
  screenName?: string;
  referenceWidth?: number;
  includeImagePlaceholders?: boolean;
  includeShapePanels?: boolean;
  embeddedImages?: DraftEmbeddedImage[];
  assetMap?: DraftAssetMapEntry[];
}

export interface PptxIntentDraft {
  intent: PlanningIntent;
  source: {
    path: string;
    slideNumber: number;
    slideWidthEmu: number;
    slideHeightEmu: number;
  };
  mediaHints: Array<{
    clientHintId: string;
    mediaPath?: string;
    relationshipId?: string;
    sourcePath?: string;
    suggestedAssetPath?: string;
    assetPath?: string;
    note: string;
  }>;
  warnings: string[];
}

export function draftPlanningIntentFromPptxLayout(
  layout: PptxLayout,
  options: PptxIntentDraftOptions = {},
): PptxIntentDraft {
  const slide = selectSlide(layout, options.slideNumber);
  const referenceWidth = clampInt(options.referenceWidth, 1920, 320, 8192);
  const referenceHeight = Math.max(1, Math.round(referenceWidth / layout.aspectRatio));
  const includeImagePlaceholders = options.includeImagePlaceholders !== false;
  const includeShapePanels = options.includeShapePanels === true;
  const mediaHints: PptxIntentDraft["mediaHints"] = [];
  const warnings: string[] = [];
  const elements: PlanningIntent["elements"] = [];

  for (const item of slide.items) {
    if (item.rect === undefined) {
      warnings.push(`slide ${slide.slideNumber} item "${item.name ?? item.kind}" has no rect and was skipped`);
      continue;
    }

    const clientHintId = clientHintFor(slide, item, elements.length + 1);
    if (item.kind === "text" && item.text !== undefined && item.text.trim().length > 0) {
      if (item.fillColor !== undefined) {
        elements.push({
          clientHintId: `${clientHintId}_fill`,
          type: "Panel",
          rect: normalizeDraftRect(item.rect),
          anchor: "TopLeft",
          props: { color: item.fillColor },
        });
      }
      elements.push({
        clientHintId,
        type: "Text",
        rect: normalizeDraftRect(item.rect),
        anchor: "TopLeft",
        props: {
          text: item.text.trim(),
          fontSize: fontSizeForRect(item.rect.h, referenceHeight),
          ...(item.fontStyle !== undefined ? { fontStyle: item.fontStyle } : {}),
          ...(item.color !== undefined ? { color: item.color } : {}),
          align: "MiddleCenter",
        },
      });
      continue;
    }

    if (item.kind === "picture") {
      const extracted = findEmbeddedImage(options.embeddedImages, item.mediaPath);
      const assetPath = findAssetPath(options.assetMap, clientHintId, item.mediaPath);
      const suggestedAssetPath = assetPath ?? (
        extracted?.path !== undefined ? `Assets/UOS/Imported/${safeFileName(basename(extracted.path))}` : undefined
      );
      mediaHints.push({
        clientHintId,
        mediaPath: item.mediaPath,
        relationshipId: item.relationshipId,
        sourcePath: extracted?.path,
        suggestedAssetPath,
        assetPath,
        note: assetPath !== undefined
          ? "Sprite asset path was applied to the draft Image element."
          : extracted?.path !== undefined
            ? "Call import_asset with sourcePath and suggestedAssetPath, then rerun draft_planning_intent_from_pptx with assetMap to set props.sprite."
            : "Call extract_embedded_images/import_asset before setting props.sprite if this picture should render as a Unity Sprite.",
      });
      if (includeImagePlaceholders) {
        const element: PlanningIntent["elements"][number] = {
          clientHintId,
          type: "Image",
          rect: normalizeDraftRect(item.rect),
          anchor: "TopLeft",
        };
        if (assetPath !== undefined) element.props = { sprite: assetPath };
        elements.push(element);
      }
      continue;
    }

    if (includeShapePanels) {
      const element: PlanningIntent["elements"][number] = {
        clientHintId,
        type: "Panel",
        rect: normalizeDraftRect(item.rect),
        anchor: "TopLeft",
      };
      if (item.fillColor !== undefined) element.props = { color: item.fillColor };
      elements.push(element);
    }
  }

  const intent: PlanningIntent = {
    version: "1.0.0",
    screenName: options.screenName?.trim() || defaultScreenName(layout.path, slide.slideNumber),
    referenceCanvas: { width: referenceWidth, height: referenceHeight },
    elements,
  };
  const validation = validatePlanningIntent(intent);
  warnings.push(...validation.warnings);
  if (!validation.ok) {
    warnings.push(...validation.errors.map((error) => `draft validation: ${error}`));
  }

  return {
    intent,
    source: {
      path: layout.path,
      slideNumber: slide.slideNumber,
      slideWidthEmu: layout.slideWidthEmu,
      slideHeightEmu: layout.slideHeightEmu,
    },
    mediaHints,
    warnings,
  };
}

export function formatPptxIntentDraft(draft: PptxIntentDraft): string {
  const lines = [
    `Draft PlanningIntent from ${draft.source.path} slide ${draft.source.slideNumber}`,
    `screenName: ${draft.intent.screenName}`,
    `referenceCanvas: ${draft.intent.referenceCanvas.width}x${draft.intent.referenceCanvas.height}`,
    `elements: ${draft.intent.elements.length}`,
  ];
  if (draft.mediaHints.length > 0) {
    lines.push("");
    lines.push("Media hints:");
    for (const hint of draft.mediaHints) {
      const parts = [
        hint.mediaPath ?? "(unknown media)",
        hint.sourcePath !== undefined ? `source=${hint.sourcePath}` : undefined,
        hint.assetPath !== undefined ? `asset=${hint.assetPath}` : undefined,
        hint.suggestedAssetPath !== undefined ? `suggestedAsset=${hint.suggestedAssetPath}` : undefined,
      ].filter((part): part is string => part !== undefined);
      lines.push(`  - ${hint.clientHintId}: ${parts.join(", ")} (${hint.note})`);
    }
  }
  if (draft.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of draft.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push("PlanningIntent JSON:");
  lines.push(JSON.stringify(draft.intent, null, 2));
  return lines.join("\n");
}

function selectSlide(layout: PptxLayout, requested: number | undefined): PptxSlideLayout {
  if (layout.slides.length === 0) {
    throw new Error(`draft_planning_intent_from_pptx: no slides found in "${layout.path}"`);
  }
  if (requested === undefined) return layout.slides[0];
  const slide = layout.slides.find((candidate) => candidate.slideNumber === requested);
  if (slide === undefined) {
    throw new Error(`draft_planning_intent_from_pptx: slide ${requested} was not found in "${layout.path}"`);
  }
  return slide;
}

function clientHintFor(slide: PptxSlideLayout, item: PptxLayoutItem, index: number): string {
  const stem = item.kind === "text" ? "text" : item.kind === "picture" ? "image" : "panel";
  const source = item.name ?? item.id ?? String(index);
  const suffix = source.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || String(index);
  return `slide${slide.slideNumber}_${stem}_${suffix}`;
}

function normalizeDraftRect(rect: { x: number; y: number; w: number; h: number }): PlanningIntent["elements"][number]["rect"] {
  return {
    x: clampMetric(rect.x, 0, 1),
    y: clampMetric(rect.y, 0, 1),
    w: clampMetric(rect.w, 0.001, 1),
    h: clampMetric(rect.h, 0.001, 1),
  };
}

function fontSizeForRect(normalizedHeight: number, referenceHeight: number): number {
  return Math.max(10, Math.min(96, Math.round(normalizedHeight * referenceHeight * 0.45)));
}

function defaultScreenName(filePath: string, slideNumber: number): string {
  const stem = basename(filePath, extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
  return `${stem || "Pptx"}Slide${slideNumber}`;
}

function clampMetric(value: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  return Number.parseFloat(clamped.toFixed(6));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function findEmbeddedImage(images: DraftEmbeddedImage[] | undefined, mediaPath: string | undefined): DraftEmbeddedImage | undefined {
  if (mediaPath === undefined || images === undefined) return undefined;
  return images.find((image) => normalizePackagePath(image.packagePath) === normalizePackagePath(mediaPath));
}

function findAssetPath(entries: DraftAssetMapEntry[] | undefined, clientHintId: string, mediaPath: string | undefined): string | undefined {
  if (entries === undefined) return undefined;
  const normalizedMediaPath = mediaPath !== undefined ? normalizePackagePath(mediaPath) : undefined;
  return entries.find((entry) => {
    if (entry.clientHintId !== undefined && entry.clientHintId === clientHintId) return true;
    const entryMediaPath = entry.mediaPath ?? entry.packagePath;
    return normalizedMediaPath !== undefined &&
      entryMediaPath !== undefined &&
      normalizePackagePath(entryMediaPath) === normalizedMediaPath;
  })?.assetPath;
}

function normalizePackagePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "asset";
}
