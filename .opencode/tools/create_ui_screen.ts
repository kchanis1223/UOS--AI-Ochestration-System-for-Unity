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

// Normalized rect (0..1 fraction of referenceCanvas, top-left origin).
// Mirrors IntentParser.ValidateRect on the Unity side so violations are
// caught client-side before the round-trip rather than silent off-screen.
const RectSchema = z.object({
  x: z.number().min(0).max(1).describe("Normalized x (0..1) relative to referenceCanvas, top-left origin."),
  y: z.number().min(0).max(1).describe("Normalized y (0..1) relative to referenceCanvas, top-left origin."),
  w: z.number().gt(0).max(1).describe("Normalized width (0,1] relative to referenceCanvas."),
  h: z.number().gt(0).max(1).describe("Normalized height (0,1] relative to referenceCanvas."),
});

const ElementTypeEnum = z.enum([
  "Panel", "Text", "Button", "Image", "InputField", "Toggle", "Slider", "ScrollView", "Dropdown",
]);

// Explicit, JsonUtility-compatible style/content props. Free-form dictionaries
// were silently discarded by the Unity backend (see docs/feedback/2026-06-02-e2e-jangheung.md Top #1).
// Per-type interpretation lives in UguiBackend.ApplyProps:
//   Text       — text / fontSize / color / align
//   Button     — color (background) / text (label) / sprite
//   Image|Panel — color / sprite
//   InputField — text (placeholder) / color
const ElementPropsSchema = z.object({
  text: z.string().optional().describe("Text content / Button label / InputField placeholder."),
  color: z.string().optional().describe("Hex color, '#RRGGBB' or '#RRGGBBAA'."),
  fontSize: z.number().int().nonnegative().optional().describe("Text font size in pt (0 = leave default)."),
  sprite: z.string().optional().describe("Sprite asset path resolvable by AssetDatabase, e.g. 'Assets/UI/btn.png'."),
  align: z.string().optional().describe("Alignment: Left / Center / Right / TopLeft / MiddleCenter / etc. (default MiddleCenter)."),
}).optional();

const ElementSchema: z.ZodTypeAny = z.object({
  clientHintId: z.string().describe("Advisory client id; authoritative only for intra-call parent linkage.").optional(),
  parentClientHintId: z.string().describe("clientHintId of the parent element within this same intent.").optional(),
  type: ElementTypeEnum,
  rect: RectSchema,
  anchor: z.string().optional(),
  props: ElementPropsSchema,
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
    // Surface the clientHintId→elementId mapping in the output text — agents need
    // the canonical elementIds for subsequent update/move/delete/transition calls
    // and previously had to re-query get_scene_hierarchy.
    const mappingRows = data.elements
      .map((p, i) => `| ${i + 1} | ${p.clientHintId ?? "(none)"} | ${p.elementId} |`)
      .join("\n");
    const mappingTable =
      data.elements.length > 0
        ? `\n\n| # | clientHintId | elementId |\n|---|---|---|\n${mappingRows}`
        : "";
    return {
      title: `create_ui_screen: ${args.intent.screenName} → ${data.screenId}`,
      output:
        `Created screen "${args.intent.screenName}" (id=${data.screenId}) with ${data.elements.length} element(s).` +
        mappingTable,
      metadata: { ok: true, ...data },
    };
  },
});
