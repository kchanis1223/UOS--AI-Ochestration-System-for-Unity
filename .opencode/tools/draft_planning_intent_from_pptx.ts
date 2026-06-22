/**
 * draft_planning_intent_from_pptx - PPTX layout to PlanningIntent draft.
 *
 * This is a deterministic bridge between document understanding and Unity UI
 * mutation: extract positioned PPTX content, convert it into a valid
 * PlanningIntent, then let the agent revise/validate/create.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { draftPlanningIntentFromPptxLayout, formatPptxIntentDraft } from "./_intent_draft";
import { extractPptxLayout } from "./_pptx_layout";
import { resolveCandidate, rootDir } from "./_materials";

const EmbeddedImageSchema = z.object({
  packagePath: z.string(),
  path: z.string(),
  filename: z.string().optional(),
}).passthrough();

const AssetMapSchema = z.object({
  clientHintId: z.string().optional(),
  mediaPath: z.string().optional(),
  packagePath: z.string().optional(),
  assetPath: z.string().describe("Unity asset path returned by import_asset, e.g. Assets/UOS/Imported/image1.png."),
}).strict();

export default tool({
  description:
    "Draft a valid PlanningIntent from a PPTX slide's positioned text and picture layout. Use before validate_planning_intent/create_ui_screen when a deck defines UI geometry.",
  args: {
    path: z.string().describe("PPTX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    slideNumber: z.number().int().positive().optional().describe("1-based slide number to convert. Defaults to the first selected slide."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to 1920; height is derived from the PPTX aspect ratio."),
    includeImagePlaceholders: z.boolean().optional().describe("Include Image elements for PPTX pictures even before sprites are imported. Defaults to true."),
    includeShapePanels: z.boolean().optional().describe("Include empty PPTX shapes as Panel elements. Defaults to false."),
    embeddedImages: z
      .array(EmbeddedImageSchema)
      .max(500)
      .optional()
      .describe("Optional metadata.images array from extract_embedded_images; matched by packagePath to add sourcePath/suggestedAssetPath hints."),
    assetMap: z
      .array(AssetMapSchema)
      .max(500)
      .optional()
      .describe("Optional mapping from PPTX mediaPath/packagePath/clientHintId to Unity assetPath after import_asset; matching Image elements get props.sprite."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pptx") {
      throw new Error(`draft_planning_intent_from_pptx: expected a .pptx file, got "${basename(resolved)}"`);
    }
    const layout = await extractPptxLayout(resolved, { pages: args.slideNumber !== undefined ? [args.slideNumber] : undefined });
    const draft = draftPlanningIntentFromPptxLayout(layout, {
      slideNumber: args.slideNumber,
      screenName: args.screenName,
      referenceWidth: args.referenceWidth,
      includeImagePlaceholders: args.includeImagePlaceholders,
      includeShapePanels: args.includeShapePanels,
      embeddedImages: args.embeddedImages,
      assetMap: args.assetMap,
    });
    return {
      title: `draft_planning_intent_from_pptx: ${draft.intent.screenName}`,
      output:
        formatPptxIntentDraft(draft) +
        "\n\nNext: call validate_planning_intent on metadata.intent, adjust if needed, then call create_ui_screen with intent=metadata.intent and source=metadata.source.",
      metadata: {
        ok: true,
        ...draft,
        source: { tool: "draft_planning_intent_from_pptx", kind: "pptx", ...draft.source },
      },
    };
  },
});
