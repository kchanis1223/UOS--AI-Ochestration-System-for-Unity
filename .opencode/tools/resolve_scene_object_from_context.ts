/**
 * resolve_scene_object_from_context - read-only resolver for persisted UOS scene objects.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
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
    "Resolve one UOS-created non-UI Unity scene object from .uos context using objectId, object name, type, path, or a natural query. Use before scene-object follow-up edits when the canonical objectId is not already known.",
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
        title: "resolve_scene_object_from_context: unresolved",
        output: formatSceneObjectResolutionFailure(resolution) + formatLiveSceneObjectRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, candidates: resolution.candidates, sceneObjectRefresh: refreshed.refresh },
      };
    }

    return {
      title: `resolve_scene_object_from_context: ${resolution.candidate.objectId}`,
      output: `Resolved ${formatSceneObjectCandidate(resolution.candidate)}.` +
        formatLiveSceneObjectRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        sceneObject: resolution.candidate,
        sceneObjectRefresh: refreshed.refresh,
      },
    };
  },
});
