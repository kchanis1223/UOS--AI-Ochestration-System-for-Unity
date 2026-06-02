/**
 * get_scene_hierarchy — bridge proxy. Returns the GameObject hierarchy of a
 * screen (or the whole scene) for client feedback.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description: "Return the GameObject hierarchy of a screen (or the whole scene) for client feedback.",
  args: {
    screenId: z.string().optional().describe("If omitted, returns the whole scene hierarchy."),
  },
  async execute(args) {
    const data = (await call("get_scene_hierarchy", args)) as Record<string, unknown>;
    return {
      title: args.screenId !== undefined ? `get_scene_hierarchy: ${args.screenId}` : "get_scene_hierarchy: scene",
      output: JSON.stringify(data, null, 2),
      metadata: { ok: true, hierarchy: data },
    };
  },
});
