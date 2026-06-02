/**
 * add_ui_element — bridge proxy. Adds a single element to an existing screen.
 * Returns { elementId } (server-minted canonical id).
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
const ElementTypeEnum = z.enum([
  "Panel", "Text", "Button", "Image", "InputField", "Toggle", "Slider", "ScrollView", "Dropdown",
]);
// Mirrors create_ui_screen.ts ElementPropsSchema. See UguiBackend.ApplyProps for handling.
const ElementPropsSchema = z.object({
  text: z.string().optional(),
  color: z.string().optional().describe("Hex color, '#RRGGBB' or '#RRGGBBAA'."),
  fontSize: z.number().int().nonnegative().optional(),
  sprite: z.string().optional().describe("Sprite asset path resolvable by AssetDatabase."),
  align: z.string().optional().describe("Alignment preset name."),
}).optional();

const ElementSchema = z.object({
  clientHintId: z.string().optional(),
  parentClientHintId: z.string().optional(),
  type: ElementTypeEnum,
  rect: RectSchema,
  anchor: z.string().optional(),
  props: ElementPropsSchema,
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
