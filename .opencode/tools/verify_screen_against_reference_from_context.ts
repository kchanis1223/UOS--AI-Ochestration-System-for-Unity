/**
 * verify_screen_against_reference_from_context - resolve screen/reference from .uos, then verify.
 */
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { verifyScreenAgainstReference } from "./_screen_verification";
import { loadUosContext, sourceReferencePath, type LoadedUosContext } from "./_uos_context";
import { resolveContextScreen } from "./add_ui_element_from_context";

export type ContextVerificationResolution =
  | {
      ok: true;
      screenId: string;
      screenName?: string;
      referencePath: string;
      referenceSource: "argument" | "persisted-source";
    }
  | {
      ok: false;
      reason: string;
      screens: Array<{ screenId: string; screenName?: string; sourceReferencePath?: string }>;
    };

export default tool({
  description:
    "Resolve a persisted UOS screen by screen name/id, or the persisted active screen when no screen is named, use an explicit reference image or the screen's persisted source/reference image, then capture and compare. Use for conversational visual verification when the canonical screenId or reference path is not already known.",
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
    referencePath: z.string().optional().describe("Reference/mockup image path. If omitted, uses the screen's persisted source rendered/extracted/image path when available."),
    maxWidth: z.number().int().positive().max(4096).optional().describe("Maximum comparison width. Defaults to 1024."),
    maxHeight: z.number().int().positive().max(4096).optional().describe("Maximum comparison height. Defaults to 1024."),
    threshold: z.number().min(0).max(1).optional().describe("Per-pixel normalized delta threshold for mismatchRatio. Defaults to 0.05."),
    outputPath: z.string().optional().describe("Optional output path for the generated diff PNG."),
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving the screen/reference. Defaults to true, except dryRun defaults to false."),
    dryRun: z.boolean().optional().describe("Resolve screen/reference without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: shouldRefreshLiveHierarchy(args) });
    context = refreshed.context;
    const resolution = await resolveContextVerification(context, args);
    if (!resolution.ok) {
      return {
        title: "verify_screen_against_reference_from_context: unresolved",
        output: formatVerificationFailure(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: false, reason: resolution.reason, screens: resolution.screens, contextRefresh: refreshed.refresh },
      };
    }

    const verifyArgs = {
      screenId: resolution.screenId,
      referencePath: resolution.referencePath,
      maxWidth: args.maxWidth,
      maxHeight: args.maxHeight,
      threshold: args.threshold,
      outputPath: args.outputPath,
    };
    if (args.dryRun === true) {
      return {
        title: "verify_screen_against_reference_from_context: dry run",
        output: `Resolved screen=${resolution.screenId}${resolution.screenName !== undefined ? `(${resolution.screenName})` : ""} reference=${resolution.referencePath} (${resolution.referenceSource}). Dry run only; Unity was not modified.` +
          formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: true, dryRun: true, matched: resolution, verifyArgs, contextRefresh: refreshed.refresh },
      };
    }

    const verified = await verifyScreenAgainstReference(verifyArgs, {
      directory: ctx.directory,
      capturePreview: async (screenId) => await call("capture_preview", { screenId }) as any,
    });
    const preview = verified.preview;
    const comparison = verified.comparison;
    return {
      title: `verify_screen_against_reference_from_context: ${verified.verdict}`,
      output:
        `Captured screen ${resolution.screenId} and compared it with ${comparison.referencePath}.\n` +
        `Preview saved to: ${preview.savedPath}\n` +
        `Diff image saved to: ${comparison.diffPath}\n` +
        `verdict=${verified.verdict}, meanAbsoluteError=${comparison.meanAbsoluteError}, ` +
        `rootMeanSquareError=${comparison.rootMeanSquareError}, mismatchRatio=${comparison.mismatchRatio}, ` +
        `maxChannelDelta=${comparison.maxChannelDelta}, aspectRatioDelta=${comparison.aspectRatioDelta}.\n` +
        "Inspect both attachments before deciding the next edit." +
        formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: true,
        matched: resolution,
        verifyArgs,
        verified,
        contextRefresh: refreshed.refresh,
        ...verified,
      },
      attachments: [
        { type: "file" as const, mime: preview.mimeType, url: preview.uri, filename: basename(preview.savedPath) },
        { type: "file" as const, mime: comparison.diffMimeType, url: comparison.uri, filename: basename(comparison.diffPath) },
      ],
    };
  },
});

export async function resolveContextVerification(
  context: LoadedUosContext,
  criteria: {
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
    referencePath?: string;
  },
): Promise<ContextVerificationResolution> {
  const screen = resolveContextScreen(context, criteria);
  if (!screen.ok) {
    return {
      ok: false,
      reason: screen.reason,
      screens: screenCandidatesWithReferences(context),
    };
  }
  const explicitReference = firstNonBlank(criteria.referencePath);
  if (explicitReference !== undefined) {
    return {
      ok: true,
      screenId: screen.screen.screenId,
      screenName: screen.screen.screenName,
      referencePath: explicitReference,
      referenceSource: "argument",
    };
  }

  const referencePath = sourceReferencePath(screen.screen.source);
  if (referencePath === undefined) {
    return {
      ok: false,
      reason: "selected screen has no persisted source/reference image; provide referencePath",
      screens: screenCandidatesWithReferences(context),
    };
  }
  try {
    const stat = await fs.stat(referencePath);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return {
      ok: false,
      reason: `persisted source/reference image is not readable: ${referencePath}`,
      screens: screenCandidatesWithReferences(context),
    };
  }
  return {
    ok: true,
    screenId: screen.screen.screenId,
    screenName: screen.screen.screenName,
    referencePath,
    referenceSource: "persisted-source",
  };
}

function screenCandidatesWithReferences(context: LoadedUosContext) {
  return context.screens.slice(0, 20).map((screen) => ({
    screenId: screen.screenId,
    screenName: screen.screenName,
    sourceReferencePath: sourceReferencePath(screen.source),
  }));
}

function formatVerificationFailure(resolution: Extract<ContextVerificationResolution, { ok: false }>): string {
  const lines = [
    resolution.reason,
    `screen candidate(s): ${resolution.screens.length}`,
  ];
  for (const screen of resolution.screens.slice(0, 10)) {
    lines.push(
      `  - screen=${screen.screenId}${screen.screenName !== undefined ? `(${screen.screenName})` : ""}` +
        (screen.sourceReferencePath !== undefined ? ` reference=${screen.sourceReferencePath}` : ""),
    );
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
