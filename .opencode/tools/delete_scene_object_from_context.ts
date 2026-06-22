/**
 * delete_scene_object_from_context - resolve a persisted .uos scene object, then delete it.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  firstNonBlank,
  formatLiveSceneObjectRefresh,
  formatSceneObjectCandidate,
  formatSceneObjectResolutionFailure,
  refreshContextFromLiveSceneObjects,
  resolveContextSceneObject,
  SceneObjectSelectorArgs,
  shouldRefreshSceneObjects,
} from "./_scene_object_context";
import { loadUosContext } from "./_uos_context";

export default tool({
  description:
    "Delete one UOS-created non-UI Unity scene object by resolving it from .uos context using object name/type/query/path when objectId is not already known.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then current session directory."),
    contextDir: z
      .string()
      .optional()
      .describe("Explicit .uos context directory. Usually not needed."),
    ...SceneObjectSelectorArgs,
    dryRun: z.boolean().optional().describe("Resolve and report the object without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveSceneObjects(context, {
      enabled: shouldRefreshSceneObjects(args),
    });
    context = refreshed.context;
    const resolution = resolveContextSceneObject(context, args);
    if (!resolution.ok) {
      return {
        title: "delete_scene_object_from_context: unresolved",
        output: formatSceneObjectResolutionFailure(resolution) + formatLiveSceneObjectRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, candidates: resolution.candidates, sceneObjectRefresh: refreshed.refresh },
      };
    }

    const deleteArgs = { objectId: resolution.candidate.objectId };
    if (args.dryRun === true) {
      return {
        title: `delete_scene_object_from_context: dry run ${resolution.candidate.objectId}`,
        output: `Resolved ${formatSceneObjectCandidate(resolution.candidate)}. Dry run only; Unity was not modified.` +
          formatLiveSceneObjectRefresh(refreshed.refresh),
        metadata: {
          ok: true,
          dryRun: true,
          matched: resolution.candidate,
          deleteArgs,
          sceneObjectRefresh: refreshed.refresh,
        },
      };
    }

    const deleted = (await call("delete_scene_object", deleteArgs)) as Record<string, unknown>;
    return {
      title: `delete_scene_object_from_context: ${resolution.candidate.objectId}`,
      output: `Deleted ${formatSceneObjectCandidate(resolution.candidate)}.` +
        formatLiveSceneObjectRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution.candidate,
        deleteArgs,
        deleted,
        sceneObjectRefresh: refreshed.refresh,
        ...deleted,
      },
    };
  },
});
