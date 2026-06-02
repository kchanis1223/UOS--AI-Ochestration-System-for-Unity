/**
 * get_project_info — bridge proxy. Returns the identity of the Unity project the
 * bridge is currently connected to: { projectPath, projectName, unityVersion }.
 *
 * Derived Unity-side from Application.dataPath (= "<project>/Assets"); the project
 * root is its parent. Used to confirm which project is being edited and to let the
 * uoc-context plugin locate "<projectRoot>/.uoc".
 */
import { tool } from "@opencode-ai/plugin";
import { call } from "./_bridge";

export default tool({
  description:
    "Return the connected Unity project's identity: { projectPath, projectName, unityVersion }. Use to confirm which Unity project the bridge is currently editing.",
  args: {},
  async execute() {
    const data = (await call("get_project_info", {})) as {
      projectPath?: string;
      projectName?: string;
      unityVersion?: string;
    };
    const output = [
      `projectName:  ${data.projectName ?? "(unknown)"}`,
      `projectPath:  ${data.projectPath ?? "(unknown)"}`,
      `unityVersion: ${data.unityVersion ?? "(unknown)"}`,
    ].join("\n");
    return {
      title: `get_project_info: ${data.projectName ?? data.projectPath ?? "connected"}`,
      output,
      metadata: { ok: true, ...data },
    };
  },
});
