/**
 * delete_scene_object - bridge proxy. Deletes a UOS-created Unity scene object.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description: "Delete a UOS-created non-UI Unity scene object by objectId.",
  args: {
    objectId: z.string(),
  },
  async execute(args) {
    const data = (await call("delete_scene_object", args)) as Record<string, unknown>;
    return {
      title: `delete_scene_object: ${args.objectId}`,
      output: `Deleted scene object ${args.objectId}.`,
      metadata: { ok: true, ...data },
    };
  },
});
