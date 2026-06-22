/**
 * capture_preview - bridge proxy + on-disk PNG + agent-visible attachment.
 *
 * Unity returns the screenshot as inline base64. This tool writes it to a temp
 * preview file and attaches that file so the agent can inspect the rendered UI.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { persistPreview } from "./_preview";

interface CapturePreviewResponse {
  screenId?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  base64Data?: string;
  size?: number;
}

export default tool({
  description:
    "Capture a thumbnail preview of a screen and surface it as a vision attachment so the agent can verify the render.",
  args: {
    screenId: z.string(),
  },
  async execute(args) {
    const data = (await call("capture_preview", args)) as CapturePreviewResponse;
    const mimeType = data.mimeType ?? "image/png";
    const size = data.size ?? 0;
    const dims = data.width !== undefined && data.height !== undefined
      ? `${data.width}x${data.height}`
      : "(unknown dims)";

    if (typeof data.base64Data !== "string" || data.base64Data.length === 0) {
      return {
        title: `capture_preview: ${args.screenId} (no base64)`,
        output: `Unity returned no base64Data for screen ${args.screenId}.`,
        metadata: { ok: false, ...data },
      };
    }

    const preview = await persistPreview(data.base64Data, args.screenId, mimeType);
    return {
      title: `capture_preview: ${args.screenId} (${dims}, ${size}b)`,
      output:
        `Preview captured for screen ${args.screenId} (${dims}, ${size}b, mime=${mimeType}).\n` +
        `Saved to: ${preview.absPath}\n` +
        "Attached for vision; inspect the image to verify layout.",
      metadata: {
        ok: true,
        screenId: args.screenId,
        mimeType,
        size,
        width: data.width,
        height: data.height,
        savedPath: preview.absPath,
        uri: preview.uri,
      },
      attachments: [{ type: "file" as const, mime: mimeType, url: preview.uri, filename: preview.filename }],
    };
  },
});
