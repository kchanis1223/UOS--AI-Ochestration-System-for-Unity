/**
 * capture_preview_from_context - resolve a persisted .uos screen, then capture preview.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { persistPreview } from "./_preview";
import { loadUosContext } from "./_uos_context";
import { resolveContextScreen } from "./add_ui_element_from_context";

interface CapturePreviewResponse {
  screenId?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  base64Data?: string;
  size?: number;
}

export default tool({
  description:
    "Capture a preview by resolving a persisted UOS screen from .uos context using screen name/id, or the persisted active screen when no screen is named. Use for conversational visual checks when the canonical screenId is not already known.",
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
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving the screen. Defaults to true, except dryRun defaults to false."),
    dryRun: z.boolean().optional().describe("Resolve and report the screen without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: shouldRefreshLiveHierarchy(args) });
    context = refreshed.context;
    const resolution = resolveContextScreen(context, args);
    if (!resolution.ok) {
      return {
        title: "capture_preview_from_context: unresolved",
        output: formatScreenFailure(resolution.reason, resolution.screens) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, screens: resolution.screens, contextRefresh: refreshed.refresh },
      };
    }

    const previewArgs = { screenId: resolution.screen.screenId };
    if (args.dryRun === true) {
      return {
        title: `capture_preview_from_context: dry run ${resolution.screen.screenId}`,
        output: `Resolved screen=${resolution.screen.screenId}${resolution.screen.screenName !== undefined ? `(${resolution.screen.screenName})` : ""}. Dry run only; Unity was not modified.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: true, dryRun: true, matched: resolution.screen, previewArgs, contextRefresh: refreshed.refresh },
      };
    }

    const data = (await call("capture_preview", previewArgs)) as CapturePreviewResponse;
    const mimeType = data.mimeType ?? "image/png";
    const size = data.size ?? 0;
    const dims = data.width !== undefined && data.height !== undefined
      ? `${data.width}x${data.height}`
      : "(unknown dims)";

    if (typeof data.base64Data !== "string" || data.base64Data.length === 0) {
      return {
        title: `capture_preview_from_context: ${resolution.screen.screenId} (no base64)`,
        output: `Unity returned no base64Data for screen ${resolution.screen.screenId}.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: {
          ok: false,
          matched: resolution.screen,
          previewArgs,
          contextRefresh: refreshed.refresh,
          captured: { screenId: resolution.screen.screenId, ...data },
        },
      };
    }

    const preview = await persistPreview(data.base64Data, resolution.screen.screenId, mimeType);
    const captured = {
      ok: true,
      screenId: resolution.screen.screenId,
      mimeType,
      size,
      width: data.width,
      height: data.height,
      savedPath: preview.absPath,
      uri: preview.uri,
    };
    return {
      title: `capture_preview_from_context: ${resolution.screen.screenId} (${dims}, ${size}b)`,
      output:
        `Preview captured for screen ${resolution.screen.screenId} (${dims}, ${size}b, mime=${mimeType}).\n` +
        `Saved to: ${preview.absPath}\n` +
        "Attached for vision; inspect the image to verify layout." +
        formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution.screen,
        previewArgs,
        captured,
        contextRefresh: refreshed.refresh,
        ...captured,
      },
      attachments: [{ type: "file" as const, mime: mimeType, url: preview.uri, filename: preview.filename }],
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
