/**
 * delete_ui_element_from_context - resolve a persisted .uos element, then delete it.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { loadUosContext } from "./_uos_context";
import {
  resolveContextElement,
  type ContextElementCandidate,
  type ContextElementResolution,
} from "./update_ui_element_from_context";

export default tool({
  description:
    "Delete one persisted UI element by resolving it from .uos context using screen name/id, clientHintId, current text, type, or elementId. If no screen is named and multiple elements match, a single active-screen match is preferred. Use for conversational follow-up deletes when the canonical elementId is not already known.",
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
    elementId: z.string().optional().describe("Exact canonical elementId. If known, delete_ui_element is also valid."),
    clientHintId: z.string().optional().describe("Exact clientHintId from the original PlanningIntent."),
    type: z.string().optional().describe("Element type filter such as Text, Button, Image, or Panel."),
    text: z.string().optional().describe("Exact current text filter, case-insensitive."),
    textContains: z.string().optional().describe("Substring current text filter, case-insensitive."),
    query: z.string().optional().describe("Natural element query matched against screen name, clientHintId, type aliases, and current text, e.g. 'play button', 'primary CTA', or '설정 버튼'."),
    includeDeleted: z.boolean().optional().describe("Allow matching elements marked deleted in .uos context. Defaults to false."),
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving the target. Defaults to true."),
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
        title: "delete_ui_element_from_context: unresolved",
        output: formatResolutionFailure(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, candidates: resolution.candidates, contextRefresh: refreshed.refresh },
      };
    }

    const deleteArgs = { elementId: resolution.candidate.elementId };
    if (args.dryRun === true) {
      return {
        title: `delete_ui_element_from_context: dry run ${resolution.candidate.elementId}`,
        output: `Resolved ${formatCandidate(resolution.candidate)}. Dry run only; Unity was not modified.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: true,
          dryRun: true,
          matched: resolution.candidate,
          deleteArgs,
          contextRefresh: refreshed.refresh,
        },
      };
    }

    const deleted = (await call("delete_ui_element", deleteArgs)) as Record<string, unknown>;
    return {
      title: `delete_ui_element_from_context: ${resolution.candidate.elementId}`,
      output: `Deleted ${formatCandidate(resolution.candidate)}.` + formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution.candidate,
        deleteArgs,
        deleted,
        contextRefresh: refreshed.refresh,
        ...deleted,
      },
    };
  },
});

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
