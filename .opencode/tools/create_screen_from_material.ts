/**
 * create_screen_from_material - smart material -> Unity screen router.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import type { ImportImageAssetResult } from "./_image_intent_assets";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createScreenFromMaterial,
  formatCreatedMaterialScreen,
  type MaterialScreenKind,
  type MaterialScreenMode,
} from "./_material_screen";
import type { ImportPptxAssetResult } from "./_pptx_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Create a Unity screen from any supported planning material. Auto-routes images to reference screens, video files to playable Video UI content, PPTX to editable slide screens, and text-forward PDF/DOCX/Markdown/text/CSV/JSON documents to editable document screens. Use mode:'reference' for PDF/DOCX visual reference screens.",
  args: {
    path: z.string().describe("Planning material path, absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    kind: z.enum(["image", "video", "pdf", "docx", "pptx", "document"]).optional().describe("Optional override when extension-based detection is not enough."),
    mode: z.enum(["auto", "editable", "reference"]).optional().describe("Routing mode. Defaults to auto: image reference, PPTX editable, PDF/DOCX/text editable document."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels."),
    referenceHeight: z.number().int().positive().optional().describe("Document editable screen reference canvas height in pixels."),
    maxTextElements: z.number().int().positive().max(30).optional().describe("Document editable mode: maximum body text elements after the title."),
    includeBackground: z.boolean().optional().describe("Document editable mode: include a full-screen background Panel. Defaults to true."),
    includeButtons: z.boolean().optional().describe("Document editable mode: convert explicit CTA/button/action labels into Button elements. Defaults to true."),
    clientHintId: z.string().optional().describe("Reference mode: optional clientHintId for single-image reference workflows."),
    assetPath: z.string().optional().describe("Reference mode: optional exact Unity destination asset path under Assets/."),
    assetDir: z.string().optional().describe("Reference mode: Unity asset directory for imported assets. Defaults to Assets/UOS/Imported."),
    outputDir: z.string().optional().describe("Reference mode: optional local output directory for rendered/extracted intermediate images."),
    desiredWidth: z.number().int().positive().optional().describe("PDF/PPTX reference mode render width in pixels; preserves aspect ratio."),
    scale: z.number().positive().optional().describe("PDF/PPTX reference mode render scale. Ignored when desiredWidth is set."),
    pageNumber: z.number().int().positive().optional().describe("PDF reference page number. Defaults to 1."),
    imageNumber: z.number().int().positive().optional().describe("DOCX reference embedded image number. Defaults to 1."),
    packagePath: z.string().optional().describe("DOCX reference exact embedded image package path."),
    slideNumber: z.number().int().positive().optional().describe("PPTX slide number. Defaults to first slide."),
    pptxMode: z.enum(["editable", "rendered"]).optional().describe("PPTX routing inside reference helper. Defaults to editable unless mode:'reference' and rendered is requested."),
    includeImagePlaceholders: z.boolean().optional().describe("PPTX editable mode: include Image elements for slide pictures. Defaults to true."),
    includeShapePanels: z.boolean().optional().describe("PPTX editable mode: include empty shapes as Panel elements. Defaults to false."),
    embeddedOutputDir: z.string().optional().describe("PPTX embedded image output directory. Defaults to outputDir when provided."),
    maxImages: z.number().int().positive().max(500).optional().describe("Maximum embedded images to extract for DOCX/PPTX. Defaults to 100."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    const created = await createScreenFromMaterial(
      resolved,
      {
        kind: args.kind as MaterialScreenKind | undefined,
        mode: args.mode as MaterialScreenMode | undefined,
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        referenceHeight: args.referenceHeight,
        maxTextElements: args.maxTextElements,
        includeBackground: args.includeBackground,
        includeButtons: args.includeButtons,
        clientHintId: args.clientHintId,
        assetPath: args.assetPath,
        assetDir: args.assetDir,
        outputDir: args.outputDir,
        desiredWidth: args.desiredWidth,
        scale: args.scale,
        pageNumber: args.pageNumber,
        imageNumber: args.imageNumber,
        packagePath: args.packagePath,
        slideNumber: args.slideNumber,
        pptxMode: args.pptxMode,
        includeImagePlaceholders: args.includeImagePlaceholders,
        includeShapePanels: args.includeShapePanels,
        embeddedOutputDir: args.embeddedOutputDir,
        maxImages: args.maxImages,
      },
      async (request) => {
        const imported = await call("import_asset", {
          sourcePath: request.sourcePath,
          assetPath: request.assetPath,
          importAsSprite: request.importAsSprite,
        }) as ImportImageAssetResult;
        return imported;
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
        const result = await call("create_ui_screen", { intent: normalizeIntentForBridge(intent) }) as { screenId: string; elements: Array<{ clientHintId?: string; elementId: string }> };
        return result;
      },
    );

    return {
      title: `create_screen_from_material: ${created.kind}/${created.mode} -> ${created.created.screenId}`,
      output:
        formatCreatedMaterialScreen(created) +
        "\n\nNext: call capture_preview and inspect the result; use verify_screen_against_reference when a visual reference image is available.",
      metadata: {
        ok: true,
        kind: created.kind,
        mode: created.mode,
        path: created.path,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.intent,
        source: created.source,
        importedAsset: created.importedAsset,
        importedAssets: created.importedAssets,
        warnings: created.warnings,
        validation: created.validation,
        created: created.created,
        specific: created.specific,
      },
    };
  },
});
