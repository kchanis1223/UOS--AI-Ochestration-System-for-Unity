/**
 * add_ui_element — bridge proxy. Adds a single element to an existing screen.
 * Returns { elementId } (server-minted canonical id).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const ElementTypeEnum = z.enum([
  "Panel", "Text", "Button", "Image", "InputField", "Toggle", "Slider", "ScrollView", "Dropdown",
]);
const ElementSchema = z.object({
  clientHintId: z.string().optional(),
  parentClientHintId: z.string().optional(),
  type: ElementTypeEnum,
  rect: RectSchema,
  anchor: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

export default tool({
  description: "Add a single element to an existing screen. Returns { elementId } (server-minted canonical id).",
  args: {
    screenId: z.string(),
    element: ElementSchema,
  },
  async execute(args) {
    const data = (await call("add_ui_element", args)) as { elementId: string };
    return {
      title: `add_ui_element: ${args.element.type} → ${data.elementId}`,
      output: `Added ${args.element.type} (id=${data.elementId}) to screen ${args.screenId}.`,
      metadata: { ok: true, ...data },
    };
  },
});
