/**
 * .opencode/plugin/uos.ts
 *
 * UOS (Unity Orchestration System) — Phase 1.
 *
 * Persists the work context of every successful UI mutation into the *connected
 * Unity project's own* folder, at `<projectRoot>/.uos/`, so the context travels
 * with the project (git-trackable) and can seed the AI on re-entry (Phase 3).
 *
 *   <projectRoot>/.uos/
 *     project.json        — identity + last-session marker
 *     work-journal.jsonl  — append-only log: one line per successful UI tool call
 *     screens.json        — rolling index of screens / elements / transitions
 *
 * The connected project's path is resolved from (in order):
 *   1. env UOS_PROJECT_DIR          — set by the `uos` launcher (Phase 2)
 *   2. bridge tool get_project_info — asks the live Unity Editor (Application.dataPath)
 *
 * Journaling is best-effort and fully isolated: any failure here is swallowed so
 * it can never break the user's actual tool call.
 */
import type { Plugin } from "@opencode-ai/plugin";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { call } from "../tools/_bridge";

// Only mutating UI tools produce work context worth journaling.
const UI_WRITE_TOOLS = new Set<string>([
  "create_ui_screen",
  "add_ui_element",
  "update_ui_element",
  "move_ui_element",
  "delete_ui_element",
  "create_screen_transition",
]);

const INDEX_VERSION = "1.0.0";

interface ElementRec {
  elementId: string;
  clientHintId?: string;
  type?: string;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

interface ScreenRec {
  screenId: string;
  screenName?: string;
  referenceCanvas?: { width: number; height: number };
  createdAt: string;
  updatedAt: string;
  elements: Record<string, ElementRec>;
}

interface TransitionRec {
  fromId: string;
  toId: string;
  trigger?: string;
  ts: string;
}

interface ScreenIndex {
  version: string;
  updatedAt: string;
  screens: Record<string, ScreenRec>;
  transitions: TransitionRec[];
}

function emptyIndex(): ScreenIndex {
  return { version: INDEX_VERSION, updatedAt: "", screens: {}, transitions: [] };
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
      // Unity backend may predate get_project_info, or the bridge is down — fall through.
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
  switch (tool) {
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

      // clientHintId -> intent element (to recover element `type`)
      const byHint = new Map<string, any>();
      for (const el of intent.elements ?? []) {
        if (el?.clientHintId) byHint.set(el.clientHintId, el);
      }
      for (const pair of meta?.elements ?? []) {
        const elementId: string | undefined = pair?.elementId;
        if (elementId === undefined) continue;
        const src = pair?.clientHintId ? byHint.get(pair.clientHintId) : undefined;
        screen.elements[elementId] = {
          elementId,
          clientHintId: pair?.clientHintId,
          type: src?.type,
          createdAt: ts,
          updatedAt: ts,
        };
      }
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
      screen.elements[elementId] = {
        elementId,
        type: args?.element?.type,
        createdAt: ts,
        updatedAt: ts,
      };
      screen.updatedAt = ts;
      idx.screens[screenId] = screen;
      return;
    }
    case "update_ui_element":
    case "move_ui_element": {
      const elementId: string | undefined = args?.elementId;
      if (elementId === undefined) return;
      const screen = findScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      screen.elements[elementId].updatedAt = ts;
      screen.updatedAt = ts;
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
    case "create_screen_transition": {
      if (!args?.fromId || !args?.toId) return;
      idx.transitions.push({ fromId: args.fromId, toId: args.toId, trigger: args.trigger, ts });
      return;
    }
  }
}

export default (async () => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (!UI_WRITE_TOOLS.has(input.tool)) return;
        const meta = (output?.metadata ?? {}) as any;
        if (meta.ok === false) return; // skip ops that failed

        const dir = await resolveProjectDir();
        if (dir === undefined) return; // can't locate the project → silently skip

        const uos = path.join(dir, ".uos");
        const ts = new Date().toISOString();

        await enqueue(async () => {
          await fs.mkdir(uos, { recursive: true });

          // 1. append-only journal (verbatim, shape-agnostic)
          const record = {
            ts,
            tool: input.tool,
            sessionID: input.sessionID,
            callID: input.callID,
            args: input.args,
            result: meta,
            title: output?.title ?? "",
          };
          await fs.appendFile(
            path.join(uos, "work-journal.jsonl"),
            JSON.stringify(record) + "\n",
            "utf8",
          );

          // 2. rolling screen / element / transition index
          const idxFile = path.join(uos, "screens.json");
          const idx = await readJson<ScreenIndex>(idxFile, emptyIndex());
          if (idx.screens === undefined) idx.screens = {};
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
}) satisfies Plugin;
