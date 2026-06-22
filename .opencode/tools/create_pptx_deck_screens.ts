/**
 * create_pptx_deck_screens - PPTX deck -> Unity screens.
 *
 * This is the mutating fast path for a multi-slide PPTX flow. Each selected
 * slide becomes an editable Unity screen, with optional sequential transitions.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createPptxDeckScreensWithAssets,
  formatCreatedPptxDeckScreens,
  type CreatePptxDeckTransitionResult,
  type CreatePptxScreenResult,
  type ImportPptxAssetResult,
} from "./_pptx_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Create Unity UI screens from multiple PPTX slides: extract slide layouts, import matched embedded pictures as Sprites, optionally connect screens with sequential transitions, and optionally activate the first screen.",
  args: {
    path: z.string().describe("PPTX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    slideNumbers: z.array(z.number().int().positive()).max(200).optional().describe("Explicit 1-based slide numbers to convert. When omitted, firstSlide/lastSlide select a range, defaulting to all slides."),
    firstSlide: z.number().int().positive().optional().describe("First 1-based slide number to convert when slideNumbers is omitted."),
    lastSlide: z.number().int().positive().optional().describe("Last 1-based slide number to convert when slideNumbers is omitted."),
    maxSlides: z.number().int().positive().max(200).optional().describe("Maximum slides to convert. Defaults to 20."),
    screenNamePrefix: z.string().optional().describe('Optional prefix for generated screen names, e.g. "Onboarding" creates "Onboarding Slide 1".'),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to 1920."),
    includeImagePlaceholders: z.boolean().optional().describe("Include Image elements for PPTX pictures. Defaults to true."),
    includeShapePanels: z.boolean().optional().describe("Include empty PPTX shapes as Panel elements. Defaults to false."),
    embeddedOutputDir: z.string().optional().describe("Optional local output directory for extracted PPTX images."),
    assetDir: z.string().optional().describe("Unity asset directory for imported PPTX images. Defaults to Assets/UOS/Imported."),
    maxImages: z.number().int().positive().max(500).optional().describe("Maximum embedded images to extract per slide conversion. Defaults to 100."),
    createTransitions: z.boolean().optional().describe("Create sequential transitions between consecutive generated screens. Defaults to false."),
    transitionTriggerPrefix: z.string().optional().describe('Trigger name prefix for generated transitions. Defaults to "next-slide".'),
    activateFirst: z.boolean().optional().describe("Activate the first generated screen after creation. Defaults to false."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pptx") {
      throw new Error(`create_pptx_deck_screens: expected a .pptx file, got "${basename(resolved)}"`);
    }

    const created = await createPptxDeckScreensWithAssets(
      resolved,
      {
        slideNumbers: args.slideNumbers,
        firstSlide: args.firstSlide,
        lastSlide: args.lastSlide,
        maxSlides: args.maxSlides,
        screenNamePrefix: args.screenNamePrefix,
        referenceWidth: args.referenceWidth,
        includeImagePlaceholders: args.includeImagePlaceholders,
        includeShapePanels: args.includeShapePanels,
        embeddedOutputDir: args.embeddedOutputDir,
        assetDir: args.assetDir,
        maxImages: args.maxImages,
        createTransitions: args.createTransitions,
        transitionTriggerPrefix: args.transitionTriggerPrefix,
        activateFirst: args.activateFirst,
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
      async (request) => {
        const transition = await call("create_screen_transition", request) as CreatePptxDeckTransitionResult;
        return transition;
      },
      async (screenId) => {
        const active = await call("set_active_screen", { screenId }) as { screenId?: string; active?: boolean; ok?: boolean };
        return active;
      },
    );

    return {
      title: `create_pptx_deck_screens: ${created.screens.length} screen(s)`,
      output:
        formatCreatedPptxDeckScreens(created) +
        "\n\nNext: call list_screens or get_uos_context, capture previews for the generated screens, then verify key screens against rendered slide references if visual matching matters.",
      metadata: {
        ok: true,
        path: resolved,
        screenCount: created.screens.length,
        slideNumbers: created.slideNumbers,
        screens: created.screens,
        transitions: created.transitions,
        activeScreenId: created.activeScreenId,
        warnings: created.warnings,
      },
    };
  },
});
