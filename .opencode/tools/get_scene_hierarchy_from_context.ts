/**
 * get_scene_hierarchy_from_context - resolve a persisted .uos screen, then inspect live hierarchy.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { formatLiveHierarchyRefresh, refreshContextFromLiveHierarchy } from "./_live_hierarchy_context";
import { loadUosContext } from "./_uos_context";
import { resolveContextScreen } from "./add_ui_element_from_context";
import { summarizeHierarchy } from "./get_scene_hierarchy";

export default tool({
  description:
    "Inspect the live Unity hierarchy for a persisted UOS screen by resolving it from .uos context using screen name/id, or the persisted active screen when no screen is named. Use before follow-up edits when the canonical screenId is not already known.",
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
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from the live Unity scene before resolving the screen. Defaults to true."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: args.refreshHierarchy !== false });
    context = refreshed.context;
    const resolution = resolveContextScreen(context, args);
    if (!resolution.ok) {
      return {
        title: "get_scene_hierarchy_from_context: unresolved",
        output: formatScreenFailure(resolution.reason, resolution.screens) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, screens: resolution.screens, contextRefresh: refreshed.refresh },
      };
    }

    const hierarchyArgs = { screenId: resolution.screen.screenId };
    const data = (await call("get_scene_hierarchy", hierarchyArgs)) as Record<string, unknown>;
    const summary = summarizeHierarchy(data);
    const raw = JSON.stringify(data, null, 2);
    return {
      title: `get_scene_hierarchy_from_context: ${resolution.screen.screenId}`,
      output:
        `Resolved screen=${resolution.screen.screenId}${resolution.screen.screenName !== undefined ? `(${resolution.screen.screenName})` : ""}.\n` +
        `${summary}\n\nRaw hierarchy JSON:\n${raw}` +
        formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution.screen,
        hierarchyArgs,
        hierarchy: data,
        contextRefresh: refreshed.refresh,
      },
    };
  },
});

function formatScreenFailure(reason: string, screens: Array<{ screenId: string; screenName?: string }>): string {
  const lines = [
    reason,
    `screen candidate(s): ${screens.length}`,
  ];
  for (const screen of screens.slice(0, 10)) {
    lines.push(`  - screen=${screen.screenId}${screen.screenName !== undefined ? `(${screen.screenName})` : ""}`);
  }
  return lines.join("\n");
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}
