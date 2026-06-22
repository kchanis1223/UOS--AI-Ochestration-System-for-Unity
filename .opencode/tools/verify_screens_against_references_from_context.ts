/**
 * verify_screens_against_references_from_context - batch visual verification
 * for material-derived screens persisted in .uos context.
 */
import { promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import {
  formatLiveHierarchyRefresh,
  refreshContextFromLiveHierarchy,
  shouldRefreshLiveHierarchy,
} from "./_live_hierarchy_context";
import { resolveCandidate, rootDir } from "./_materials";
import { verifyScreenAgainstReference, type VerifiedScreen } from "./_screen_verification";
import { loadUosContext, sourceReferencePath, type LoadedUosContext, type ScreenSummary } from "./_uos_context";

export interface BatchVerificationCriteria {
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
  referenceByScreenId?: Record<string, string>;
  maxScreens?: number;
}

export interface BatchVerificationPlan {
  screenId: string;
  screenName?: string;
  referencePath: string;
  referenceSource: "argument" | "argument-map" | "persisted-source";
  source?: ScreenSummary["source"];
}

export interface BatchVerificationResolution {
  ok: boolean;
  plans: BatchVerificationPlan[];
  skipped: Array<{ screenId: string; screenName?: string; reason: string; source?: ScreenSummary["source"] }>;
  candidates: Array<{ screenId: string; screenName?: string; sourceReferencePath?: string }>;
  reason?: string;
}

export default tool({
  description:
    "Resolve multiple persisted UOS screens by source filters, then capture and compare each screen with its persisted source/reference image. Use for PPTX decks, multi-page material flows, or broad follow-up requests like 'verify all screens from this deck'.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then current session directory."),
    contextDir: z
      .string()
      .optional()
      .describe("Explicit .uos context directory. Usually not needed."),
    screenId: z.string().optional().describe("Exact screenId filter."),
    screenName: z.string().optional().describe("Exact or unique case-insensitive screenName filter."),
    screenQuery: z.string().optional().describe("Natural query matched against screen name/id and persisted source metadata, e.g. 'lobby deck' or 'slide 2'."),
    sourceKind: z.string().optional().describe("Persisted source kind filter such as image, pdf, pptx, docx, md, txt, csv, or json."),
    sourcePath: z.string().optional().describe("Exact persisted source path filter, case-insensitive."),
    sourcePathContains: z.string().optional().describe("Substring persisted source path filter, case-insensitive."),
    pageNumber: z.number().int().positive().optional().describe("Persisted source page number filter for PDF-derived screens."),
    slideNumber: z.number().int().positive().optional().describe("Persisted source slide number filter for PPTX-derived screens."),
    imageNumber: z.number().int().positive().optional().describe("Persisted source embedded image number filter for DOCX-derived screens."),
    latest: z.boolean().optional().describe("Verify only the most recent matching screen. Defaults to false."),
    referencePath: z.string().optional().describe("Explicit reference image path. Allowed only when exactly one screen matches."),
    referenceByScreenId: z.record(z.string(), z.string()).optional().describe("Optional explicit reference image path per screenId for screens without persisted source/reference images."),
    maxScreens: z.number().int().positive().max(25).optional().describe("Maximum screens to verify. Defaults to 10, or 1 when latest=true."),
    maxWidth: z.number().int().positive().max(4096).optional().describe("Maximum comparison width. Defaults to 1024."),
    maxHeight: z.number().int().positive().max(4096).optional().describe("Maximum comparison height. Defaults to 1024."),
    threshold: z.number().min(0).max(1).optional().describe("Per-pixel normalized delta threshold for mismatchRatio. Defaults to 0.05."),
    outputDir: z.string().optional().describe("Optional directory for generated diff PNGs. Relative paths resolve against UNITY_MCP_MATERIALS_DIR/session cwd."),
    refreshHierarchy: z.boolean().optional().describe("Best-effort refresh from live Unity hierarchy before resolving screens. Defaults to true, except dryRun defaults to false."),
    dryRun: z.boolean().optional().describe("Resolve screen/reference pairs without calling Unity. Defaults to false."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    let context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const refreshed = await refreshContextFromLiveHierarchy(context, { enabled: shouldRefreshLiveHierarchy(args) });
    context = refreshed.context;

    const resolution = await resolveContextVerificationBatch(context, args);
    if (!resolution.ok || resolution.plans.length === 0) {
      return {
        title: "verify_screens_against_references_from_context: unresolved",
        output: formatBatchResolutionFailure(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: false, ...resolution, contextRefresh: refreshed.refresh },
      };
    }

    if (args.dryRun === true) {
      return {
        title: "verify_screens_against_references_from_context: dry run",
        output: formatDryRunResolution(resolution) + formatLiveHierarchyRefresh(refreshed.refresh),
        metadata: { ok: true, dryRun: true, ...resolution, contextRefresh: refreshed.refresh },
      };
    }

    const outputDir = args.outputDir !== undefined
      ? resolveCandidate(args.outputDir, rootDir(ctx.directory))
      : undefined;
    const verifiedScreens: Array<{
      screenId: string;
      screenName?: string;
      referencePath: string;
      referenceSource: BatchVerificationPlan["referenceSource"];
      verifyArgs: {
        screenId: string;
        referencePath: string;
        maxWidth?: number;
        maxHeight?: number;
        threshold?: number;
        outputPath?: string;
      };
      verified: VerifiedScreen;
    }> = [];
    const failedScreens: Array<{ screenId: string; screenName?: string; referencePath: string; error: string }> = [];

    for (const plan of resolution.plans) {
      const verifyArgs = {
        screenId: plan.screenId,
        referencePath: plan.referencePath,
        maxWidth: args.maxWidth,
        maxHeight: args.maxHeight,
        threshold: args.threshold,
        outputPath: outputDir !== undefined
          ? join(outputDir, `diff-${safeFileStem(plan.screenName ?? plan.screenId)}.png`)
          : undefined,
      };
      try {
        const verified = await verifyScreenAgainstReference(verifyArgs, {
          directory: ctx.directory,
          capturePreview: async (screenId) => await call("capture_preview", { screenId }) as any,
        });
        verifiedScreens.push({
          screenId: plan.screenId,
          screenName: plan.screenName,
          referencePath: plan.referencePath,
          referenceSource: plan.referenceSource,
          verifyArgs,
          verified,
        });
      } catch (err) {
        failedScreens.push({
          screenId: plan.screenId,
          screenName: plan.screenName,
          referencePath: plan.referencePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const verdict = batchVerdict(verifiedScreens.map((item) => item.verified.verdict), failedScreens.length);
    const attachments = verifiedScreens.flatMap((item) => [
      {
        type: "file" as const,
        mime: item.verified.preview.mimeType,
        url: item.verified.preview.uri,
        filename: basename(item.verified.preview.savedPath),
      },
      {
        type: "file" as const,
        mime: item.verified.comparison.diffMimeType,
        url: item.verified.comparison.uri,
        filename: basename(item.verified.comparison.diffPath),
      },
    ]);

    return {
      title: `verify_screens_against_references_from_context: ${verdict}`,
      output: formatBatchVerificationResult(verdict, verifiedScreens, failedScreens, resolution.skipped) +
        formatLiveHierarchyRefresh(refreshed.refresh),
      metadata: {
        ok: verifiedScreens.length > 0,
        complete: failedScreens.length === 0,
        verdict,
        verifiedScreens,
        failedScreens,
        skippedScreens: resolution.skipped,
        contextRefresh: refreshed.refresh,
      },
      attachments,
    };
  },
});

export async function resolveContextVerificationBatch(
  context: LoadedUosContext,
  criteria: BatchVerificationCriteria,
): Promise<BatchVerificationResolution> {
  let screens = context.screens.filter((screen) => matchesScreenCriteria(screen, criteria));
  screens = [...screens].sort((a, b) => latestScreenTime(b) - latestScreenTime(a));
  const maxScreens = criteria.latest === true
    ? 1
    : clampInteger(criteria.maxScreens, 10, 1, 25);
  const candidates = screens.map((screen) => ({
    screenId: screen.screenId,
    screenName: screen.screenName,
    sourceReferencePath: sourceReferencePath(screen.source),
  }));
  const selected = screens.slice(0, maxScreens);
  const skipped: BatchVerificationResolution["skipped"] = [];
  const plans: BatchVerificationPlan[] = [];

  if (criteria.referencePath !== undefined && selected.length !== 1) {
    return {
      ok: false,
      plans,
      skipped,
      candidates,
      reason: "referencePath can only be used when exactly one screen matches; use referenceByScreenId for batch verification",
    };
  }

  for (const screen of selected) {
    const mappedReference = criteria.referenceByScreenId?.[screen.screenId];
    const explicitReference = selected.length === 1 ? criteria.referencePath : undefined;
    const persistedReference = sourceReferencePath(screen.source);
    const referencePath = firstNonBlank(mappedReference, explicitReference, persistedReference);
    const referenceSource: BatchVerificationPlan["referenceSource"] =
      mappedReference !== undefined ? "argument-map" : explicitReference !== undefined ? "argument" : "persisted-source";
    if (referencePath === undefined) {
      skipped.push({
        screenId: screen.screenId,
        screenName: screen.screenName,
        reason: "no persisted source/reference image; provide referenceByScreenId",
        source: screen.source,
      });
      continue;
    }
    try {
      const stat = await fs.stat(referencePath);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      skipped.push({
        screenId: screen.screenId,
        screenName: screen.screenName,
        reason: `reference image is not readable: ${referencePath}`,
        source: screen.source,
      });
      continue;
    }
    plans.push({
      screenId: screen.screenId,
      screenName: screen.screenName,
      referencePath,
      referenceSource,
      source: screen.source,
    });
  }

  if (screens.length === 0) {
    return {
      ok: false,
      plans,
      skipped,
      candidates,
      reason: "no matching screens in persisted .uos context",
    };
  }
  if (plans.length === 0) {
    return {
      ok: false,
      plans,
      skipped,
      candidates,
      reason: "matching screens were found but none had a readable reference image",
    };
  }
  return { ok: true, plans, skipped, candidates };
}

function matchesScreenCriteria(screen: ScreenSummary, criteria: BatchVerificationCriteria): boolean {
  if (criteria.screenId !== undefined && screen.screenId !== criteria.screenId) return false;
  if (criteria.screenName !== undefined) {
    const nameMatches = sameFolded(screen.screenName, criteria.screenName)
      || containsFolded(screen.screenName, criteria.screenName);
    if (!nameMatches) return false;
  }
  if (criteria.screenQuery !== undefined && !screenMatchesQuery(screen, criteria.screenQuery)) return false;
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
  const tokens = searchText([query]).split(" ").filter((token) => token.length > 0);
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
  ]);
  return tokens.every((token) => corpus.includes(token));
}

function formatBatchResolutionFailure(resolution: BatchVerificationResolution): string {
  const lines = [
    resolution.reason ?? "no verifiable screens",
    `candidate screen(s): ${resolution.candidates.length}`,
  ];
  for (const candidate of resolution.candidates.slice(0, 12)) {
    lines.push(
      `  - screen=${candidate.screenId}${candidate.screenName !== undefined ? `(${candidate.screenName})` : ""}` +
        (candidate.sourceReferencePath !== undefined ? ` reference=${candidate.sourceReferencePath}` : ""),
    );
  }
  if (resolution.skipped.length > 0) {
    lines.push(`skipped screen(s): ${resolution.skipped.length}`);
    for (const skipped of resolution.skipped.slice(0, 12)) {
      lines.push(`  - screen=${skipped.screenId}${skipped.screenName !== undefined ? `(${skipped.screenName})` : ""}: ${skipped.reason}`);
    }
  }
  return lines.join("\n");
}

function formatDryRunResolution(resolution: BatchVerificationResolution): string {
  const lines = [
    `Resolved ${resolution.plans.length} screen/reference pair(s). Dry run only; Unity was not called.`,
  ];
  for (const plan of resolution.plans) {
    lines.push(
      `  - screen=${plan.screenId}${plan.screenName !== undefined ? `(${plan.screenName})` : ""}` +
        ` reference=${plan.referencePath} (${plan.referenceSource})`,
    );
  }
  if (resolution.skipped.length > 0) {
    lines.push(`Skipped ${resolution.skipped.length} matching screen(s) without readable references.`);
  }
  return lines.join("\n");
}

function formatBatchVerificationResult(
  verdict: string,
  verifiedScreens: Array<{ screenId: string; screenName?: string; referencePath: string; verified: VerifiedScreen }>,
  failedScreens: Array<{ screenId: string; screenName?: string; referencePath: string; error: string }>,
  skippedScreens: BatchVerificationResolution["skipped"],
): string {
  const lines = [
    `Verified ${verifiedScreens.length} screen(s), failed ${failedScreens.length}, skipped ${skippedScreens.length}.`,
    `batch verdict=${verdict}`,
  ];
  for (const item of verifiedScreens) {
    const comparison = item.verified.comparison;
    lines.push(
      `  - screen=${item.screenId}${item.screenName !== undefined ? `(${item.screenName})` : ""}` +
        ` verdict=${item.verified.verdict}` +
        ` mae=${comparison.meanAbsoluteError}` +
        ` mismatch=${comparison.mismatchRatio}` +
        ` diff=${comparison.diffPath}`,
    );
  }
  for (const item of failedScreens) {
    lines.push(
      `  - failed screen=${item.screenId}${item.screenName !== undefined ? `(${item.screenName})` : ""}` +
        ` reference=${item.referencePath}: ${item.error}`,
    );
  }
  for (const item of skippedScreens.slice(0, 8)) {
    lines.push(
      `  - skipped screen=${item.screenId}${item.screenName !== undefined ? `(${item.screenName})` : ""}: ${item.reason}`,
    );
  }
  lines.push("Inspect the preview and diff attachments before deciding the next edit.");
  return lines.join("\n");
}

function batchVerdict(verdicts: Array<VerifiedScreen["verdict"]>, failedCount: number): "close" | "needs review" | "different" {
  if (failedCount > 0) return "different";
  if (verdicts.includes("different")) return "different";
  if (verdicts.includes("needs review")) return "needs review";
  return "close";
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

function searchText(values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^0-9a-zA-Z\uAC00-\uD7AF]+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function safeFileStem(value: string): string {
  return value.replace(/[^0-9a-zA-Z._-]+/g, "_").replace(/^_+|_+$/g, "") || "screen";
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}
