/**
 * resolve_uos_context_target - read-only resolver for persisted UOS screen/element targets.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { resolveContextScreen } from "./add_ui_element_from_context";
import { loadUosContext, type LoadedUosContext, type ScreenSummary } from "./_uos_context";
import {
  resolveContextElement,
  type ContextElementCandidate,
  type ContextElementCriteria,
} from "./update_ui_element_from_context";

const ScreenSelectorArgs = {
  screenId: z.string().optional().describe("Exact persisted screenId filter."),
  screenName: z.string().optional().describe("Exact or unique case-insensitive screenName filter."),
  screenQuery: z.string().optional().describe("Natural screen query matched against screen name/id, source metadata, or the persisted active screen, e.g. 'current screen' or 'lobby slide 2'."),
  sourceKind: z.string().optional().describe("Persisted source kind filter such as image, pdf, pptx, docx, md, txt, csv, or json."),
  sourcePath: z.string().optional().describe("Exact persisted source path filter, case-insensitive."),
  sourcePathContains: z.string().optional().describe("Substring persisted source path filter, case-insensitive."),
  pageNumber: z.number().int().positive().optional().describe("Persisted source page number filter for PDF-derived screens."),
  slideNumber: z.number().int().positive().optional().describe("Persisted source slide number filter for PPTX-derived screens."),
  imageNumber: z.number().int().positive().optional().describe("Persisted source embedded image number filter for DOCX-derived screens."),
  latest: z.boolean().optional().describe("When several screens match the filters, choose the most recently updated/previewed/compared one. Defaults to false."),
};

const ElementSelectorArgs = {
  elementId: z.string().optional().describe("Exact canonical elementId."),
  clientHintId: z.string().optional().describe("Exact clientHintId from the original PlanningIntent."),
  type: z.string().optional().describe("Element type filter such as Text, Button, Image, or Panel."),
  text: z.string().optional().describe("Exact current text filter, case-insensitive."),
  textContains: z.string().optional().describe("Substring current text filter, case-insensitive."),
  query: z.string().optional().describe("Natural element query matched against screen name, clientHintId, type aliases, and current text, e.g. 'play button'."),
  includeDeleted: z.boolean().optional().describe("Allow matching elements marked deleted in .uos context. Defaults to false."),
};

export type ResolvedUosContextTarget =
  | { ok: true; screen: ScreenSummary; element?: ContextElementCandidate }
  | {
      ok: false;
      reason: string;
      screens?: Array<{ screenId: string; screenName?: string }>;
      candidates?: ContextElementCandidate[];
    };

export default tool({
  description:
    "Resolve a persisted UOS screen and optionally one element from .uos context without calling Unity. Use before conversational edits when a user names a prior screen, material source, or element but canonical ids are not already known.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then current session directory."),
    contextDir: z
      .string()
      .optional()
      .describe("Explicit .uos context directory. Usually not needed."),
    ...ScreenSelectorArgs,
    ...ElementSelectorArgs,
    requireElement: z.boolean().optional().describe("When true, fail if no element selector was provided. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const resolution = resolveUosContextTarget(context, args);
    if (!resolution.ok) {
      return {
        title: "resolve_uos_context_target: unresolved",
        output: formatFailure(resolution),
        metadata: resolution,
      };
    }

    const output = [
      `screen: ${formatScreen(resolution.screen)}`,
      resolution.screen.source !== undefined ? `source: ${formatSource(resolution.screen.source)}` : undefined,
      resolution.element !== undefined ? `element: ${formatCandidate(resolution.element)}` : undefined,
      resolution.element === undefined ? "element: not requested" : undefined,
    ].filter((line): line is string => line !== undefined).join("\n");
    return {
      title: resolution.element !== undefined
        ? `resolve_uos_context_target: ${resolution.element.elementId}`
        : `resolve_uos_context_target: ${resolution.screen.screenId}`,
      output,
      metadata: {
        ok: true,
        screen: resolution.screen,
        element: resolution.element,
      },
    };
  },
});

export function resolveUosContextTarget(
  context: LoadedUosContext,
  criteria: ContextElementCriteria & { requireElement?: boolean },
): ResolvedUosContextTarget {
  const elementRequested = hasElementSelector(criteria);
  if (elementRequested) {
    const element = resolveContextElement(context, criteria);
    if (!element.ok) {
      return { ok: false, reason: element.reason, candidates: element.candidates };
    }
    const screen = context.screens.find((candidate) => candidate.screenId === element.candidate.screenId);
    if (screen === undefined) {
      return {
        ok: false,
        reason: "resolved element's screen is missing from persisted .uos context",
        candidates: [element.candidate],
      };
    }
    return { ok: true, screen, element: element.candidate };
  }

  if (criteria.requireElement === true) {
    return {
      ok: false,
      reason: "no element selector provided; add elementId, clientHintId, type, text, textContains, or query",
      screens: context.screens.map((screen) => ({ screenId: screen.screenId, screenName: screen.screenName })).slice(0, 20),
    };
  }

  const screen = resolveContextScreen(context, criteria);
  if (!screen.ok) return screen;
  return { ok: true, screen: screen.screen };
}

function hasElementSelector(criteria: ContextElementCriteria): boolean {
  return criteria.elementId !== undefined
    || criteria.clientHintId !== undefined
    || criteria.type !== undefined
    || criteria.text !== undefined
    || criteria.textContains !== undefined
    || criteria.query !== undefined;
}

function formatFailure(resolution: Extract<ResolvedUosContextTarget, { ok: false }>): string {
  const lines = [resolution.reason];
  if (resolution.screens !== undefined) {
    lines.push(`screen candidate(s): ${resolution.screens.length}`);
    for (const screen of resolution.screens.slice(0, 10)) {
      lines.push(`  - screen=${screen.screenId}${screen.screenName !== undefined ? `(${screen.screenName})` : ""}`);
    }
  }
  if (resolution.candidates !== undefined) {
    lines.push(`element candidate(s): ${resolution.candidates.length}`);
    for (const candidate of resolution.candidates.slice(0, 10)) {
      lines.push(`  - ${formatCandidate(candidate)}`);
    }
  }
  return lines.join("\n");
}

function formatScreen(screen: ScreenSummary): string {
  const parts = [
    screen.screenId,
    screen.screenName !== undefined ? `name=${screen.screenName}` : undefined,
    screen.active === true ? "active" : undefined,
    `elements=${screen.elementCount}`,
    screen.previewCount > 0 ? `previews=${screen.previewCount}` : undefined,
    screen.comparisonCount > 0 ? `comparisons=${screen.comparisonCount}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function formatCandidate(candidate: ContextElementCandidate): string {
  const parts = [
    `screen=${candidate.screenId}${candidate.screenName !== undefined ? `(${candidate.screenName})` : ""}`,
    `element=${candidate.elementId}`,
    candidate.clientHintId !== undefined ? `hint=${candidate.clientHintId}` : undefined,
    candidate.type !== undefined ? `type=${candidate.type}` : undefined,
    candidate.text !== undefined ? `text="${candidate.text}"` : undefined,
    candidate.deleted === true ? "deleted" : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function formatSource(source: ScreenSummary["source"]): string {
  if (source === undefined) return "";
  const parts = [
    source.kind ?? source.tool,
    source.mode !== undefined ? `mode=${source.mode}` : undefined,
    source.path,
    source.pageNumber !== undefined ? `page=${source.pageNumber}` : undefined,
    source.slideNumber !== undefined ? `slide=${source.slideNumber}` : undefined,
    source.imageNumber !== undefined ? `image=${source.imageNumber}` : undefined,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.join(" ");
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}
