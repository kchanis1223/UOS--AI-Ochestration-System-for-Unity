/**
 * move_ui_element - bridge proxy. Moves/resizes an existing element by its
 * canonical elementId. rect is normalized 0..1.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

// Normalized rect (0..1, top-left origin, referenceCanvas fraction).
const RectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export default tool({
  description: "Move/resize an existing element by its canonical elementId. rect is normalized 0..1.",
  args: {
    elementId: z.string(),
    rect: RectSchema,
    anchor: z.string().optional(),
  },
  async execute(args) {
    const data = (await call("move_ui_element", args)) as Record<string, unknown>;
    return {
      title: `move_ui_element: ${args.elementId}`,
      output: `Moved element ${args.elementId} to (${args.rect.x},${args.rect.y},${args.rect.w}x${args.rect.h}).`,
      metadata: { ok: true, ...data },
    };
  },
});
