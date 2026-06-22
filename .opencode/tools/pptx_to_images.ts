/**
 * pptx_to_images - PPTX preparation helper.
 *
 * True slide rasterization needs PowerPoint or LibreOffice and is not
 * guaranteed on every UOS machine. This tool tries available renderers first,
 * then provides a deterministic built-in fallback by extracting per-slide text
 * from the PPTX Open XML package.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { extname, basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  extractPlanningText,
  resolveCandidate,
  rootDir,
} from "./_materials";
import { extractEmbeddedImages, type EmbeddedImageResult } from "./_embedded_images";
import { extractPptxLayout, formatPptxLayout } from "./_pptx_layout";
import { renderPptxToImages } from "./_render";

const PagesSchema = z.array(z.number().int().positive()).max(50);

export default tool({
  description:
    "Prepare a .pptx deck for planning analysis. Renders slides to PNG via LibreOffice/PowerPoint when available; otherwise extracts per-slide text as fallback.",
  args: {
    path: z.string().describe("PPTX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    pages: PagesSchema.optional().describe("Specific 1-based slide numbers to render. Overrides first/last."),
    first: z.number().int().positive().optional().describe("Render the first N slides when a renderer is available."),
    last: z.number().int().positive().optional().describe("When paired with first, renders inclusive first..last range where supported."),
    desiredWidth: z.number().int().positive().optional().describe("Target output width for rendered PNG slides."),
    scale: z.number().positive().optional().describe("Render scale for renderer paths that go through PDF."),
    outputDir: z.string().optional().describe("Optional output directory for rendered PNG slides."),
    maxFallbackImages: z.number().int().positive().max(50).optional().describe("Maximum embedded PPTX images to attach when slide rendering is unavailable. Defaults to 6."),
    disableExternalRenderers: z.boolean().optional().describe("Force built-in text/layout/embedded-image fallback instead of LibreOffice/PowerPoint. Mostly useful for diagnostics."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pptx") {
      throw new Error(`pptx_to_images: expected a .pptx file, got "${basename(resolved)}"`);
    }

    const extracted = await extractPlanningText(resolved);
    const layout = await extractPptxLayout(resolved, {
      pages: args.pages,
      first: args.first,
      last: args.last,
    });
    const rendered = await renderPptxToImages(resolved, {
      outputDir: args.outputDir,
      desiredWidth: args.desiredWidth,
      scale: args.scale,
      pages: args.pages,
      first: args.first,
      last: args.last,
      disableExternal: args.disableExternalRenderers,
    });

    if (rendered.rendered) {
      const attachments = rendered.images.map((image) => ({
        type: "file" as const,
        mime: image.mimeType,
        url: pathToFileURL(image.path).toString(),
        filename: basename(image.path),
      }));

      const extractedOutput = extracted.ok && extracted.text !== undefined
        ? `\n\nExtracted slide text:\n${extracted.text}`
        : "";
      const layoutOutput = layout.slides.length > 0
        ? `\n\nExtracted slide layout:\n${formatPptxLayout(layout)}`
        : "";
      return {
        title: `pptx_to_images: ${basename(resolved)} (${rendered.images.length} slide image(s))`,
        output:
          `Rendered ${rendered.images.length} PPTX slide image(s) using ${rendered.renderer}.\n` +
          rendered.images
            .map((image) => `  - slide ${image.pageNumber}: ${image.path} (${image.width}x${image.height}, ${image.size} bytes)`)
            .join("\n") +
          extractedOutput +
          layoutOutput,
        metadata: { ok: true, path: resolved, ...rendered, fallback: null, extractedText: extracted, layout },
        attachments,
      };
    }

    const embedded = await extractFallbackEmbeddedImages(resolved, rendered.outputDir, args.maxFallbackImages);
    const embeddedAttachments = embedded.result.images.map((image) => ({
      type: "file" as const,
      mime: image.mimeType,
      url: pathToFileURL(image.path).toString(),
      filename: image.filename,
    }));
    const embeddedOutput = formatEmbeddedFallbackOutput(embedded.result, embedded.error);

    if ((!extracted.ok || extracted.text === undefined) && embedded.result.images.length === 0) {
      throw new Error(
        `pptx_to_images: could not render slides or extract slide text from "${resolved}": ` +
        `${rendered.error ?? extracted.error ?? embedded.error ?? "no text found"}`,
      );
    }

    return {
      title: `pptx_to_images: ${basename(resolved)} (${extracted.text !== undefined ? "text" : "embedded image"} fallback)`,
      output:
        `PPTX raster images are not available on this machine (${rendered.error ?? "no renderer"}).\n` +
        (extracted.text !== undefined
          ? `Extracted per-slide text from: ${resolved}\n\n${extracted.text}`
          : `No slide text was found in: ${resolved}`) +
        `\n\nExtracted slide layout:\n${formatPptxLayout(layout)}` +
        embeddedOutput,
      metadata: {
        ok: true,
        path: resolved,
        rendered: false,
        images: [],
        fallback: extracted.text !== undefined ? "pptx-text" : "pptx-embedded-images",
        renderError: rendered.error,
        extractedText: extracted,
        layout,
        embeddedImages: embedded.result,
        embeddedImageError: embedded.error,
      },
      attachments: embeddedAttachments,
    };
  },
});

async function extractFallbackEmbeddedImages(
  filePath: string,
  renderOutputDir: string,
  maxImages: number | undefined,
): Promise<{ result: EmbeddedImageResult; error?: string }> {
  try {
    return {
      result: await extractEmbeddedImages(filePath, {
        outputDir: join(renderOutputDir, "embedded-images"),
        maxImages: maxImages ?? 6,
      }),
    };
  } catch (err) {
    return {
      result: {
        ok: false,
        sourcePath: filePath,
        outputDir: join(renderOutputDir, "embedded-images"),
        images: [],
        skipped: [],
      },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatEmbeddedFallbackOutput(result: EmbeddedImageResult, error: string | undefined): string {
  if (result.images.length > 0) {
    return "\n\nExtracted embedded PPTX image(s) for vision fallback:\n" +
      result.images
        .map((image) =>
          `  - ${image.filename}: ${image.path}` +
          ` (${image.mimeType}, ${image.width ?? "?"}x${image.height ?? "?"}, ${image.size} bytes)`)
        .join("\n");
  }
  if (error !== undefined) {
    return `\n\nEmbedded image extraction failed: ${error}`;
  }
  return "\n\nNo embedded PPTX raster images found for fallback.";
}
