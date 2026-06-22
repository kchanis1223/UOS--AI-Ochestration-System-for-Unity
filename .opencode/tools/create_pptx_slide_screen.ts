/**
 * create_pptx_slide_screen - PPTX slide -> Unity assets -> screen.
 *
 * This is the mutating fast path for a single PPTX slide when its structured
 * layout can directly seed a Unity screen.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createPptxScreenWithAssets,
  formatCreatedPptxScreen,
  type CreatePptxScreenResult,
  type ImportPptxAssetResult,
} from "./_pptx_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Create a Unity UI screen directly from one PPTX slide: extract positioned layout, import matched embedded pictures as Sprites, and call create_ui_screen.",
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
      throw new Error(`create_pptx_slide_screen: expected a .pptx file, got "${basename(resolved)}"`);
    }

    const created = await createPptxScreenWithAssets(
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
      async (intent) => {
        const result = await call("create_ui_screen", { intent: normalizeIntentForBridge(intent) }) as CreatePptxScreenResult;
        return result;
      },
    );

    return {
      title: `create_pptx_slide_screen: ${created.draft.intent.screenName} -> ${created.created.screenId}`,
      output:
        formatCreatedPptxScreen(created) +
        "\n\nNext: call capture_preview, inspect the result, then use compare_images against a rendered slide if visual matching matters.",
      metadata: {
        ok: true,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.draft.intent,
        draft: created.draft,
        importedAssets: created.importedAssets,
        assetMap: created.assetMap,
        embeddedImages: created.embeddedImages,
        warnings: created.warnings,
        validation: created.validation,
        created: created.created,
      },
    };
  },
});
