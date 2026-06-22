/**
 * get_project_info - bridge proxy.
 *
 * Returns the selected Unity project's identity plus UOS bridge/package
 * metadata. Application.dataPath is "<project>/Assets"; the project root is its
 * parent. The UOS context plugin uses this to locate "<projectRoot>/.uos".
 */
import { tool } from "@opencode-ai/plugin";
import { call } from "./_bridge";

export interface ProjectInfoPayload {
  projectPath?: string;
  projectName?: string;
  unityVersion?: string;
  uosPackageName?: string;
  uosPackageVersion?: string;
  protocolVersion?: string;
  bridgeHost?: string;
  bridgePort?: number;
  autoStartBridge?: boolean;
  editorInstanceId?: string;
  supportedTools?: string[];
  writeTools?: string[];
}

function formatSupportedTools(tools: string[] | undefined): string {
  return tools === undefined ? "(unknown)" : `${tools.length} supported`;
}

function formatWriteTools(tools: string[] | undefined): string {
  if (tools === undefined) return "(unknown)";
  return tools.length > 0 ? tools.join(", ") : "0 write tools";
}

export function formatProjectInfoOutput(data: ProjectInfoPayload): string {
  return [
    `projectName:  ${data.projectName ?? "(unknown)"}`,
    `projectPath:  ${data.projectPath ?? "(unknown)"}`,
    `unityVersion: ${data.unityVersion ?? "(unknown)"}`,
    `uosPackage:   ${data.uosPackageName ?? "(unknown)"} ${data.uosPackageVersion ?? ""}`.trimEnd(),
    `protocol:     ${data.protocolVersion ?? "(unknown)"}`,
    `bridge:       ${data.bridgeHost ?? "(unknown)"}:${data.bridgePort ?? "(unknown)"}`,
    `autoStart:    ${data.autoStartBridge === undefined ? "(unknown)" : String(data.autoStartBridge)}`,
    `instanceId:   ${data.editorInstanceId ?? "(unknown)"}`,
    `tools:        ${formatSupportedTools(Array.isArray(data.supportedTools) ? data.supportedTools : undefined)}`,
    `writeTools:   ${formatWriteTools(Array.isArray(data.writeTools) ? data.writeTools : undefined)}`,
  ].join("\n");
}

export default tool({
  description:
    "Return the connected Unity project's identity and UOS bridge metadata. Use to confirm which Unity project the bridge is currently editing.",
  args: {},
  async execute() {
    const data = (await call("get_project_info", {})) as ProjectInfoPayload;
    const output = formatProjectInfoOutput(data);
    return {
      title: `get_project_info: ${data.projectName ?? data.projectPath ?? "connected"}`,
      output,
      metadata: { ok: true, ...data },
    };
  },
});
