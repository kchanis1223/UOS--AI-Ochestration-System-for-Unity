/**
 * compare_images - local visual-diff helper for preview verification.
 *
 * Use after capture_preview to compare the rendered Unity preview against a
 * planning mockup, PDF page render, PPTX slide render, or extracted image.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { compareImageFiles, verdictForImageComparison } from "./_image";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Compare two local images and return normalized pixel-difference metrics plus a diff PNG attachment. Use after capture_preview to compare Unity output against a planning image.",
  args: {
    referencePath: z.string().describe("Reference/mockup image path, absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    candidatePath: z.string().describe("Candidate/rendered preview image path, usually capture_preview metadata.savedPath."),
    maxWidth: z.number().int().positive().max(4096).optional().describe("Maximum comparison width. Defaults to 1024."),
    maxHeight: z.number().int().positive().max(4096).optional().describe("Maximum comparison height. Defaults to 1024."),
    threshold: z.number().min(0).max(1).optional().describe("Per-pixel normalized delta threshold for mismatchRatio. Defaults to 0.05."),
    outputPath: z.string().optional().describe("Optional output path for the generated diff PNG."),
  },
  async execute(args, ctx) {
    const root = rootDir(ctx.directory);
    const referencePath = resolveCandidate(args.referencePath, root);
    const candidatePath = resolveCandidate(args.candidatePath, root);
    const result = await compareImageFiles(referencePath, candidatePath, {
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
      threshold: args.threshold,
      outputPath: args.outputPath,
    });
    const uri = pathToFileURL(result.diffPath).toString();

    const verdict = verdictForImageComparison(result);

    return {
      title: `compare_images: ${verdict}`,
      output:
        `Compared reference ${referencePath} with candidate ${candidatePath}.\n` +
        `Reference: ${result.referenceWidth}x${result.referenceHeight}; candidate: ${result.candidateWidth}x${result.candidateHeight}; comparison: ${result.compareWidth}x${result.compareHeight}.\n` +
        `meanAbsoluteError=${result.meanAbsoluteError}, rootMeanSquareError=${result.rootMeanSquareError}, mismatchRatio=${result.mismatchRatio}, maxChannelDelta=${result.maxChannelDelta}, aspectRatioDelta=${result.aspectRatioDelta}.\n` +
        `Diff image saved to: ${result.diffPath}\n` +
        `Use the diff attachment and the original images for visual judgment; metrics are a guide, not a replacement for layout inspection.`,
      metadata: { ok: true, verdict, uri, ...result },
      attachments: [{ type: "file" as const, mime: result.diffMimeType, url: uri, filename: basename(result.diffPath) }],
    };
  },
});
