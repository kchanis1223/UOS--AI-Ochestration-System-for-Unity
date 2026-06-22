/**
 * create_reference_screen_from_material - auto-route material -> Unity screen.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import type {
  CreateImageScreenResult,
  ImportImageAssetResult,
} from "./_image_intent_assets";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createReferenceScreenFromMaterial,
  formatCreatedMaterialReferenceScreen,
  type MaterialReferenceKind,
} from "./_material_reference_screen";
import type { ImportPptxAssetResult } from "./_pptx_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Create a Unity reference screen from a planning material by auto-routing image/PDF/DOCX/PPTX files to the matching import/render/extract/create workflow.",
  args: {
    path: z.string().describe("Planning material path (image, PDF, DOCX, or PPTX), absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    kind: z.enum(["image", "pdf", "docx", "pptx"]).optional().describe("Optional override when extension-based detection is not enough."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels."),
    clientHintId: z.string().optional().describe("Optional clientHintId for single-image reference workflows."),
    assetPath: z.string().optional().describe("Optional exact Unity destination asset path under Assets/. Only applies to image/PDF/DOCX single-image workflows."),
    assetDir: z.string().optional().describe("Unity asset directory for imported assets. Defaults to Assets/UOS/Imported."),
    outputDir: z.string().optional().describe("Optional local output directory for rendered/extracted intermediate images."),
    desiredWidth: z.number().int().positive().optional().describe("PDF render width in pixels; preserves aspect ratio."),
    scale: z.number().positive().optional().describe("PDF render scale. Ignored when desiredWidth is set."),
    pageNumber: z.number().int().positive().optional().describe("PDF page number. Defaults to 1."),
    imageNumber: z.number().int().positive().optional().describe("DOCX embedded image number. Defaults to 1."),
    packagePath: z.string().optional().describe("DOCX embedded image package path, e.g. word/media/image1.png."),
    slideNumber: z.number().int().positive().optional().describe("PPTX slide number. Defaults to the first slide."),
    pptxMode: z.enum(["editable", "rendered"]).optional().describe("PPTX handling mode. 'editable' converts slide layout into Unity elements; 'rendered' imports a rendered slide PNG as one reference Image."),
    includeImagePlaceholders: z.boolean().optional().describe("PPTX: include Image elements for slide pictures. Defaults to true."),
    includeShapePanels: z.boolean().optional().describe("PPTX: include empty shapes as Panel elements. Defaults to false."),
    embeddedOutputDir: z.string().optional().describe("PPTX embedded image output directory. Defaults to outputDir when provided."),
    maxImages: z.number().int().positive().max(500).optional().describe("Maximum embedded images to extract for DOCX/PPTX. Defaults to 100."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    const created = await createReferenceScreenFromMaterial(
      resolved,
      {
        kind: args.kind as MaterialReferenceKind | undefined,
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        clientHintId: args.clientHintId,
        assetPath: args.assetPath,
        assetDir: args.assetDir,
        outputDir: args.outputDir,
        desiredWidth: args.desiredWidth,
        scale: args.scale,
        pageNumber: args.pageNumber,
        imageNumber: args.imageNumber,
        packagePath: args.packagePath,
        pptxMode: args.pptxMode,
        slideNumber: args.slideNumber,
        includeImagePlaceholders: args.includeImagePlaceholders,
        includeShapePanels: args.includeShapePanels,
        embeddedOutputDir: args.embeddedOutputDir,
        maxImages: args.maxImages,
      },
      async (request) => {
        const imported = await call("import_asset", {
          sourcePath: request.sourcePath,
          assetPath: request.assetPath,
          importAsSprite: true,
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
        const result = await call("create_ui_screen", { intent: normalizeIntentForBridge(intent) }) as CreateImageScreenResult;
        return result;
      },
    );

    return {
      title: `create_reference_screen_from_material: ${created.kind} -> ${created.created.screenId}`,
      output:
        formatCreatedMaterialReferenceScreen(created) +
        "\n\nNext: call capture_preview and inspect the result; compare against the source/rendered image when visual matching matters.",
      metadata: {
        ok: true,
        kind: created.kind,
        pptxMode: created.pptxMode,
        path: created.path,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.intent,
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
