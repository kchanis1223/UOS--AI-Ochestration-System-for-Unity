/**
 * create_ui_screen - bridge proxy. Generates a Unity UI screen (Canvas + element
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
import { normalizeIntentForBridge, PlanningIntentSchema, validatePlanningIntent } from "./_planning_intent";

const ScreenSourceSchema = z.object({
  tool: z.string().optional().describe("Tool or workflow that produced the draft/source, e.g. draft_planning_intent_from_document."),
  kind: z.string().optional().describe("Source kind such as image, pdf, docx, pptx, md, txt, or document."),
  mode: z.string().optional().describe("Optional source mode, e.g. rendered or editable."),
  path: z.string().optional().describe("Original local material path when known."),
  pageNumber: z.number().int().positive().optional().describe("1-based PDF page number when applicable."),
  slideNumber: z.number().int().positive().optional().describe("1-based PPTX slide number when applicable."),
  imageNumber: z.number().int().positive().optional().describe("1-based embedded image number when applicable."),
  packagePath: z.string().optional().describe("Office package media path when applicable."),
  renderedPath: z.string().optional().describe("Rendered page/slide image path when applicable."),
  extractedPath: z.string().optional().describe("Extracted embedded image path when applicable."),
  assetPaths: z.array(z.string()).max(500).optional().describe("Unity asset paths imported for this screen, when applicable."),
}).strict();

export default tool({
  description:
    "Generate a Unity UI screen (Canvas + element tree) from a PlanningIntent. Returns { screenId, elements: [{ clientHintId, elementId }] } with server-minted canonical ids. clientHintId is advisory and authoritative only for intra-call parent linkage. Optional source metadata is persisted only in UOS context and is not sent to Unity.",
  args: {
    intent: PlanningIntentSchema,
    source: ScreenSourceSchema.optional().describe("Optional material/source metadata to persist in .uos for follow-up sessions. Pass metadata.source from draft tools when available."),
  },
  async execute(args) {
    const validation = validatePlanningIntent(args.intent);
    if (!validation.ok) {
      return {
        title: "create_ui_screen: preflight failed",
        output: `preflight failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
        metadata: { ok: false, errors: validation.errors, warnings: validation.warnings },
      };
    }
    const data = (await call("create_ui_screen", { intent: normalizeIntentForBridge(args.intent) })) as {
      screenId: string;
      elements: Array<{ clientHintId?: string; elementId: string }>;
    };
    // Surface the clientHintId -> elementId mapping in the output text; agents need
    // the canonical elementIds for subsequent update/move/delete/transition calls
    // and previously had to re-query get_scene_hierarchy.
    const mappingRows = data.elements
      .map((p, i) => `| ${i + 1} | ${p.clientHintId ?? "(none)"} | ${p.elementId} |`)
      .join("\n");
    const mappingTable =
      data.elements.length > 0
        ? `\n\n| # | clientHintId | elementId |\n|---|---|---|\n${mappingRows}`
        : "";
    const warningText = validation.warnings.length > 0
      ? `\n\nWarnings:\n${validation.warnings.map((w) => `- ${w}`).join("\n")}`
      : "";
    return {
      title: `create_ui_screen: ${args.intent.screenName} -> ${data.screenId}`,
      output:
        `Created screen "${args.intent.screenName}" (id=${data.screenId}) with ${data.elements.length} element(s).` +
        mappingTable +
        warningText,
      metadata: { ok: true, warnings: validation.warnings, source: args.source, ...data },
    };
  },
});
