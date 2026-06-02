/**
 * update_ui_element — bridge proxy. Updates properties of an existing element
 * by its server-minted canonical elementId.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export default tool({
  description: "Update properties of an existing element by its server-minted canonical elementId.",
  args: {
    elementId: z.string(),
    props: z.record(z.string(), z.unknown()).optional(),
    rect: RectSchema.optional(),
    anchor: z.string().optional(),
  },
  async execute(args) {
    const data = (await call("update_ui_element", args)) as Record<string, unknown>;
    return {
      title: `update_ui_element: ${args.elementId}`,
      output: `Updated element ${args.elementId}.`,
      metadata: { ok: true, ...data },
    };
  },
});
