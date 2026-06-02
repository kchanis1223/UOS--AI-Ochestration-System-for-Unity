/**
 * pptx_to_images — localHandler stub (NotImplemented).
 *
 * v1 punt: rendering .pptx slides requires native libraries (libreoffice/poppler)
 * we deliberately don't bundle. The agent should pre-render slides to PNG/JPG
 * on disk and use list_planning_materials + read_planning_material instead.
 *
 * Ported from mcp-server/src/tools/planningMaterials.ts (pptxToImagesNotImplemented).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename } from "node:path";

export default tool({
  description:
    "Convert a .pptx deck into an array of per-slide images. NOT IMPLEMENTED (no bundled libreoffice/poppler); pre-render slides on disk and use list_planning_materials instead.",
  args: {
    path: z.string(),
  },
  async execute(args) {
    const name = basename(args.path);
    throw new Error(
      `pptx_to_images is not implemented (would require libreoffice/poppler for "${name}"). ` +
      `Workaround: pre-render slides to PNG/JPG on disk and use list_planning_materials + read_planning_material.`,
    );
  },
});
