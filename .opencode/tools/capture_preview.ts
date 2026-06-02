/**
 * capture_preview — bridge proxy + on-disk PNG + agent-visible attachment.
 *
 * Unity returns the screenshot as inline base64. We:
 *   1. decode + write it to %TEMP%/oh-my-unity/preview-<screenId>-<ts>.png
 *   2. expose the file path as a ToolAttachment so the agent can actually see
 *      what was rendered (multimodal vision).
 *
 * Without (2) the agent only saw `size=38662b` in metadata, breaking the
 * "generate → verify → fix" autonomous loop. See docs/feedback/2026-06-02-e2e-jangheung.md.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

interface CapturePreviewResponse {
  screenId?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  base64Data?: string;
  size?: number;
}

async function persistPreview(
  base64Data: string,
  screenId: string,
  mimeType: string,
): Promise<{ absPath: string; uri: string }> {
  const dir = join(tmpdir(), "oh-my-unity", "previews");
  await mkdir(dir, { recursive: true });
  const ext = mimeType === "image/png" ? "png" : mimeType.split("/")[1] ?? "bin";
  const absPath = join(dir, `preview-${screenId}-${Date.now()}.${ext}`);
  await writeFile(absPath, Buffer.from(base64Data, "base64"));
  return { absPath, uri: pathToFileURL(absPath).toString() };
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
      ? `${data.width}×${data.height}`
      : "(unknown dims)";

    if (typeof data.base64Data !== "string" || data.base64Data.length === 0) {
      return {
        title: `capture_preview: ${args.screenId} (no base64)`,
        output: `Unity returned no base64Data for screen ${args.screenId}.`,
        metadata: { ok: false, ...data },
      };
    }

    const { absPath, uri } = await persistPreview(data.base64Data, args.screenId, mimeType);
    return {
      title: `capture_preview: ${args.screenId} (${dims}, ${size}b)`,
      output:
        `Preview captured for screen ${args.screenId} (${dims}, ${size}b, mime=${mimeType}).\n` +
        `Saved to: ${absPath}\n` +
        `Attached for vision — inspect the image to verify layout.`,
      metadata: { ok: true, screenId: args.screenId, mimeType, size, width: data.width, height: data.height, savedPath: absPath, uri },
      attachments: [{ type: "file" as const, mime: mimeType, url: uri, filename: basename(absPath) }],
    };
  },
});
