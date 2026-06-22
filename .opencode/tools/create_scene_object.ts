/**
 * create_scene_object - bridge proxy. Creates a non-UI Unity scene GameObject
 * with a persistent UOS object id for conversational follow-up edits.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  SceneObjectData,
  SceneObjectTypeSchema,
  SceneTransformSchema,
  summarizeSceneObject,
} from "./_scene_object";

export default tool({
  description: "Create a non-UI Unity scene object such as Empty, Cube, Sphere, Camera, PointLight, DirectionalLight, or SpotLight. Returns a persistent objectId for follow-up scene edits.",
  args: {
    name: z.string().optional(),
    type: SceneObjectTypeSchema,
    parentId: z.string().optional().describe("Optional parent object id. Can target a UOS scene object id or generated UI/screen element id."),
    active: z.boolean().optional(),
    transform: SceneTransformSchema.optional(),
  },
  async execute(args) {
    const data = (await call("create_scene_object", args)) as SceneObjectData;
    return {
      title: `create_scene_object: ${data.objectId ?? args.name ?? args.type ?? "object"}`,
      output: `Created scene object: ${summarizeSceneObject(data)}`,
      metadata: { ok: true, ...data },
    };
  },
});
