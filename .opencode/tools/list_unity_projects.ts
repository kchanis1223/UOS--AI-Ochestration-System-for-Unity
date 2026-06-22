/**
 * list_unity_projects - inspect live Unity Editor bridge targets.
 *
 * Read-only. The Orchestrator uses this when the user wants to choose or
 * confirm which connected Unity project should be edited.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
// @ts-expect-error - shared launcher helpers are pure JS.
import { discoverLiveEditors, label } from "../../bin/uos-core.js";
import {
  publicUnityTarget,
  readActiveUnityTarget,
  sameUnityTarget,
  type UnityTargetEntry,
} from "./_unity_target_state";

export default tool({
  description:
    "List live Unity Editor projects connected to UOS and show which project is currently selected for editing. Read-only; use select_unity_project to switch.",
  args: {
    includeSelectors: z
      .boolean()
      .optional()
      .describe("Include selector hints for each project. Defaults to true."),
  },
  async execute(args) {
    const result = await listUnityProjects({
      includeSelectors: args.includeSelectors !== false,
      env: processEnv(),
    });
    return {
      title: `list_unity_projects: ${result.editors.length} live project(s)`,
      output: result.output,
      metadata: {
        ok: true,
        count: result.editors.length,
        selected: result.selected,
        editors: result.editors,
      },
    };
  },
});

export async function listUnityProjects(options: {
  includeSelectors?: boolean;
  env?: Record<string, string | undefined>;
  discover?: () => Promise<UnityTargetEntry[]>;
} = {}) {
  const env = options.env ?? processEnv();
  const editors = await (options.discover ?? (() => discoverLiveEditors({ env })))();
  const active = await readActiveUnityTarget({ env });
  const selectedTarget = active?.target;
  const publicEditors = editors.map((entry, index) => ({
    ...publicUnityTarget(entry, index + 1),
    selected: sameUnityTarget(entry, selectedTarget),
  }));
  const selected = selectedTarget !== undefined
    ? {
      ...publicUnityTarget(selectedTarget),
      source: active?.source,
      stateFile: active?.stateFile,
    }
    : undefined;
  return {
    editors: publicEditors,
    selected,
    output: formatUnityProjectList(editors, selectedTarget, options.includeSelectors !== false),
  };
}

function formatUnityProjectList(
  editors: UnityTargetEntry[],
  selected: UnityTargetEntry | undefined,
  includeSelectors: boolean,
): string {
  if (editors.length === 0) {
    return [
      "[uos] no live Unity Editor bridge found.",
      "Open a Unity project with Oh My Unity installed, then use Window > Oh My Unity > Monitor.",
    ].join("\n");
  }
  const lines = ["[uos] connected Unity projects:"];
  editors.forEach((entry, index) => {
    const current = sameUnityTarget(entry, selected) ? " [selected]" : "";
    const id = entry.instanceId !== undefined ? ` id=${entry.instanceId}` : "";
    lines.push(`  ${index + 1}. ${label(entry)}${id}${current}`);
    if (includeSelectors) {
      const selectors = [
        String(index + 1),
        entry.instanceId,
        entry.projectName,
        entry.projectPath,
      ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      lines.push(`     selectors: ${selectors.join(" | ")}`);
    }
  });
  if (selected !== undefined && !editors.some((entry) => sameUnityTarget(entry, selected))) {
    lines.push(`[uos] current selection is not live: ${label(selected)}`);
  }
  lines.push("Use select_unity_project with an index, id, name, or path before editing a different target.");
  return lines.join("\n");
}

function processEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}
