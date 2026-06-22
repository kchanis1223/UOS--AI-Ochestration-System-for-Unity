/**
 * prepare_pptx_ui_draft - PPTX -> extracted pictures -> Unity assets -> PlanningIntent.
 *
 * This tool needs a live Unity bridge because it imports matched PPTX picture
 * assets before returning a sprite-populated PlanningIntent draft.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { formatPptxIntentDraft } from "./_intent_draft";
import {
  preparePptxIntentWithAssets,
  type ImportPptxAssetResult,
} from "./_pptx_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Prepare a Unity-ready PlanningIntent draft from a PPTX slide: extract positioned layout and embedded pictures, import matched pictures as Unity Sprites, then return a draft with props.sprite populated.",
  args: {
    path: z.string().describe("PPTX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    slideNumber: z.number().int().positive().optional().describe("1-based slide number to convert and import assets for. Defaults to the first slide."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to 1920."),
    includeImagePlaceholders: z.boolean().optional().describe("Include Image elements for PPTX pictures. Defaults to true."),
    includeShapePanels: z.boolean().optional().describe("Include empty PPTX shapes as Panel elements. Defaults to false."),
    embeddedOutputDir: z.string().optional().describe("Optional local output directory for extracted PPTX images."),
    assetDir: z.string().optional().describe("Unity asset directory for imported PPTX images. Defaults to Assets/UOS/Imported."),
    maxImages: z.number().int().positive().max(500).optional().describe("Maximum embedded images to extract. Defaults to 100."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pptx") {
      throw new Error(`prepare_pptx_ui_draft: expected a .pptx file, got "${basename(resolved)}"`);
    }

    const prepared = await preparePptxIntentWithAssets(
      resolved,
      {
        slideNumber: args.slideNumber,
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        includeImagePlaceholders: args.includeImagePlaceholders,
        includeShapePanels: args.includeShapePanels,
        embeddedOutputDir: args.embeddedOutputDir,
        assetDir: args.assetDir,
        maxImages: args.maxImages,
      },
      async (request) => {
        const imported = await call("import_asset", {
          sourcePath: request.sourcePath,
          assetPath: request.assetPath,
          importAsSprite: true,
        }) as ImportPptxAssetResult;
        return imported;
      },
    );

    return {
      title: `prepare_pptx_ui_draft: ${prepared.draft.intent.screenName}`,
      output:
        `Imported ${prepared.importedAssets.length} PPTX picture asset(s) into Unity.\n\n` +
        formatPptxIntentDraft(prepared.draft) +
        "\n\nNext: call validate_planning_intent on metadata.draft.intent, adjust if needed, then call create_ui_screen.",
      metadata: { ok: true, ...prepared },
    };
  },
});
