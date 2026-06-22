import { promises as fs } from "node:fs";
import { basename, relative, resolve } from "node:path";
import {
  extractPlanningText,
  formatMaterialSummary,
  inspectPlanningMaterial,
  listPlanningMaterialFiles,
  resolveCandidate,
  type ListedPlanningMaterial,
  type TextExtraction,
} from "./_materials";

const DEFAULT_MAX_TEXT_FILES = 8;
const DEFAULT_MAX_TEXT_CHARS_PER_FILE = 1_500;

export interface AnalyzePlanningMaterialsOptions {
  root: string;
  dir?: string;
  files?: string[];
  recursive?: boolean;
  maxDepth?: number;
  maxFiles?: number;
  maxTextFiles?: number;
  maxTextCharsPerFile?: number;
}

export interface PlanningMaterialsBrief {
  root: string;
  searchedDir: string;
  truncated: boolean;
  total: number;
  counts: Record<string, number>;
  items: PlanningBriefItem[];
}

export interface PlanningBriefItem extends ListedPlanningMaterial {
  source: "directory" | "file" | "both";
  priority: number;
  recommendedTools: string[];
  rationale: string[];
  extractedText?: PlanningTextExcerpt;
}

export interface PlanningTextExcerpt {
  ok: boolean;
  kind: TextExtraction["kind"];
  chars?: number;
  truncated?: boolean;
  excerpt?: string;
  error?: string;
}

export async function analyzePlanningMaterials(
  options: AnalyzePlanningMaterialsOptions,
): Promise<PlanningMaterialsBrief> {
  const root = resolve(options.root);
  const searchedDir = options.dir !== undefined && options.dir.trim().length > 0
    ? resolveCandidate(options.dir, root)
    : root;
  const byPath = new Map<string, PlanningBriefItem>();
  let truncated = false;

  try {
    const stat = await fs.stat(searchedDir);
    if (stat.isDirectory()) {
      const listed = await listPlanningMaterialFiles(searchedDir, {
        recursive: options.recursive ?? true,
        maxDepth: options.maxDepth,
        maxFiles: options.maxFiles,
      });
      truncated = listed.truncated;
      for (const entry of listed.entries) {
        byPath.set(resolve(entry.path), annotateItem(entry, "directory"));
      }
    }
  } catch {
    // Explicit files may still be analyzable when the broad directory is absent.
  }

  for (const raw of options.files ?? []) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const filePath = resolveCandidate(trimmed, root);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const summary = await inspectPlanningMaterial(filePath, stat);
    const key = resolve(filePath);
    const existing = byPath.get(key);
    const item = annotateItem({
      name: basename(filePath),
      relativePath: normalizeRelativePath(relative(root, filePath)),
      ...summary,
    }, existing === undefined ? "file" : "both");
    byPath.set(key, item);
  }

  const maxTextFiles = clampInt(options.maxTextFiles, DEFAULT_MAX_TEXT_FILES, 0, 50);
  const maxTextChars = clampInt(options.maxTextCharsPerFile, DEFAULT_MAX_TEXT_CHARS_PER_FILE, 100, 20_000);
  let textFilesRead = 0;
  const items = [...byPath.values()]
    .sort((a, b) => b.priority - a.priority || a.relativePath.localeCompare(b.relativePath));
  for (const item of items) {
    if (textFilesRead >= maxTextFiles || item.isImage || item.kind === "video") continue;
    const extracted = await extractPlanningText(item.path, maxTextChars);
    item.extractedText = toExcerpt(extracted);
    textFilesRead += 1;
  }

  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  }

  return {
    root,
    searchedDir,
    truncated,
    total: items.length,
    counts,
    items,
  };
}

export function formatPlanningMaterialsBrief(brief: PlanningMaterialsBrief): string {
  const counts = Object.entries(brief.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
  const lines = [
    `[planning materials] root: ${brief.root}`,
    `[planning materials] searchedDir: ${brief.searchedDir}`,
    `[planning materials] files: ${brief.total}${counts.length > 0 ? ` (${counts})` : ""}`,
  ];
  if (brief.truncated) {
    lines.push("[planning materials] listing was truncated; narrow dir or raise maxFiles before broad edits.");
  }
  if (brief.items.length === 0) {
    lines.push("No supported planning materials found. Ask for files or use list_planning_materials on a narrower folder.");
    return lines.join("\n");
  }

  const steps = recommendedWorkflow(brief.items);
  if (steps.length > 0) {
    lines.push("Recommended workflow:");
    for (const step of steps.slice(0, 24)) {
      lines.push(`  - ${step}`);
    }
    lines.push("Verification workflow:");
    lines.push("  - After creating or editing a Unity screen from visual material, call verify_screen_against_reference with the screenId and a local reference image path.");
    lines.push("  - For image files, use the material path as referencePath; for PDF/PPTX, use the rendered page/slide path returned by the reference-screen or render tool metadata.");
  }

  lines.push("Priority material candidates:");
  for (const item of brief.items.slice(0, 20)) {
    lines.push(
      `  - ${item.relativePath} [${item.kind}, ${item.source}, priority=${item.priority}] ` +
        `(${formatMaterialSummary(item)})`,
    );
    if (item.rationale.length > 0) {
      lines.push(`      why: ${item.rationale.join("; ")}`);
    }
    if (item.recommendedTools.length > 0) {
      lines.push(`      tools: ${item.recommendedTools.join(", ")}`);
    }
    if (item.extractedText !== undefined) {
      lines.push(`      text: ${formatTextExcerpt(item.extractedText)}`);
    }
  }
  if (brief.items.length > 20) {
    lines.push(`  ... ${brief.items.length - 20} more material candidate(s) omitted`);
  }
  return lines.join("\n");
}

function annotateItem(entry: ListedPlanningMaterial, source: PlanningBriefItem["source"]): PlanningBriefItem {
  const recommendation = recommendFor(entry);
  return {
    ...entry,
    source,
    priority: recommendation.priority,
    recommendedTools: recommendation.tools,
    rationale: recommendation.rationale,
  };
}

function recommendFor(entry: ListedPlanningMaterial): { priority: number; tools: string[]; rationale: string[] } {
  switch (entry.kind) {
    case "pptx": {
      const tools = [
        "read_planning_material",
        "create_screen_from_material",
        "create_reference_screen_from_material",
        "extract_pptx_layout",
        "draft_planning_intent_from_pptx",
        "create_pptx_slide_screen",
        "create_pptx_deck_screens",
        "prepare_pptx_ui_draft",
        "pptx_to_images",
      ];
      const rationale = ["deck can define screen flow and visual layout"];
      if ((entry.embeddedImageCount ?? 0) > 0) {
        tools.push("extract_embedded_images");
        rationale.push(`${entry.embeddedImageCount} embedded image(s) may contain mockups or art`);
      }
      return {
        priority: 95 + Math.min(entry.slideCount ?? 0, 5),
        tools,
        rationale,
      };
    }
    case "pdf":
      return {
        priority: 88,
        tools: ["read_planning_material", "create_screen_from_material", "draft_planning_intent_from_document", "create_document_screen", "create_reference_screen_from_material", "create_pdf_page_reference_screen", "pdf_to_images"],
        rationale: ["PDF text and rendered pages can carry layout requirements"],
      };
    case "docx": {
      const tools = ["read_planning_material", "create_screen_from_material", "draft_planning_intent_from_docx", "draft_planning_intent_from_document", "create_document_screen"];
      const rationale = ["document can carry requirements and copy"];
      if ((entry.embeddedImageCount ?? 0) > 0) {
        tools.push("create_reference_screen_from_material");
        tools.push("create_docx_image_reference_screen");
        tools.push("extract_embedded_images");
        rationale.push(`${entry.embeddedImageCount} embedded image(s) may contain references`);
      }
      return { priority: 82, tools, rationale };
    }
    case "image":
      return {
        priority: 78 + (entry.width !== undefined && entry.height !== undefined ? 2 : 0),
        tools: ["read_planning_material", "create_screen_from_material", "create_reference_screen_from_material", "create_image_reference_screen", "prepare_image_ui_draft", "preprocess_image", "verify_screen_against_reference", "import_asset"],
        rationale: ["image can be used for visual matching or converted into a Unity-ready reference screen"],
      };
    case "video":
      return {
        priority: 76,
        tools: ["read_planning_material", "create_screen_from_material", "import_asset"],
        rationale: ["video is treated as playable content media; only filename and file metadata are inspected"],
      };
    case "text":
      return {
        priority: 68,
        tools: ["read_planning_material", "create_screen_from_material", "draft_planning_intent_from_document", "create_document_screen"],
        rationale: ["text material can define screen requirements and labels"],
      };
    default:
      return {
        priority: 20,
        tools: ["read_planning_material"],
        rationale: ["unsupported type may still be useful as an attachment"],
      };
  }
}

function recommendedWorkflow(items: PlanningBriefItem[]): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const toolName of item.recommendedTools) {
      const key = `${toolName}:${item.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push(`${toolName} "${item.relativePath}"`);
    }
  }
  return steps;
}

function toExcerpt(extracted: TextExtraction): PlanningTextExcerpt {
  if (!extracted.ok || extracted.text === undefined) {
    return {
      ok: false,
      kind: extracted.kind,
      error: extracted.error ?? "no extracted text",
    };
  }
  return {
    ok: true,
    kind: extracted.kind,
    chars: extracted.chars,
    truncated: extracted.truncated,
    excerpt: oneLine(extracted.text, 500),
  };
}

function formatTextExcerpt(excerpt: PlanningTextExcerpt): string {
  if (!excerpt.ok) return `${excerpt.kind} extraction unavailable (${excerpt.error ?? "no text"})`;
  const truncated = excerpt.truncated === true ? ", truncated" : "";
  return `${excerpt.kind}, ${excerpt.chars ?? excerpt.excerpt?.length ?? 0} chars${truncated}: ${excerpt.excerpt ?? ""}`;
}

function oneLine(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}...`;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
