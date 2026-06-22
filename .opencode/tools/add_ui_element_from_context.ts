/**
 * add_ui_element_from_context - resolve a persisted .uos screen/parent, then add an element.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { AddElementSchema, normalizeAddElementForBridge, validateAddElement, type AddElement } from "./_planning_intent";
import { loadUosContext, type LoadedUosContext, type ScreenSummary } from "./_uos_context";
import {
  resolveContextElement,
  type ContextElementCandidate,
  type ContextElementResolution,
} from "./update_ui_element_from_context";

export interface ContextAddCriteria {
  screenId?: string;
  screenName?: string;
  screenQuery?: string;
  sourceKind?: string;
  sourcePath?: string;
  sourcePathContains?: string;
  pageNumber?: number;
  slideNumber?: number;
  imageNumber?: number;
  latest?: boolean;
  parentElementId?: string;
  parentClientHintId?: string;
  parentType?: string;
  parentText?: string;
  parentTextContains?: string;
  parentQuery?: string;
  includeDeleted?: boolean;
}

export type ContextAddTargetResolution =
  | { ok: true; screenId: string; screenName?: string; parent?: ContextElementCandidate }
  | {
      ok: false;
      reason: string;
      screens: Array<{ screenId: string; screenName?: string }>;
      parentCandidates?: ContextElementCandidate[];
    };

export default tool({
  description:
    "Add one UI element to a persisted UOS screen by resolving the screen and optional parent from .uos context. Use for conversational follow-up adds when the screenId or parentElementId is not already known. If no screen is named, the persisted active screen is used when available.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then current session directory."),
    contextDir: z
      .string()
      .optional()
      .describe("Explicit .uos context directory. Usually not needed."),
    screenId: z.string().optional().describe("Preferred exact screenId filter. When omitted with screenName, the active screen is used if one is persisted."),
    screenName: z.string().optional().describe("Exact or unique case-insensitive screenName filter. When omitted with screenId, the active screen is used if one is persisted."),
    screenQuery: z.string().optional().describe("Natural screen query matched against screen name/id, source metadata, or the persisted active screen, e.g. 'current screen', 'lobby slide 2', or 'settings document'."),
    sourceKind: z.string().optional().describe("Persisted source kind filter such as image, pdf, pptx, docx, md, txt, csv, or json."),
    sourcePath: z.string().optional().describe("Exact persisted source path filter, case-insensitive."),
    sourcePathContains: z.string().optional().describe("Substring persisted source path filter, case-insensitive."),
    pageNumber: z.number().int().positive().optional().describe("Persisted source page number filter for PDF-derived screens."),
    slideNumber: z.number().int().positive().optional().describe("Persisted source slide number filter for PPTX-derived screens."),
    imageNumber: z.number().int().positive().optional().describe("Persisted source embedded image number filter for DOCX-derived screens."),
    latest: z.boolean().optional().describe("When several screens match the filters, choose the most recently updated/previewed/compared one. Defaults to false."),
    parentElementId: z.string().optional().describe("Exact canonical parent elementId to add under."),
    parentClientHintId: z.string().optional().describe("Exact parent clientHintId from the original PlanningIntent."),
    parentType: z.string().optional().describe("Parent element type filter such as Panel, Button, Image, or Text."),
    parentText: z.string().optional().describe("Exact current parent text filter, case-insensitive."),
    parentTextContains: z.string().optional().describe("Substring current parent text filter, case-insensitive."),
    parentQuery: z.string().optional().describe("Natural parent query matched against screen name, clientHintId, type aliases, and current text, e.g. 'main panel' or 'settings card'."),
    includeDeleted: z.boolean().optional().describe("Allow matching deleted parent elements in .uos context. Defaults to false."),
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving the screen or parent. Defaults to true."),
    element: AddElementSchema.describe("Element to add. parentElementId may be omitted when parent selectors are provided."),
    dryRun: z.boolean().optional().describe("Resolve and report the target without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: shouldRefreshLiveHierarchy(args) });
    context = refreshed.context;
    const resolution = resolveContextAddTarget(context, args);
    if (!resolution.ok) {
      return {
        title: "add_ui_element_from_context: unresolved",
        output: formatAddTargetFailure(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: false,
          reason: resolution.reason,
          screens: resolution.screens,
          parentCandidates: resolution.parentCandidates,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const element = compactObject({
      ...args.element,
      parentElementId: resolution.parent?.elementId ?? args.element.parentElementId,
    }) as AddElement;
    const validation = validateAddElement(element);
    if (!validation.ok) {
      return {
        title: "add_ui_element_from_context: preflight failed",
        output: `preflight failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
        metadata: {
          ok: false,
          matched: resolution,
          errors: validation.errors,
          warnings: validation.warnings,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const addArgs = {
      screenId: resolution.screenId,
      element: normalizeAddElementForBridge(element),
    };
    if (args.dryRun === true) {
      return {
        title: `add_ui_element_from_context: dry run ${element.type}`,
        output: `Resolved screen=${resolution.screenId}${resolution.screenName !== undefined ? `(${resolution.screenName})` : ""}${resolution.parent !== undefined ? ` parent=${formatCandidate(resolution.parent)}` : ""}. Dry run only; Unity was not modified.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: true,
          dryRun: true,
          matched: resolution,
          addArgs,
          warnings: validation.warnings,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const added = (await call("add_ui_element", addArgs)) as Record<string, unknown>;
    const warningText = validation.warnings.length > 0
      ? `\n\nWarnings:\n${validation.warnings.map((w) => `- ${w}`).join("\n")}`
      : "";
    return {
      title: `add_ui_element_from_context: ${element.type} -> ${added.elementId ?? "(unknown id)"}`,
      output: `Added ${element.type} to screen ${resolution.screenId}${resolution.parent !== undefined ? ` under ${resolution.parent.elementId}` : ""}.` +
        warningText +
        formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution,
        addArgs,
        added,
        warnings: validation.warnings,
        contextRefresh: refreshed.refresh,
        ...added,
      },
    };
  },
});

export function resolveContextAddTarget(
  context: LoadedUosContext,
  criteria: ContextAddCriteria & { element?: { parentElementId?: string } },
): ContextAddTargetResolution {
  const screenResolution = resolveContextScreen(context, criteria);
  if (!screenResolution.ok) return screenResolution;

  const parentCriteria = {
    screenId: screenResolution.screen.screenId,
    elementId: firstNonBlank(criteria.parentElementId, criteria.element?.parentElementId),
    clientHintId: criteria.parentClientHintId,
    type: criteria.parentType,
    text: criteria.parentText,
    textContains: criteria.parentTextContains,
    query: criteria.parentQuery,
    includeDeleted: criteria.includeDeleted,
  };
  if (!hasParentSelector(parentCriteria)) {
    return {
      ok: true,
      screenId: screenResolution.screen.screenId,
      screenName: screenResolution.screen.screenName,
    };
  }

  const parent = resolveContextElement(context, parentCriteria);
  if (!parent.ok) {
    return {
      ok: false,
      reason: `parent ${parent.reason}`,
      screens: screenCandidates([screenResolution.screen]),
      parentCandidates: parent.candidates,
    };
  }
  return {
    ok: true,
    screenId: parent.candidate.screenId,
    screenName: parent.candidate.screenName,
    parent: parent.candidate,
  };
}

export function resolveContextScreen(
  context: LoadedUosContext,
  criteria: ContextAddCriteria,
): { ok: true; screen: ScreenSummary } | Extract<ContextAddTargetResolution, { ok: false }> {
  let screens = context.screens;
  const hasScreenSelector = hasScreenCriteria(criteria);
  if (criteria.screenId !== undefined) {
    screens = screens.filter((screen) => screen.screenId === criteria.screenId);
  }
  if (criteria.screenName !== undefined) {
    const exact = screens.filter((screen) => sameFolded(screen.screenName, criteria.screenName));
    screens = exact.length > 0
      ? exact
      : screens.filter((screen) => containsFolded(screen.screenName, criteria.screenName));
  }
  if (criteria.screenQuery !== undefined) {
    if (isActiveScreenQuery(criteria.screenQuery)) {
      const active = activeScreen(context);
      screens = active !== undefined
        ? screens.filter((screen) => screen.screenId === active.screenId)
        : [];
    } else {
      screens = screens.filter((screen) => screenMatchesQuery(screen, criteria.screenQuery));
    }
  }
  screens = screens.filter((screen) => screenMatchesSource(screen, criteria));
  if (!hasScreenSelector) {
    const active = activeScreen(context);
    if (active !== undefined) return { ok: true, screen: active };
  }
  if (criteria.latest === true && screens.length > 0) {
    return { ok: true, screen: [...screens].sort((a, b) => latestScreenTime(b) - latestScreenTime(a))[0] };
  }
  if (screens.length === 1) return { ok: true, screen: screens[0] };
  if (screens.length === 0) {
    return {
      ok: false,
      reason: "no matching screen in persisted .uos context",
      screens: screenCandidates(context.screens),
    };
  }
  return {
    ok: false,
    reason: "multiple matching screens in persisted .uos context; add screenId, a stricter screenName/screenQuery/source filter, or latest=true",
    screens: screenCandidates(screens),
  };
}

function hasScreenCriteria(criteria: ContextAddCriteria): boolean {
  return criteria.screenId !== undefined
    || criteria.screenName !== undefined
    || criteria.screenQuery !== undefined
    || criteria.sourceKind !== undefined
    || criteria.sourcePath !== undefined
    || criteria.sourcePathContains !== undefined
    || criteria.pageNumber !== undefined
    || criteria.slideNumber !== undefined
    || criteria.imageNumber !== undefined
    || criteria.latest === true;
}

function activeScreen(context: LoadedUosContext): ScreenSummary | undefined {
  const byId = context.activeScreenId !== undefined
    ? context.screens.find((screen) => screen.screenId === context.activeScreenId)
    : undefined;
  if (byId !== undefined) return byId;
  const activeScreens = context.screens.filter((screen) => screen.active === true);
  return activeScreens.length === 1 ? activeScreens[0] : undefined;
}

function hasParentSelector(criteria: {
  elementId?: string;
  clientHintId?: string;
  type?: string;
  text?: string;
  textContains?: string;
  query?: string;
}): boolean {
  return criteria.elementId !== undefined
    || criteria.clientHintId !== undefined
    || criteria.type !== undefined
    || criteria.text !== undefined
    || criteria.textContains !== undefined
    || criteria.query !== undefined;
}

export function screenCandidates(screens: ScreenSummary[]): Array<{ screenId: string; screenName?: string }> {
  return screens.slice(0, 20).map((screen) => ({
    screenId: screen.screenId,
    screenName: screen.screenName,
  }));
}

function formatAddTargetFailure(resolution: Extract<ContextAddTargetResolution, { ok: false }>): string {
  const lines = [
    resolution.reason,
    `screen candidate(s): ${resolution.screens.length}`,
  ];
  for (const screen of resolution.screens.slice(0, 10)) {
    lines.push(`  - screen=${screen.screenId}${screen.screenName !== undefined ? `(${screen.screenName})` : ""}`);
  }
  if (resolution.parentCandidates !== undefined) {
    lines.push(`parent candidate(s): ${resolution.parentCandidates.length}`);
    for (const candidate of resolution.parentCandidates.slice(0, 10)) {
      lines.push(`  - ${formatCandidate(candidate)}`);
    }
  }
  return lines.join("\n");
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

function sameFolded(left: string | undefined, right: string): boolean {
  return fold(left) === fold(right);
}

function containsFolded(value: string | undefined, query: string): boolean {
  const haystack = fold(value);
  const needle = fold(query);
  return haystack.length > 0 && needle.length > 0 && haystack.includes(needle);
}

function containsPathQuery(value: string | undefined, query: string): boolean {
  if (containsFolded(value, query)) return true;
  const haystack = searchText([value]);
  const needle = searchText([query]);
  return haystack.length > 0 && needle.length > 0 && haystack.includes(needle);
}

function screenMatchesSource(screen: ScreenSummary, criteria: ContextAddCriteria): boolean {
  const source = screen.source;
  if (criteria.sourceKind !== undefined && !sameFolded(source?.kind, criteria.sourceKind)) return false;
  if (criteria.sourcePath !== undefined && !sameFolded(source?.path, criteria.sourcePath)) return false;
  if (criteria.sourcePathContains !== undefined && !containsPathQuery(source?.path, criteria.sourcePathContains)) return false;
  if (criteria.pageNumber !== undefined && source?.pageNumber !== criteria.pageNumber) return false;
  if (criteria.slideNumber !== undefined && source?.slideNumber !== criteria.slideNumber) return false;
  if (criteria.imageNumber !== undefined && source?.imageNumber !== criteria.imageNumber) return false;
  return true;
}

function screenMatchesQuery(screen: ScreenSummary, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  const source = screen.source;
  const corpus = searchText([
    screen.screenId,
    screen.screenName,
    source?.kind,
    source?.mode,
    source?.tool,
    source?.path,
    source?.packagePath,
    source?.renderedPath,
    source?.extractedPath,
    source?.pageNumber !== undefined ? `page ${source.pageNumber}` : undefined,
    source?.slideNumber !== undefined ? `slide ${source.slideNumber}` : undefined,
    source?.imageNumber !== undefined ? `image ${source.imageNumber}` : undefined,
    ...sourceNumberAliases(source),
  ]);
  return tokens.every((token) => corpus.includes(token));
}

function queryTokens(query: string): string[] {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "this",
    "that",
    "please",
    "screen",
    "ui",
    "page",
    "slide",
    "image",
    "화면",
    "페이지",
    "슬라이드",
    "이미지",
  ]);
  return searchText([query])
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopwords.has(token));
}

function isActiveScreenQuery(query: string): boolean {
  const tokens = searchText([query]).split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  const screenWords = new Set([
    "the",
    "a",
    "an",
    "this",
    "that",
    "screen",
    "ui",
    "page",
    "화면",
    "페이지",
  ]);
  const activeWords = new Set([
    "current",
    "active",
    "visible",
    "shown",
    "selected",
    "now",
    "현재",
    "현재화면",
    "활성",
    "활성화면",
    "보이는",
    "표시",
    "선택된",
    "지금",
    "지금화면",
  ]);
  const meaningful = tokens.filter((token) => !screenWords.has(token));
  return meaningful.length === 0 || meaningful.every((token) => activeWords.has(token));
}

function sourceNumberAliases(source: ScreenSummary["source"]): string[] {
  if (source === undefined) return [];
  return [
    ...numberAliases("page", "페이지", source.pageNumber),
    ...numberAliases("slide", "슬라이드", source.slideNumber),
    ...numberAliases("image", "이미지", source.imageNumber),
  ];
}

function numberAliases(english: string, korean: string, value: number | undefined): string[] {
  if (value === undefined) return [];
  return [
    `${english} ${value}`,
    `${value} ${english}`,
    `${korean} ${value}`,
    `${value} ${korean}`,
    `${korean} ${value}번`,
    `${value}번 ${korean}`,
    `${value}번`,
    `${korean} ${value}번째`,
    `${value}번째 ${korean}`,
    `${value}번째`,
  ];
}

function searchText(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^0-9a-zA-Z\uAC00-\uD7AF]+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function latestScreenTime(screen: ScreenSummary): number {
  const values = [
    screen.lastComparedAt,
    screen.lastPreviewAt,
    screen.updatedAt,
    screen.comparisons[0]?.ts,
    screen.previews[0]?.ts,
  ];
  for (const value of values) {
    const parsed = value !== undefined ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function fold(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}
