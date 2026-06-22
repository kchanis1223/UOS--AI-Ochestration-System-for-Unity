/**
 * update_scene_object - bridge proxy. Updates name, parent, active state, and
 * transform for a UOS-created Unity scene GameObject.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { SceneObjectData, SceneTransformSchema, summarizeSceneObject } from "./_scene_object";

export default tool({
  description: "Update a UOS-created non-UI Unity scene object by objectId. Supports name, parentId, active, and local transform fields.",
  args: {
    objectId: z.string(),
    name: z.string().optional(),
    parentId: z.string().optional().describe("Set to another generated id, or an empty string to unparent to the scene root."),
    active: z.boolean().optional(),
    transform: SceneTransformSchema.optional(),
  },
  async execute(args) {
    if (
      args.name === undefined &&
      args.parentId === undefined &&
      args.active === undefined &&
      args.transform === undefined
    ) {
      return {
        title: "update_scene_object: preflight failed",
        output: "preflight failed:\n  - provide at least one of name, parentId, active, or transform",
        metadata: { ok: false, errors: ["provide at least one of name, parentId, active, or transform"] },
      };
    }
    const data = (await call("update_scene_object", args)) as SceneObjectData;
    return {
      title: `update_scene_object: ${args.objectId}`,
      output: `Updated scene object: ${summarizeSceneObject(data)}`,
      metadata: { ok: true, ...data },
    };
  },
});
