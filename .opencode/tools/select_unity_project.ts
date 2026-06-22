/**
 * select_unity_project - switch the active Unity Editor target inside an
 * opencode UOS session.
 *
 * This does not mutate Unity content. It only changes which live bridge future
 * Editor tools call.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
// @ts-expect-error - shared launcher helpers are pure JS.
import { discoverLiveEditors, label, selectEditorBySelector } from "../../bin/uos-core.js";
import {
  applyUnityTargetToEnv,
  publicUnityTarget,
  readActiveUnityTarget,
  sameUnityTarget,
  writeActiveUnityTarget,
  type UnityTargetEntry,
} from "./_unity_target_state";
import { listUnityProjects } from "./list_unity_projects";

export default tool({
  description:
    "Select which live Unity Editor project UOS should edit in this opencode session. Pass an index, instance id, project name, or project path from list_unity_projects. Does not mutate Unity content.",
  args: {
    selector: z
      .string()
      .optional()
      .describe("Project selector: list index, editor instance id, project name, or project path. If omitted, returns the live project list without switching."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Resolve the selector and show what would be selected without changing the active target."),
  },
  async execute(args, ctx) {
    const result = await selectUnityProject({
      selector: args.selector,
      dryRun: args.dryRun === true,
      env: processEnv(),
      cwd: ctx.directory,
    });
    return {
      title: result.title,
      output: result.output,
      metadata: result.metadata,
    };
  },
});

export async function selectUnityProject(options: {
  selector?: string;
  dryRun?: boolean;
  env?: Record<string, string | undefined>;
  cwd?: string;
  discover?: () => Promise<UnityTargetEntry[]>;
}) {
  const env = options.env ?? processEnv();
  const discover = options.discover ?? (() => discoverLiveEditors({ env }));
  const selector = stringValue(options.selector);
  if (selector === undefined) {
    const listed = await listUnityProjects({ env, discover });
    return {
      title: `select_unity_project: choose a project`,
      output: [
        listed.output,
        "",
        "No selector was provided. Ask the user which project to edit, then call select_unity_project again.",
      ].join("\n"),
      metadata: {
        ok: true,
        selected: listed.selected,
        editors: listed.editors,
        switched: false,
        needsSelector: true,
      },
    };
  }

  const editors = await discover();
  const selected = selectEditorBySelector(editors, selector) as UnityTargetEntry;
  const previous = await readActiveUnityTarget({ env, cwd: options.cwd });
  const alreadySelected = sameUnityTarget(previous?.target, selected);
  if (options.dryRun === true) {
    return {
      title: `select_unity_project: dry run ${selected.projectName ?? selected.projectPath ?? selected.instanceId ?? selector}`,
      output: [
        `[uos] would select Unity project: ${label(selected)}`,
        alreadySelected ? "[uos] target is already selected." : "[uos] dryRun=true, active target unchanged.",
      ].join("\n"),
      metadata: {
        ok: true,
        selected: publicUnityTarget(selected),
        previous: previous !== undefined ? publicUnityTarget(previous.target) : undefined,
        switched: false,
        dryRun: true,
      },
    };
  }

  const state = await writeActiveUnityTarget(selected, { env, cwd: options.cwd });
  applyUnityTargetToEnv(selected, env, state.stateFile);
  return {
    title: `select_unity_project: ${selected.projectName ?? selected.projectPath ?? selected.instanceId ?? "selected"}`,
    output: [
      `[uos] selected Unity project: ${label(selected)}`,
      alreadySelected ? "[uos] target was already active." : "[uos] future Unity bridge calls in this session will use this target.",
      state.stateFile !== undefined ? `[uos] session target state: ${state.stateFile}` : "",
      "Call get_uos_context next to load the selected project's .uos context before mutating Unity.",
    ].filter(Boolean).join("\n"),
    metadata: {
      ok: true,
      selected: publicUnityTarget(selected),
      previous: previous !== undefined ? publicUnityTarget(previous.target) : undefined,
      stateFile: state.stateFile,
      switched: !alreadySelected,
      dryRun: false,
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function processEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}
