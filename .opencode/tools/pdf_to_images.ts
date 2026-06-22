/**
 * pdf_to_images - render PDF pages into PNG attachments for visual analysis.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { renderPdfPages } from "./_render";
import { resolveCandidate, rootDir } from "./_materials";

const PagesSchema = z.array(z.number().int().positive()).max(20);

export default tool({
  description:
    "Render selected PDF pages to PNG files and return them as vision attachments. Use when PDF layout or visual design matters.",
  args: {
    path: z.string().describe("PDF path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    pages: PagesSchema.optional().describe("Specific 1-based page numbers to render. Overrides first/last."),
    first: z.number().int().positive().optional().describe("Render the first N pages. Defaults to 8 when no page range is supplied."),
    last: z.number().int().positive().optional().describe("When paired with first, renders inclusive first..last range; alone renders last N pages."),
    desiredWidth: z.number().int().positive().optional().describe("Target output width in pixels; preserves aspect ratio."),
    scale: z.number().positive().optional().describe("PDF render scale. Ignored when desiredWidth is set."),
    outputDir: z.string().optional().describe("Optional output directory for rendered PNGs."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pdf") {
      throw new Error(`pdf_to_images: expected a .pdf file, got "${basename(resolved)}"`);
    }

    const rendered = await renderPdfPages(resolved, {
      outputDir: args.outputDir,
      desiredWidth: args.desiredWidth,
      scale: args.scale,
      pages: args.pages,
      first: args.first,
      last: args.last,
    });

    if (!rendered.rendered) {
      throw new Error(`pdf_to_images: no PDF pages rendered from "${resolved}"`);
    }

    const attachments = rendered.images.map((image) => ({
      type: "file" as const,
      mime: image.mimeType,
      url: pathToFileURL(image.path).toString(),
      filename: basename(image.path),
    }));

    return {
      title: `pdf_to_images: ${basename(resolved)} (${rendered.images.length} page image(s))`,
      output:
        `Rendered ${rendered.images.length} PDF page image(s) using ${rendered.renderer}.\n` +
        rendered.images
          .map((image) => `  - page ${image.pageNumber}: ${image.path} (${image.width}x${image.height}, ${image.size} bytes)`)
          .join("\n"),
      metadata: { ok: true, path: resolved, ...rendered },
      attachments,
    };
  },
});
