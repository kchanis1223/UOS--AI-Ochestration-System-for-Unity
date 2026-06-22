/**
 * create_screen_transition_from_context - resolve persisted .uos screens/trigger, then create transition.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { loadUosContext, type LoadedUosContext } from "./_uos_context";
import {
  resolveContextScreen,
  screenCandidates,
  type ContextAddTargetResolution,
} from "./add_ui_element_from_context";
import {
  resolveContextElement,
  type ContextElementCandidate,
} from "./update_ui_element_from_context";

export interface ContextTransitionCriteria {
  fromId?: string;
  fromScreenName?: string;
  fromScreenQuery?: string;
  fromSourceKind?: string;
  fromSourcePath?: string;
  fromSourcePathContains?: string;
  fromPageNumber?: number;
  fromSlideNumber?: number;
  fromImageNumber?: number;
  fromLatest?: boolean;
  toId?: string;
  toScreenName?: string;
  toScreenQuery?: string;
  toSourceKind?: string;
  toSourcePath?: string;
  toSourcePathContains?: string;
  toPageNumber?: number;
  toSlideNumber?: number;
  toImageNumber?: number;
  toLatest?: boolean;
  trigger?: string;
  triggerElementId?: string;
  triggerClientHintId?: string;
  triggerType?: string;
  triggerText?: string;
  triggerTextContains?: string;
  triggerQuery?: string;
  includeDeleted?: boolean;
}

export type ContextTransitionResolution =
  | {
      ok: true;
      fromId: string;
      fromScreenName?: string;
      toId: string;
      toScreenName?: string;
      trigger: string;
      triggerElement?: ContextElementCandidate;
    }
  | {
      ok: false;
      reason: string;
      screens: Array<{ screenId: string; screenName?: string }>;
      triggerCandidates?: ContextElementCandidate[];
    };

export default tool({
  description:
    "Create a screen transition by resolving source/target screens and optional trigger element from persisted .uos context. Use for conversational navigation edits when screenId or trigger elementId is not already known. If the source screen is omitted, the persisted active screen is used when available; the target screen must still be specified.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then current session directory."),
    contextDir: z
      .string()
      .optional()
      .describe("Explicit .uos context directory. Usually not needed."),
    fromId: z.string().optional().describe("Exact source screenId. When omitted with fromScreenName, the active screen is used if one is persisted."),
    fromScreenName: z.string().optional().describe("Exact or unique case-insensitive source screenName. When omitted with fromId, the active screen is used if one is persisted."),
    fromScreenQuery: z.string().optional().describe("Natural source screen query matched against screen name/id, source metadata, or the persisted active screen."),
    fromSourceKind: z.string().optional().describe("Source screen persisted kind filter such as image, pdf, pptx, docx, md, txt, csv, or json."),
    fromSourcePath: z.string().optional().describe("Exact source screen persisted source path filter, case-insensitive."),
    fromSourcePathContains: z.string().optional().describe("Substring source screen persisted source path filter, case-insensitive."),
    fromPageNumber: z.number().int().positive().optional().describe("Source screen PDF page number filter."),
    fromSlideNumber: z.number().int().positive().optional().describe("Source screen PPTX slide number filter."),
    fromImageNumber: z.number().int().positive().optional().describe("Source screen DOCX embedded image number filter."),
    fromLatest: z.boolean().optional().describe("When several source screens match, choose the most recent one. Defaults to false."),
    toId: z.string().optional().describe("Exact target screenId."),
    toScreenName: z.string().optional().describe("Exact or unique case-insensitive target screenName."),
    toScreenQuery: z.string().optional().describe("Natural target screen query matched against screen name/id, source metadata, or the persisted active screen."),
    toSourceKind: z.string().optional().describe("Target screen persisted kind filter such as image, pdf, pptx, docx, md, txt, csv, or json."),
    toSourcePath: z.string().optional().describe("Exact target screen persisted source path filter, case-insensitive."),
    toSourcePathContains: z.string().optional().describe("Substring target screen persisted source path filter, case-insensitive."),
    toPageNumber: z.number().int().positive().optional().describe("Target screen PDF page number filter."),
    toSlideNumber: z.number().int().positive().optional().describe("Target screen PPTX slide number filter."),
    toImageNumber: z.number().int().positive().optional().describe("Target screen DOCX embedded image number filter."),
    toLatest: z.boolean().optional().describe("When several target screens match, choose the most recent one. Defaults to false."),
    trigger: z.string().optional().describe("Direct trigger string. Use this when the trigger is already a canonical elementId or named event."),
    triggerElementId: z.string().optional().describe("Exact canonical trigger elementId on the source screen."),
    triggerClientHintId: z.string().optional().describe("Exact trigger clientHintId on the source screen."),
    triggerType: z.string().optional().describe("Trigger element type filter, usually Button."),
    triggerText: z.string().optional().describe("Exact current trigger text filter, case-insensitive."),
    triggerTextContains: z.string().optional().describe("Substring current trigger text filter, case-insensitive."),
    triggerQuery: z.string().optional().describe("Natural trigger query matched against screen name, clientHintId, type aliases, and current text, e.g. 'play button', 'primary CTA', or '설정 버튼'."),
    includeDeleted: z.boolean().optional().describe("Allow matching deleted trigger elements in .uos context. Defaults to false."),
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving source, target, or trigger. Defaults to true."),
    dryRun: z.boolean().optional().describe("Resolve and report the transition without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: shouldRefreshLiveHierarchy(args) });
    context = refreshed.context;
    const resolution = resolveContextTransition(context, args);
    if (!resolution.ok) {
      return {
        title: "create_screen_transition_from_context: unresolved",
        output: formatTransitionFailure(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: false,
          reason: resolution.reason,
          screens: resolution.screens,
          triggerCandidates: resolution.triggerCandidates,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const transitionArgs = {
      fromId: resolution.fromId,
      toId: resolution.toId,
      trigger: resolution.trigger,
    };
    if (args.dryRun === true) {
      return {
        title: "create_screen_transition_from_context: dry run",
        output: `Resolved transition ${formatScreen(resolution.fromId, resolution.fromScreenName)} -> ${formatScreen(resolution.toId, resolution.toScreenName)} (trigger: ${resolution.trigger}). Dry run only; Unity was not modified.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: true,
          dryRun: true,
          matched: resolution,
          transitionArgs,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const created = (await call("create_screen_transition", transitionArgs)) as Record<string, unknown>;
    return {
      title: `create_screen_transition_from_context: ${resolution.fromId} -> ${resolution.toId}`,
      output: `Created transition ${formatScreen(resolution.fromId, resolution.fromScreenName)} -> ${formatScreen(resolution.toId, resolution.toScreenName)} (trigger: ${resolution.trigger}).` +
        formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution,
        transitionArgs,
        created,
        contextRefresh: refreshed.refresh,
        ...created,
      },
    };
  },
});

export function resolveContextTransition(
  context: LoadedUosContext,
  criteria: ContextTransitionCriteria,
): ContextTransitionResolution {
  const from = resolveContextScreen(context, {
    screenId: criteria.fromId,
    screenName: criteria.fromScreenName,
    screenQuery: criteria.fromScreenQuery,
    sourceKind: criteria.fromSourceKind,
    sourcePath: criteria.fromSourcePath,
    sourcePathContains: criteria.fromSourcePathContains,
    pageNumber: criteria.fromPageNumber,
    slideNumber: criteria.fromSlideNumber,
    imageNumber: criteria.fromImageNumber,
    latest: criteria.fromLatest,
  });
  if (!from.ok) return screenFailure("source", context, from);

  if (!hasTargetSelector(criteria)) {
    return {
      ok: false,
      reason: "target screen is required; provide toId, toScreenName, toScreenQuery, or a target source filter",
      screens: screenCandidates(context.screens),
    };
  }
  const to = resolveContextScreen(context, {
    screenId: criteria.toId,
    screenName: criteria.toScreenName,
    screenQuery: criteria.toScreenQuery,
    sourceKind: criteria.toSourceKind,
    sourcePath: criteria.toSourcePath,
    sourcePathContains: criteria.toSourcePathContains,
    pageNumber: criteria.toPageNumber,
    slideNumber: criteria.toSlideNumber,
    imageNumber: criteria.toImageNumber,
    latest: criteria.toLatest,
  });
  if (!to.ok) return screenFailure("target", context, to);

  const triggerResolution = resolveTrigger(context, from.screen.screenId, criteria);
  if (!triggerResolution.ok) {
    return {
      ok: false,
      reason: triggerResolution.reason,
      screens: screenCandidates(context.screens),
      triggerCandidates: triggerResolution.candidates,
    };
  }

  return {
    ok: true,
    fromId: from.screen.screenId,
    fromScreenName: from.screen.screenName,
    toId: to.screen.screenId,
    toScreenName: to.screen.screenName,
    trigger: triggerResolution.trigger,
    triggerElement: triggerResolution.candidate,
  };
}

function resolveTrigger(
  context: LoadedUosContext,
  fromScreenId: string,
  criteria: ContextTransitionCriteria,
): { ok: true; trigger: string; candidate?: ContextElementCandidate }
  | { ok: false; reason: string; candidates: ContextElementCandidate[] } {
  if (!hasTriggerSelector(criteria)) {
    const direct = firstNonBlank(criteria.trigger);
    if (direct !== undefined) return { ok: true, trigger: direct };
    return {
      ok: false,
      reason: "transition trigger is required; provide trigger or a trigger element selector",
      candidates: triggerCandidates(context, fromScreenId),
    };
  }

  const resolved = resolveContextElement(context, {
    screenId: fromScreenId,
    elementId: criteria.triggerElementId,
    clientHintId: criteria.triggerClientHintId,
    type: criteria.triggerType,
    text: criteria.triggerText,
    textContains: criteria.triggerTextContains,
    query: criteria.triggerQuery,
    includeDeleted: criteria.includeDeleted,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      reason: `trigger ${resolved.reason}`,
      candidates: resolved.candidates,
    };
  }
  return {
    ok: true,
    trigger: resolved.candidate.elementId,
    candidate: resolved.candidate,
  };
}

function hasTriggerSelector(criteria: ContextTransitionCriteria): boolean {
  return criteria.triggerElementId !== undefined
    || criteria.triggerClientHintId !== undefined
    || criteria.triggerType !== undefined
    || criteria.triggerText !== undefined
    || criteria.triggerTextContains !== undefined
    || criteria.triggerQuery !== undefined;
}

function hasTargetSelector(criteria: ContextTransitionCriteria): boolean {
  return criteria.toId !== undefined
    || criteria.toScreenName !== undefined
    || criteria.toScreenQuery !== undefined
    || criteria.toSourceKind !== undefined
    || criteria.toSourcePath !== undefined
    || criteria.toSourcePathContains !== undefined
    || criteria.toPageNumber !== undefined
    || criteria.toSlideNumber !== undefined
    || criteria.toImageNumber !== undefined
    || criteria.toLatest === true;
}

function triggerCandidates(context: LoadedUosContext, fromScreenId: string): ContextElementCandidate[] {
  const resolved = resolveContextElement(context, { screenId: fromScreenId, type: "Button" });
  if (resolved.ok) return [resolved.candidate];
  return resolved.candidates;
}

function screenFailure(
  role: "source" | "target",
  context: LoadedUosContext,
  resolution: Extract<ContextAddTargetResolution, { ok: false }>,
): Extract<ContextTransitionResolution, { ok: false }> {
  return {
    ok: false,
    reason: `${role} ${resolution.reason}`,
    screens: resolution.screens.length > 0 ? resolution.screens : screenCandidates(context.screens),
  };
}

function formatTransitionFailure(resolution: Extract<ContextTransitionResolution, { ok: false }>): string {
  const lines = [
    resolution.reason,
    `screen candidate(s): ${resolution.screens.length}`,
  ];
  for (const screen of resolution.screens.slice(0, 10)) {
    lines.push(`  - ${formatScreen(screen.screenId, screen.screenName)}`);
  }
  if (resolution.triggerCandidates !== undefined) {
    lines.push(`trigger candidate(s): ${resolution.triggerCandidates.length}`);
    for (const candidate of resolution.triggerCandidates.slice(0, 10)) {
      lines.push(`  - ${formatCandidate(candidate)}`);
    }
  }
  return lines.join("\n");
}

function formatScreen(screenId: string, screenName?: string): string {
  return `screen=${screenId}${screenName !== undefined ? `(${screenName})` : ""}`;
}

function formatCandidate(candidate: ContextElementCandidate): string {
  const parts = [
    `screen=${candidate.screenId}${candidate.screenName !== undefined ? `(${candidate.screenName})` : ""}`,
    `element=${candidate.elementId}`,
    candidate.clientHintId !== undefined ? `hint=${candidate.clientHintId}` : undefined,
    candidate.type !== undefined ? `type=${candidate.type}` : undefined,
    candidate.text !== undefined ? `text="${candidate.text}"` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}
