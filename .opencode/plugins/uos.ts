/**
 * .opencode/plugin/uos.ts
 *
 * UOS (Unity Orchestration System) - Phase 1.
 *
 * Persists the work context of every successful UI mutation into the *connected
 * Unity project's own* folder, at `<projectRoot>/.uos/`, so the context travels
 * with the project (git-trackable) and can seed the AI on re-entry (Phase 3).
 *
 *   <projectRoot>/.uos/
 *     project.json        - identity + last-session marker
 *     work-journal.jsonl  - append-only log: one line per successful contextual tool call
 *     screens.json        - rolling index of screens / elements / previews / transitions
 *
 * The connected project's path is resolved from (in order):
 *   1. env UOS_PROJECT_DIR          - set by the `uos` launcher (Phase 2)
 *   2. bridge tool get_project_info - asks the live Unity Editor (Application.dataPath)
 *
 * Journaling is best-effort and fully isolated: any failure here is swallowed so
 * it can never break the user's actual tool call.
 */
import type { Plugin } from "@opencode-ai/plugin";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { call } from "../tools/_bridge";
import { readActiveUnityTarget } from "../tools/_unity_target_state";

// UI mutations, visual verification, and live Unity inspection outputs produce work context worth journaling.
const UOS_CONTEXT_TOOLS = new Set<string>([
  "create_ui_screen",
  "add_ui_element",
  "add_ui_element_from_context",
  "update_ui_element",
  "update_ui_element_from_context",
  "move_ui_element",
  "move_ui_element_from_context",
  "delete_ui_element",
  "delete_ui_element_from_context",
  "create_screen_transition",
  "create_screen_transition_from_context",
  "set_active_screen",
  "set_active_screen_from_context",
  "capture_preview",
  "capture_preview_from_context",
  "compare_images",
  "verify_screen_against_reference",
  "verify_screen_against_reference_from_context",
  "verify_screens_against_references_from_context",
  "inspect_screen_feedback_from_context",
  "save_scene",
  "import_asset",
  "list_screens",
  "create_scene_object",
  "update_scene_object",
  "update_scene_object_from_context",
  "delete_scene_object",
  "delete_scene_object_from_context",
  "list_scene_objects",
  "get_scene_hierarchy",
  "get_scene_hierarchy_from_context",
  "read_planning_material",
  "create_screen_from_material",
  "create_image_reference_screen",
  "create_document_screen",
  "create_pptx_slide_screen",
  "create_pptx_deck_screens",
  "create_pdf_page_reference_screen",
  "create_docx_image_reference_screen",
  "create_reference_screen_from_material",
]);

const UOS_PERMISSION_AUTO_ALLOW_TOOLS = new Set<string>([
  "get_project_info",
  "get_uos_context",
  "select_uos_mode",
  "resolve_uos_context_target",
  "resolve_scene_object_from_context",
  "list_unity_projects",
  "list_screens",
  "list_scene_objects",
  "get_scene_hierarchy",
  "get_scene_hierarchy_from_context",
  "list_planning_materials",
  "analyze_planning_materials",
  "read_planning_material",
  "extract_pptx_layout",
  "extract_embedded_images",
  "pdf_to_images",
  "pptx_to_images",
  "preprocess_image",
  "compare_images",
  "capture_preview",
  "capture_preview_from_context",
  "inspect_screen_feedback_from_context",
  "verify_screen_against_reference",
  "verify_screen_against_reference_from_context",
  "verify_screens_against_references_from_context",
  "validate_planning_intent",
  "draft_planning_intent_from_document",
  "draft_planning_intent_from_docx",
  "draft_planning_intent_from_pptx",
  "draft_production_blueprint",
  "plan_kiosk_structure",
  "build_kiosk_from_plan",
]);

const UOS_PERMISSION_MUTATING_TOOLS = new Set<string>([
  "create_ui_screen",
  "add_ui_element",
  "add_ui_element_from_context",
  "update_ui_element",
  "update_ui_element_from_context",
  "move_ui_element",
  "move_ui_element_from_context",
  "delete_ui_element",
  "delete_ui_element_from_context",
  "create_screen_transition",
  "create_screen_transition_from_context",
  "set_active_screen",
  "set_active_screen_from_context",
  "save_scene",
  "import_asset",
  "create_screen_from_material",
  "create_image_reference_screen",
  "create_document_screen",
  "create_pptx_slide_screen",
  "create_pptx_deck_screens",
  "create_pdf_page_reference_screen",
  "create_docx_image_reference_screen",
  "create_reference_screen_from_material",
  "create_scene_object",
  "update_scene_object",
  "update_scene_object_from_context",
  "delete_scene_object",
  "delete_scene_object_from_context",
]);

const UOS_PERMISSION_KNOWN_TOOLS = new Set<string>([
  ...UOS_PERMISSION_AUTO_ALLOW_TOOLS,
  ...UOS_PERMISSION_MUTATING_TOOLS,
]);

const INDEX_VERSION = "1.0.0";
const GUI_APPROVAL_VERSION = "1.0.0";

interface ElementRec {
  elementId: string;
  clientHintId?: string;
  parentClientHintId?: string;
  parentElementId?: string;
  type?: string;
  rect?: RectRec;
  anchor?: string;
  props?: ElementPropsRec;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

interface RectRec {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ElementPropsRec {
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

interface ScreenRec {
  screenId: string;
  screenName?: string;
  referenceCanvas?: { width: number; height: number };
  source?: ScreenSourceRec;
  createdAt: string;
  updatedAt: string;
  previews?: PreviewRec[];
  comparisons?: ComparisonRec[];
  active?: boolean;
  elements: Record<string, ElementRec>;
}

interface ScreenSourceRec {
  tool: string;
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
  ts: string;
}

interface PreviewRec {
  savedPath?: string;
  uri?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  ts: string;
}

interface ComparisonRec {
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
  ts: string;
}

interface TransitionRec {
  fromId: string;
  toId: string;
  trigger?: string;
  ok?: boolean;
  ts: string;
}

interface Vec3Rec {
  x: number;
  y: number;
  z: number;
}

interface SceneTransformRec {
  position?: Vec3Rec;
  rotation?: Vec3Rec;
  scale?: Vec3Rec;
}

interface SceneObjectRec {
  objectId: string;
  name?: string;
  type?: string;
  path?: string;
  parentObjectId?: string;
  active?: boolean;
  transform?: SceneTransformRec;
  components?: string[];
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

interface ScreenIndex {
  version: string;
  updatedAt: string;
  screens: Record<string, ScreenRec>;
  sceneObjects: Record<string, SceneObjectRec>;
  transitions: TransitionRec[];
  activeScreenId?: string;
  importedAssets?: ImportedAssetRec[];
  lastSavedScenePath?: string;
  lastSavedAt?: string;
}

interface ImportedAssetRec {
  sourcePath?: string;
  assetPath: string;
  importedAsSprite?: boolean;
  assetType?: string;
  ts: string;
}

function emptyIndex(): ScreenIndex {
  return { version: INDEX_VERSION, updatedAt: "", screens: {}, sceneObjects: {}, transitions: [] };
}

// ---- connected-project resolution (cached) ----

function envValue(key: string): string | undefined {
  // Mirror _bridge.ts: read process.env without depending on a typed `process` global.
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const v = env[key]?.trim();
  return v !== undefined && v.length > 0 ? v : undefined;
}

let cachedDir: string | undefined;
let inflight: Promise<string | undefined> | undefined;

async function resolveProjectDir(): Promise<string | undefined> {
  const active = await readActiveUnityTarget();
  if (active?.target.projectPath !== undefined) {
    cachedDir = active.target.projectPath;
    return active.target.projectPath;
  }
  if (cachedDir !== undefined) return cachedDir;
  if (inflight !== undefined) return inflight;
  inflight = (async () => {
    const override = envValue("UOS_PROJECT_DIR");
    if (override !== undefined) {
      cachedDir = override;
      return override;
    }
    try {
      const info = (await call("get_project_info", {})) as { projectPath?: string };
      const p = info?.projectPath?.trim();
      if (p !== undefined && p.length > 0) {
        cachedDir = p;
        return p;
      }
    } catch {
      // Unity backend may predate get_project_info, or the bridge is down; fall through.
    }
    return undefined;
  })();
  try {
    return await inflight;
  } finally {
    inflight = undefined;
  }
}

// ---- serialized read-modify-write (avoid interleaved writes to screens.json) ----

let writeChain: Promise<unknown> = Promise.resolve();
function enqueue(task: () => Promise<void>): Promise<void> {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => {});
  return next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function findScreenOfElement(idx: ScreenIndex, elementId: string): ScreenRec | undefined {
  for (const screen of Object.values(idx.screens)) {
    if (screen.elements[elementId] !== undefined) return screen;
  }
  return undefined;
}

function applyToIndex(idx: ScreenIndex, tool: string, args: any, meta: any, ts: string): void {
  if (meta?.dryRun === true || args?.dryRun === true) return;
  switch (tool) {
    case "create_image_reference_screen": {
      applyToIndex(idx, "import_asset", args, meta?.importedAsset, ts);
      applyToIndex(idx, "create_ui_screen", { intent: meta?.intent }, meta?.created ?? meta, ts);
      applyScreenSource(idx, meta?.created ?? meta, referenceScreenSource(tool, args, meta, ts));
      return;
    }
    case "create_pdf_page_reference_screen": {
      applyToIndex(idx, "import_asset", args, meta?.importedAsset, ts);
      applyToIndex(idx, "create_ui_screen", { intent: meta?.intent }, meta?.created ?? meta, ts);
      applyScreenSource(idx, meta?.created ?? meta, referenceScreenSource(tool, args, meta, ts));
      return;
    }
    case "create_docx_image_reference_screen": {
      applyToIndex(idx, "import_asset", args, meta?.importedAsset, ts);
      applyToIndex(idx, "create_ui_screen", { intent: meta?.intent }, meta?.created ?? meta, ts);
      applyScreenSource(idx, meta?.created ?? meta, referenceScreenSource(tool, args, meta, ts));
      return;
    }
    case "create_document_screen": {
      applyToIndex(
        idx,
        "create_ui_screen",
        { intent: meta?.intent ?? meta?.draft?.intent, source: meta?.source },
        { ...(meta?.created ?? meta), source: meta?.source },
        ts,
      );
      return;
    }
    case "create_screen_from_material": {
      if (meta?.importedAsset !== undefined) {
        applyToIndex(idx, "import_asset", args, meta.importedAsset, ts);
      }
      for (const imported of meta?.importedAssets ?? []) {
        applyToIndex(idx, "import_asset", args, imported, ts);
      }
      applyToIndex(
        idx,
        "create_ui_screen",
        { intent: meta?.intent ?? meta?.specific?.draft?.intent, source: meta?.source },
        { ...(meta?.created ?? meta), source: meta?.source },
        ts,
      );
      return;
    }
    case "create_reference_screen_from_material": {
      if (meta?.importedAsset !== undefined) {
        applyToIndex(idx, "import_asset", args, meta.importedAsset, ts);
      }
      for (const imported of meta?.importedAssets ?? []) {
        applyToIndex(idx, "import_asset", args, imported, ts);
      }
      applyToIndex(idx, "create_ui_screen", { intent: meta?.intent }, meta?.created ?? meta, ts);
      applyScreenSource(idx, meta?.created ?? meta, referenceScreenSource(tool, args, meta, ts));
      return;
    }
    case "create_pptx_slide_screen": {
      for (const imported of meta?.importedAssets ?? []) {
        applyToIndex(idx, "import_asset", args, imported, ts);
      }
      applyToIndex(idx, "create_ui_screen", { intent: meta?.intent ?? meta?.draft?.intent }, meta?.created ?? meta, ts);
      applyScreenSource(idx, meta?.created ?? meta, referenceScreenSource(tool, args, meta, ts));
      return;
    }
    case "create_pptx_deck_screens": {
      for (const screen of meta?.screens ?? []) {
        for (const imported of screen?.importedAssets ?? []) {
          applyToIndex(idx, "import_asset", args, imported, ts);
        }
        const source = screen?.source ?? {
          tool,
          kind: "pptx",
          mode: "editable",
          path: firstString(meta?.path, args?.path),
          slideNumber: numberValue(screen?.slideNumber ?? screen?.draft?.source?.slideNumber),
          assetPaths: referenceAssetPaths(screen),
        };
        applyToIndex(
          idx,
          "create_ui_screen",
          { intent: screen?.intent ?? screen?.draft?.intent, source },
          { ...(screen?.created ?? screen), source },
          ts,
        );
      }
      for (const transition of meta?.transitions ?? []) {
        applyToIndex(idx, "create_screen_transition", transition, transition, ts);
      }
      const activeScreenId = stringValue(meta?.activeScreenId);
      if (activeScreenId !== undefined) {
        applyToIndex(idx, "set_active_screen", { screenId: activeScreenId }, { screenId: activeScreenId, active: true }, ts);
      }
      return;
    }
    case "verify_screen_against_reference": {
      const screenId = stringValue(args?.screenId ?? meta?.screenId);
      if (screenId === undefined) return;
      applyToIndex(idx, "capture_preview", { screenId }, meta?.preview, ts);
      applyToIndex(
        idx,
        "compare_images",
        {
          screenId,
          referencePath: args?.referencePath ?? meta?.comparison?.referencePath,
          candidatePath: meta?.preview?.savedPath,
          threshold: args?.threshold,
        },
        { screenId, ...meta?.comparison },
        ts,
      );
      return;
    }
    case "verify_screen_against_reference_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "verify_screen_against_reference", meta?.verifyArgs ?? args, meta?.verified ?? meta, ts);
      return;
    }
    case "verify_screens_against_references_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      for (const item of meta?.verifiedScreens ?? []) {
        applyToIndex(idx, "verify_screen_against_reference", item?.verifyArgs ?? args, item?.verified ?? item, ts);
      }
      return;
    }
    case "get_scene_hierarchy": {
      applyHierarchyToIndex(idx, meta?.hierarchy ?? meta, ts);
      return;
    }
    case "get_scene_hierarchy_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyHierarchyToIndex(idx, meta?.hierarchy ?? meta, ts);
      return;
    }
    case "list_screens": {
      applyScreenListToIndex(idx, meta, ts);
      return;
    }
    case "create_scene_object": {
      applySceneObjectToIndex(idx, meta, ts, false);
      return;
    }
    case "update_scene_object": {
      applySceneObjectToIndex(idx, meta, ts, false);
      return;
    }
    case "update_scene_object_from_context": {
      applySceneObjectRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "update_scene_object", meta?.updateArgs ?? args, meta?.updated ?? meta, ts);
      return;
    }
    case "delete_scene_object": {
      const objectId = stringValue(args?.objectId ?? meta?.objectId);
      if (objectId === undefined) return;
      const rec = idx.sceneObjects?.[objectId] ?? { objectId, createdAt: ts, updatedAt: ts };
      rec.deleted = true;
      rec.updatedAt = ts;
      idx.sceneObjects ??= {};
      idx.sceneObjects[objectId] = rec;
      return;
    }
    case "delete_scene_object_from_context": {
      applySceneObjectRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "delete_scene_object", meta?.deleteArgs ?? args, meta?.deleted ?? meta, ts);
      return;
    }
    case "list_scene_objects": {
      applySceneObjectListToIndex(idx, meta, ts);
      return;
    }
    case "create_ui_screen": {
      const screenId: string | undefined = meta?.screenId;
      if (screenId === undefined) return;
      const intent = args?.intent ?? {};
      const screen: ScreenRec = idx.screens[screenId] ?? {
        screenId,
        createdAt: ts,
        updatedAt: ts,
        elements: {},
      };
      screen.screenName = intent.screenName ?? screen.screenName;
      screen.referenceCanvas = intent.referenceCanvas ?? screen.referenceCanvas;
      screen.updatedAt = ts;

      // clientHintId -> intent element / elementId (to recover element state and parent links)
      const byHint = new Map<string, any>();
      const hintToElementId = new Map<string, string>();
      for (const pair of meta?.elements ?? []) {
        if (pair?.clientHintId && pair?.elementId) {
          hintToElementId.set(pair.clientHintId, pair.elementId);
        }
      }
      for (const el of intent.elements ?? []) {
        if (el?.clientHintId) byHint.set(el.clientHintId, el);
      }
      for (const pair of meta?.elements ?? []) {
        const elementId: string | undefined = pair?.elementId;
        if (elementId === undefined) continue;
        const src = pair?.clientHintId ? byHint.get(pair.clientHintId) : undefined;
        const rec = screen.elements[elementId] ?? { elementId, createdAt: ts, updatedAt: ts };
        rec.elementId = elementId;
        rec.clientHintId = pair?.clientHintId ?? rec.clientHintId;
        applyElementInput(rec, src, ts, hintToElementId);
        rec.deleted = false;
        screen.elements[elementId] = rec;
      }
      const source = directScreenSource(tool, args, meta, ts);
      if (source !== undefined) screen.source = source;
      idx.screens[screenId] = screen;
      return;
    }
    case "add_ui_element": {
      const screenId: string | undefined = args?.screenId;
      const elementId: string | undefined = meta?.elementId;
      if (screenId === undefined || elementId === undefined) return;
      const screen: ScreenRec = idx.screens[screenId] ?? {
        screenId,
        createdAt: ts,
        updatedAt: ts,
        elements: {},
      };
      const rec = screen.elements[elementId] ?? { elementId, createdAt: ts, updatedAt: ts };
      rec.elementId = elementId;
      applyElementInput(rec, args?.element, ts, undefined, screen);
      rec.deleted = false;
      screen.elements[elementId] = rec;
      screen.updatedAt = ts;
      idx.screens[screenId] = screen;
      return;
    }
    case "add_ui_element_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "add_ui_element", meta?.addArgs ?? args, meta?.added ?? meta, ts);
      return;
    }
    case "update_ui_element": {
      const elementId: string | undefined = args?.elementId;
      if (elementId === undefined) return;
      const screen = findScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      const element = screen.elements[elementId];
      applyElementPatch(element, args, ts);
      screen.updatedAt = ts;
      return;
    }
    case "update_ui_element_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "update_ui_element", meta?.updateArgs ?? args, meta?.updated ?? meta, ts);
      return;
    }
    case "move_ui_element": {
      const elementId: string | undefined = args?.elementId;
      if (elementId === undefined) return;
      const screen = findScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      const element = screen.elements[elementId];
      const rect = sanitizeRect(args?.rect);
      if (rect !== undefined) element.rect = rect;
      if (typeof args?.anchor === "string" && args.anchor.length > 0) element.anchor = args.anchor;
      element.updatedAt = ts;
      screen.updatedAt = ts;
      return;
    }
    case "move_ui_element_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "move_ui_element", meta?.moveArgs ?? args, meta?.moved ?? meta, ts);
      return;
    }
    case "delete_ui_element": {
      const elementId: string | undefined = args?.elementId;
      if (elementId === undefined) return;
      const screen = findScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      screen.elements[elementId].deleted = true;
      screen.elements[elementId].updatedAt = ts;
      screen.updatedAt = ts;
      return;
    }
    case "delete_ui_element_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "delete_ui_element", meta?.deleteArgs ?? args, meta?.deleted ?? meta, ts);
      return;
    }
    case "create_screen_transition": {
      if (!args?.fromId || !args?.toId) return;
      idx.transitions.push({
        fromId: args.fromId,
        toId: args.toId,
        trigger: stringValue(args.trigger),
        ok: typeof meta?.ok === "boolean" ? meta.ok : undefined,
        ts,
      });
      idx.transitions = idx.transitions.slice(-100);
      return;
    }
    case "create_screen_transition_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "create_screen_transition", meta?.transitionArgs ?? args, meta?.created ?? meta, ts);
      return;
    }
    case "set_active_screen": {
      const screenId = stringValue(args?.screenId ?? meta?.screenId);
      if (screenId === undefined) return;
      for (const screen of Object.values(idx.screens)) {
        screen.active = screen.screenId === screenId ? true : undefined;
      }
      const screen: ScreenRec = idx.screens[screenId] ?? {
        screenId,
        createdAt: ts,
        updatedAt: ts,
        elements: {},
      };
      screen.screenName = stringValue(meta?.name) ?? screen.screenName;
      screen.active = true;
      screen.updatedAt = ts;
      idx.screens[screenId] = screen;
      idx.activeScreenId = screenId;
      return;
    }
    case "set_active_screen_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "set_active_screen", meta?.activateArgs ?? args, meta?.activated ?? meta, ts);
      return;
    }
    case "capture_preview": {
      const screenId = stringValue(meta?.screenId ?? args?.screenId);
      if (screenId === undefined) return;
      const screen: ScreenRec = idx.screens[screenId] ?? {
        screenId,
        createdAt: ts,
        updatedAt: ts,
        elements: {},
      };
      screen.previews ??= [];
      screen.previews.push({
        savedPath: stringValue(meta?.savedPath ?? meta?.path),
        uri: stringValue(meta?.uri),
        mimeType: stringValue(meta?.mimeType),
        width: numberValue(meta?.width),
        height: numberValue(meta?.height),
        size: numberValue(meta?.size),
        ts,
      });
      screen.previews = screen.previews.slice(-20);
      idx.screens[screenId] = screen;
      return;
    }
    case "capture_preview_from_context": {
      applyContextRefreshToIndex(idx, meta, ts);
      applyToIndex(idx, "capture_preview", meta?.previewArgs ?? args, meta?.captured ?? meta, ts);
      return;
    }
    case "compare_images": {
      const comparison = comparisonRecord(args, meta, ts);
      if (comparison === undefined) return;
      const screenId = stringValue(args?.screenId ?? meta?.screenId);
      const screen = screenId !== undefined
        ? idx.screens[screenId]
        : findScreenByPreviewLocation(idx, comparison.candidatePath);
      if (screen === undefined) return;
      screen.comparisons ??= [];
      screen.comparisons.push(comparison);
      screen.comparisons = screen.comparisons.slice(-20);
      screen.updatedAt = ts;
      return;
    }
    case "save_scene": {
      const scenePath = stringValue(meta?.path ?? args?.path);
      if (scenePath === undefined) return;
      idx.lastSavedScenePath = scenePath;
      idx.lastSavedAt = ts;
      return;
    }
    case "import_asset": {
      const assetPath = stringValue(meta?.assetPath);
      if (assetPath === undefined) return;
      idx.importedAssets ??= [];
      idx.importedAssets.push({
        sourcePath: stringValue(meta?.sourcePath),
        assetPath,
        importedAsSprite: typeof meta?.importedAsSprite === "boolean" ? meta.importedAsSprite : undefined,
        assetType: stringValue(meta?.assetType),
        ts,
      });
      return;
    }
  }
}

function applySceneObjectListToIndex(idx: ScreenIndex, meta: any, ts: string): void {
  const objects = Array.isArray(meta?.objects) ? meta.objects : [];
  idx.sceneObjects ??= {};
  const liveIds = new Set<string>();
  for (const object of objects) {
    const objectId = stringValue(object?.objectId);
    if (objectId === undefined) continue;
    liveIds.add(objectId);
    applySceneObjectToIndex(idx, object, ts, false);
  }
  for (const rec of Object.values(idx.sceneObjects)) {
    if (!liveIds.has(rec.objectId) && rec.deleted !== true) {
      rec.deleted = true;
      rec.updatedAt = ts;
    }
  }
}

function applySceneObjectToIndex(idx: ScreenIndex, value: any, ts: string, deleted: boolean): void {
  const objectId = stringValue(value?.objectId);
  if (objectId === undefined) return;
  idx.sceneObjects ??= {};
  const rec = idx.sceneObjects[objectId] ?? { objectId, createdAt: ts, updatedAt: ts };
  rec.objectId = objectId;
  rec.name = stringValue(value?.name) ?? rec.name;
  rec.type = stringValue(value?.type) ?? rec.type;
  rec.path = stringValue(value?.path) ?? rec.path;
  rec.parentObjectId = stringValue(value?.parentObjectId) ?? rec.parentObjectId;
  if (typeof value?.active === "boolean") rec.active = value.active;
  const transform = sanitizeSceneTransform(value?.transform);
  if (transform !== undefined) rec.transform = { ...(rec.transform ?? {}), ...transform };
  const components = arrayStringValues(value?.components);
  if (components !== undefined) rec.components = components;
  rec.deleted = deleted ? true : undefined;
  rec.updatedAt = ts;
  idx.sceneObjects[objectId] = rec;
}

function comparisonRecord(args: any, meta: any, ts: string): ComparisonRec | undefined {
  const comparison: ComparisonRec = {
    referencePath: firstString(meta?.referencePath, args?.referencePath),
    candidatePath: firstString(meta?.candidatePath, args?.candidatePath),
    diffPath: firstString(meta?.diffPath),
    diffUri: firstString(meta?.uri),
    diffMimeType: firstString(meta?.diffMimeType),
    verdict: firstString(meta?.verdict),
    referenceWidth: numberValue(meta?.referenceWidth),
    referenceHeight: numberValue(meta?.referenceHeight),
    candidateWidth: numberValue(meta?.candidateWidth),
    candidateHeight: numberValue(meta?.candidateHeight),
    compareWidth: numberValue(meta?.compareWidth),
    compareHeight: numberValue(meta?.compareHeight),
    meanAbsoluteError: numberValue(meta?.meanAbsoluteError),
    rootMeanSquareError: numberValue(meta?.rootMeanSquareError),
    mismatchRatio: numberValue(meta?.mismatchRatio),
    maxChannelDelta: numberValue(meta?.maxChannelDelta),
    aspectRatioDelta: numberValue(meta?.aspectRatioDelta),
    threshold: numberValue(meta?.threshold ?? args?.threshold),
    size: numberValue(meta?.size),
    ts,
  };
  if (
    comparison.referencePath === undefined
    && comparison.candidatePath === undefined
    && comparison.diffPath === undefined
    && comparison.diffUri === undefined
    && comparison.verdict === undefined
  ) {
    return undefined;
  }
  return comparison;
}

function applyContextRefreshToIndex(idx: ScreenIndex, meta: any, ts: string): void {
  const refresh = meta?.contextRefresh;
  if (refresh?.ok !== true) return;
  applyHierarchyToIndex(idx, refresh.hierarchy, ts);
}

function applySceneObjectRefreshToIndex(idx: ScreenIndex, meta: any, ts: string): void {
  const refresh = meta?.sceneObjectRefresh;
  if (refresh?.ok !== true) return;
  applySceneObjectListToIndex(idx, { objects: refresh.objects ?? [] }, ts);
}

function applyScreenListToIndex(idx: ScreenIndex, meta: any, ts: string): void {
  const screens = Array.isArray(meta?.screens) ? meta.screens : [];
  if (screens.length === 0) return;

  let activeScreenId = stringValue(meta?.activeScreenId);
  const activeFromScreens = screens
    .filter((screen: any) => screen?.active === true)
    .map((screen: any) => stringValue(screen?.id ?? screen?.screenId))
    .filter((screenId: string | undefined): screenId is string => screenId !== undefined);
  if (activeScreenId === undefined && activeFromScreens.length === 1) {
    activeScreenId = activeFromScreens[0];
  }

  for (const raw of screens) {
    const screenId = stringValue(raw?.id ?? raw?.screenId);
    if (screenId === undefined) continue;
    const screen: ScreenRec = idx.screens[screenId] ?? {
      screenId,
      createdAt: ts,
      updatedAt: ts,
      elements: {},
    };
    screen.screenName = stringValue(raw?.name ?? raw?.screenName) ?? screen.screenName;
    const rawActive = typeof raw?.active === "boolean" ? raw.active : undefined;
    screen.active = activeScreenId !== undefined
      ? screenId === activeScreenId ? true : undefined
      : rawActive === true ? true : undefined;
    screen.updatedAt = ts;
    idx.screens[screenId] = screen;
  }

  if (activeScreenId !== undefined) {
    idx.activeScreenId = activeScreenId;
    for (const screen of Object.values(idx.screens)) {
      screen.active = screen.screenId === activeScreenId ? true : undefined;
    }
  }
}

function applyHierarchyToIndex(idx: ScreenIndex, hierarchy: any, ts: string): void {
  const nodes = Array.isArray(hierarchy?.nodes) ? hierarchy.nodes : [];
  if (nodes.length === 0) return;

  const activeScreens = new Set<string>();
  for (const raw of nodes) {
    if (raw === undefined || raw === null || typeof raw !== "object") continue;
    const rootScreenId = stringValue(raw.rootScreenId);
    if (rootScreenId === undefined) continue;

    const rootScreenName = stringValue(raw.rootScreenName);
    const elementId = stringValue(raw.elementId);
    const type = stringValue(raw.type);
    const depth = numberValue(raw.depth) ?? 0;
    const isRootScreenNode = elementId === rootScreenId || (depth === 0 && (type === "Screen" || type === "Canvas"));
    const screen: ScreenRec = idx.screens[rootScreenId] ?? {
      screenId: rootScreenId,
      createdAt: ts,
      updatedAt: ts,
      elements: {},
    };
    screen.screenName = rootScreenName ?? (isRootScreenNode ? stringValue(raw.name) : screen.screenName);
    if (isRootScreenNode && typeof raw.active === "boolean") {
      screen.active = raw.active ? true : undefined;
      if (raw.active) activeScreens.add(rootScreenId);
    }
    screen.updatedAt = ts;
    idx.screens[rootScreenId] = screen;

    if (elementId === undefined || isRootScreenNode) continue;
    const rec = screen.elements[elementId] ?? { elementId, createdAt: ts, updatedAt: ts };
    rec.elementId = elementId;
    rec.type = type ?? rec.type;
    rec.parentElementId = stringValue(raw.parentElementId) ?? rec.parentElementId;
    const rect = sanitizeRect(raw.rect);
    if (rect !== undefined) rec.rect = rect;
    rec.anchor = stringValue(raw.anchor) ?? rec.anchor;
    const props = sanitizeProps(raw.props);
    if (props !== undefined) rec.props = { ...(rec.props ?? {}), ...props };
    rec.deleted = false;
    rec.updatedAt = ts;
    screen.elements[elementId] = rec;
  }

  if (activeScreens.size === 1) {
    const [activeScreenId] = activeScreens;
    idx.activeScreenId = activeScreenId;
    for (const screen of Object.values(idx.screens)) {
      screen.active = screen.screenId === activeScreenId ? true : undefined;
    }
  }
}

function findScreenByPreviewLocation(idx: ScreenIndex, candidatePath: string | undefined): ScreenRec | undefined {
  if (candidatePath === undefined) return undefined;
  for (const screen of Object.values(idx.screens)) {
    for (const preview of screen.previews ?? []) {
      if (
        sameLocation(candidatePath, preview.savedPath)
        || sameLocation(candidatePath, preview.uri)
      ) {
        return screen;
      }
    }
  }
  return undefined;
}

function sameLocation(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  if (left === right) return true;
  const normalizedLeft = normalizeLocation(left);
  const normalizedRight = normalizeLocation(right);
  if (normalizedLeft === undefined || normalizedRight === undefined) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (/^[A-Za-z]:\//.test(normalizedLeft) && /^[A-Za-z]:\//.test(normalizedRight)) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return false;
}

function normalizeLocation(value: string): string | undefined {
  let local = value;
  if (value.startsWith("file:")) {
    try {
      local = fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  let normalized = path.normalize(local).replace(/\\/g, "/");
  if (/^[a-z]:\//.test(normalized)) {
    normalized = normalized[0].toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

function applyScreenSource(idx: ScreenIndex, created: any, source: ScreenSourceRec | undefined): void {
  const screenId = stringValue(created?.screenId);
  if (screenId === undefined || source === undefined) return;
  const screen = idx.screens[screenId];
  if (screen === undefined) return;
  screen.source = source;
}

function referenceScreenSource(tool: string, args: any, meta: any, ts: string): ScreenSourceRec | undefined {
  const specific = meta?.specific ?? meta;
  const source: ScreenSourceRec = {
    tool,
    kind: stringValue(meta?.kind) ?? kindForReferenceTool(tool),
    mode: firstString(meta?.pptxMode, specific?.pptxMode),
    path: firstString(
      meta?.path,
      specific?.source?.path,
      specific?.pdf?.path,
      specific?.docx?.path,
      specific?.draft?.source?.path,
      meta?.source?.path,
      meta?.pdf?.path,
      meta?.docx?.path,
      meta?.draft?.source?.path,
      args?.path,
    ),
    pageNumber: numberValue(specific?.pdf?.pageNumber ?? meta?.pdf?.pageNumber ?? args?.pageNumber),
    slideNumber: numberValue(
      specific?.draft?.source?.slideNumber
        ?? meta?.draft?.source?.slideNumber
        ?? specific?.pptx?.slideNumber
        ?? meta?.pptx?.slideNumber
        ?? args?.slideNumber,
    ),
    imageNumber: numberValue(specific?.docx?.imageNumber ?? meta?.docx?.imageNumber ?? args?.imageNumber),
    packagePath: firstString(
      specific?.docx?.packagePath,
      meta?.docx?.packagePath,
      specific?.embeddedImage?.packagePath,
      meta?.embeddedImage?.packagePath,
      args?.packagePath,
    ),
    renderedPath: firstString(
      specific?.renderedPage?.path,
      meta?.renderedPage?.path,
      specific?.renderedSlide?.path,
      meta?.renderedSlide?.path,
    ),
    extractedPath: firstString(specific?.embeddedImage?.path, meta?.embeddedImage?.path),
    assetPaths: referenceAssetPaths(meta),
    ts,
  };
  if (
    source.kind === undefined
    && source.path === undefined
    && source.pageNumber === undefined
    && source.slideNumber === undefined
    && source.imageNumber === undefined
    && source.assetPaths === undefined
  ) {
    return undefined;
  }
  return source;
}

function directScreenSource(tool: string, args: any, meta: any, ts: string): ScreenSourceRec | undefined {
  const raw = args?.source ?? meta?.source;
  if (raw === undefined || raw === null || typeof raw !== "object") return undefined;
  const source: ScreenSourceRec = {
    tool: firstString(raw.tool, tool) ?? tool,
    kind: stringValue(raw.kind),
    mode: stringValue(raw.mode),
    path: stringValue(raw.path),
    pageNumber: numberValue(raw.pageNumber),
    slideNumber: numberValue(raw.slideNumber),
    imageNumber: numberValue(raw.imageNumber),
    packagePath: stringValue(raw.packagePath),
    renderedPath: stringValue(raw.renderedPath),
    extractedPath: stringValue(raw.extractedPath),
    assetPaths: arrayStringValues(raw.assetPaths),
    ts,
  };
  if (
    source.kind === undefined
    && source.path === undefined
    && source.pageNumber === undefined
    && source.slideNumber === undefined
    && source.imageNumber === undefined
    && source.packagePath === undefined
    && source.renderedPath === undefined
    && source.extractedPath === undefined
    && source.assetPaths === undefined
  ) {
    return undefined;
  }
  return source;
}

function kindForReferenceTool(tool: string): string | undefined {
  switch (tool) {
    case "create_image_reference_screen": return "image";
    case "create_pdf_page_reference_screen": return "pdf";
    case "create_docx_image_reference_screen": return "docx";
    case "create_pptx_slide_screen": return "pptx";
    case "create_pptx_deck_screens": return "pptx";
    default: return undefined;
  }
}

function referenceAssetPaths(meta: any): string[] | undefined {
  const paths = [
    stringValue(meta?.importedAsset?.assetPath),
    ...(Array.isArray(meta?.importedAssets)
      ? meta.importedAssets.map((asset: any) => stringValue(asset?.assetPath))
      : []),
  ].filter((item): item is string => item !== undefined);
  const unique = [...new Set(paths)];
  return unique.length > 0 ? unique : undefined;
}

function arrayStringValues(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const unique = [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
  return unique.length > 0 ? unique : undefined;
}

function applyElementInput(
  rec: ElementRec,
  input: any,
  ts: string,
  hintToElementId?: Map<string, string>,
  screen?: ScreenRec,
): void {
  if (input === undefined || input === null || typeof input !== "object") {
    rec.updatedAt = ts;
    return;
  }
  rec.clientHintId = stringValue(input.clientHintId) ?? rec.clientHintId;
  rec.type = stringValue(input.type) ?? rec.type;
  rec.parentClientHintId = stringValue(input.parentClientHintId) ?? rec.parentClientHintId;
  rec.parentElementId = parentElementId(input, hintToElementId, screen) ?? rec.parentElementId;
  const rect = sanitizeRect(input.rect);
  if (rect !== undefined) rec.rect = rect;
  rec.anchor = stringValue(input.anchor) ?? rec.anchor;
  const props = sanitizeProps(input.props);
  if (props !== undefined) rec.props = props;
  rec.updatedAt = ts;
}

function applyElementPatch(rec: ElementRec, args: any, ts: string): void {
  const rect = sanitizeRect(args?.rect);
  if (rect !== undefined) rec.rect = rect;
  rec.anchor = stringValue(args?.anchor) ?? rec.anchor;
  const props = sanitizeProps(args?.props);
  if (props !== undefined) {
    rec.props = { ...(rec.props ?? {}), ...props };
  }
  rec.updatedAt = ts;
}

function parentElementId(input: any, hintToElementId?: Map<string, string>, screen?: ScreenRec): string | undefined {
  const parentElementId = stringValue(input.parentElementId);
  if (parentElementId !== undefined) return parentElementId;
  const parentHint = stringValue(input.parentClientHintId);
  if (parentHint === undefined) return undefined;
  const mapped = hintToElementId?.get(parentHint);
  if (mapped !== undefined) return mapped;
  if (screen === undefined) return undefined;
  return Object.values(screen.elements).find((element) => element.clientHintId === parentHint)?.elementId;
}

function sanitizeRect(value: any): RectRec | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return { x, y, w, h };
}

function sanitizeSceneTransform(value: any): SceneTransformRec | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const transform: SceneTransformRec = {};
  const position = sanitizeVec3(value.position);
  if (position !== undefined) transform.position = position;
  const rotation = sanitizeVec3(value.rotation);
  if (rotation !== undefined) transform.rotation = rotation;
  const scale = sanitizeVec3(value.scale);
  if (scale !== undefined) transform.scale = scale;
  return Object.keys(transform).length > 0 ? transform : undefined;
}

function sanitizeVec3(value: any): Vec3Rec | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const { x, y, z } = value;
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return { x, y, z };
}

function sanitizeProps(value: any): ElementPropsRec | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const props: ElementPropsRec = {};
  for (const key of ["text", "placeholder", "inputText", "color", "fontStyle", "sprite", "video", "align"] as const) {
    const v = value[key];
    if (typeof v === "string") props[key] = v;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = stringValue(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeJournalValue(value: unknown, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") {
    if (value.startsWith("data:") && value.includes(";base64,")) {
      return `[redacted data URL, ${value.length} chars]`;
    }
    return value.length > 8192 ? `[redacted long string, ${value.length} chars]` : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= 8) return "[redacted deep object]";
  if (Array.isArray(value)) {
    const max = 200;
    const items = value.slice(0, max).map((item) => sanitizeJournalValue(item, depth + 1));
    if (value.length > max) items.push(`[redacted ${value.length - max} more item(s)]`);
    return items;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRedactJournalField(key, item)) {
      result[key] = typeof item === "string"
        ? `[redacted ${key}, ${item.length} chars]`
        : `[redacted ${key}]`;
      continue;
    }
    result[key] = sanitizeJournalValue(item, depth + 1);
  }
  return result;
}

function shouldRedactJournalField(key: string, value: unknown): boolean {
  const lowered = key.toLowerCase();
  if (lowered === "base64data" || lowered === "base64" || lowered.endsWith("base64")) return true;
  if (lowered === "dataurl" || lowered.endsWith("dataurl")) return true;
  if (lowered === "bytes" || lowered.endsWith("bytes")) return true;
  return typeof value === "string" && value.length > 8192;
}

async function shouldAutoAllowUosPermission(input: any): Promise<boolean> {
  const toolName = permissionToolName(input);
  if (toolName === undefined) return false;
  if (UOS_PERMISSION_AUTO_ALLOW_TOOLS.has(toolName)) return true;
  if (envValue("UOS_GUI_MODE") !== "1") return false;
  if (!UOS_PERMISSION_MUTATING_TOOLS.has(toolName)) return false;
  return await hasValidGuiApproval();
}

function permissionToolName(input: any): string | undefined {
  const candidates: string[] = [];
  pushPermissionString(candidates, input?.permission);
  collectPermissionStrings(input?.patterns, candidates);
  collectPermissionStrings(input?.always, candidates);
  pushPermissionString(candidates, input?.tool?.name);
  pushPermissionString(candidates, input?.tool?.id);
  pushPermissionString(candidates, input?.tool?.tool);
  collectShallowPermissionMetadata(input?.metadata, candidates);
  for (const candidate of candidates) {
    for (const toolName of UOS_PERMISSION_KNOWN_TOOLS) {
      if (candidate === toolName) return toolName;
      if (candidate.includes(toolName)) return toolName;
    }
  }
  return undefined;
}

async function hasValidGuiApproval(): Promise<boolean> {
  const approvalFile = envValue("UOS_GUI_APPROVAL_FILE");
  if (approvalFile === undefined) return false;
  try {
    const approval = JSON.parse(await fs.readFile(approvalFile, "utf8")) as any;
    if (approval?.version !== GUI_APPROVAL_VERSION) return false;
    if (approval?.status !== "approved") return false;
    const expiresAt = Date.parse(String(approval?.expiresAt ?? ""));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    const projectDir = envValue("UOS_PROJECT_DIR");
    if (projectDir !== undefined && path.resolve(String(approval?.projectDir ?? "")) !== path.resolve(projectDir)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function pushPermissionString(out: string[], value: unknown): void {
  if (typeof value === "string" && value.length > 0) out.push(value);
}

function collectPermissionStrings(value: unknown, out: string[]): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") out.push(item);
    }
  }
}

function collectShallowPermissionMetadata(value: unknown, out: string[]): void {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of ["tool", "toolID", "toolId", "toolName", "name", "command", "permission", "pattern"] as const) {
    pushPermissionString(out, (value as Record<string, unknown>)[key]);
  }
}

const createUosJournalPlugin: Plugin = async () => {
  return {
    "permission.ask": async (input, output) => {
      if (await shouldAutoAllowUosPermission(input)) {
        output.status = "allow";
      }
    },
    "tool.execute.after": async (input, output) => {
      try {
        if (!UOS_CONTEXT_TOOLS.has(input.tool)) return;
        const meta = (output?.metadata ?? {}) as any;
        if (meta.ok === false) return; // skip ops that failed
        if (meta.dryRun === true || input.args?.dryRun === true) return; // dry runs must not alter persisted context

        const dir = await resolveProjectDir();
        if (dir === undefined) return; // can't locate the project; silently skip

        const uos = path.join(dir, ".uos");
        const ts = new Date().toISOString();

        await enqueue(async () => {
          await fs.mkdir(uos, { recursive: true });

          // 1. append-only journal (shape-agnostic, with bulky binary payloads redacted)
          const record = {
            ts,
            tool: input.tool,
            sessionID: input.sessionID,
            callID: input.callID,
            args: sanitizeJournalValue(input.args),
            result: sanitizeJournalValue(meta),
            title: output?.title ?? "",
          };
          await fs.appendFile(
            path.join(uos, "work-journal.jsonl"),
            JSON.stringify(record) + "\n",
            "utf8",
          );

          // 2. rolling screen / element / scene-object / transition index
          const idxFile = path.join(uos, "screens.json");
          const idx = await readJson<ScreenIndex>(idxFile, emptyIndex());
          if (idx.screens === undefined) idx.screens = {};
          if (idx.sceneObjects === undefined) idx.sceneObjects = {};
          if (idx.transitions === undefined) idx.transitions = [];
          applyToIndex(idx, input.tool, input.args, meta, ts);
          idx.version = INDEX_VERSION;
          idx.updatedAt = ts;
          await writeJsonAtomic(idxFile, idx);

          // 3. project identity / AI entry marker
          const projFile = path.join(uos, "project.json");
          const prev = await readJson<{ createdAt?: string }>(projFile, {});
          await writeJsonAtomic(projFile, {
            projectPath: dir,
            projectName: path.basename(dir),
            createdAt: prev.createdAt ?? ts,
            updatedAt: ts,
            lastSessionID: input.sessionID,
            lastTool: input.tool,
          });
        });
      } catch {
        // journaling must never break the user's tool call
      }
    },
  };
};

export const UosJournalPlugin = Object.assign(createUosJournalPlugin, {
  applyToIndex,
  emptyIndex,
  sanitizeJournalValue,
  shouldAutoAllowUosPermission,
  hasValidGuiApproval,
  permissionToolName,
});
