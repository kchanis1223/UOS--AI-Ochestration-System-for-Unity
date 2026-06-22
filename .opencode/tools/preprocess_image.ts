/**
 * preprocess_image - local image preprocessing for planning materials.
 *
 * Downscales, crops, and/or transcodes a planning image into a bounded local
 * file and returns it as a vision attachment. This keeps large kiosk/planning
 * captures usable inside the agent loop without requiring manual preprocessing.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { preprocessImageFile } from "./_image";
import { resolveCandidate, rootDir } from "./_materials";

const CropSchema = z.object({
  x: z.number().nonnegative().describe("Crop left in source pixels."),
  y: z.number().nonnegative().describe("Crop top in source pixels."),
  width: z.number().positive().describe("Crop width in source pixels."),
  height: z.number().positive().describe("Crop height in source pixels."),
});

export default tool({
  description:
    "Preprocess a planning image: optional pixel crop, resize to max dimensions, and output as PNG/JPEG/WebP attachment for vision.",
  args: {
    path: z.string().describe("Image path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    maxWidth: z.number().positive().optional().describe("Maximum output width; preserves aspect ratio."),
    maxHeight: z.number().positive().optional().describe("Maximum output height; preserves aspect ratio."),
    crop: CropSchema.optional(),
    format: z.enum(["png", "jpeg", "webp"]).optional().describe("Output format; default png."),
    quality: z.number().min(1).max(100).optional().describe("JPEG/WebP quality."),
    outputPath: z.string().optional().describe("Optional explicit output path."),
  },
  async execute(args, ctx) {
    const inputPath = resolveCandidate(args.path, rootDir(ctx.directory));
    const result = await preprocessImageFile(inputPath, {
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
      crop: args.crop,
      format: args.format,
      quality: args.quality,
      outputPath: args.outputPath,
    });
    const uri = pathToFileURL(result.path).toString();
    return {
      title: `preprocess_image: ${basename(inputPath)} -> ${basename(result.path)}`,
      output:
        `Preprocessed image saved to: ${result.path}\n` +
        `Output: ${result.width}x${result.height}, ${result.format}, ${result.size} bytes`,
      metadata: { ok: true, inputPath, uri, ...result },
      attachments: [{ type: "file" as const, mime: result.mimeType, url: uri, filename: basename(result.path) }],
    };
  },
});
