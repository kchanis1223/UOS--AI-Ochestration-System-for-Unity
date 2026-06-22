/**
 * prepare_image_ui_draft - image mockup -> Unity Sprite -> PlanningIntent.
 *
 * This tool needs a live Unity bridge because it imports the image into the
 * selected project before returning a sprite-populated PlanningIntent draft.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import {
  formatImageIntentDraft,
  prepareImageIntentWithAsset,
  type ImportImageAssetResult,
} from "./_image_intent_assets";
import { resolveCandidate, rootDir } from "./_materials";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

export default tool({
  description:
    "Prepare a Unity-ready PlanningIntent draft from a single image mockup/reference: import it as a Unity Sprite and return a full-screen Image element with props.sprite populated.",
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
      throw new Error(`prepare_image_ui_draft: expected an image file, got "${basename(resolved)}"`);
    }

    const prepared = await prepareImageIntentWithAsset(
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
    );

    return {
      title: `prepare_image_ui_draft: ${prepared.intent.screenName}`,
      output:
        "Imported 1 image asset into Unity.\n\n" +
        formatImageIntentDraft(prepared) +
        "\n\nNext: call validate_planning_intent on metadata.intent, adjust if needed, then call create_ui_screen.",
      metadata: { ok: true, ...prepared },
    };
  },
});
