import { z } from "zod";
import { call } from "./_bridge";
import {
  contextWithLiveSceneObjects,
  type LoadedUosContext,
  type SceneObjectSummary,
} from "./_uos_context";

export const SceneObjectSelectorArgs = {
  objectId: z.string().optional().describe("Exact persisted scene object id, e.g. SceneObject_abc123."),
  objectName: z.string().optional().describe("Exact or unique case-insensitive scene object name filter."),
  objectNameContains: z.string().optional().describe("Substring scene object name filter, case-insensitive."),
  type: z.string().optional().describe("Scene object type filter such as Cube, Sphere, Camera, PointLight, DirectionalLight, or SpotLight."),
  path: z.string().optional().describe("Exact persisted hierarchy path filter, case-insensitive."),
  pathContains: z.string().optional().describe("Substring persisted hierarchy path filter, case-insensitive."),
  query: z.string().optional().describe("Natural scene object query matched against id, name, type, path, and components, e.g. 'conversation cube', 'main camera', or 'point light'."),
  includeDeleted: z.boolean().optional().describe("Allow matching objects marked deleted in .uos context. Defaults to false."),
  latest: z.boolean().optional().describe("When several objects match, choose the most recently updated one. Defaults to false."),
  refreshSceneObjects: z.boolean().optional().describe("Best-effort refresh from live Unity list_scene_objects before resolving. Defaults to true, false during dryRun unless explicitly true."),
};

export interface ContextSceneObjectCriteria {
  objectId?: string;
  objectName?: string;
  objectNameContains?: string;
  type?: string;
  path?: string;
  pathContains?: string;
  query?: string;
  includeDeleted?: boolean;
  latest?: boolean;
  dryRun?: boolean;
  refreshSceneObjects?: boolean;
}

export interface ContextSceneObjectCandidate {
  objectId: string;
  name?: string;
  type?: string;
  path?: string;
  parentObjectId?: string;
  active?: boolean;
  deleted?: boolean;
  updatedAt?: string;
  transform?: SceneObjectSummary["transform"];
  components?: string[];
}

export type ContextSceneObjectResolution =
  | { ok: true; candidate: ContextSceneObjectCandidate }
  | { ok: false; reason: string; candidates: ContextSceneObjectCandidate[] };

export interface LiveSceneObjectContextRefresh {
  ok: boolean;
  objects?: SceneObjectSummary[];
  count?: number;
  warning?: string;
}

export interface LiveSceneObjectContextResult {
  context: LoadedUosContext;
  refresh?: LiveSceneObjectContextRefresh;
}

export async function refreshContextFromLiveSceneObjects(
  context: LoadedUosContext,
  options: { enabled?: boolean } = {},
): Promise<LiveSceneObjectContextResult> {
  if (options.enabled === false) return { context };
  try {
    const result = await call("list_scene_objects", {}) as Record<string, unknown>;
    const refreshed = contextWithLiveSceneObjects(context, result);
    const objects = Array.isArray(result.objects)
      ? result.objects.filter((item): item is SceneObjectSummary => item !== null && typeof item === "object" && typeof (item as { objectId?: unknown }).objectId === "string")
      : [];
    return {
      context: refreshed,
      refresh: {
        ok: true,
        objects,
        count: objects.length,
      },
    };
  } catch (error) {
    return {
      context,
      refresh: {
        ok: false,
        warning: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function shouldRefreshSceneObjects(args: { dryRun?: boolean; refreshSceneObjects?: boolean }): boolean {
  return args.dryRun === true ? args.refreshSceneObjects === true : args.refreshSceneObjects !== false;
}

export function formatLiveSceneObjectRefresh(refresh: LiveSceneObjectContextRefresh | undefined): string {
  if (refresh === undefined) return "";
  if (!refresh.ok) return `\n\nLive scene object refresh warning: ${refresh.warning ?? "unknown error"}`;
  return `\n\nLive scene objects refreshed before resolution${refresh.count !== undefined ? ` (${refresh.count} object(s))` : ""}.`;
}

export function resolveContextSceneObject(
  context: LoadedUosContext,
  criteria: ContextSceneObjectCriteria,
): ContextSceneObjectResolution {
  const candidates = context.sceneObjects
    .filter((object) => criteria.includeDeleted === true || object.deleted !== true)
    .map(toCandidate);
  const matched = candidates.filter((candidate) => candidateMatches(candidate, criteria));
  if (matched.length === 1) return { ok: true, candidate: matched[0] };
  if (matched.length === 0) {
    return {
      ok: false,
      reason: "no matching scene object in persisted .uos context",
      candidates: candidates.slice(0, 20),
    };
  }
  if (criteria.latest === true) {
    return { ok: true, candidate: [...matched].sort((a, b) => latestTime(b) - latestTime(a))[0] };
  }
  return {
    ok: false,
    reason: "multiple matching scene objects in persisted .uos context; add objectId, objectName, type, path, or a stricter query",
    candidates: matched.slice(0, 20),
  };
}

export function formatSceneObjectResolutionFailure(
  resolution: Extract<ContextSceneObjectResolution, { ok: false }>,
): string {
  const lines = [
    resolution.reason,
    `candidate(s): ${resolution.candidates.length}`,
  ];
  for (const candidate of resolution.candidates.slice(0, 10)) {
    lines.push(`  - ${formatSceneObjectCandidate(candidate)}`);
  }
  return lines.join("\n");
}

export function formatSceneObjectCandidate(candidate: ContextSceneObjectCandidate): string {
  const parts = [
    `object=${candidate.objectId}`,
    candidate.name !== undefined ? `name="${candidate.name}"` : undefined,
    candidate.type !== undefined ? `type=${candidate.type}` : undefined,
    candidate.path !== undefined ? `path="${candidate.path}"` : undefined,
    candidate.parentObjectId !== undefined ? `parent=${candidate.parentObjectId}` : undefined,
    candidate.active === false ? "inactive" : candidate.active === true ? "active" : undefined,
    candidate.deleted === true ? "deleted" : undefined,
    formatTransform(candidate.transform),
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

export function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}

function toCandidate(object: SceneObjectSummary): ContextSceneObjectCandidate {
  return {
    objectId: object.objectId,
    name: object.name,
    type: object.type,
    path: object.path,
    parentObjectId: object.parentObjectId,
    active: object.active,
    deleted: object.deleted,
    updatedAt: object.updatedAt,
    transform: object.transform,
    components: object.components,
  };
}

function candidateMatches(candidate: ContextSceneObjectCandidate, criteria: ContextSceneObjectCriteria): boolean {
  if (criteria.objectId !== undefined && candidate.objectId !== criteria.objectId) return false;
  if (criteria.objectName !== undefined && !matchesExactOrContains(candidate.name, criteria.objectName)) return false;
  if (criteria.objectNameContains !== undefined && !containsFolded(candidate.name, criteria.objectNameContains)) return false;
  if (criteria.type !== undefined && !sameFolded(candidate.type, criteria.type)) return false;
  if (criteria.path !== undefined && !sameFolded(candidate.path, criteria.path)) return false;
  if (criteria.pathContains !== undefined && !containsFolded(candidate.path, criteria.pathContains)) return false;
  if (criteria.query !== undefined && !matchesObjectQuery(candidate, criteria.query)) return false;
  return true;
}

function matchesExactOrContains(value: string | undefined, query: string): boolean {
  return sameFolded(value, query) || containsFolded(value, query);
}

function matchesObjectQuery(candidate: ContextSceneObjectCandidate, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  const corpus = searchText([
    candidate.objectId,
    candidate.name,
    candidate.type,
    candidate.path,
    candidate.parentObjectId,
    ...(candidate.components ?? []),
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
    "scene",
    "object",
    "gameobject",
    "game",
    "go",
    "unity",
    "그",
    "이",
    "저",
    "씬",
    "오브젝트",
    "게임오브젝트",
  ]);
  return searchText([query])
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopwords.has(token));
}

function typeAliases(type: string | undefined): string | undefined {
  switch (fold(type)) {
    case "empty":
      return "empty parent marker holder root 빈 부모 마커";
    case "cube":
      return "cube box block 큐브 박스";
    case "sphere":
      return "sphere ball 구 공";
    case "capsule":
      return "capsule 캡슐";
    case "cylinder":
      return "cylinder 원통 실린더";
    case "plane":
      return "plane floor ground 바닥 평면";
    case "quad":
      return "quad plane billboard 사각 평면";
    case "camera":
      return "camera cam view main camera 카메라";
    case "pointlight":
      return "point light lamp bulb 포인트 라이트 조명";
    case "directionallight":
      return "directional light sun sunlight 디렉셔널 라이트 태양 조명";
    case "spotlight":
      return "spot light spotlight cone 스팟 라이트 조명";
    default:
      return undefined;
  }
}

function sameFolded(left: string | undefined, right: string): boolean {
  return fold(left) === fold(right);
}

function containsFolded(value: string | undefined, query: string): boolean {
  const haystack = fold(value);
  const needle = fold(query);
  return haystack.length > 0 && needle.length > 0 && haystack.includes(needle);
}

function fold(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
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

function latestTime(candidate: ContextSceneObjectCandidate): number {
  const parsed = candidate.updatedAt !== undefined ? Date.parse(candidate.updatedAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTransform(transform: ContextSceneObjectCandidate["transform"]): string | undefined {
  if (transform === undefined) return undefined;
  const parts = [
    formatVec3("pos", transform.position),
    formatVec3("rot", transform.rotation),
    formatVec3("scale", transform.scale),
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function formatVec3(label: string, value: { x: number; y: number; z: number } | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${label}=(${fmt(value.x)},${fmt(value.y)},${fmt(value.z)})`;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
