/**
 * create_pdf_page_reference_screen - PDF page -> PNG -> Unity Sprite -> screen.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createPdfReferenceScreen,
  formatCreatedPdfReferenceScreen,
} from "./_pdf_reference_screen";
import type {
  CreateImageScreenResult,
  ImportImageAssetResult,
} from "./_image_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Create a Unity UI reference screen directly from one PDF page: render the page to PNG, import it as a Sprite, and call create_ui_screen.",
  args: {
    path: z.string().describe("PDF path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    pageNumber: z.number().int().positive().optional().describe("1-based PDF page number to render. Defaults to 1."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to the rendered page width."),
    desiredWidth: z.number().int().positive().optional().describe("Target render width in pixels; preserves aspect ratio."),
    scale: z.number().positive().optional().describe("PDF render scale. Ignored when desiredWidth is set."),
    clientHintId: z.string().optional().describe("Optional clientHintId for the generated Image element."),
    outputDir: z.string().optional().describe("Optional local output directory for the rendered page PNG."),
    assetPath: z.string().optional().describe("Optional exact Unity destination asset path under Assets/."),
    assetDir: z.string().optional().describe("Unity asset directory for imported rendered page. Defaults to Assets/UOS/Imported."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pdf") {
      throw new Error(`create_pdf_page_reference_screen: expected a .pdf file, got "${basename(resolved)}"`);
    }

    const created = await createPdfReferenceScreen(
      resolved,
      {
        pageNumber: args.pageNumber,
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        desiredWidth: args.desiredWidth,
        scale: args.scale,
        clientHintId: args.clientHintId,
        outputDir: args.outputDir,
        assetPath: args.assetPath,
        assetDir: args.assetDir,
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
      title: `create_pdf_page_reference_screen: ${created.intent.screenName} -> ${created.created.screenId}`,
      output:
        formatCreatedPdfReferenceScreen(created) +
        "\n\nNext: call capture_preview, inspect the result, then use compare_images against metadata.renderedPage.path if visual matching matters.",
      metadata: {
        ok: true,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.intent,
        source: created.source,
        pdf: created.pdf,
        renderedPage: created.renderedPage,
        renderResult: created.renderResult,
        importedAsset: created.importedAsset,
        warnings: created.warnings,
        validation: created.validation,
        created: created.created,
      },
    };
  },
});
