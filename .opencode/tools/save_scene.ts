/**
 * save_scene - bridge proxy. Saves the active Unity scene so generated UI
 * persists on disk.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description:
    "Save the active Unity scene. If path is omitted, saves the current scene path; unsaved scenes default to Assets/UOS_Generated.unity.",
  args: {
    path: z
      .string()
      .optional()
      .describe("Optional scene asset path. Relative paths resolve under Assets; must end with .unity."),
  },
  async execute(args) {
    const data = (await call("save_scene", args)) as {
      ok: boolean;
      path: string;
      sceneName?: string;
    };
    return {
      title: `save_scene: ${data.path}`,
      output: `Saved active scene${data.sceneName ? ` "${data.sceneName}"` : ""} to ${data.path}`,
      metadata: { ok: true, ...data },
    };
  },
});
