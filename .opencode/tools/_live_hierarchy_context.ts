import { call } from "./_bridge";
import { contextWithLiveHierarchy, type LoadedUosContext } from "./_uos_context";

export interface LiveHierarchyContextRefresh {
  ok: boolean;
  hierarchyArgs?: { screenId?: string };
  hierarchy?: Record<string, unknown>;
  nodeCount?: number;
  warning?: string;
}

export interface LiveHierarchyContextResult {
  context: LoadedUosContext;
  refresh?: LiveHierarchyContextRefresh;
}

export async function refreshContextFromLiveHierarchy(
  context: LoadedUosContext,
  options: { enabled?: boolean; screenId?: string } = {},
): Promise<LiveHierarchyContextResult> {
  if (options.enabled === false) return { context };
  const hierarchyArgs = compactObject({ screenId: options.screenId }) as { screenId?: string };
  try {
    const hierarchy = await call("get_scene_hierarchy", hierarchyArgs) as Record<string, unknown>;
    return {
      context: contextWithLiveHierarchy(context, hierarchy),
      refresh: {
        ok: true,
        hierarchyArgs,
        hierarchy,
        nodeCount: Array.isArray(hierarchy.nodes) ? hierarchy.nodes.length : undefined,
      },
    };
  } catch (error) {
    return {
      context,
      refresh: {
        ok: false,
        hierarchyArgs,
        warning: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function shouldRefreshLiveHierarchy(args: { dryRun?: boolean; refreshHierarchy?: boolean }): boolean {
  return args.dryRun === true ? args.refreshHierarchy === true : args.refreshHierarchy !== false;
}

export function formatLiveHierarchyRefresh(refresh: LiveHierarchyContextRefresh | undefined): string {
  if (refresh === undefined) return "";
  if (!refresh.ok) return `\n\nLive hierarchy refresh warning: ${refresh.warning ?? "unknown error"}`;
  return `\n\nLive hierarchy refreshed before resolution${refresh.nodeCount !== undefined ? ` (${refresh.nodeCount} node(s))` : ""}.`;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}
