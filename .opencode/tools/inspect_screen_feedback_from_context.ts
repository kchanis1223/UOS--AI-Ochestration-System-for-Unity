/**
 * inspect_screen_feedback_from_context - summarize persisted visual feedback for one screen.
 */
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { guessMimeType } from "./_materials";
import {
  loadUosContext,
  sourceReferencePath,
  type ComparisonSummary,
  type LoadedUosContext,
  type PreviewSummary,
  type ScreenSummary,
} from "./_uos_context";
import { resolveContextScreen } from "./add_ui_element_from_context";

export interface ScreenFeedbackSummary {
  ok: true;
  screen: {
    screenId: string;
    screenName?: string;
    active?: boolean;
    elementCount: number;
    previewCount: number;
    comparisonCount: number;
  };
  source?: ScreenSummary["source"];
  latestPreview?: PreviewSummary;
  latestComparison?: ComparisonSummary;
  sourceReferencePath?: string;
  recommendedTools: string[];
  diagnostics: ScreenFeedbackDiagnostic[];
  recommendations: string[];
}

export interface ScreenFeedbackDiagnostic {
  code:
    | "preview-missing"
    | "comparison-missing"
    | "reference-missing"
    | "visual-close"
    | "aspect-ratio-delta"
    | "moderate-mismatch"
    | "large-mismatch";
  severity: "info" | "low" | "medium" | "high";
  message: string;
  evidence?: Record<string, number | string | boolean>;
  recommendedTools: string[];
}

export default tool({
  description:
    "Inspect persisted .uos visual feedback for one screen: source material, latest preview, latest comparison/diff, and recommended next tools. Use after material-derived screen creation or visual verification before conversational follow-up edits.",
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
    maxAttachments: z
      .number()
      .int()
      .min(0)
      .max(3)
      .optional()
      .describe("Maximum images to attach among diff, source/reference, and preview. Defaults to 3."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const context = await loadUosContext(args.contextDir !== undefined
      ? { contextDir: args.contextDir }
      : { projectDir: firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, ctx.directory) });
    const resolution = resolveContextScreen(context, args);
    if (!resolution.ok) {
      return {
        title: "inspect_screen_feedback_from_context: unresolved",
        output: formatScreenFailure(resolution.reason, resolution.screens),
        metadata: { ok: false, reason: resolution.reason, screens: resolution.screens },
      };
    }

    const feedback = screenFeedbackFromContext(context, resolution.screen);
    const attachments = await feedbackAttachments(feedback, args.maxAttachments ?? 3);
    return {
      title: `inspect_screen_feedback_from_context: ${feedback.screen.screenId}`,
      output: formatScreenFeedback(feedback, attachments.length),
      metadata: {
        ...feedback,
        attachments,
      },
      attachments: attachments.map((attachment) => ({
        type: attachment.type,
        mime: attachment.mime,
        url: attachment.url,
        filename: attachment.filename,
      })),
    };
  },
});

export function screenFeedbackFromContext(
  _context: LoadedUosContext,
  screen: ScreenSummary,
): ScreenFeedbackSummary {
  const latestPreview = latestByTs(screen.previews);
  const latestComparison = latestByTs(screen.comparisons);
  const refPath = sourceReferencePath(screen.source);
  const diagnostics = feedbackDiagnostics(latestPreview, latestComparison, refPath);
  return {
    ok: true,
    screen: {
      screenId: screen.screenId,
      screenName: screen.screenName,
      active: screen.active,
      elementCount: screen.elementCount,
      previewCount: screen.previewCount,
      comparisonCount: screen.comparisonCount,
    },
    source: screen.source,
    latestPreview,
    latestComparison,
    sourceReferencePath: refPath,
    recommendedTools: feedbackRecommendedTools(latestPreview, latestComparison, refPath),
    diagnostics,
    recommendations: feedbackRecommendations(screen, latestPreview, latestComparison, refPath),
  };
}

export function formatScreenFeedback(feedback: ScreenFeedbackSummary, attachmentCount = 0): string {
  const lines = [
    `[screen feedback] screen: ${feedback.screen.screenId}${feedback.screen.screenName !== undefined ? ` (${feedback.screen.screenName})` : ""}`,
    `[screen feedback] elements=${feedback.screen.elementCount}, previews=${feedback.screen.previewCount}, comparisons=${feedback.screen.comparisonCount}${feedback.screen.active === true ? ", active" : ""}`,
  ];
  if (feedback.source !== undefined) {
    const sourceBits = [
      feedback.source.kind,
      feedback.source.mode,
      feedback.source.path,
      feedback.source.pageNumber !== undefined ? `page=${feedback.source.pageNumber}` : undefined,
      feedback.source.slideNumber !== undefined ? `slide=${feedback.source.slideNumber}` : undefined,
      feedback.source.imageNumber !== undefined ? `image=${feedback.source.imageNumber}` : undefined,
    ].filter((part): part is string => part !== undefined && part.length > 0);
    lines.push(`[screen feedback] source: ${sourceBits.join(" ")}`);
  }
  if (feedback.sourceReferencePath !== undefined) {
    lines.push(`[screen feedback] source/reference image: ${feedback.sourceReferencePath}`);
  }
  if (feedback.latestPreview !== undefined) {
    const preview = feedback.latestPreview;
    const dims = preview.width !== undefined && preview.height !== undefined
      ? `${preview.width}x${preview.height}`
      : "unknown dims";
    lines.push(`[screen feedback] latest preview: ${preview.savedPath ?? preview.uri ?? "(no path)"} (${dims}${preview.ts !== undefined ? `, ${preview.ts}` : ""})`);
  } else {
    lines.push("[screen feedback] latest preview: none");
  }
  if (feedback.latestComparison !== undefined) {
    lines.push(`[screen feedback] latest comparison: ${formatComparison(feedback.latestComparison)}`);
  } else {
    lines.push("[screen feedback] latest comparison: none");
  }
  if (feedback.diagnostics.length > 0) {
    lines.push("[screen feedback] diagnostics:");
    for (const diagnostic of feedback.diagnostics) {
      const evidence = formatDiagnosticEvidence(diagnostic.evidence);
      const tools = diagnostic.recommendedTools.length > 0
        ? ` tools=${diagnostic.recommendedTools.join(",")}`
        : "";
      lines.push(`  - ${diagnostic.severity}/${diagnostic.code}: ${diagnostic.message}${evidence}${tools}`);
    }
  }
  if (feedback.recommendedTools.length > 0) {
    lines.push(`[screen feedback] recommended tools: ${feedback.recommendedTools.join(", ")}`);
  }
  lines.push("[screen feedback] recommended next steps:");
  for (const recommendation of feedback.recommendations) {
    lines.push(`  - ${recommendation}`);
  }
  if (attachmentCount > 0) {
    lines.push(`[screen feedback] attached image(s): ${attachmentCount}`);
  }
  return lines.join("\n");
}

export async function feedbackAttachments(
  feedback: ScreenFeedbackSummary,
  maxAttachments = 3,
): Promise<Array<{ type: "file"; mime: string; url: string; filename: string; path: string; role: string }>> {
  const ordered = [
    { path: feedback.latestComparison?.diffPath, role: "comparison-diff" },
    { path: feedback.sourceReferencePath, role: "source-reference" },
    { path: feedback.latestPreview?.savedPath, role: "latest-preview" },
  ];
  const attachments: Array<{ type: "file"; mime: string; url: string; filename: string; path: string; role: string }> = [];
  const seen = new Set<string>();
  for (const item of ordered) {
    if (attachments.length >= maxAttachments) break;
    if (item.path === undefined || seen.has(item.path)) continue;
    const stat = await statFile(item.path);
    if (stat === undefined || !stat.isFile()) continue;
    seen.add(item.path);
    attachments.push({
      type: "file",
      mime: guessMimeType(item.path),
      url: pathToFileURL(item.path).toString(),
      filename: basename(item.path),
      path: item.path,
      role: item.role,
    });
  }
  return attachments;
}

function feedbackDiagnostics(
  preview: PreviewSummary | undefined,
  comparison: ComparisonSummary | undefined,
  refPath: string | undefined,
): ScreenFeedbackDiagnostic[] {
  const diagnostics: ScreenFeedbackDiagnostic[] = [];
  if (preview === undefined) {
    diagnostics.push({
      code: "preview-missing",
      severity: "high",
      message: "No captured preview is available, so visual quality cannot be judged yet.",
      recommendedTools: ["capture_preview_from_context"],
    });
  }

  if (comparison === undefined) {
    if (refPath !== undefined) {
      diagnostics.push({
        code: "comparison-missing",
        severity: preview === undefined ? "medium" : "high",
        message: "A source/reference image exists, but no visual comparison has been recorded.",
        evidence: { sourceReferencePath: refPath },
        recommendedTools: ["verify_screen_against_reference_from_context"],
      });
    } else {
      diagnostics.push({
        code: "reference-missing",
        severity: "medium",
        message: "No persisted source/reference image is available for objective visual comparison.",
        recommendedTools: ["get_scene_hierarchy_from_context", "capture_preview_from_context"],
      });
    }
    return diagnostics;
  }

  const aspectDelta = finiteNumber(comparison.aspectRatioDelta);
  if (aspectDelta !== undefined && aspectDelta > 0.02) {
    diagnostics.push({
      code: "aspect-ratio-delta",
      severity: aspectDelta > 0.08 ? "high" : "medium",
      message: "Reference and preview aspect ratios differ; broad layout edits may be more useful than local element tweaks.",
      evidence: { aspectRatioDelta: aspectDelta },
      recommendedTools: ["get_scene_hierarchy_from_context", "move_ui_element_from_context", "verify_screen_against_reference_from_context"],
    });
  }

  const mismatchRatio = finiteNumber(comparison.mismatchRatio);
  const meanAbsoluteError = finiteNumber(comparison.meanAbsoluteError);
  if (
    comparison.verdict === "different" ||
    (mismatchRatio !== undefined && mismatchRatio > 0.35) ||
    (meanAbsoluteError !== undefined && meanAbsoluteError > 0.12)
  ) {
    diagnostics.push({
      code: "large-mismatch",
      severity: "high",
      message: "The latest preview is visually far from the reference; verify the selected screen/source before doing fine polish.",
      evidence: metricEvidence(comparison),
      recommendedTools: [
        "get_scene_hierarchy_from_context",
        "update_ui_element_from_context",
        "move_ui_element_from_context",
        "add_ui_element_from_context",
        "delete_ui_element_from_context",
        "verify_screen_against_reference_from_context",
      ],
    });
  } else if (
    comparison.verdict === "needs review" ||
    (mismatchRatio !== undefined && mismatchRatio > 0.1) ||
    (meanAbsoluteError !== undefined && meanAbsoluteError > 0.03)
  ) {
    diagnostics.push({
      code: "moderate-mismatch",
      severity: "medium",
      message: "The screen is broadly recognizable but still differs enough to guide targeted follow-up edits.",
      evidence: metricEvidence(comparison),
      recommendedTools: [
        "get_scene_hierarchy_from_context",
        "update_ui_element_from_context",
        "move_ui_element_from_context",
        "verify_screen_against_reference_from_context",
      ],
    });
  } else {
    diagnostics.push({
      code: "visual-close",
      severity: "info",
      message: "The latest comparison is close; prefer user-directed polish over broad reconstruction.",
      evidence: metricEvidence(comparison),
      recommendedTools: ["get_scene_hierarchy_from_context", "capture_preview_from_context"],
    });
  }

  return diagnostics;
}

function feedbackRecommendations(
  _screen: ScreenSummary,
  preview: PreviewSummary | undefined,
  comparison: ComparisonSummary | undefined,
  refPath: string | undefined,
): string[] {
  const recommendations: string[] = [];
  if (preview === undefined) {
    recommendations.push("Capture the current screen with capture_preview_from_context before judging layout.");
  }
  if (comparison === undefined) {
    if (refPath !== undefined) {
      recommendations.push("Run verify_screen_against_reference_from_context to compare the current preview against the persisted source/reference image.");
    } else {
      recommendations.push("No persisted visual reference is available; inspect hierarchy and preview, or provide a reference image before visual verification.");
    }
  } else if (comparison.verdict === "close") {
    recommendations.push("Visual comparison is close; use user feedback or hierarchy inspection for small polish edits.");
  } else {
    recommendations.push("Inspect the attached diff/source/preview images, then use update/move/add/delete_ui_element_from_context with query selectors for targeted fixes.");
  }
  if (comparison?.aspectRatioDelta !== undefined && comparison.aspectRatioDelta > 0.02) {
    recommendations.push("Aspect ratio differs; check referenceCanvas, anchors, or whether a rendered reference image should be used.");
  }
  if (comparison?.mismatchRatio !== undefined && comparison.mismatchRatio > 0.35) {
    recommendations.push("Large mismatch detected; verify the correct screen and source material were selected before making local element edits.");
  }
  return recommendations;
}

function feedbackRecommendedTools(
  preview: PreviewSummary | undefined,
  comparison: ComparisonSummary | undefined,
  refPath: string | undefined,
): string[] {
  const tools: string[] = [];
  if (preview === undefined) {
    tools.push("capture_preview_from_context");
  }
  if (comparison === undefined) {
    if (refPath !== undefined) tools.push("verify_screen_against_reference_from_context");
    tools.push("get_scene_hierarchy_from_context");
    return uniqueStrings(tools);
  }
  tools.push("inspect_screen_feedback_from_context");
  if (comparison.verdict !== "close") {
    tools.push(
      "get_scene_hierarchy_from_context",
      "update_ui_element_from_context",
      "move_ui_element_from_context",
      "add_ui_element_from_context",
      "delete_ui_element_from_context",
      "verify_screen_against_reference_from_context",
    );
  } else {
    tools.push("get_scene_hierarchy_from_context", "capture_preview_from_context");
  }
  return uniqueStrings(tools);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function metricEvidence(comparison: ComparisonSummary): Record<string, number | string | boolean> {
  const evidence: Record<string, number | string | boolean> = {};
  if (comparison.verdict !== undefined) evidence.verdict = comparison.verdict;
  const mismatchRatio = finiteNumber(comparison.mismatchRatio);
  const meanAbsoluteError = finiteNumber(comparison.meanAbsoluteError);
  const rootMeanSquareError = finiteNumber(comparison.rootMeanSquareError);
  const aspectRatioDelta = finiteNumber(comparison.aspectRatioDelta);
  if (mismatchRatio !== undefined) evidence.mismatchRatio = mismatchRatio;
  if (meanAbsoluteError !== undefined) evidence.meanAbsoluteError = meanAbsoluteError;
  if (rootMeanSquareError !== undefined) evidence.rootMeanSquareError = rootMeanSquareError;
  if (aspectRatioDelta !== undefined) evidence.aspectRatioDelta = aspectRatioDelta;
  return evidence;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatDiagnosticEvidence(evidence: Record<string, number | string | boolean> | undefined): string {
  if (evidence === undefined) return "";
  const entries = Object.entries(evidence);
  if (entries.length === 0) return "";
  return ` evidence=${entries.map(([key, value]) => `${key}:${value}`).join(",")}`;
}

function latestByTs<T extends { ts?: string }>(items: T[]): T | undefined {
  return [...items].sort((left, right) => timeValue(right.ts) - timeValue(left.ts))[0];
}

function timeValue(value: string | undefined): number {
  const parsed = value !== undefined ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatComparison(comparison: ComparisonSummary): string {
  const metrics = [
    comparison.verdict !== undefined ? `verdict=${comparison.verdict}` : undefined,
    comparison.mismatchRatio !== undefined ? `mismatch=${comparison.mismatchRatio}` : undefined,
    comparison.meanAbsoluteError !== undefined ? `mae=${comparison.meanAbsoluteError}` : undefined,
    comparison.rootMeanSquareError !== undefined ? `rmse=${comparison.rootMeanSquareError}` : undefined,
    comparison.maxChannelDelta !== undefined ? `maxDelta=${comparison.maxChannelDelta}` : undefined,
    comparison.aspectRatioDelta !== undefined ? `aspectDelta=${comparison.aspectRatioDelta}` : undefined,
    comparison.threshold !== undefined ? `threshold=${comparison.threshold}` : undefined,
    comparison.compareWidth !== undefined && comparison.compareHeight !== undefined
      ? `compare=${comparison.compareWidth}x${comparison.compareHeight}`
      : undefined,
    comparison.diffPath !== undefined ? `diff=${comparison.diffPath}` : undefined,
    comparison.ts !== undefined ? `ts=${comparison.ts}` : undefined,
  ].filter((metric): metric is string => metric !== undefined);
  return metrics.join(", ");
}

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

async function statFile(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> {
  try {
    return await fs.stat(filePath);
  } catch {
    return undefined;
  }
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}
