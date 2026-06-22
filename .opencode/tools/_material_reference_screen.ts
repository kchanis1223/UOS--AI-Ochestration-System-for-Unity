import { basename, extname } from "node:path";
import {
  createDocxImageReferenceScreen,
  formatCreatedDocxImageReferenceScreen,
  type CreatedDocxImageReferenceScreen,
} from "./_docx_reference_screen";
import {
  createImageReferenceScreenWithAsset,
  formatCreatedImageReferenceScreen,
  type CreatedImageReferenceScreen,
  type ImageAssetImporter,
  type ImageScreenCreator,
} from "./_image_intent_assets";
import {
  createPdfReferenceScreen,
  formatCreatedPdfReferenceScreen,
  type CreatedPdfReferenceScreen,
} from "./_pdf_reference_screen";
import {
  createPptxScreenWithAssets,
  formatCreatedPptxScreen,
  type PptxAssetImporter,
  type PptxScreenWithAssets,
} from "./_pptx_intent_assets";
import type { PlanningIntent } from "./_planning_intent";
import { renderPptxToImages, type RenderResult } from "./_render";

export type MaterialReferenceKind = "image" | "pdf" | "docx" | "pptx";
export type PptxMaterialReferenceMode = "editable" | "rendered";

export interface MaterialReferenceScreenOptions {
  kind?: MaterialReferenceKind;
  screenName?: string;
  referenceWidth?: number;
  clientHintId?: string;
  assetPath?: string;
  assetDir?: string;
  outputDir?: string;
  desiredWidth?: number;
  scale?: number;
  pageNumber?: number;
  imageNumber?: number;
  packagePath?: string;
  slideNumber?: number;
  pptxMode?: PptxMaterialReferenceMode;
  includeImagePlaceholders?: boolean;
  includeShapePanels?: boolean;
  embeddedOutputDir?: string;
  maxImages?: number;
}

export interface CreatedPptxRenderedReferenceScreen extends CreatedImageReferenceScreen {
  pptx: {
    path: string;
    slideNumber: number;
    renderer: string;
    total?: number;
    outputDir: string;
  };
  renderedSlide: {
    path: string;
    pageNumber: number;
    width: number;
    height: number;
    size: number;
  };
}

export interface CreatedMaterialReferenceScreen {
  kind: MaterialReferenceKind;
  pptxMode?: PptxMaterialReferenceMode;
  path: string;
  intent: PlanningIntent;
  created: { screenId: string; elements: Array<{ clientHintId?: string; elementId: string }> };
  importedAsset?: CreatedImageReferenceScreen["importedAsset"];
  importedAssets?: PptxScreenWithAssets["importedAssets"];
  warnings: string[];
  validation: CreatedImageReferenceScreen["validation"] | PptxScreenWithAssets["validation"];
  specific:
    | CreatedImageReferenceScreen
    | CreatedPdfReferenceScreen
    | CreatedDocxImageReferenceScreen
    | PptxScreenWithAssets
    | CreatedPptxRenderedReferenceScreen;
}

export type PptxRenderer = (
  filePath: string,
  options: {
    outputDir?: string;
    desiredWidth?: number;
    scale?: number;
    pages?: number[];
    first?: number;
    last?: number;
  },
) => Promise<RenderResult>;

export async function createReferenceScreenFromMaterial(
  filePath: string,
  options: MaterialReferenceScreenOptions,
  imageImporter: ImageAssetImporter,
  pptxImporter: PptxAssetImporter,
  creator: ImageScreenCreator,
  pptxRenderer: PptxRenderer = renderPptxToImages,
): Promise<CreatedMaterialReferenceScreen> {
  const kind = options.kind ?? inferKind(filePath);
  switch (kind) {
    case "image": {
      const created = await createImageReferenceScreenWithAsset(
        filePath,
        {
          screenName: options.screenName,
          referenceWidth: options.referenceWidth,
          clientHintId: options.clientHintId,
          assetPath: options.assetPath,
          assetDir: options.assetDir,
        },
        imageImporter,
        creator,
      );
      return fromImageLike(kind, filePath, created);
    }
    case "pdf": {
      const created = await createPdfReferenceScreen(
        filePath,
        {
          pageNumber: options.pageNumber,
          screenName: options.screenName,
          referenceWidth: options.referenceWidth,
          clientHintId: options.clientHintId,
          assetPath: options.assetPath,
          assetDir: options.assetDir,
          outputDir: options.outputDir,
          desiredWidth: options.desiredWidth,
          scale: options.scale,
        },
        imageImporter,
        creator,
      );
      return fromImageLike(kind, filePath, created);
    }
    case "docx": {
      const created = await createDocxImageReferenceScreen(
        filePath,
        {
          imageNumber: options.imageNumber,
          packagePath: options.packagePath,
          screenName: options.screenName,
          referenceWidth: options.referenceWidth,
          clientHintId: options.clientHintId,
          assetPath: options.assetPath,
          assetDir: options.assetDir,
          outputDir: options.outputDir,
          maxImages: options.maxImages,
        },
        imageImporter,
        creator,
      );
      return fromImageLike(kind, filePath, created);
    }
    case "pptx": {
      if (options.pptxMode === "rendered") {
        const created = await createPptxRenderedReferenceScreen(
          filePath,
          options,
          imageImporter,
          creator,
          pptxRenderer,
        );
        return {
          kind,
          pptxMode: "rendered",
          path: filePath,
          intent: created.intent,
          created: created.created,
          importedAsset: created.importedAsset,
          warnings: created.warnings,
          validation: created.validation,
          specific: created,
        };
      }
      const created = await createPptxScreenWithAssets(
        filePath,
        {
          slideNumber: options.slideNumber,
          screenName: options.screenName,
          referenceWidth: options.referenceWidth,
          includeImagePlaceholders: options.includeImagePlaceholders,
          includeShapePanels: options.includeShapePanels,
          embeddedOutputDir: options.embeddedOutputDir ?? options.outputDir,
          assetDir: options.assetDir,
          maxImages: options.maxImages,
        },
        pptxImporter,
        creator,
      );
      return {
        kind,
        pptxMode: "editable",
        path: filePath,
        intent: created.draft.intent,
        created: created.created,
        importedAssets: created.importedAssets,
        warnings: created.warnings,
        validation: created.validation,
        specific: created,
      };
    }
  }
}

export function formatCreatedMaterialReferenceScreen(created: CreatedMaterialReferenceScreen): string {
  const header = `Material: ${created.kind} ${created.path}`;
  switch (created.kind) {
    case "image":
      return `${header}\n\n${formatCreatedImageReferenceScreen(created.specific as CreatedImageReferenceScreen)}`;
    case "pdf":
      return `${header}\n\n${formatCreatedPdfReferenceScreen(created.specific as CreatedPdfReferenceScreen)}`;
    case "docx":
      return `${header}\n\n${formatCreatedDocxImageReferenceScreen(created.specific as CreatedDocxImageReferenceScreen)}`;
    case "pptx":
      if (created.pptxMode === "rendered") {
        return `${header}\n\n${formatCreatedPptxRenderedReferenceScreen(created.specific as CreatedPptxRenderedReferenceScreen)}`;
      }
      return `${header}\n\n${formatCreatedPptxScreen(created.specific as PptxScreenWithAssets)}`;
  }
}

async function createPptxRenderedReferenceScreen(
  filePath: string,
  options: MaterialReferenceScreenOptions,
  imageImporter: ImageAssetImporter,
  creator: ImageScreenCreator,
  pptxRenderer: PptxRenderer,
): Promise<CreatedPptxRenderedReferenceScreen> {
  const slideNumber = clampPositiveInt(options.slideNumber, 1);
  const rendered = await pptxRenderer(filePath, {
    outputDir: options.outputDir,
    desiredWidth: options.desiredWidth,
    scale: options.scale,
    pages: [slideNumber],
  });
  const image = rendered.images.find((item) => item.pageNumber === slideNumber) ?? rendered.images[0];
  if (!rendered.rendered || image === undefined) {
    throw new Error(
      "create_reference_screen_from_material: PPTX rendered reference requires LibreOffice or PowerPoint " +
        `(${rendered.error ?? "no rendered slide image"}). ` +
        "Use pptxMode:\"editable\" to build an editable screen from PPTX layout without a renderer.",
    );
  }

  const created = await createImageReferenceScreenWithAsset(
    image.path,
    {
      screenName: options.screenName ?? defaultPptxRenderedScreenName(filePath, image.pageNumber),
      referenceWidth: options.referenceWidth,
      clientHintId: options.clientHintId ?? "pptx_rendered_slide",
      assetPath: options.assetPath,
      assetDir: options.assetDir,
    },
    imageImporter,
    creator,
  );

  return {
    ...created,
    pptx: {
      path: filePath,
      slideNumber: image.pageNumber,
      renderer: rendered.renderer,
      total: rendered.total,
      outputDir: rendered.outputDir,
    },
    renderedSlide: {
      path: image.path,
      pageNumber: image.pageNumber,
      width: image.width,
      height: image.height,
      size: image.size,
    },
  };
}

function formatCreatedPptxRenderedReferenceScreen(created: CreatedPptxRenderedReferenceScreen): string {
  return [
    `Created PPTX rendered reference screen "${created.intent.screenName}" (id=${created.created.screenId}).`,
    `Source: ${created.pptx.path} slide ${created.pptx.slideNumber}`,
    `Rendered slide: ${created.renderedSlide.path} (${created.renderedSlide.width}x${created.renderedSlide.height}) using ${created.pptx.renderer}`,
    `Imported sprite: ${created.importedAsset.assetPath}`,
    `Reference canvas: ${created.intent.referenceCanvas.width}x${created.intent.referenceCanvas.height}`,
  ].join("\n");
}

function fromImageLike(
  kind: "image" | "pdf" | "docx",
  filePath: string,
  created: CreatedImageReferenceScreen | CreatedPdfReferenceScreen | CreatedDocxImageReferenceScreen,
): CreatedMaterialReferenceScreen {
  return {
    kind,
    path: filePath,
    intent: created.intent,
    created: created.created,
    importedAsset: created.importedAsset,
    warnings: created.warnings,
    validation: created.validation,
    specific: created,
  };
}

function inferKind(filePath: string): MaterialReferenceKind {
  const ext = extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".pptx") return "pptx";
  throw new Error(`create_reference_screen_from_material: unsupported material type for "${basename(filePath)}"`);
}

function defaultPptxRenderedScreenName(filePath: string, slideNumber: number): string {
  const stem = basename(filePath, extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
  return `${stem.length > 0 ? stem : "Pptx"}Slide${slideNumber}ReferenceScreen`;
}

function clampPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}
