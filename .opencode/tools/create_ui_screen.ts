/**
 * create_ui_screen — bridge proxy. Generates a Unity UI screen (Canvas + element
 * tree) from a PlanningIntent. Server mints canonical IDs and returns mapping
 * { screenId, elements: [{ clientHintId, elementId }] }.
 *
 * Preflight: deterministic Zod schema validation + intra-call parent-link tree
 * validation. Failing preflight short-circuits without round-tripping to Unity.
 *
 * Ported from mcp-server/src/tools/definitions.ts (planningIntentInputSchema +
 * preflightCreateUiScreen).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const ElementTypeEnum = z.enum([
  "Panel", "Text", "Button", "Image", "InputField", "Toggle", "Slider", "ScrollView", "Dropdown",
]);

const ElementSchema: z.ZodTypeAny = z.object({
  clientHintId: z.string().describe("Advisory client id; authoritative only for intra-call parent linkage.").optional(),
  parentClientHintId: z.string().describe("clientHintId of the parent element within this same intent.").optional(),
  type: ElementTypeEnum,
  rect: RectSchema,
  anchor: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

const PlanningIntentSchema = z.object({
  version: z.literal("1.0.0"),
  screenName: z.string(),
  referenceCanvas: z.object({ width: z.number(), height: z.number() }),
  elements: z.array(ElementSchema),
});

function validateIntentTree(intent: z.infer<typeof PlanningIntentSchema>): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const el of intent.elements) {
    if (el.clientHintId !== undefined) {
      if (ids.has(el.clientHintId)) {
        errors.push(`duplicate clientHintId: ${el.clientHintId}`);
      }
      ids.add(el.clientHintId);
    }
  }
  for (const el of intent.elements) {
    if (el.parentClientHintId !== undefined && !ids.has(el.parentClientHintId)) {
      errors.push(`parentClientHintId "${el.parentClientHintId}" not found in intent`);
    }
  }
  return errors;
}

export default tool({
  description:
    "Generate a Unity UI screen (Canvas + element tree) from a PlanningIntent. Returns { screenId, elements: [{ clientHintId, elementId }] } with server-minted canonical ids. clientHintId is advisory and authoritative only for intra-call parent linkage.",
  args: {
    intent: PlanningIntentSchema,
  },
  async execute(args) {
    const treeErrors = validateIntentTree(args.intent);
    if (treeErrors.length > 0) {
      return {
        title: "create_ui_screen: preflight failed",
        output: `preflight failed:\n${treeErrors.map((e) => `  - tree: ${e}`).join("\n")}`,
        metadata: { ok: false, errors: treeErrors },
      };
    }
    const data = (await call("create_ui_screen", { intent: args.intent })) as {
      screenId: string;
      elements: Array<{ clientHintId?: string; elementId: string }>;
    };
    return {
      title: `create_ui_screen: ${args.intent.screenName} → ${data.screenId}`,
      output: `Created screen "${args.intent.screenName}" (id=${data.screenId}) with ${data.elements.length} elements.`,
      metadata: { ok: true, ...data },
    };
  },
});
