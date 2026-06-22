/**
 * create_image_reference_screen - image mockup -> Unity Sprite -> screen.
 *
 * This is the mutating fast path for a single mockup/reference image. It keeps
 * prepare_image_ui_draft available for review/revision-first workflows.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createImageReferenceScreenWithAsset,
  formatCreatedImageReferenceScreen,
  type CreateImageScreenResult,
  type ImportImageAssetResult,
} from "./_image_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export default tool({
  description:
    "Create a Unity UI reference screen directly from a single image mockup/reference: import the image as a Sprite, build a full-screen Image PlanningIntent, and call create_ui_screen.",
  args: {
    path: z.string().describe("Image path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to the image width, clamped to 8192."),
    clientHintId: z.string().optional().describe("Optional clientHintId for the generated Image element."),
    assetPath: z.string().optional().describe("Optional exact Unity destination asset path under Assets/."),
    assetDir: z.string().optional().describe("Unity asset directory for imported image. Defaults to Assets/UOS/Imported."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    const ext = extname(resolved).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
      throw new Error(`create_image_reference_screen: expected an image file, got "${basename(resolved)}"`);
    }

    const created = await createImageReferenceScreenWithAsset(
      resolved,
      {
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        clientHintId: args.clientHintId,
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
      title: `create_image_reference_screen: ${created.intent.screenName} -> ${created.created.screenId}`,
      output:
        formatCreatedImageReferenceScreen(created) +
        "\n\nNext: call capture_preview, inspect the result, then use compare_images against the source if visual matching matters.",
      metadata: {
        ok: true,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.intent,
        source: created.source,
        importedAsset: created.importedAsset,
        warnings: created.warnings,
        validation: created.validation,
        created: created.created,
      },
    };
  },
});
