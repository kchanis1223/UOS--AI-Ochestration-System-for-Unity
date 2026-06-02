/**
 * capture_preview — bridge proxy. Captures a thumbnail preview of a screen
 * (size-capped, mirrors read input caps).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description: "Capture a thumbnail preview of a screen (size-capped, mirrors read input caps).",
  args: {
    screenId: z.string(),
  },
  async execute(args) {
    const data = (await call("capture_preview", args)) as {
      mimeType?: string;
      uri?: string;
      base64Data?: string;
      size?: number;
    };
    const summary =
      data.uri !== undefined
        ? `Preview captured (size=${data.size ?? "?"}b, served as URI: ${data.uri})`
        : `Preview captured (size=${data.size ?? "?"}b, inline base64 ${data.mimeType ?? "?"})`;
    return {
      title: `capture_preview: ${args.screenId}`,
      output: summary,
      metadata: { ok: true, ...data },
    };
  },
});
