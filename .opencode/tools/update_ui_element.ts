/**
 * update_ui_element - bridge proxy. Updates properties of an existing element
 * by its server-minted canonical elementId.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { ElementPropsSchema, normalizeElementPropsForBridge } from "./_planning_intent";

// Normalized rect (0..1, top-left origin, referenceCanvas fraction).
const RectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export default tool({
  description: "Update properties of an existing element by its server-minted canonical elementId.",
  args: {
    elementId: z.string(),
    props: ElementPropsSchema,
    rect: RectSchema.optional(),
    anchor: z.string().optional(),
  },
  async execute(args) {
    const data = (await call("update_ui_element", {
      ...args,
      props: normalizeElementPropsForBridge(args.props),
    })) as Record<string, unknown>;
    return {
      title: `update_ui_element: ${args.elementId}`,
      output: `Updated element ${args.elementId}.`,
      metadata: { ok: true, ...data },
    };
  },
});
