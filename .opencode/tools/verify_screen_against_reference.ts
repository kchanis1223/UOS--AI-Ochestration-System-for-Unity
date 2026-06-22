/**
 * verify_screen_against_reference - capture a Unity screen preview and compare
 * it against a local reference/mockup image in one step.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename } from "node:path";
import { call } from "./_bridge";
import { verifyScreenAgainstReference } from "./_screen_verification";

export default tool({
  description:
    "Capture a Unity screen preview, compare it against a reference/mockup image, and attach both the rendered preview and visual diff.",
  args: {
    screenId: z.string(),
    referencePath: z.string().describe("Reference/mockup image path, absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    maxWidth: z.number().int().positive().max(4096).optional().describe("Maximum comparison width. Defaults to 1024."),
    maxHeight: z.number().int().positive().max(4096).optional().describe("Maximum comparison height. Defaults to 1024."),
    threshold: z.number().min(0).max(1).optional().describe("Per-pixel normalized delta threshold for mismatchRatio. Defaults to 0.05."),
    outputPath: z.string().optional().describe("Optional output path for the generated diff PNG."),
  },
  async execute(args, ctx) {
    const verified = await verifyScreenAgainstReference(args, {
      directory: ctx.directory,
      capturePreview: async (screenId) => await call("capture_preview", { screenId }) as any,
    });

    const preview = verified.preview;
    const comparison = verified.comparison;
    return {
      title: `verify_screen_against_reference: ${verified.verdict}`,
      output:
        `Captured screen ${args.screenId} and compared it with ${comparison.referencePath}.\n` +
        `Preview saved to: ${preview.savedPath}\n` +
        `Diff image saved to: ${comparison.diffPath}\n` +
        `verdict=${verified.verdict}, meanAbsoluteError=${comparison.meanAbsoluteError}, ` +
        `rootMeanSquareError=${comparison.rootMeanSquareError}, mismatchRatio=${comparison.mismatchRatio}, ` +
        `maxChannelDelta=${comparison.maxChannelDelta}, aspectRatioDelta=${comparison.aspectRatioDelta}.\n` +
        "Inspect both attachments before deciding the next edit.",
      metadata: verified,
      attachments: [
        { type: "file" as const, mime: preview.mimeType, url: preview.uri, filename: basename(preview.savedPath) },
        { type: "file" as const, mime: comparison.diffMimeType, url: comparison.uri, filename: basename(comparison.diffPath) },
      ],
    };
  },
});
