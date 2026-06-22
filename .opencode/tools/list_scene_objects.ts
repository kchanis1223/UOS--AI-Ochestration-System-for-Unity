/**
 * list_scene_objects - bridge proxy. Lists UOS-created non-UI scene objects.
 */
import { tool } from "@opencode-ai/plugin";
import { call } from "./_bridge";
import { SceneObjectData, summarizeSceneObjects } from "./_scene_object";

interface ListSceneObjectsResponse {
  objects?: SceneObjectData[];
}

export default tool({
  description: "List UOS-created non-UI Unity scene objects with persistent object ids, hierarchy paths, active state, transform, and components.",
  args: {},
  async execute() {
    const data = (await call("list_scene_objects", {})) as ListSceneObjectsResponse;
    const objects = Array.isArray(data.objects) ? data.objects : [];
    return {
      title: `list_scene_objects: ${objects.length} found`,
      output: summarizeSceneObjects(objects),
      metadata: { ok: true, count: objects.length, objects },
    };
  },
});
