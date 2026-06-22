/**
 * import_asset - bridge proxy. Copies a local source file into the selected
 * Unity project's Assets folder and optionally imports images as sprites.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Import a local file into the selected Unity project's Assets folder. Use importAsSprite:true for images referenced as props.sprite, and importAsSprite:false for video files referenced as props.video.",
  args: {
    sourcePath: z.string().describe("Local source file path, absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    assetPath: z
      .string()
      .optional()
      .describe("Optional destination asset path. Defaults to Assets/UOS/Imported/<filename>."),
    importAsSprite: z
      .boolean()
      .optional()
      .describe("When true, image imports are configured as Sprite assets. Use false for video/content assets. Defaults to true."),
  },
  async execute(args, ctx) {
    const sourcePath = resolveCandidate(args.sourcePath, rootDir(ctx.directory));
    const data = (await call("import_asset", {
      sourcePath,
      assetPath: args.assetPath,
      importAsSprite: args.importAsSprite ?? true,
    })) as {
      ok: boolean;
      sourcePath: string;
      assetPath: string;
      importedAsSprite: boolean;
      assetType?: string;
    };

    return {
      title: `import_asset: ${data.assetPath}`,
      output:
        `Imported ${data.sourcePath} -> ${data.assetPath}\n` +
        `Sprite: ${data.importedAsSprite ? "yes" : "no"}${data.assetType ? `\nAsset type: ${data.assetType}` : ""}`,
      metadata: { ok: true, ...data },
    };
  },
});
