import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { extractEmbeddedImages } from "./_embedded_images";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Extract embedded raster images from DOCX/PPTX planning materials and return them as vision attachments. Use when a document or deck contains screenshots, mockups, icons, or reference art.",
  args: {
    path: z.string().describe("DOCX/PPTX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    outputDir: z.string().optional().describe("Optional output directory for extracted images."),
    maxImages: z.number().int().positive().max(500).optional().describe("Maximum number of images to extract. Defaults to 100."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    const ext = extname(resolved).toLowerCase();
    if (ext !== ".docx" && ext !== ".pptx") {
      throw new Error(`extract_embedded_images: expected a .docx or .pptx file, got "${basename(resolved)}"`);
    }

    const result = await extractEmbeddedImages(resolved, {
      outputDir: args.outputDir,
      maxImages: args.maxImages,
    });
    const attachments = result.images.map((image) => ({
      type: "file" as const,
      mime: image.mimeType,
      url: pathToFileURL(image.path).toString(),
      filename: image.filename,
    }));

    const skipped = result.skipped.length > 0
      ? `\nSkipped ${result.skipped.length} unsupported or over-limit media file(s).`
      : "";
    return {
      title: `extract_embedded_images: ${basename(resolved)} (${result.images.length} image(s))`,
      output:
        (result.images.length === 0
          ? `No embedded raster images found in ${resolved}.`
          : `Extracted ${result.images.length} embedded image(s) from ${resolved}:\n` +
            result.images
              .map((image) =>
                `  - ${image.filename}: ${image.path}` +
                ` (${image.mimeType}, ${image.width ?? "?"}x${image.height ?? "?"}, ${image.size} bytes)`)
              .join("\n")) +
        skipped,
      metadata: { ...result },
      attachments,
    };
  },
});
