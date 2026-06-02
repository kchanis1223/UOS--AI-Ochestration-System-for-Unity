/**
 * preprocess_image — localHandler stub (NotImplemented).
 *
 * v1 punt: image preprocessing (downscale/crop) requires sharp/jimp which we
 * deliberately don't bundle. The agent should pre-process images on disk
 * before calling read_planning_material.
 *
 * Ported from mcp-server/src/tools/planningMaterials.ts (preprocessImageNotImplemented).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename } from "node:path";

export default tool({
  description:
    "Apply preprocessing ops (e.g. downscale, crop). NOT IMPLEMENTED (no bundled sharp/jimp); pre-process on disk before read_planning_material.",
  args: {
    path: z.string(),
    ops: z.array(z.record(z.string(), z.unknown())).optional(),
  },
  async execute(args) {
    const name = basename(args.path);
    throw new Error(
      `preprocess_image is not implemented (would require sharp/jimp for "${name}"). ` +
      `Workaround: pre-process images on disk before calling read_planning_material.`,
    );
  },
});
