import { basename, extname } from "node:path";
import {
  createImageReferenceScreenWithAsset,
  formatCreatedImageReferenceScreen,
  type CreatedImageReferenceScreen,
  type ImageAssetImporter,
  type ImageScreenCreator,
} from "./_image_intent_assets";
import { renderPdfPages, type RenderImage, type RenderResult } from "./_render";

export interface PdfReferenceScreenOptions {
  pageNumber?: number;
  screenName?: string;
  referenceWidth?: number;
  clientHintId?: string;
  assetPath?: string;
  assetDir?: string;
  outputDir?: string;
  desiredWidth?: number;
  scale?: number;
}

export interface CreatedPdfReferenceScreen extends CreatedImageReferenceScreen {
  pdf: {
    path: string;
    pageNumber: number;
    total?: number;
    renderer: string;
  };
  renderedPage: RenderImage;
  renderResult: RenderResult;
}

export async function createPdfReferenceScreen(
  filePath: string,
  options: PdfReferenceScreenOptions,
  importer: ImageAssetImporter,
  creator: ImageScreenCreator,
): Promise<CreatedPdfReferenceScreen> {
  const pageNumber = positiveInt(options.pageNumber) ?? 1;
  const rendered = await renderPdfPages(filePath, {
    outputDir: options.outputDir,
    desiredWidth: options.desiredWidth,
    scale: options.scale,
    pages: [pageNumber],
    prefix: `${safeStem(basename(filePath, extname(filePath)))}-page-${String(pageNumber).padStart(3, "0")}`,
  });
  if (!rendered.rendered || rendered.images.length === 0) {
    throw new Error(`create_pdf_page_reference_screen: no PDF page rendered from "${filePath}"`);
  }

  const page = rendered.images.find((image) => image.pageNumber === pageNumber) ?? rendered.images[0];
  const created = await createImageReferenceScreenWithAsset(
    page.path,
    {
      screenName: options.screenName?.trim() || defaultPdfScreenName(filePath, page.pageNumber),
      referenceWidth: options.referenceWidth ?? page.width,
      clientHintId: options.clientHintId ?? `pdf_page_${page.pageNumber}`,
      assetPath: options.assetPath,
      assetDir: options.assetDir,
    },
    importer,
    creator,
  );

  return {
    ...created,
    pdf: {
      path: filePath,
      pageNumber: page.pageNumber,
      total: rendered.total,
      renderer: rendered.renderer,
    },
    renderedPage: page,
    renderResult: rendered,
  };
}

export function formatCreatedPdfReferenceScreen(created: CreatedPdfReferenceScreen): string {
  return [
    `PDF source: ${created.pdf.path} page ${created.pdf.pageNumber}${created.pdf.total !== undefined ? ` of ${created.pdf.total}` : ""}`,
    `Rendered page: ${created.renderedPage.path} (${created.renderedPage.width}x${created.renderedPage.height}) using ${created.pdf.renderer}`,
    "",
    formatCreatedImageReferenceScreen(created),
  ].join("\n");
}

function defaultPdfScreenName(filePath: string, pageNumber: number): string {
  const stem = basename(filePath, extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
  return `${stem || "Pdf"}Page${pageNumber}`;
}

function safeStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "pdf";
}

function positiveInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.round(n));
}
