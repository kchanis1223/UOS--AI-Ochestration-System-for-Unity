/**
 * read_planning_material - local handler tool (no Unity proxy).
 *
 * Returns a planning material as an MCP-style resource. For large files,
 * returns a file:// URI; for smaller files, returns inline base64.
 * Ported from mcp-server/src/tools/planningMaterials.ts (readPlanningMaterial).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, extname } from "node:path";
import { extractEmbeddedImages, type EmbeddedImageResult } from "./_embedded_images";
import { prepareVisionImageAttachment } from "./_image";
import {
  DEFAULT_BASE64_CAP_BYTES,
  extractPlanningText,
  formatMaterialSummary,
  guessMimeType,
  inspectPlanningMaterial,
  resolveCandidate,
  rootDir,
} from "./_materials";
import { renderPdfPages, type RenderResult } from "./_render";

export default tool({
  description:
    "Return a planning material as an MCP resource (file URI for large files; size-capped base64 fallback otherwise). The client LLM performs multimodal vision for supported visual documents; video files are treated as filename/metadata-only playable content media.",
  args: {
    path: z.string().describe("File path (absolute, or relative to UNITY_MCP_MATERIALS_DIR or session cwd)."),
    maxEmbeddedImages: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("For DOCX/PPTX, maximum embedded raster images to extract and attach for vision. Defaults to 3; use 0 to disable."),
    maxPdfPages: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("For PDFs, maximum leading pages to render and attach as PNG vision images. Defaults to 2; use 0 to disable."),
    pdfDesiredWidth: z
      .number()
      .int()
      .min(128)
      .max(4096)
      .optional()
      .describe("For PDFs, target width in pixels for rendered page vision attachments. Defaults to 1200."),
  },
  async execute(args, ctx) {
    const root = rootDir(ctx.directory);
    const resolved = resolveCandidate(args.path, root);

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
    const isImage = mimeType.startsWith("image/");
    const material = await inspectPlanningMaterial(resolved, stat);
    const uri = pathToFileURL(resolved).toString();
    const filename = basename(resolved);
    let visionImage: Awaited<ReturnType<typeof prepareVisionImageAttachment>> | undefined;
    let visionError: string | undefined;
    if (isImage) {
      try {
        visionImage = await prepareVisionImageAttachment(resolved);
      } catch (err) {
        visionError = err instanceof Error ? err.message : String(err);
      }
    }
    const extracted = await extractPlanningText(resolved);
    const pdfRender = await maybeRenderPdfPages(resolved, ext, args.maxPdfPages, args.pdfDesiredWidth);
    const embedded = await maybeExtractEmbeddedImages(resolved, ext, args.maxEmbeddedImages);
    const summaryOutput = `\nMaterial metadata: ${formatMaterialSummary(material)}`;
    const visionOutput = visionImage !== undefined
      ? `\nVision attachment: ${visionImage.resized ? "downscaled copy" : "original file"} ` +
        `(${visionImage.width ?? "?"}x${visionImage.height ?? "?"}, ${visionImage.mimeType}, ${visionImage.size}b` +
        `${visionImage.capSatisfied ? "" : ", still above preferred cap"}).\n` +
        `Vision path: ${visionImage.path}` +
        (visionImage.resized ? `\nOriginal path: ${resolved}` : "")
      : visionError !== undefined
        ? `\nVision attachment warning: image preprocessing failed; using original file. ${visionError}`
        : "";
    const pdfRenderOutput = formatPdfRenderOutput(pdfRender.result, pdfRender.error);
    const embeddedOutput = formatEmbeddedOutput(embedded.result, embedded.error);
    const extractionOutput = extracted.ok && extracted.text !== undefined
      ? `\n\nExtracted text (${extracted.kind}, ${extracted.chars ?? extracted.text.length} chars${extracted.truncated ? ", truncated" : ""}):\n${extracted.text}`
      : extracted.kind === "unsupported"
        ? ""
        : `\n\nText extraction ${extracted.kind}: ${extracted.error ?? "no text extracted"}`;

    // ToolAttachment surface: lets the LLM perform multimodal vision on the file
    // instead of seeing only metadata. Large images are downscaled first so
    // common 1920x1080 planning mockups survive model/client image limits.
    const attachmentPath = visionImage?.path ?? resolved;
    const attachmentMime = visionImage?.mimeType ?? mimeType;
    const attachments = [{
      type: "file" as const,
      mime: attachmentMime,
      url: pathToFileURL(attachmentPath).toString(),
      filename: basename(attachmentPath),
    }, ...pdfRender.result.images.map((image) => ({
      type: "file" as const,
      mime: image.mimeType,
      url: pathToFileURL(image.path).toString(),
      filename: basename(image.path),
    })), ...embedded.result.images.map((image) => ({
      type: "file" as const,
      mime: image.mimeType,
      url: pathToFileURL(image.path).toString(),
      filename: image.filename,
    }))];

    if (stat.size > DEFAULT_BASE64_CAP_BYTES) {
      return {
        title: `read_planning_material: ${filename} (uri, ${stat.size}b)`,
        output:
          `File loaded as attachment for vision (mimeType=${mimeType}, size=${stat.size}b).\n` +
          `Path: ${resolved}\n` +
          `URI: ${uri}` +
          visionOutput +
          pdfRenderOutput +
          embeddedOutput +
          summaryOutput +
          extractionOutput,
        metadata: { ok: true, path: resolved, mimeType, uri, size: stat.size, isImage, material, visionImage, visionError, pdfRender: pdfRender.result, pdfRenderError: pdfRender.error, embeddedImages: embedded.result, embeddedImageError: embedded.error, extractedText: extracted },
        attachments,
      };
    }

    const bytes = await fs.readFile(resolved);
    const base64Data = bytes.toString("base64");
    return {
      title: `read_planning_material: ${filename} (${mimeType}, ${stat.size}b)`,
      output:
        `File loaded as attachment for vision (mimeType=${mimeType}, size=${stat.size}b).\n` +
        `Path: ${resolved}` +
        visionOutput +
        pdfRenderOutput +
        embeddedOutput +
        summaryOutput +
        extractionOutput,
      metadata: { ok: true, path: resolved, mimeType, base64Data, size: stat.size, isImage, material, visionImage, visionError, pdfRender: pdfRender.result, pdfRenderError: pdfRender.error, embeddedImages: embedded.result, embeddedImageError: embedded.error, extractedText: extracted },
      attachments,
    };
  },
});

async function maybeRenderPdfPages(
  filePath: string,
  ext: string,
  maxPdfPages: number | undefined,
  pdfDesiredWidth: number | undefined,
): Promise<{ result: RenderResult; error?: string }> {
  const maxPages = maxPdfPages ?? 2;
  if (maxPages <= 0 || ext !== ".pdf") {
    return { result: emptyRenderResult() };
  }
  try {
    return {
      result: await renderPdfPages(filePath, {
        first: maxPages,
        desiredWidth: pdfDesiredWidth ?? 1200,
      }),
    };
  } catch (err) {
    return {
      result: emptyRenderResult(err instanceof Error ? err.message : String(err)),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function maybeExtractEmbeddedImages(
  filePath: string,
  ext: string,
  maxEmbeddedImages: number | undefined,
): Promise<{ result: EmbeddedImageResult; error?: string }> {
  const maxImages = maxEmbeddedImages ?? 3;
  if (maxImages <= 0 || (ext !== ".docx" && ext !== ".pptx")) {
    return { result: emptyEmbeddedImageResult(filePath) };
  }
  try {
    return {
      result: await extractEmbeddedImages(filePath, {
        maxImages,
      }),
    };
  } catch (err) {
    return {
      result: emptyEmbeddedImageResult(filePath),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function emptyRenderResult(error?: string): RenderResult {
  return {
    ok: false,
    rendered: false,
    renderer: "none",
    images: [],
    outputDir: "",
    error,
  };
}

function emptyEmbeddedImageResult(filePath: string): EmbeddedImageResult {
  return {
    ok: false,
    sourcePath: filePath,
    outputDir: "",
    images: [],
    skipped: [],
  };
}

function formatPdfRenderOutput(result: RenderResult, error: string | undefined): string {
  if (result.images.length > 0) {
    return "\nRendered PDF page attachment(s): " +
      `${result.images.length}` +
      result.images
        .map((image) =>
          `\n  - page ${image.pageNumber}: ${image.path}` +
          ` (${image.mimeType}, ${image.width}x${image.height}, ${image.size}b)`)
        .join("");
  }
  const warning = error ?? result.error;
  if (warning !== undefined) {
    return `\nPDF render warning: ${warning}`;
  }
  return "";
}

function formatEmbeddedOutput(result: EmbeddedImageResult, error: string | undefined): string {
  if (result.images.length > 0) {
    return "\nEmbedded image attachment(s): " +
      `${result.images.length}` +
      result.images
        .map((image) =>
          `\n  - ${image.filename}: ${image.path}` +
          ` (${image.mimeType}, ${image.width ?? "?"}x${image.height ?? "?"}, ${image.size}b)`)
        .join("");
  }
  if (error !== undefined) {
    return `\nEmbedded image warning: ${error}`;
  }
  return "";
}
