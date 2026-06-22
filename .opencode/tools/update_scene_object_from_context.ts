/**
 * update_scene_object_from_context - resolve a persisted .uos scene object, then update it.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { SceneTransformSchema } from "./_scene_object";
import {
  compactObject,
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
    "Update one UOS-created non-UI Unity scene object by resolving it from .uos context using object name/type/query/path when objectId is not already known. Supports name, parentId, active, and local transform changes.",
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
    name: z.string().optional().describe("New scene object name."),
    parentId: z.string().optional().describe("Set to another generated object/screen/element id, or an empty string to unparent to the scene root."),
    active: z.boolean().optional().describe("New GameObject active state."),
    transform: SceneTransformSchema.optional().describe("New local transform fields to apply."),
    dryRun: z.boolean().optional().describe("Resolve and report the object/update payload without calling Unity. Defaults to false."),
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
        title: "update_scene_object_from_context: unresolved",
        output: formatSceneObjectResolutionFailure(resolution) + formatLiveSceneObjectRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, candidates: resolution.candidates, sceneObjectRefresh: refreshed.refresh },
      };
    }

    const updateArgs = compactObject({
      objectId: resolution.candidate.objectId,
      name: args.name,
      parentId: args.parentId,
      active: args.active,
      transform: args.transform,
    });
    const hasPatch =
      args.name !== undefined ||
      args.parentId !== undefined ||
      args.active !== undefined ||
      args.transform !== undefined;
    if (!hasPatch && args.dryRun !== true) {
      return {
        title: "update_scene_object_from_context: no update fields",
        output: "Resolved the target scene object, but no name, parentId, active, or transform update was provided. Unity was not modified." +
          formatLiveSceneObjectRefresh(refreshed.refresh),
        metadata: {
          ok: false,
          reason: "no name, parentId, active, or transform update provided",
          matched: resolution.candidate,
          updateArgs,
          sceneObjectRefresh: refreshed.refresh,
        },
      };
    }
    if (args.dryRun === true) {
      return {
        title: `update_scene_object_from_context: dry run ${resolution.candidate.objectId}`,
        output: `Resolved ${formatSceneObjectCandidate(resolution.candidate)}. Dry run only; Unity was not modified.` +
          formatLiveSceneObjectRefresh(refreshed.refresh),
        metadata: {
          ok: true,
          dryRun: true,
          matched: resolution.candidate,
          updateArgs,
          sceneObjectRefresh: refreshed.refresh,
        },
      };
    }

    const updated = (await call("update_scene_object", updateArgs)) as Record<string, unknown>;
    return {
      title: `update_scene_object_from_context: ${resolution.candidate.objectId}`,
      output: `Updated ${formatSceneObjectCandidate(resolution.candidate)}.` +
        formatLiveSceneObjectRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution.candidate,
        updateArgs,
        updated,
        sceneObjectRefresh: refreshed.refresh,
        ...updated,
      },
    };
  },
});
