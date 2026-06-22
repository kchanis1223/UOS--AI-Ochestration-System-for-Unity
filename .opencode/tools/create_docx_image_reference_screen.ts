/**
 * create_docx_image_reference_screen - DOCX embedded image -> Unity Sprite -> screen.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createDocxImageReferenceScreen,
  formatCreatedDocxImageReferenceScreen,
} from "./_docx_reference_screen";
import type {
  CreateImageScreenResult,
  ImportImageAssetResult,
} from "./_image_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Create a Unity UI reference screen directly from a DOCX embedded image: extract a raster image, import it as a Sprite, and call create_ui_screen.",
  args: {
    path: z.string().describe("DOCX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    imageNumber: z.number().int().positive().optional().describe("1-based extracted image number to use. Defaults to 1."),
    packagePath: z.string().optional().describe("Optional exact DOCX package path, e.g. word/media/image1.png. Overrides imageNumber."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to the embedded image width when available."),
    clientHintId: z.string().optional().describe("Optional clientHintId for the generated Image element."),
    outputDir: z.string().optional().describe("Optional local output directory for extracted DOCX images."),
    assetPath: z.string().optional().describe("Optional exact Unity destination asset path under Assets/."),
    assetDir: z.string().optional().describe("Unity asset directory for imported embedded image. Defaults to Assets/UOS/Imported."),
    maxImages: z.number().int().positive().max(500).optional().describe("Maximum embedded images to extract. Defaults to 100."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".docx") {
      throw new Error(`create_docx_image_reference_screen: expected a .docx file, got "${basename(resolved)}"`);
    }

    const created = await createDocxImageReferenceScreen(
      resolved,
      {
        imageNumber: args.imageNumber,
        packagePath: args.packagePath,
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        clientHintId: args.clientHintId,
        outputDir: args.outputDir,
        assetPath: args.assetPath,
        assetDir: args.assetDir,
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
      async (intent) => {
        const result = await call("create_ui_screen", { intent: normalizeIntentForBridge(intent) }) as CreateImageScreenResult;
        return result;
      },
    );

    return {
      title: `create_docx_image_reference_screen: ${created.intent.screenName} -> ${created.created.screenId}`,
      output:
        formatCreatedDocxImageReferenceScreen(created) +
        "\n\nNext: call capture_preview, inspect the result, then use compare_images against metadata.embeddedImage.path if visual matching matters.",
      metadata: {
        ok: true,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.intent,
        source: created.source,
        docx: created.docx,
        embeddedImage: created.embeddedImage,
        embeddedImages: created.embeddedImages,
        extraction: created.extraction,
        importedAsset: created.importedAsset,
        warnings: created.warnings,
        validation: created.validation,
        created: created.created,
      },
    };
  },
});
