import { promises as fs } from "node:fs";
import { basename, extname } from "node:path";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// @ts-expect-error - shared pure-JS ochestrator progress helpers (no type declarations).
import { formatOchestratorProgress, readOchestratorProgress } from "../../bin/ochestrator-progress-core.js";
// @ts-expect-error - shared pure-JS blueprint persistence helpers (no type declarations).
import { summarizeProductionBlueprints } from "../../bin/production-blueprint-core.js";

const DEFAULT_MAX_JOURNAL_ENTRIES = 20;
const DEFAULT_MAX_JOURNAL_BYTES = 512 * 1024;
const DEFAULT_MAX_PREVIEW_ATTACHMENTS = 3;
const DEFAULT_MAX_LAUNCH_MATERIAL_ATTACHMENTS = 10;
const DEFAULT_MAX_SOURCE_MATERIAL_ATTACHMENTS = 5;
const DEFAULT_MAX_SOURCE_REFERENCE_ATTACHMENTS = 5;
const DEFAULT_MAX_COMPARISON_ATTACHMENTS = 3;
const DEFAULT_MAX_MATERIAL_CANDIDATES = 12;
const DEFAULT_MAX_MATERIAL_SCAN_FILES = 500;
const DEFAULT_MAX_MATERIAL_DEPTH = 4;
const SUPPORTED_MATERIAL_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".mp4", ".mov", ".webm", ".m4v",
  ".pdf", ".pptx", ".docx", ".txt", ".md", ".markdown", ".csv", ".json",
]);
const MATERIAL_IGNORE_DIRS = new Set([
  ".git", ".omx", ".opencode", ".uos",
  "Library", "Temp", "Obj", "Logs", "UserSettings",
  "node_modules", "Build", "Builds",
]);

export interface UosContextOptions {
  projectDir?: string;
  contextDir?: string;
  maxJournalEntries?: number;
  maxJournalBytes?: number;
  planningMaterialsDir?: string;
  attachedFiles?: string[];
  maxMaterialCandidates?: number;
  maxMaterialScanFiles?: number;
  maxMaterialDepth?: number;
}

export interface ScreenSummary {
  screenId: string;
  screenName?: string;
  source?: ScreenSourceSummary;
  elementCount: number;
  deletedElementCount: number;
  previewCount: number;
  comparisonCount: number;
  active?: boolean;
  lastPreviewAt?: string;
  lastComparedAt?: string;
  updatedAt?: string;
  elements: ElementSummary[];
  previews: PreviewSummary[];
  comparisons: ComparisonSummary[];
}

export interface ScreenSourceSummary {
  tool?: string;
  kind?: string;
  mode?: string;
  path?: string;
  pageNumber?: number;
  slideNumber?: number;
  imageNumber?: number;
  packagePath?: string;
  renderedPath?: string;
  extractedPath?: string;
  assetPaths?: string[];
  ts?: string;
}

export interface ElementSummary {
  elementId: string;
  clientHintId?: string;
  parentElementId?: string;
  parentClientHintId?: string;
  type?: string;
  rect?: RectSummary;
  anchor?: string;
  props?: ElementPropsSummary;
  deleted?: boolean;
  updatedAt?: string;
}

export interface RectSummary {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ElementPropsSummary {
  text?: string;
  placeholder?: string;
  inputText?: string;
  color?: string;
  fontSize?: number;
  fontStyle?: string;
  sprite?: string;
  video?: string;
  align?: string;
  value?: number;
  minValue?: number;
  maxValue?: number;
  isOn?: boolean;
  interactable?: boolean;
  options?: string[];
  loop?: boolean;
  playOnAwake?: boolean;
  muted?: boolean;
}

export interface Vec3Summary {
  x: number;
  y: number;
  z: number;
}

export interface SceneTransformSummary {
  position?: Vec3Summary;
  rotation?: Vec3Summary;
  scale?: Vec3Summary;
}

export interface SceneObjectSummary {
  objectId: string;
  name?: string;
  type?: string;
  path?: string;
  parentObjectId?: string;
  active?: boolean;
  transform?: SceneTransformSummary;
  components?: string[];
  deleted?: boolean;
  updatedAt?: string;
}

export interface PreviewSummary {
  savedPath?: string;
  uri?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  ts?: string;
}

export interface ComparisonSummary {
  referencePath?: string;
  candidatePath?: string;
  diffPath?: string;
  diffUri?: string;
  diffMimeType?: string;
  verdict?: string;
  referenceWidth?: number;
  referenceHeight?: number;
  candidateWidth?: number;
  candidateHeight?: number;
  compareWidth?: number;
  compareHeight?: number;
  meanAbsoluteError?: number;
  rootMeanSquareError?: number;
  mismatchRatio?: number;
  maxChannelDelta?: number;
  aspectRatioDelta?: number;
  threshold?: number;
  size?: number;
  ts?: string;
}

export interface PreviewAttachment {
  type: "file";
  mime: string;
  url: string;
  filename: string;
  screenId: string;
  path: string;
  ts?: string;
}

export interface LaunchMaterialAttachment {
  type: "file";
  mime: string;
  url: string;
  filename: string;
  path: string;
  size: number;
}

export interface SourceReferenceAttachment {
  type: "file";
  mime: string;
  url: string;
  filename: string;
  screenId: string;
  path: string;
  role: "source-reference";
  sourceKind?: string;
}

export interface SourceMaterialAttachment {
  type: "file";
  mime: string;
  url: string;
  filename: string;
  screenId: string;
  path: string;
  role: "source-material";
  sourceKind?: string;
  sourceTool?: string;
}

export interface ComparisonAttachment {
  type: "file";
  mime: string;
  url: string;
  filename: string;
  screenId: string;
  path: string;
  role: "comparison-diff";
  verdict?: string;
  ts?: string;
}

export interface JournalSummary {
  ts?: string;
  tool?: string;
  title?: string;
  sessionID?: string;
  callID?: string;
  screenId?: string;
  elementId?: string;
  objectId?: string;
}

export interface LaunchMaterialCandidate {
  path: string;
  relativePath: string;
  kind: "image" | "video" | "pdf" | "pptx" | "docx" | "document";
  source: "directory" | "file" | "both";
  mime: string;
  priority: number;
  recommendedTools: string[];
}

export interface LaunchAttachedFile {
  path: string;
  readable: boolean;
  supported: boolean;
  kind?: LaunchMaterialCandidate["kind"];
  mime?: string;
  reason?: "missing" | "not-file" | "unsupported";
}

export interface LaunchWorkflowAction {
  order: number;
  phase: "read" | "scan" | "create" | "verify";
  tool: string;
  reason: string;
  args?: Record<string, unknown>;
  candidatePath?: string;
  candidateKind?: LaunchMaterialCandidate["kind"];
  recommendedTools?: string[];
  alternativeTools?: string[];
}

export interface LaunchWorkflow {
  hasLaunchInputs: boolean;
  summary: string;
  actions: LaunchWorkflowAction[];
}

export interface LoadedUosContext {
  projectDir: string;
  contextDir: string;
  hasContext: boolean;
  activeOchestratorProgress?: Record<string, unknown>;
  productionBlueprints?: Record<string, unknown>;
  planningMaterialsDir?: string;
  attachedFiles: string[];
  attachedMaterialFiles: LaunchAttachedFile[];
  materialCandidates: LaunchMaterialCandidate[];
  project?: Record<string, unknown>;
  screens: ScreenSummary[];
  sceneObjects: SceneObjectSummary[];
  transitionCount: number;
  activeScreenId?: string;
  lastSavedScenePath?: string;
  lastSavedAt?: string;
  importedAssets: ImportedAssetSummary[];
  recentJournal: JournalSummary[];
}

export interface ImportedAssetSummary {
  assetPath: string;
  sourcePath?: string;
  importedAsSprite?: boolean;
  assetType?: string;
  ts?: string;
}

export async function loadUosContext(options: UosContextOptions): Promise<LoadedUosContext> {
  const contextDir = resolveContextDir(options);
  const projectDir = options.projectDir !== undefined
    ? path.resolve(options.projectDir)
    : path.dirname(contextDir);
  const maxJournalEntries = clampInt(
    options.maxJournalEntries,
    DEFAULT_MAX_JOURNAL_ENTRIES,
    0,
    100,
  );
  const maxJournalBytes = clampInt(
    options.maxJournalBytes,
    DEFAULT_MAX_JOURNAL_BYTES,
    16 * 1024,
    4 * 1024 * 1024,
  );

  const project = await readJson<Record<string, unknown>>(path.join(contextDir, "project.json"));
  const screenIndex = await readJson<any>(path.join(contextDir, "screens.json"));
  const recentJournal = maxJournalEntries > 0
    ? await readJournalTail(path.join(contextDir, "work-journal.jsonl"), maxJournalEntries, maxJournalBytes)
    : [];
  const screens = summarizeScreens(screenIndex);
  const sceneObjects = summarizeSceneObjects(screenIndex);
  const transitionCount = Array.isArray(screenIndex?.transitions) ? screenIndex.transitions.length : 0;
  const importedAssets = summarizeImportedAssets(screenIndex);
  const activeOchestratorProgress = await readOchestratorProgress(projectDir);
  const productionBlueprints = await summarizeProductionBlueprints(projectDir);
  const planningMaterialsDir = stringValue(options.planningMaterialsDir);
  const attachedFiles = normalizeAttachedFiles(options.attachedFiles);
  const attachedMaterialFiles = await summarizeLaunchAttachedFiles(attachedFiles);
  const materialCandidates = await summarizeLaunchMaterialCandidates({
    projectDir,
    planningMaterialsDir,
    attachedFiles,
    maxCandidates: options.maxMaterialCandidates,
    maxFiles: options.maxMaterialScanFiles,
    maxDepth: options.maxMaterialDepth,
  });

  return {
    projectDir,
    contextDir,
    hasContext: project !== undefined
      || screens.length > 0
      || sceneObjects.length > 0
      || recentJournal.length > 0
      || activeOchestratorProgress !== undefined
      || blueprintCount(productionBlueprints) > 0,
    activeOchestratorProgress,
    productionBlueprints,
    planningMaterialsDir,
    attachedFiles,
    attachedMaterialFiles,
    materialCandidates,
    project,
    screens,
    sceneObjects,
    transitionCount,
    activeScreenId: stringValue(screenIndex?.activeScreenId),
    lastSavedScenePath: stringValue(screenIndex?.lastSavedScenePath),
    lastSavedAt: stringValue(screenIndex?.lastSavedAt),
    importedAssets,
    recentJournal,
  };
}

export function contextWithLiveHierarchy(
  context: LoadedUosContext,
  hierarchy: unknown,
  updatedAt = new Date().toISOString(),
): LoadedUosContext {
  const nodes = hierarchy !== undefined
    && hierarchy !== null
    && typeof hierarchy === "object"
    && Array.isArray((hierarchy as { nodes?: unknown }).nodes)
    ? (hierarchy as { nodes: unknown[] }).nodes
    : [];
  if (nodes.length === 0) return context;

  const screensById = new Map(context.screens.map((screen) => [screen.screenId, cloneScreenSummary(screen)]));
  const activeScreens = new Set<string>();

  for (const raw of nodes) {
    if (raw === null || raw === undefined || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    const rootScreenId = stringValue(node.rootScreenId);
    if (rootScreenId === undefined) continue;

    const elementId = stringValue(node.elementId);
    const type = stringValue(node.type);
    const depth = numberValue(node.depth) ?? 0;
    const isRootScreenNode = elementId === rootScreenId || (depth === 0 && (type === "Screen" || type === "Canvas"));
    const screen = screensById.get(rootScreenId) ?? emptyScreenSummary(rootScreenId, updatedAt);
    screen.screenName = stringValue(node.rootScreenName) ?? (isRootScreenNode ? stringValue(node.name) : screen.screenName);
    screen.updatedAt = updatedAt;
    if (isRootScreenNode && typeof node.active === "boolean") {
      screen.active = node.active ? true : undefined;
      if (node.active) activeScreens.add(rootScreenId);
    }
    screensById.set(rootScreenId, screen);

    if (elementId === undefined || isRootScreenNode) continue;
    const elementsById = new Map(screen.elements.map((element) => [element.elementId, { ...element }]));
    const element = elementsById.get(elementId) ?? { elementId };
    element.type = type ?? element.type;
    element.parentElementId = stringValue(node.parentElementId) ?? element.parentElementId;
    const rect = summarizeRect(node.rect);
    if (rect !== undefined) element.rect = rect;
    element.anchor = stringValue(node.anchor) ?? element.anchor;
    const props = summarizeProps(node.props);
    if (props !== undefined) element.props = { ...(element.props ?? {}), ...props };
    element.deleted = undefined;
    element.updatedAt = updatedAt;
    elementsById.set(elementId, element);
    screen.elements = [...elementsById.values()]
      .sort((a, b) => Number(a.deleted === true) - Number(b.deleted === true)
        || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    screen.elementCount = screen.elements.filter((item) => item.deleted !== true).length;
    screen.deletedElementCount = screen.elements.filter((item) => item.deleted === true).length;
  }

  let activeScreenId = context.activeScreenId;
  if (activeScreens.size === 1) {
    const [resolvedActiveScreenId] = activeScreens;
    activeScreenId = resolvedActiveScreenId;
    for (const screen of screensById.values()) {
      screen.active = screen.screenId === resolvedActiveScreenId ? true : undefined;
    }
  }

  return {
    ...context,
    hasContext: true,
    activeScreenId,
    screens: [...screensById.values()].sort((a, b) => latestScreenTime(b).localeCompare(latestScreenTime(a))),
  };
}

export function contextWithLiveSceneObjects(
  context: LoadedUosContext,
  listResult: unknown,
  updatedAt = new Date().toISOString(),
): LoadedUosContext {
  const hasObjectList = listResult !== undefined
    && listResult !== null
    && typeof listResult === "object"
    && Array.isArray((listResult as { objects?: unknown }).objects);
  if (!hasObjectList) return context;
  const objects = (listResult as { objects: unknown[] }).objects;

  const objectsById = new Map(context.sceneObjects.map((object) => [object.objectId, { ...object }]));
  const liveIds = new Set<string>();

  for (const raw of objects) {
    const summarized = summarizeSceneObject(raw);
    if (summarized === undefined) continue;
    liveIds.add(summarized.objectId);
    const existing = objectsById.get(summarized.objectId);
    objectsById.set(summarized.objectId, {
      ...(existing ?? { objectId: summarized.objectId }),
      ...summarized,
      deleted: undefined,
      updatedAt,
    });
  }

  for (const [objectId, object] of objectsById) {
    if (!liveIds.has(objectId) && object.deleted !== true) {
      objectsById.set(objectId, { ...object, deleted: true, updatedAt });
    }
  }

  return {
    ...context,
    hasContext: true,
    sceneObjects: [...objectsById.values()]
      .sort((a, b) => Number(a.deleted === true) - Number(b.deleted === true)
        || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))),
  };
}

export async function previewAttachmentsForContext(
  context: LoadedUosContext,
  maxPreviewAttachments = DEFAULT_MAX_PREVIEW_ATTACHMENTS,
): Promise<PreviewAttachment[]> {
  const max = clampInt(maxPreviewAttachments, DEFAULT_MAX_PREVIEW_ATTACHMENTS, 0, 10);
  if (max === 0) return [];

  const candidates = context.screens
    .flatMap((screen) => screen.previews.map((preview) => ({ screen, preview })))
    .sort((a, b) => String(b.preview.ts ?? "").localeCompare(String(a.preview.ts ?? "")));
  const attachments: PreviewAttachment[] = [];
  const seen = new Set<string>();

  for (const { screen, preview } of candidates) {
    if (attachments.length >= max) break;
    const filePath = previewLocalPath(preview);
    if (filePath === undefined || seen.has(filePath)) continue;
    seen.add(filePath);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const mime = preview.mimeType?.startsWith("image/") === true ? preview.mimeType : "image/png";
    attachments.push({
      type: "file",
      mime,
      url: pathToFileURL(filePath).toString(),
      filename: basename(filePath),
      screenId: screen.screenId,
      path: filePath,
      ts: preview.ts,
    });
  }

  return attachments;
}

export async function sourceReferenceAttachmentsForContext(
  context: LoadedUosContext,
  maxSourceReferenceAttachments = DEFAULT_MAX_SOURCE_REFERENCE_ATTACHMENTS,
): Promise<SourceReferenceAttachment[]> {
  const max = clampInt(maxSourceReferenceAttachments, DEFAULT_MAX_SOURCE_REFERENCE_ATTACHMENTS, 0, 20);
  if (max === 0) return [];

  const attachments: SourceReferenceAttachment[] = [];
  const seen = new Set<string>();
  for (const screen of context.screens) {
    if (attachments.length >= max) break;
    const filePath = sourceReferencePath(screen.source);
    if (filePath === undefined || seen.has(filePath)) continue;
    seen.add(filePath);
    const mime = mimeForAttachmentPath(filePath);
    if (!mime.startsWith("image/")) continue;
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    attachments.push({
      type: "file",
      mime,
      url: pathToFileURL(filePath).toString(),
      filename: basename(filePath),
      screenId: screen.screenId,
      path: filePath,
      role: "source-reference",
      sourceKind: screen.source?.kind,
    });
  }
  return attachments;
}

export async function sourceMaterialAttachmentsForContext(
  context: LoadedUosContext,
  maxSourceMaterialAttachments = DEFAULT_MAX_SOURCE_MATERIAL_ATTACHMENTS,
): Promise<SourceMaterialAttachment[]> {
  const max = clampInt(maxSourceMaterialAttachments, DEFAULT_MAX_SOURCE_MATERIAL_ATTACHMENTS, 0, 20);
  if (max === 0) return [];

  const attachments: SourceMaterialAttachment[] = [];
  const seen = new Set<string>();
  for (const screen of context.screens) {
    if (attachments.length >= max) break;
    const filePath = screen.source?.path;
    if (filePath === undefined) continue;
    const resolved = path.resolve(filePath);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    attachments.push({
      type: "file",
      mime: mimeForAttachmentPath(resolved),
      url: pathToFileURL(resolved).toString(),
      filename: basename(resolved),
      screenId: screen.screenId,
      path: resolved,
      role: "source-material",
      sourceKind: screen.source?.kind,
      sourceTool: screen.source?.tool,
    });
  }
  return attachments;
}

export async function comparisonAttachmentsForContext(
  context: LoadedUosContext,
  maxComparisonAttachments = DEFAULT_MAX_COMPARISON_ATTACHMENTS,
): Promise<ComparisonAttachment[]> {
  const max = clampInt(maxComparisonAttachments, DEFAULT_MAX_COMPARISON_ATTACHMENTS, 0, 10);
  if (max === 0) return [];

  const candidates = context.screens
    .flatMap((screen) => screen.comparisons.map((comparison) => ({ screen, comparison })))
    .sort((a, b) => String(b.comparison.ts ?? "").localeCompare(String(a.comparison.ts ?? "")));
  const attachments: ComparisonAttachment[] = [];
  const seen = new Set<string>();

  for (const { screen, comparison } of candidates) {
    if (attachments.length >= max) break;
    const filePath = comparisonDiffLocalPath(comparison);
    if (filePath === undefined || seen.has(filePath)) continue;
    seen.add(filePath);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const mime = comparison.diffMimeType?.startsWith("image/") === true
      ? comparison.diffMimeType
      : mimeForAttachmentPath(filePath);
    if (!mime.startsWith("image/")) continue;
    attachments.push({
      type: "file",
      mime,
      url: pathToFileURL(filePath).toString(),
      filename: basename(filePath),
      screenId: screen.screenId,
      path: filePath,
      role: "comparison-diff",
      verdict: comparison.verdict,
      ts: comparison.ts,
    });
  }

  return attachments;
}

export async function launchMaterialAttachmentsForContext(
  context: LoadedUosContext,
  maxLaunchMaterialAttachments = DEFAULT_MAX_LAUNCH_MATERIAL_ATTACHMENTS,
): Promise<LaunchMaterialAttachment[]> {
  const max = clampInt(maxLaunchMaterialAttachments, DEFAULT_MAX_LAUNCH_MATERIAL_ATTACHMENTS, 0, 50);
  if (max === 0) return [];

  const attachments: LaunchMaterialAttachment[] = [];
  const seen = new Set<string>();
  for (const raw of context.attachedFiles) {
    if (attachments.length >= max) break;
    const filePath = path.resolve(raw);
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    attachments.push({
      type: "file",
      mime: mimeForAttachmentPath(filePath),
      url: pathToFileURL(filePath).toString(),
      filename: basename(filePath),
      path: filePath,
      size: stat.size,
    });
  }
  return attachments;
}

export function sourceReferencePath(source: ScreenSourceSummary | undefined): string | undefined {
  if (source === undefined) return undefined;
  if (source.renderedPath !== undefined) return source.renderedPath;
  if (source.extractedPath !== undefined) return source.extractedPath;
  if (source.kind === "image" && source.path !== undefined) return source.path;
  return undefined;
}

export function formatUosContext(context: LoadedUosContext): string {
  const unavailableAttachedFiles = launchUnavailableAttachedFiles(context);
  const lines = [
    `[uos context] projectDir: ${context.projectDir}`,
    `[uos context] contextDir: ${context.contextDir}`,
  ];
  if (context.planningMaterialsDir !== undefined) {
    lines.push(`[uos context] planningMaterialsDir: ${context.planningMaterialsDir}`);
  }
  if (context.attachedFiles.length > 0) {
    lines.push(`[uos context] attached material files: ${context.attachedFiles.length}`);
    for (const file of context.attachedFiles.slice(0, 20)) {
      lines.push(`  - ${file}`);
    }
    if (context.attachedFiles.length > 20) {
      lines.push(`  ... ${context.attachedFiles.length - 20} more attached file(s) omitted`);
    }
    if (unavailableAttachedFiles.length > 0) {
      lines.push(`  ! ${unavailableAttachedFiles.length} attached file(s) are unavailable or unsupported for planning-material reads`);
      for (const file of unavailableAttachedFiles.slice(0, 5)) {
        lines.push(`    - ${file}`);
      }
      if (unavailableAttachedFiles.length > 5) {
        lines.push(`    - ... ${unavailableAttachedFiles.length - 5} more unavailable attached file(s) omitted`);
      }
    }
  }
  if (context.planningMaterialsDir !== undefined || context.attachedFiles.length > 0) {
    lines.push(...formatLaunchMaterialCandidates(context.materialCandidates));
  }
  if (context.planningMaterialsDir !== undefined || context.attachedFiles.length > 0) {
    lines.push(...formatLaunchInputGuidance(context));
  }
  if (context.activeOchestratorProgress !== undefined) {
    lines.push(formatOchestratorProgress(context.activeOchestratorProgress));
  }
  const blueprintSummary = formatProductionBlueprintContext(context.productionBlueprints);
  if (blueprintSummary !== undefined) {
    lines.push(blueprintSummary);
  }

  if (!context.hasContext) {
    if (launchReadableAttachedFiles(context).length > 0) {
      lines.push("No persisted UOS context found yet. Start by reading attached files with read_planning_material, then inspect the live Unity scene with list_screens/get_scene_hierarchy/list_scene_objects.");
    } else if (context.attachedFiles.length > 0) {
      lines.push("No persisted UOS context found yet. No launch-attached planning files are currently readable; fix those paths or start by listing planning materials before inspecting the live Unity scene.");
    } else if (context.planningMaterialsDir !== undefined) {
      lines.push("No persisted UOS context found yet. Start by listing planning materials with list_planning_materials, then read the most relevant files before inspecting the live Unity scene.");
    } else {
      lines.push("No persisted UOS context found yet. Start by inspecting the live Unity scene with list_screens/get_scene_hierarchy/list_scene_objects.");
    }
    return lines.join("\n");
  }

  const projectName = stringValue(context.project?.projectName);
  const updatedAt = stringValue(context.project?.updatedAt);
  if (projectName !== undefined) lines.push(`projectName: ${projectName}`);
  if (updatedAt !== undefined) lines.push(`updatedAt: ${updatedAt}`);
  if (context.lastSavedScenePath !== undefined) {
    lines.push(
      `lastSavedScene: ${context.lastSavedScenePath}` +
        (context.lastSavedAt !== undefined ? ` (${context.lastSavedAt})` : ""),
    );
  }

  lines.push(`screens: ${context.screens.length}`);
  if (context.activeScreenId !== undefined) {
    lines.push(`activeScreen: ${context.activeScreenId}`);
  }
  for (const screen of context.screens.slice(0, 25)) {
    const name = screen.screenName !== undefined ? ` (${screen.screenName})` : "";
    const active = screen.active === true ? ", active" : "";
    const deleted = screen.deletedElementCount > 0 ? `, deleted=${screen.deletedElementCount}` : "";
    const previews = screen.previewCount > 0
      ? `, previews=${screen.previewCount}${screen.lastPreviewAt !== undefined ? `, lastPreviewAt=${screen.lastPreviewAt}` : ""}`
      : "";
    const comparisons = screen.comparisonCount > 0
      ? `, comparisons=${screen.comparisonCount}${screen.lastComparedAt !== undefined ? `, lastComparedAt=${screen.lastComparedAt}` : ""}`
      : "";
    lines.push(
      `  - ${screen.screenId}${name}: elements=${screen.elementCount}${active}${deleted}` +
        previews +
        comparisons +
        (screen.updatedAt !== undefined ? `, updatedAt=${screen.updatedAt}` : ""),
    );
    if (screen.source !== undefined) {
      lines.push(`      source: ${formatSourceSummary(screen.source)}`);
      lines.push(`      selector: ${formatSourceSelectorHint(screen)}`);
    }
    for (const element of screen.elements.filter((el) => el.deleted !== true).slice(0, 12)) {
      lines.push(`      * ${formatElementSummary(element)}`);
    }
    const extraElements = screen.elements.filter((el) => el.deleted !== true).length - 12;
    if (extraElements > 0) lines.push(`      ... ${extraElements} more active element(s) omitted`);
    for (const preview of screen.previews.slice(0, 3)) {
      lines.push(`      preview: ${formatPreviewSummary(preview)}`);
    }
    if (screen.previewCount > 3) {
      lines.push(`      ... ${screen.previewCount - 3} more preview(s) omitted`);
    }
    for (const comparison of screen.comparisons.slice(0, 3)) {
      lines.push(`      comparison: ${formatComparisonSummary(comparison)}`);
    }
    if (screen.comparisonCount > 3) {
      lines.push(`      ... ${screen.comparisonCount - 3} more comparison(s) omitted`);
    }
    const feedbackHint = formatVisualFeedbackHint(screen);
    if (feedbackHint !== undefined) {
      lines.push(`      feedback: ${feedbackHint}`);
    }
  }
  if (context.screens.length > 25) {
    lines.push(`  ... ${context.screens.length - 25} more screen(s) omitted`);
  }

  const sceneObjects = Array.isArray(context.sceneObjects) ? context.sceneObjects : [];
  const activeSceneObjects = sceneObjects.filter((object) => object.deleted !== true);
  const deletedSceneObjectCount = sceneObjects.length - activeSceneObjects.length;
  lines.push(`scene objects: ${activeSceneObjects.length}${deletedSceneObjectCount > 0 ? `, deleted=${deletedSceneObjectCount}` : ""}`);
  for (const object of activeSceneObjects.slice(0, 25)) {
    lines.push(`  - ${formatSceneObjectSummary(object)}`);
  }
  if (activeSceneObjects.length > 25) {
    lines.push(`  ... ${activeSceneObjects.length - 25} more scene object(s) omitted`);
  }

  lines.push(`transitions: ${context.transitionCount}`);
  lines.push(`imported assets: ${context.importedAssets.length}`);
  for (const asset of context.importedAssets.slice(-10)) {
    const sprite = asset.importedAsSprite === true ? ", sprite" : "";
    lines.push(`  - ${asset.assetPath}${sprite}${asset.ts !== undefined ? ` (${asset.ts})` : ""}`);
  }
  lines.push(`recent journal entries: ${context.recentJournal.length}`);
  for (const entry of context.recentJournal) {
    const id = entry.screenId ?? entry.elementId ?? entry.objectId;
    const target = id !== undefined ? ` ${id}` : "";
    const title = entry.title !== undefined && entry.title.length > 0 ? ` - ${entry.title}` : "";
    lines.push(`  - ${entry.ts ?? "(unknown time)"} ${entry.tool ?? "(unknown tool)"}${target}${title}`);
  }

  return lines.join("\n");
}

function resolveContextDir(options: UosContextOptions): string {
  if (options.contextDir !== undefined && options.contextDir.trim().length > 0) {
    return path.resolve(options.contextDir);
  }
  const projectDir = options.projectDir !== undefined && options.projectDir.trim().length > 0
    ? options.projectDir
    : process.cwd();
  return path.join(path.resolve(projectDir), ".uos");
}

function blueprintCount(summary: Record<string, unknown> | undefined): number {
  return typeof summary?.count === "number" && Number.isFinite(summary.count) ? summary.count : 0;
}

function formatProductionBlueprintContext(summary: Record<string, unknown> | undefined): string | undefined {
  if (summary === undefined || blueprintCount(summary) === 0) return undefined;
  const lines = [`[uos context] productionBlueprints: ${blueprintCount(summary)}`];
  const latest = isRecord(summary.latest) ? summary.latest : undefined;
  const active = isRecord(summary.active) ? summary.active : undefined;
  if (latest !== undefined) {
    lines.push(`  - latest: ${formatBlueprintContextLine(latest)}`);
  }
  if (active !== undefined && stringValue(active.path) !== stringValue(latest?.path)) {
    lines.push(`  - active: ${formatBlueprintContextLine(active)}`);
  }
  const invalid = Array.isArray(summary.invalid) ? summary.invalid.filter(isRecord) : [];
  if (invalid.length > 0) {
    lines.push(`  - blocker: ${invalid.length} invalid ProductionBlueprint artifact(s); do not continue to Plan/Build until fixed`);
    for (const item of invalid.slice(0, 3)) {
      const pathValue = stringValue(item.path) ?? "(unknown path)";
      const errors = Array.isArray(item.errors) ? item.errors.filter((error): error is string => typeof error === "string") : [];
      lines.push(`    * ${pathValue}${errors.length > 0 ? ` - ${errors.slice(0, 2).join("; ")}` : ""}`);
    }
  } else if (latest !== undefined && stringValue(latest.status) === "needs-approval") {
    lines.push("  - next: show the latest blueprint to the user for approval, revision, or pause before broad Unity mutation");
  } else if (latest !== undefined && stringValue(latest.status) === "approved") {
    lines.push("  - next: approved blueprint can be converted into the selected mode's Plan artifact");
  }
  return lines.join("\n");
}

function formatBlueprintContextLine(item: Record<string, unknown>): string {
  const id = stringValue(item.id) ?? "(invalid)";
  const status = stringValue(item.status) ?? "invalid";
  const modeId = stringValue(item.modeId);
  const recipeId = stringValue(item.recipeId);
  const approval = stringValue(item.approvalStatus);
  const ambiguity = numberValue(item.ambiguityEstimate);
  const pathValue = stringValue(item.path);
  return [
    `${id} status=${status}`,
    modeId !== undefined ? `mode=${modeId}` : undefined,
    recipeId !== undefined ? `recipe=${recipeId}` : undefined,
    approval !== undefined ? `approval=${approval}` : undefined,
    ambiguity !== undefined ? `ambiguity=${ambiguity}%` : undefined,
    pathValue !== undefined ? `path=${pathValue}` : undefined,
  ].filter((part): part is string => part !== undefined).join(" ");
}

function formatVisualFeedbackHint(screen: ScreenSummary): string | undefined {
  const latestPreview = screen.previews[0];
  const latestComparison = screen.comparisons[0];
  const referencePath = sourceReferencePath(screen.source);
  const diagnostics = visualFeedbackDiagnosticCodes(latestPreview, latestComparison, referencePath);
  const tools = visualFeedbackRecommendedTools(latestPreview, latestComparison, referencePath);

  if (diagnostics.length === 0 && tools.length === 0) return undefined;
  const parts = [
    latestComparison?.verdict !== undefined ? `verdict=${latestComparison.verdict}` : undefined,
    finiteNumber(latestComparison?.mismatchRatio) !== undefined ? `mismatch=${latestComparison?.mismatchRatio}` : undefined,
    finiteNumber(latestComparison?.meanAbsoluteError) !== undefined ? `mae=${latestComparison?.meanAbsoluteError}` : undefined,
    finiteNumber(latestComparison?.aspectRatioDelta) !== undefined ? `aspectDelta=${latestComparison?.aspectRatioDelta}` : undefined,
    diagnostics.length > 0 ? `diagnostics=${diagnostics.join("|")}` : undefined,
    tools.length > 0 ? `next=${tools.join(", ")}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(", ");
}

function visualFeedbackDiagnosticCodes(
  preview: PreviewSummary | undefined,
  comparison: ComparisonSummary | undefined,
  referencePath: string | undefined,
): string[] {
  const diagnostics: string[] = [];
  if (preview === undefined) diagnostics.push("preview-missing");
  if (comparison === undefined) {
    diagnostics.push(referencePath !== undefined ? "comparison-missing" : "reference-missing");
    return diagnostics;
  }
  const aspectDelta = finiteNumber(comparison.aspectRatioDelta);
  if (aspectDelta !== undefined && aspectDelta > 0.02) diagnostics.push("aspect-ratio-delta");
  const mismatchRatio = finiteNumber(comparison.mismatchRatio);
  const meanAbsoluteError = finiteNumber(comparison.meanAbsoluteError);
  if (
    comparison.verdict === "different" ||
    (mismatchRatio !== undefined && mismatchRatio > 0.35) ||
    (meanAbsoluteError !== undefined && meanAbsoluteError > 0.12)
  ) {
    diagnostics.push("large-mismatch");
  } else if (
    comparison.verdict === "needs review" ||
    (mismatchRatio !== undefined && mismatchRatio > 0.1) ||
    (meanAbsoluteError !== undefined && meanAbsoluteError > 0.03)
  ) {
    diagnostics.push("moderate-mismatch");
  } else {
    diagnostics.push("visual-close");
  }
  return diagnostics;
}

function visualFeedbackRecommendedTools(
  preview: PreviewSummary | undefined,
  comparison: ComparisonSummary | undefined,
  referencePath: string | undefined,
): string[] {
  const tools: string[] = [];
  if (preview === undefined) tools.push("capture_preview_from_context");
  if (comparison === undefined) {
    if (referencePath !== undefined) tools.push("verify_screen_against_reference_from_context");
    tools.push("get_scene_hierarchy_from_context");
    return uniqueStrings(tools);
  }
  tools.push("inspect_screen_feedback_from_context");
  if (comparison.verdict !== "close") {
    tools.push(
      "get_scene_hierarchy_from_context",
      "update_ui_element_from_context",
      "move_ui_element_from_context",
      "verify_screen_against_reference_from_context",
    );
  } else {
    tools.push("get_scene_hierarchy_from_context", "capture_preview_from_context");
  }
  return uniqueStrings(tools);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readJournalTail(file: string, maxEntries: number, maxBytes: number): Promise<JournalSummary[]> {
  let text: string;
  try {
    text = await readTextTail(file, maxBytes);
  } catch {
    return [];
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsed: JournalSummary[] = [];
  for (const line of lines) {
    try {
      parsed.push(summarizeJournal(JSON.parse(line)));
    } catch {
      // Ignore partially written or old malformed lines.
    }
  }
  return parsed.slice(-maxEntries);
}

async function readTextTail(file: string, maxBytes: number): Promise<string> {
  const stat = await fs.stat(file);
  const bytesToRead = Math.min(stat.size, maxBytes);
  const start = stat.size - bytesToRead;
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, start);
    let text = buffer.toString("utf8");
    if (start > 0) {
      const firstNewline = text.search(/\r?\n/);
      if (firstNewline >= 0) text = text.slice(firstNewline + 1);
    }
    return text;
  } finally {
    await handle.close();
  }
}

function summarizeScreens(index: any): ScreenSummary[] {
  const rawScreens = index?.screens;
  if (rawScreens === undefined || rawScreens === null || typeof rawScreens !== "object") return [];
  return Object.values(rawScreens)
    .map((screen: any) => {
      const elements = screen?.elements !== undefined && typeof screen.elements === "object"
        ? Object.values(screen.elements)
        : [];
      const previews = summarizePreviews(screen?.previews);
      const comparisons = summarizeComparisons(screen?.comparisons);
      const summarizedElements = elements
        .map((element: any) => summarizeElement(element))
        .filter((element): element is ElementSummary => element !== undefined)
        .sort((a, b) => Number(a.deleted === true) - Number(b.deleted === true)
          || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      return {
        screenId: String(screen?.screenId ?? ""),
        screenName: stringValue(screen?.screenName),
        source: summarizeScreenSource(screen?.source),
        elementCount: elements.filter((element: any) => element?.deleted !== true).length,
        deletedElementCount: elements.filter((element: any) => element?.deleted === true).length,
        previewCount: Array.isArray(screen?.previews) ? screen.previews.length : 0,
        comparisonCount: Array.isArray(screen?.comparisons) ? screen.comparisons.length : 0,
        active: screen?.active === true || screen?.screenId === stringValue(index?.activeScreenId) ? true : undefined,
        lastPreviewAt: previews[0]?.ts,
        lastComparedAt: comparisons[0]?.ts,
        updatedAt: stringValue(screen?.updatedAt),
        elements: summarizedElements,
        previews,
        comparisons,
      };
    })
    .filter((screen) => screen.screenId.length > 0)
    .sort((a, b) => latestScreenTime(b).localeCompare(latestScreenTime(a)));
}

function emptyScreenSummary(screenId: string, updatedAt: string): ScreenSummary {
  return {
    screenId,
    elementCount: 0,
    deletedElementCount: 0,
    previewCount: 0,
    comparisonCount: 0,
    updatedAt,
    elements: [],
    previews: [],
    comparisons: [],
  };
}

function cloneScreenSummary(screen: ScreenSummary): ScreenSummary {
  return {
    ...screen,
    source: screen.source !== undefined
      ? {
          ...screen.source,
          assetPaths: screen.source.assetPaths !== undefined ? [...screen.source.assetPaths] : undefined,
        }
      : undefined,
    elements: screen.elements.map((element) => ({
      ...element,
      rect: element.rect !== undefined ? { ...element.rect } : undefined,
      props: element.props !== undefined ? { ...element.props } : undefined,
    })),
    previews: screen.previews.map((preview) => ({ ...preview })),
    comparisons: screen.comparisons.map((comparison) => ({ ...comparison })),
  };
}

function summarizeElement(element: any): ElementSummary | undefined {
  const elementId = stringValue(element?.elementId);
  if (elementId === undefined) return undefined;
  return {
    elementId,
    clientHintId: stringValue(element?.clientHintId),
    parentElementId: stringValue(element?.parentElementId),
    parentClientHintId: stringValue(element?.parentClientHintId),
    type: stringValue(element?.type),
    rect: summarizeRect(element?.rect),
    anchor: stringValue(element?.anchor),
    props: summarizeProps(element?.props),
    deleted: element?.deleted === true ? true : undefined,
    updatedAt: stringValue(element?.updatedAt),
  };
}

function summarizeScreenSource(value: any): ScreenSourceSummary | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const source: ScreenSourceSummary = {
    tool: stringValue(value.tool),
    kind: stringValue(value.kind),
    mode: stringValue(value.mode),
    path: stringValue(value.path),
    pageNumber: numberValue(value.pageNumber),
    slideNumber: numberValue(value.slideNumber),
    imageNumber: numberValue(value.imageNumber),
    packagePath: stringValue(value.packagePath),
    renderedPath: stringValue(value.renderedPath),
    extractedPath: stringValue(value.extractedPath),
    assetPaths: Array.isArray(value.assetPaths)
      ? value.assetPaths
        .filter((item: unknown): item is string => typeof item === "string" && item.length > 0)
        .slice(0, 12)
      : undefined,
    ts: stringValue(value.ts),
  };
  return Object.values(source).some((item) => item !== undefined) ? source : undefined;
}

function summarizeSceneObjects(index: any): SceneObjectSummary[] {
  const rawObjects = index?.sceneObjects;
  if (rawObjects === undefined || rawObjects === null || typeof rawObjects !== "object") return [];
  return Object.values(rawObjects)
    .map((object: any) => summarizeSceneObject(object))
    .filter((object): object is SceneObjectSummary => object !== undefined)
    .sort((a, b) => Number(a.deleted === true) - Number(b.deleted === true)
      || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function summarizeSceneObject(object: any): SceneObjectSummary | undefined {
  const objectId = stringValue(object?.objectId);
  if (objectId === undefined) return undefined;
  return {
    objectId,
    name: stringValue(object?.name),
    type: stringValue(object?.type),
    path: stringValue(object?.path),
    parentObjectId: stringValue(object?.parentObjectId),
    active: typeof object?.active === "boolean" ? object.active : undefined,
    transform: summarizeSceneTransform(object?.transform),
    components: Array.isArray(object?.components)
      ? object.components.filter((item: unknown): item is string => typeof item === "string" && item.length > 0).slice(0, 32)
      : undefined,
    deleted: object?.deleted === true ? true : undefined,
    updatedAt: stringValue(object?.updatedAt),
  };
}

function summarizeSceneTransform(value: any): SceneTransformSummary | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const transform: SceneTransformSummary = {};
  const position = summarizeVec3(value.position);
  if (position !== undefined) transform.position = position;
  const rotation = summarizeVec3(value.rotation);
  if (rotation !== undefined) transform.rotation = rotation;
  const scale = summarizeVec3(value.scale);
  if (scale !== undefined) transform.scale = scale;
  return Object.keys(transform).length > 0 ? transform : undefined;
}

function summarizeVec3(value: any): Vec3Summary | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const z = numberValue(value.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}

function summarizeImportedAssets(index: any): ImportedAssetSummary[] {
  const assets = Array.isArray(index?.importedAssets) ? index.importedAssets : [];
  return assets
    .map((asset: any) => {
      const assetPath = stringValue(asset?.assetPath);
      if (assetPath === undefined) return undefined;
      return {
        assetPath,
        sourcePath: stringValue(asset?.sourcePath),
        importedAsSprite: typeof asset?.importedAsSprite === "boolean" ? asset.importedAsSprite : undefined,
        assetType: stringValue(asset?.assetType),
        ts: stringValue(asset?.ts),
      };
    })
    .filter((asset): asset is ImportedAssetSummary => asset !== undefined);
}

function summarizePreviews(value: any): PreviewSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((preview: any) => {
      const savedPath = stringValue(preview?.savedPath);
      const uri = stringValue(preview?.uri);
      if (savedPath === undefined && uri === undefined) return undefined;
      return {
        savedPath,
        uri,
        mimeType: stringValue(preview?.mimeType),
        width: numberValue(preview?.width),
        height: numberValue(preview?.height),
        size: numberValue(preview?.size),
        ts: stringValue(preview?.ts),
      };
    })
    .filter((preview): preview is PreviewSummary => preview !== undefined)
    .sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
}

function summarizeComparisons(value: any): ComparisonSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((comparison: any) => {
      const referencePath = stringValue(comparison?.referencePath);
      const candidatePath = stringValue(comparison?.candidatePath);
      const diffPath = stringValue(comparison?.diffPath);
      const diffUri = stringValue(comparison?.diffUri);
      if (
        referencePath === undefined
        && candidatePath === undefined
        && diffPath === undefined
        && diffUri === undefined
        && stringValue(comparison?.verdict) === undefined
      ) {
        return undefined;
      }
      return {
        referencePath,
        candidatePath,
        diffPath,
        diffUri,
        diffMimeType: stringValue(comparison?.diffMimeType),
        verdict: stringValue(comparison?.verdict),
        referenceWidth: numberValue(comparison?.referenceWidth),
        referenceHeight: numberValue(comparison?.referenceHeight),
        candidateWidth: numberValue(comparison?.candidateWidth),
        candidateHeight: numberValue(comparison?.candidateHeight),
        compareWidth: numberValue(comparison?.compareWidth),
        compareHeight: numberValue(comparison?.compareHeight),
        meanAbsoluteError: numberValue(comparison?.meanAbsoluteError),
        rootMeanSquareError: numberValue(comparison?.rootMeanSquareError),
        mismatchRatio: numberValue(comparison?.mismatchRatio),
        maxChannelDelta: numberValue(comparison?.maxChannelDelta),
        aspectRatioDelta: numberValue(comparison?.aspectRatioDelta),
        threshold: numberValue(comparison?.threshold),
        size: numberValue(comparison?.size),
        ts: stringValue(comparison?.ts),
      };
    })
    .filter((comparison): comparison is ComparisonSummary => comparison !== undefined)
    .sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
}

function latestScreenTime(screen: ScreenSummary): string {
  return screen.lastComparedAt ?? screen.lastPreviewAt ?? screen.updatedAt ?? "";
}

function previewLocalPath(preview: PreviewSummary): string | undefined {
  if (preview.savedPath !== undefined) return preview.savedPath;
  if (preview.uri === undefined || !preview.uri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(preview.uri);
  } catch {
    return undefined;
  }
}

function comparisonDiffLocalPath(comparison: ComparisonSummary): string | undefined {
  if (comparison.diffPath !== undefined) return comparison.diffPath;
  if (comparison.diffUri === undefined || !comparison.diffUri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(comparison.diffUri);
  } catch {
    return undefined;
  }
}

function mimeForAttachmentPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".pdf": return "application/pdf";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt": return "text/plain";
    case ".md":
    case ".markdown": return "text/markdown";
    case ".csv": return "text/csv";
    case ".json": return "application/json";
    default: return "application/octet-stream";
  }
}

function summarizeRect(value: any): RectSummary | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return { x, y, w, h };
}

function summarizeProps(value: any): ElementPropsSummary | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const props: ElementPropsSummary = {};
  for (const key of ["text", "placeholder", "inputText", "color", "fontStyle", "sprite", "video", "align"] as const) {
    const v = value[key];
    if (typeof v === "string" && v.length > 0) props[key] = v;
  }
  for (const key of ["fontSize", "value", "minValue", "maxValue"] as const) {
    const v = value[key];
    if (typeof v === "number" && Number.isFinite(v)) props[key] = v;
  }
  for (const key of ["isOn", "interactable", "loop", "playOnAwake", "muted"] as const) {
    if (typeof value[key] === "boolean") props[key] = value[key];
  }
  if (Array.isArray(value.options)) {
    const options = value.options.filter((item: unknown): item is string => typeof item === "string");
    if (options.length > 0) props.options = options;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

function formatElementSummary(element: ElementSummary): string {
  const parts = [
    element.elementId,
    element.type !== undefined ? `type=${element.type}` : undefined,
    element.clientHintId !== undefined ? `hint=${element.clientHintId}` : undefined,
    element.parentElementId !== undefined ? `parent=${element.parentElementId}` : undefined,
    element.rect !== undefined
      ? `rect=${element.rect.x},${element.rect.y},${element.rect.w},${element.rect.h}`
      : undefined,
    element.anchor !== undefined ? `anchor=${element.anchor}` : undefined,
    formatProps(element.props),
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function formatSceneObjectSummary(object: SceneObjectSummary): string {
  const parts = [
    object.objectId,
    object.type !== undefined ? `type=${object.type}` : undefined,
    object.name !== undefined ? `name="${truncate(object.name, 60)}"` : undefined,
    object.active === false ? "inactive" : object.active === true ? "active" : undefined,
    object.parentObjectId !== undefined ? `parent=${object.parentObjectId}` : undefined,
    object.path !== undefined ? `path="${truncate(object.path, 80)}"` : undefined,
    formatSceneTransform(object.transform),
    object.components !== undefined && object.components.length > 0
      ? `components=${object.components.slice(0, 8).join(",")}${object.components.length > 8 ? `+${object.components.length - 8}` : ""}`
      : undefined,
    object.updatedAt !== undefined ? `updatedAt=${object.updatedAt}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function formatSceneTransform(transform: SceneTransformSummary | undefined): string | undefined {
  if (transform === undefined) return undefined;
  const parts = [
    formatVec3("pos", transform.position),
    formatVec3("rot", transform.rotation),
    formatVec3("scale", transform.scale),
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function formatVec3(label: string, value: Vec3Summary | undefined): string | undefined {
  if (value === undefined) return undefined;
  return `${label}=(${formatNumber(value.x)},${formatNumber(value.y)},${formatNumber(value.z)})`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatSourceSummary(source: ScreenSourceSummary): string {
  const parts = [
    source.kind ?? source.tool,
    source.mode !== undefined ? `mode=${source.mode}` : undefined,
    source.path,
    source.pageNumber !== undefined ? `page=${source.pageNumber}` : undefined,
    source.slideNumber !== undefined ? `slide=${source.slideNumber}` : undefined,
    source.imageNumber !== undefined ? `image=${source.imageNumber}` : undefined,
    source.packagePath !== undefined ? `package=${source.packagePath}` : undefined,
    source.renderedPath !== undefined ? `rendered=${source.renderedPath}` : undefined,
    source.extractedPath !== undefined ? `extracted=${source.extractedPath}` : undefined,
    source.assetPaths !== undefined && source.assetPaths.length > 0
      ? `assets=${source.assetPaths.join(",")}`
      : undefined,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.join(" ");
}

function formatSourceSelectorHint(screen: ScreenSummary): string {
  const source = screen.source;
  if (source === undefined) return `screenId=${quote(screen.screenId)}`;

  const sourceFile = source.path !== undefined ? basename(source.path) : undefined;
  const queryParts = [
    sourceFile !== undefined ? sourceFile.replace(/\.[^.]+$/, "") : undefined,
    source.pageNumber !== undefined ? `page ${source.pageNumber}` : undefined,
    source.slideNumber !== undefined ? `slide ${source.slideNumber}` : undefined,
    source.imageNumber !== undefined ? `image ${source.imageNumber}` : undefined,
    sourceFile === undefined ? screen.screenName : undefined,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  const screenQuery = queryParts.length > 0
    ? queryParts.join(" ")
    : (screen.screenName ?? screen.screenId);
  const parts = [
    `screenQuery=${quote(screenQuery)}`,
    source.kind !== undefined ? `sourceKind=${quote(source.kind)}` : undefined,
    sourceFile !== undefined ? `sourcePathContains=${quote(sourceFile)}` : undefined,
    source.pageNumber !== undefined ? `pageNumber=${source.pageNumber}` : undefined,
    source.slideNumber !== undefined ? `slideNumber=${source.slideNumber}` : undefined,
    source.imageNumber !== undefined ? `imageNumber=${source.imageNumber}` : undefined,
    "latest=true",
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function formatProps(props: ElementPropsSummary | undefined): string | undefined {
  if (props === undefined) return undefined;
  const parts = [
    props.text !== undefined ? `text="${truncate(props.text, 60)}"` : undefined,
    props.placeholder !== undefined ? `placeholder="${truncate(props.placeholder, 60)}"` : undefined,
    props.inputText !== undefined ? `inputText="${truncate(props.inputText, 60)}"` : undefined,
    props.color !== undefined ? `color=${props.color}` : undefined,
    props.fontSize !== undefined ? `fontSize=${props.fontSize}` : undefined,
    props.fontStyle !== undefined ? `fontStyle=${props.fontStyle}` : undefined,
    props.sprite !== undefined ? `sprite=${props.sprite}` : undefined,
    props.video !== undefined ? `video=${props.video}` : undefined,
    props.align !== undefined ? `align=${props.align}` : undefined,
    props.value !== undefined ? `value=${props.value}` : undefined,
    props.minValue !== undefined ? `min=${props.minValue}` : undefined,
    props.maxValue !== undefined ? `max=${props.maxValue}` : undefined,
    props.isOn !== undefined ? `isOn=${props.isOn}` : undefined,
    props.interactable !== undefined ? `interactable=${props.interactable}` : undefined,
    props.loop !== undefined ? `loop=${props.loop}` : undefined,
    props.playOnAwake !== undefined ? `playOnAwake=${props.playOnAwake}` : undefined,
    props.muted !== undefined ? `muted=${props.muted}` : undefined,
    props.options !== undefined ? `options=${props.options.slice(0, 5).map((option) => quote(truncate(option, 24))).join("|")}${props.options.length > 5 ? `+${props.options.length - 5}` : ""}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? `props(${parts.join(", ")})` : undefined;
}

function formatPreviewSummary(preview: PreviewSummary): string {
  const dims = preview.width !== undefined && preview.height !== undefined
    ? ` ${preview.width}x${preview.height}`
    : "";
  const size = preview.size !== undefined ? ` ${preview.size}b` : "";
  const mime = preview.mimeType !== undefined ? ` ${preview.mimeType}` : "";
  const ts = preview.ts !== undefined ? ` ts=${preview.ts}` : "";
  const location = preview.savedPath ?? preview.uri ?? "(unknown path)";
  return `${location}${mime}${dims}${size}${ts}`;
}

function formatComparisonSummary(comparison: ComparisonSummary): string {
  const parts = [
    comparison.verdict !== undefined ? `verdict=${comparison.verdict}` : undefined,
    metricPart("mae", comparison.meanAbsoluteError),
    metricPart("rmse", comparison.rootMeanSquareError),
    metricPart("mismatch", comparison.mismatchRatio),
    comparison.maxChannelDelta !== undefined ? `maxDelta=${comparison.maxChannelDelta}` : undefined,
    metricPart("aspectDelta", comparison.aspectRatioDelta),
    metricPart("threshold", comparison.threshold),
    comparison.compareWidth !== undefined && comparison.compareHeight !== undefined
      ? `compare=${comparison.compareWidth}x${comparison.compareHeight}`
      : undefined,
    comparison.referencePath !== undefined ? `reference=${comparison.referencePath}` : undefined,
    comparison.candidatePath !== undefined ? `candidate=${comparison.candidatePath}` : undefined,
    comparison.diffPath !== undefined ? `diff=${comparison.diffPath}` : undefined,
    comparison.diffPath === undefined && comparison.diffUri !== undefined ? `diff=${comparison.diffUri}` : undefined,
    comparison.ts !== undefined ? `ts=${comparison.ts}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function metricPart(name: string, value: number | undefined): string | undefined {
  return value !== undefined ? `${name}=${value}` : undefined;
}

async function summarizeLaunchMaterialCandidates(options: {
  projectDir: string;
  planningMaterialsDir?: string;
  attachedFiles: string[];
  maxCandidates?: number;
  maxFiles?: number;
  maxDepth?: number;
}): Promise<LaunchMaterialCandidate[]> {
  const byPath = new Map<string, LaunchMaterialCandidate>();
  const maxFiles = clampInt(options.maxFiles, DEFAULT_MAX_MATERIAL_SCAN_FILES, 1, 5000);
  const maxDepth = clampInt(options.maxDepth, DEFAULT_MAX_MATERIAL_DEPTH, 0, 20);

  if (options.planningMaterialsDir !== undefined) {
    await scanLaunchMaterialDirectory(options.planningMaterialsDir, {
      baseDir: options.planningMaterialsDir,
      projectDir: options.projectDir,
      maxFiles,
      maxDepth,
      byPath,
    });
  }

  for (const raw of options.attachedFiles) {
    const filePath = path.resolve(raw);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    addLaunchMaterialCandidate(byPath, filePath, {
      source: "file",
      baseDir: options.planningMaterialsDir,
      projectDir: options.projectDir,
    });
  }

  const maxCandidates = clampInt(options.maxCandidates, DEFAULT_MAX_MATERIAL_CANDIDATES, 0, 50);
  if (maxCandidates === 0) return [];
  return [...byPath.values()]
    .sort((a, b) => b.priority - a.priority || a.relativePath.localeCompare(b.relativePath))
    .slice(0, maxCandidates);
}

async function summarizeLaunchAttachedFiles(files: string[]): Promise<LaunchAttachedFile[]> {
  const summaries: LaunchAttachedFile[] = [];
  for (const raw of uniqueAttachedFiles(files)) {
    const filePath = path.resolve(raw);
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(filePath);
    } catch {
      summaries.push({
        path: filePath,
        readable: false,
        supported: false,
        reason: "missing",
      });
      continue;
    }
    if (!stat.isFile()) {
      summaries.push({
        path: filePath,
        readable: false,
        supported: false,
        reason: "not-file",
      });
      continue;
    }
    const ext = extname(filePath).toLowerCase();
    if (!SUPPORTED_MATERIAL_EXTENSIONS.has(ext)) {
      summaries.push({
        path: filePath,
        readable: false,
        supported: false,
        reason: "unsupported",
      });
      continue;
    }
    summaries.push({
      path: filePath,
      readable: true,
      supported: true,
      kind: materialKindForPath(filePath),
      mime: mimeForAttachmentPath(filePath),
    });
  }
  return summaries;
}

async function scanLaunchMaterialDirectory(
  dir: string,
  options: {
    baseDir: string;
    projectDir: string;
    maxFiles: number;
    maxDepth: number;
    byPath: Map<string, LaunchMaterialCandidate>;
  },
): Promise<void> {
  let inspected = 0;

  async function walk(current: string, depth: number): Promise<void> {
    if (inspected >= options.maxFiles) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (inspected >= options.maxFiles) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < options.maxDepth && !MATERIAL_IGNORE_DIRS.has(entry.name)) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      inspected += 1;
      addLaunchMaterialCandidate(options.byPath, full, {
        source: "directory",
        baseDir: options.baseDir,
        projectDir: options.projectDir,
      });
    }
  }

  await walk(dir, 0);
}

function addLaunchMaterialCandidate(
  byPath: Map<string, LaunchMaterialCandidate>,
  filePath: string,
  options: {
    source: LaunchMaterialCandidate["source"];
    baseDir?: string;
    projectDir: string;
  },
): void {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_MATERIAL_EXTENSIONS.has(ext)) return;
  const resolved = path.resolve(filePath);
  const existing = byPath.get(resolved);
  const source = mergeCandidateSource(existing?.source, options.source);
  if (existing !== undefined) {
    byPath.set(resolved, { ...existing, source });
    return;
  }
  const kind = materialKindForPath(filePath);
  byPath.set(resolved, {
    path: resolved,
    relativePath: materialRelativePath(resolved, options.baseDir, options.projectDir),
    kind,
    source,
    mime: mimeForAttachmentPath(resolved),
    priority: materialCandidatePriority(kind),
    recommendedTools: recommendedMaterialCandidateTools(kind),
  });
}

function formatLaunchMaterialCandidates(candidates: LaunchMaterialCandidate[]): string[] {
  if (candidates.length === 0) {
    return ["[uos context] planningMaterialCandidates: 0 supported file(s) found"];
  }
  const lines = [`[uos context] planningMaterialCandidates: ${candidates.length} (${materialCandidateCounts(candidates)})`];
  for (const candidate of candidates) {
    lines.push(
      `  - ${candidate.relativePath} [${candidate.kind}, ${candidate.source}] ` +
        `tools=${candidate.recommendedTools.join(", ")}`,
    );
  }
  return lines;
}

function mergeCandidateSource(
  existing: LaunchMaterialCandidate["source"] | undefined,
  next: LaunchMaterialCandidate["source"],
): LaunchMaterialCandidate["source"] {
  if (existing === undefined) return next;
  if (existing === next) return existing;
  return "both";
}

function materialRelativePath(filePath: string, baseDir: string | undefined, projectDir: string): string {
  if (baseDir !== undefined) {
    const relativeToBase = path.relative(baseDir, filePath);
    if (relativeToBase.length > 0 && !relativeToBase.startsWith("..") && !path.isAbsolute(relativeToBase)) {
      return relativeToBase.replace(/\\/g, "/");
    }
  }
  const relativeToProject = path.relative(projectDir, filePath);
  if (relativeToProject.length > 0 && !relativeToProject.startsWith("..") && !path.isAbsolute(relativeToProject)) {
    return relativeToProject.replace(/\\/g, "/");
  }
  return filePath.replace(/\\/g, "/");
}

function materialKindForPath(filePath: string): LaunchMaterialCandidate["kind"] {
  const ext = extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if (ext === ".pptx") return "pptx";
  if (ext === ".docx") return "docx";
  return "document";
}

function materialCandidatePriority(kind: LaunchMaterialCandidate["kind"]): number {
  switch (kind) {
    case "pptx": return 100;
    case "pdf": return 90;
    case "docx": return 84;
    case "image": return 80;
    case "video": return 76;
    case "document": return 68;
  }
}

function recommendedMaterialCandidateTools(kind: LaunchMaterialCandidate["kind"]): string[] {
  switch (kind) {
    case "pptx":
      return ["read_planning_material", "create_screen_from_material", "create_pptx_deck_screens"];
    case "pdf":
      return ["read_planning_material", "create_screen_from_material", "create_document_screen", "create_pdf_page_reference_screen", "create_reference_screen_from_material", "pdf_to_images"];
    case "docx":
      return ["read_planning_material", "create_screen_from_material", "create_document_screen", "create_docx_image_reference_screen", "extract_embedded_images"];
    case "image":
      return ["read_planning_material", "create_screen_from_material", "create_reference_screen_from_material", "prepare_image_ui_draft", "verify_screen_against_reference"];
    case "video":
      return ["read_planning_material", "create_screen_from_material", "import_asset"];
    case "document":
      return ["read_planning_material", "create_screen_from_material", "create_document_screen", "draft_planning_intent_from_document"];
  }
}

function materialCreationAlternativeTools(candidate: LaunchMaterialCandidate, defaultTool: string): string[] {
  return candidate.recommendedTools.filter((toolName) => (
    toolName !== defaultTool
    && (
      toolName.startsWith("create_")
      || toolName.startsWith("draft_")
      || toolName.startsWith("prepare_")
    )
  ));
}

function materialCandidateCounts(candidates: LaunchMaterialCandidate[]): string {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate.kind, (counts.get(candidate.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
}

function launchReadableAttachedFiles(context: LoadedUosContext): string[] {
  const summaries = attachedFileSummaries(context);
  if (summaries.length > 0) {
    return summaries
      .filter((file) => file.readable && file.supported)
      .map((file) => file.path);
  }
  const candidatePaths = attachedCandidatePathSet(context);
  return uniqueAttachedFiles(context.attachedFiles)
    .map((file) => path.resolve(file))
    .filter((file) => candidatePaths.has(file));
}

function launchUnavailableAttachedFiles(context: LoadedUosContext): string[] {
  const summaries = attachedFileSummaries(context);
  if (summaries.length > 0) {
    return summaries
      .filter((file) => !file.readable || !file.supported)
      .map((file) => file.path);
  }
  const candidatePaths = attachedCandidatePathSet(context);
  return uniqueAttachedFiles(context.attachedFiles)
    .map((file) => path.resolve(file))
    .filter((file) => !candidatePaths.has(file));
}

function attachedCandidatePathSet(context: LoadedUosContext): Set<string> {
  return new Set(
    context.materialCandidates
      .filter((candidate) => candidate.source === "file" || candidate.source === "both")
      .map((candidate) => path.resolve(candidate.path)),
  );
}

function attachedFileSummaries(context: LoadedUosContext): LaunchAttachedFile[] {
  return Array.isArray(context.attachedMaterialFiles) ? context.attachedMaterialFiles : [];
}

function uniqueAttachedFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const file of files) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(file);
  }
  return unique;
}

export function recommendedLaunchWorkflow(context: LoadedUosContext): LaunchWorkflow {
  const hasLaunchInputs = context.attachedFiles.length > 0 || context.planningMaterialsDir !== undefined;
  if (!hasLaunchInputs) {
    return {
      hasLaunchInputs: false,
      summary: "No launch planning inputs were provided. Inspect persisted context or the live Unity scene first.",
      actions: [],
    };
  }

  const actions: LaunchWorkflowAction[] = [];
  let order = 1;
  const readableAttachedFiles = launchReadableAttachedFiles(context);
  const readableAttachedFileSet = new Set(readableAttachedFiles.map((file) => path.resolve(file)));
  for (const file of readableAttachedFiles.slice(0, 12)) {
    actions.push({
      order: order++,
      phase: "read",
      tool: "read_planning_material",
      args: { path: file },
      reason: materialGuidance(file),
    });
  }
  if (context.planningMaterialsDir !== undefined) {
    actions.push({
      order: order++,
      phase: "scan",
      tool: "analyze_planning_materials",
      args: { dir: context.planningMaterialsDir, recursive: true },
      reason: "Rank supported planning files in the selected project's material directory before broad reads.",
    });
  }
  for (const candidate of context.materialCandidates.slice(0, 5)) {
    if (readableAttachedFileSet.has(path.resolve(candidate.path))) continue;
    actions.push({
      order: order++,
      phase: "read",
      tool: "read_planning_material",
      args: { path: candidate.path },
      candidatePath: candidate.path,
      candidateKind: candidate.kind,
      recommendedTools: candidate.recommendedTools,
      reason: `Read this ${candidate.kind} material before choosing a Unity mutation path.`,
    });
  }
  for (const candidate of context.materialCandidates.slice(0, 5)) {
    const tool = "create_screen_from_material";
    actions.push({
      order: order++,
      phase: "create",
      tool,
      args: { path: candidate.path },
      candidatePath: candidate.path,
      candidateKind: candidate.kind,
      recommendedTools: candidate.recommendedTools,
      alternativeTools: materialCreationAlternativeTools(candidate, tool),
      reason: `Use the broad material router for this ${candidate.kind} material after reading it; choose an alternative when the user asks for a more specific route.`,
    });
  }
  if (context.materialCandidates.length > 0) {
    actions.push({
      order: order++,
      phase: "verify",
      tool: "verify_screen_against_reference",
      reason: "After material-derived creation or visual edits, compare the Unity preview against the source/reference image when one is available.",
    });
  }

  return {
    hasLaunchInputs: true,
    summary: readableAttachedFiles.length > 0
      ? "Read attached files first, then create or verify screens from the selected material candidates."
      : context.attachedFiles.length > 0
        ? "No launch-attached planning files are currently readable; fix attached paths or scan the planning material directory before mutating Unity."
      : "Scan the planning material directory first, then read the highest-ranked candidates before mutating Unity.",
    actions,
  };
}

function formatLaunchInputGuidance(context: LoadedUosContext): string[] {
  const lines = ["launch input workflow:"];
  const readableAttachedFiles = launchReadableAttachedFiles(context);
  const unavailableAttachedFiles = launchUnavailableAttachedFiles(context);
  const readableAttachedFileSet = new Set(readableAttachedFiles.map((file) => path.resolve(file)));
  if (context.attachedFiles.length > 0) {
    if (readableAttachedFiles.length > 0) {
      lines.push("  - Read attached files first with read_planning_material.");
    } else {
      lines.push("  - No launch-attached planning files are currently readable; fix those paths before trying read_planning_material on them.");
    }
    for (const file of readableAttachedFiles.slice(0, 12)) {
      lines.push(`    * read_planning_material({ path: ${quote(file)} }) - ${materialGuidance(file)}`);
    }
    if (readableAttachedFiles.length > 12) {
      lines.push(`    * ... ${readableAttachedFiles.length - 12} more readable attached file(s) omitted`);
    }
    if (unavailableAttachedFiles.length > 0) {
      lines.push(`    * skip ${unavailableAttachedFiles.length} unavailable/unsupported attached file(s) until the path or type is fixed`);
      for (const file of unavailableAttachedFiles.slice(0, 5)) {
        lines.push(`      - ${file}`);
      }
    }
  }
  if (context.planningMaterialsDir !== undefined) {
    lines.push("  - Use list_planning_materials or analyze_planning_materials on the planning material directory before reading broad folders.");
    const unreadCandidates = context.materialCandidates
      .filter((candidate) => !readableAttachedFileSet.has(path.resolve(candidate.path)))
      .slice(0, 5);
    if (unreadCandidates.length > 0) {
      lines.push("  - Then read the highest-ranked material candidates before mutating Unity.");
      for (const candidate of unreadCandidates) {
        lines.push(`    * read_planning_material({ path: ${quote(candidate.path)} }) - ${candidate.kind} candidate; then choose ${candidate.recommendedTools.join(" or ")}`);
      }
    }
  }
  lines.push("  - If any supported material should become a Unity screen immediately, use create_screen_from_material after choosing the file.");
  lines.push("  - If a supported image/PDF/DOCX/PPTX should become a visual reference screen specifically, use create_reference_screen_from_material.");
  lines.push("  - If a supported video should become playable screen content, use create_screen_from_material; UOS will use the filename and file metadata, not video content analysis.");
  lines.push("  - If a text-forward PDF/DOCX/Markdown/text document should become editable UI immediately, use create_document_screen.");
  lines.push("  - When creating a screen from a draft tool, pass metadata.source as create_ui_screen.source so this context can trace the screen back to the material later.");
  lines.push("  - After creating or editing a screen from visual material, use verify_screen_against_reference with the screenId and available reference image path.");
  lines.push("  - Use pptx_to_images/pdf_to_images/extract_embedded_images when visual layout or embedded screenshots matter.");
  return lines;
}

function materialGuidance(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
    return "image/mockup; use create_reference_screen_from_material or prepare_image_ui_draft when it should drive Unity UI.";
  }
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) {
    return "video content media; use create_screen_from_material to import it as a playable Unity Video element without analyzing frames.";
  }
  if (ext === ".pptx") {
    return "PPTX deck; use extract_pptx_layout, create_pptx_slide_screen, or create_pptx_deck_screens depending on scope.";
  }
  if (ext === ".pdf") {
    return "PDF; use document drafting for text-forward pages or pdf_to_images/create_pdf_page_reference_screen for visual pages.";
  }
  if (ext === ".docx") {
    return "DOCX; use draft_planning_intent_from_docx for body text or extract_embedded_images for screenshots/mockups.";
  }
  if ([".txt", ".md", ".csv", ".json"].includes(ext)) {
    return "text-forward document; use draft_planning_intent_from_document or create_document_screen.";
  }
  return "planning material; use read_planning_material metadata to choose the next material tool.";
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function summarizeJournal(record: any): JournalSummary {
  const result = record?.result ?? {};
  const args = record?.args ?? {};
  return {
    ts: stringValue(record?.ts),
    tool: stringValue(record?.tool),
    title: stringValue(record?.title),
    sessionID: stringValue(record?.sessionID),
    callID: stringValue(record?.callID),
    screenId: stringValue(result?.screenId ?? args?.screenId ?? args?.fromId ?? args?.activateArgs?.screenId),
    elementId: stringValue(result?.elementId ?? args?.elementId),
    objectId: stringValue(result?.objectId ?? args?.objectId),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAttachedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, n));
}
