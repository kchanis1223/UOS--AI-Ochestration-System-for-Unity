/**
 * update_ui_element_from_context - resolve a persisted .uos element, then update it.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { ElementPropsSchema, normalizeElementPropsForBridge } from "./_planning_intent";
import { loadUosContext, type LoadedUosContext } from "./_uos_context";

const RectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export interface ContextElementCriteria {
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
  elementId?: string;
  clientHintId?: string;
  type?: string;
  text?: string;
  textContains?: string;
  query?: string;
  includeDeleted?: boolean;
  refreshHierarchy?: boolean;
}

export interface ContextElementCandidate {
  screenId: string;
  screenName?: string;
  elementId: string;
  clientHintId?: string;
  type?: string;
  text?: string;
  deleted?: boolean;
}

export type ContextElementResolution =
  | { ok: true; candidate: ContextElementCandidate }
  | { ok: false; reason: string; candidates: ContextElementCandidate[] };

export default tool({
  description:
    "Update one persisted UI element by resolving it from .uos context using screen name/id, clientHintId, current text, type, or elementId. If no screen is named and multiple elements match, a single active-screen match is preferred. Use for conversational follow-up edits when the canonical elementId is not already known.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then current session directory."),
    contextDir: z
      .string()
      .optional()
      .describe("Explicit .uos context directory. Usually not needed."),
    screenId: z.string().optional().describe("Preferred exact screenId filter."),
    screenName: z.string().optional().describe("Exact or unique case-insensitive screenName filter."),
    screenQuery: z.string().optional().describe("Natural screen query matched against screen name/id, source metadata, or the persisted active screen, e.g. 'current screen' or 'lobby slide 2'."),
    sourceKind: z.string().optional().describe("Persisted source kind filter such as image, pdf, pptx, docx, md, txt, csv, or json."),
    sourcePath: z.string().optional().describe("Exact persisted source path filter, case-insensitive."),
    sourcePathContains: z.string().optional().describe("Substring persisted source path filter, case-insensitive."),
    pageNumber: z.number().int().positive().optional().describe("Persisted source page number filter for PDF-derived screens."),
    slideNumber: z.number().int().positive().optional().describe("Persisted source slide number filter for PPTX-derived screens."),
    imageNumber: z.number().int().positive().optional().describe("Persisted source embedded image number filter for DOCX-derived screens."),
    latest: z.boolean().optional().describe("When several screens match the filters, choose the most recently updated/previewed/compared one. Defaults to false."),
    elementId: z.string().optional().describe("Exact canonical elementId. If known, update_ui_element is also valid."),
    clientHintId: z.string().optional().describe("Exact clientHintId from the original PlanningIntent."),
    type: z.string().optional().describe("Element type filter such as Text, Button, Image, or Panel."),
    text: z.string().optional().describe("Exact current text filter, case-insensitive."),
    textContains: z.string().optional().describe("Substring current text filter, case-insensitive."),
    query: z.string().optional().describe("Natural element query matched against screen name, clientHintId, type aliases, and current text, e.g. 'play button', 'primary CTA', or '설정 버튼'."),
    includeDeleted: z.boolean().optional().describe("Allow matching elements marked deleted in .uos context. Defaults to false."),
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving the target. Defaults to true."),
    props: ElementPropsSchema,
    rect: RectSchema.optional(),
    anchor: z.string().optional(),
    dryRun: z.boolean().optional().describe("Resolve and report the element without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: shouldRefreshLiveHierarchy(args) });
    context = refreshed.context;
    const resolution = resolveContextElement(context, args);
    if (!resolution.ok) {
      return {
        title: "update_ui_element_from_context: unresolved",
        output: formatResolutionFailure(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, candidates: resolution.candidates, contextRefresh: refreshed.refresh },
      };
    }

    const updateArgs = compactObject({
      elementId: resolution.candidate.elementId,
      props: normalizeElementPropsForBridge(args.props),
      rect: args.rect,
      anchor: args.anchor,
    });
    const hasPatch = args.props !== undefined || args.rect !== undefined || args.anchor !== undefined;
    if (!hasPatch && args.dryRun !== true) {
      return {
        title: "update_ui_element_from_context: no update fields",
        output: "Resolved the target element, but no props, rect, or anchor update was provided. Unity was not modified." +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: false,
          reason: "no props, rect, or anchor update provided",
          matched: resolution.candidate,
          updateArgs,
          contextRefresh: refreshed.refresh,
        },
      };
    }
    if (args.dryRun === true) {
      return {
        title: `update_ui_element_from_context: dry run ${resolution.candidate.elementId}`,
        output: `Resolved ${formatCandidate(resolution.candidate)}. Dry run only; Unity was not modified.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: true,
          dryRun: true,
          matched: resolution.candidate,
          updateArgs,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const updated = (await call("update_ui_element", updateArgs)) as Record<string, unknown>;
    return {
      title: `update_ui_element_from_context: ${resolution.candidate.elementId}`,
      output: `Updated ${formatCandidate(resolution.candidate)}.` + formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution.candidate,
        updateArgs,
        updated,
        contextRefresh: refreshed.refresh,
        ...updated,
      },
    };
  },
});

export function resolveContextElement(
  context: LoadedUosContext,
  criteria: ContextElementCriteria,
): ContextElementResolution {
  const screens = matchingScreens(context, criteria);
  const candidates = screens.flatMap((screen) =>
    screen.elements
      .filter((element) => criteria.includeDeleted === true || element.deleted !== true)
      .map((element) => ({
        screenId: screen.screenId,
        screenName: screen.screenName,
        elementId: element.elementId,
        clientHintId: element.clientHintId,
        type: element.type,
        text: element.props?.text,
        deleted: element.deleted,
      } satisfies ContextElementCandidate)));

  const matched = candidates.filter((candidate) => candidateMatches(candidate, criteria));
  if (matched.length === 1) return { ok: true, candidate: matched[0] };
  if (matched.length === 0) {
    return {
      ok: false,
      reason: "no matching element in persisted .uos context",
      candidates: candidates.slice(0, 20),
    };
  }
  const active = activeCandidate(context, criteria, matched);
  if (active !== undefined) return { ok: true, candidate: active };
  return {
    ok: false,
    reason: "multiple matching elements in persisted .uos context; add screenId, screenName, clientHintId, type, text, or a stricter query",
    candidates: matched.slice(0, 20),
  };
}

function matchingScreens(context: LoadedUosContext, criteria: ContextElementCriteria): LoadedUosContext["screens"] {
  let screens = context.screens;
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
      const activeScreenId = context.activeScreenId ?? singleActiveScreenId(context);
      screens = activeScreenId !== undefined
        ? screens.filter((screen) => screen.screenId === activeScreenId)
        : [];
    } else {
      screens = screens.filter((screen) => screenMatchesQuery(screen, criteria.screenQuery));
    }
  }
  screens = screens.filter((screen) => screenMatchesSource(screen, criteria));
  if (criteria.latest === true && screens.length > 0) {
    return [[...screens].sort((a, b) => latestScreenTime(b) - latestScreenTime(a))[0]];
  }
  return screens;
}

function activeCandidate(
  context: LoadedUosContext,
  criteria: ContextElementCriteria,
  candidates: ContextElementCandidate[],
): ContextElementCandidate | undefined {
  if (criteria.screenId !== undefined || criteria.screenName !== undefined) return undefined;
  const activeScreenId = context.activeScreenId ?? singleActiveScreenId(context);
  if (activeScreenId === undefined) return undefined;
  const active = candidates.filter((candidate) => candidate.screenId === activeScreenId);
  return active.length === 1 ? active[0] : undefined;
}

function singleActiveScreenId(context: LoadedUosContext): string | undefined {
  const active = context.screens.filter((screen) => screen.active === true);
  return active.length === 1 ? active[0].screenId : undefined;
}

function candidateMatches(candidate: ContextElementCandidate, criteria: ContextElementCriteria): boolean {
  if (criteria.elementId !== undefined && candidate.elementId !== criteria.elementId) return false;
  if (criteria.clientHintId !== undefined && candidate.clientHintId !== criteria.clientHintId) return false;
  if (criteria.type !== undefined && !sameFolded(candidate.type, criteria.type)) return false;
  if (criteria.text !== undefined && !sameFolded(candidate.text, criteria.text)) return false;
  if (criteria.textContains !== undefined && !containsFolded(candidate.text, criteria.textContains)) return false;
  if (criteria.query !== undefined && !matchesElementQuery(candidate, criteria.query)) return false;
  return true;
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

function fold(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function screenMatchesSource(screen: LoadedUosContext["screens"][number], criteria: ContextElementCriteria): boolean {
  const source = screen.source;
  if (criteria.sourceKind !== undefined && !sameFolded(source?.kind, criteria.sourceKind)) return false;
  if (criteria.sourcePath !== undefined && !sameFolded(source?.path, criteria.sourcePath)) return false;
  if (criteria.sourcePathContains !== undefined && !containsPathQuery(source?.path, criteria.sourcePathContains)) return false;
  if (criteria.pageNumber !== undefined && source?.pageNumber !== criteria.pageNumber) return false;
  if (criteria.slideNumber !== undefined && source?.slideNumber !== criteria.slideNumber) return false;
  if (criteria.imageNumber !== undefined && source?.imageNumber !== criteria.imageNumber) return false;
  return true;
}

function screenMatchesQuery(screen: LoadedUosContext["screens"][number], query: string): boolean {
  const tokens = screenQueryTokens(query);
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

function screenQueryTokens(query: string): string[] {
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

function sourceNumberAliases(source: LoadedUosContext["screens"][number]["source"]): string[] {
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

function latestScreenTime(screen: LoadedUosContext["screens"][number]): number {
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

function matchesElementQuery(candidate: ContextElementCandidate, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  const corpus = searchText([
    candidate.screenName,
    candidate.elementId,
    candidate.clientHintId,
    candidate.type,
    candidate.text,
    typeAliases(candidate.type),
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
    "ui",
    "element",
    "control",
    "object",
    "thing",
    "이",
    "그",
    "저",
    "요소",
    "컨트롤",
    "오브젝트",
  ]);
  return searchText([query])
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopwords.has(token));
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

function typeAliases(type: string | undefined): string | undefined {
  switch (fold(type)) {
    case "button":
      return "button cta action 버튼 단추 액션";
    case "text":
      return "text label title copy heading 텍스트 라벨 제목 문구";
    case "panel":
      return "panel container background box card 패널 컨테이너 배경 박스 카드";
    case "image":
      return "image picture sprite mockup reference 이미지 그림 스프라이트 목업 참고";
    case "inputfield":
      return "input field text field entry 입력 입력창 텍스트필드";
    case "toggle":
      return "toggle checkbox switch 토글 체크박스 스위치";
    case "slider":
      return "slider range volume 슬라이더 범위 볼륨";
    case "scrollview":
      return "scroll view list 스크롤 목록 리스트";
    case "dropdown":
      return "dropdown drop down select menu 드롭다운 선택 메뉴";
    default:
      return undefined;
  }
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function formatResolutionFailure(resolution: Extract<ContextElementResolution, { ok: false }>): string {
  const lines = [
    resolution.reason,
    `candidate(s): ${resolution.candidates.length}`,
  ];
  for (const candidate of resolution.candidates.slice(0, 10)) {
    lines.push(`  - ${formatCandidate(candidate)}`);
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
