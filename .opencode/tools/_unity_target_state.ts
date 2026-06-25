import { promises as fs } from "node:fs";
import * as path from "node:path";

const STATE_VERSION = "1.0.0";

export interface UnityTargetEntry {
  instanceId?: string;
  projectName?: string;
  projectPath?: string;
  host?: string;
  port?: number;
  token?: string;
  unityVersion?: string;
  uosPackageName?: string;
  uosPackageVersion?: string;
  protocolVersion?: string;
  autoStartBridge?: boolean;
}

export interface ActiveUnityTargetState {
  version: string;
  selectedAt: string;
  source: "env" | "session" | "gui";
  target: UnityTargetEntry;
  stateFile?: string;
}

export function unityTargetStateFile(
  env: Record<string, string | undefined> = processEnv(),
  cwd = defaultCwd(),
): string {
  const explicit = stringValue(env.UOS_TARGET_SESSION_FILE);
  if (explicit !== undefined) return path.resolve(explicit);
  const contextDir = stringValue(env.UOS_CONTEXT_DIR)
    ?? (stringValue(env.UOS_PROJECT_DIR) !== undefined
      ? path.join(stringValue(env.UOS_PROJECT_DIR) as string, ".uos")
      : path.join(cwd, ".uos"));
  return path.join(contextDir, "ochestrator", "unity-target-session.json");
}

export async function readActiveUnityTarget(options: {
  env?: Record<string, string | undefined>;
  cwd?: string;
  stateFile?: string;
} = {}): Promise<ActiveUnityTargetState | undefined> {
  const env = options.env ?? processEnv();
  const guiConnectionFile = stringValue(env.UOS_GUI_CONNECTION_FILE);
  if (guiConnectionFile !== undefined) {
    return await readGuiConnectionTarget(guiConnectionFile);
  }
  const stateFile = options.stateFile ?? unityTargetStateFile(env, options.cwd);
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, "utf8")) as unknown;
    const target = normalizeUnityTarget((parsed as any)?.target);
    if (target !== undefined) {
      return {
        version: stringValue((parsed as any)?.version) ?? STATE_VERSION,
        selectedAt: stringValue((parsed as any)?.selectedAt) ?? "",
        source: "session",
        target,
        stateFile,
      };
    }
  } catch {
    // Missing or unreadable session target state falls back to launcher env.
  }

  const envTarget = unityTargetFromEnv(env);
  return envTarget !== undefined
    ? { version: STATE_VERSION, selectedAt: "", source: "env", target: envTarget }
    : undefined;
}

async function readGuiConnectionTarget(connectionFile: string): Promise<ActiveUnityTargetState | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.resolve(connectionFile), "utf8")) as any;
    if (parsed?.status !== "connected") return undefined;
    const target = normalizeUnityTarget({
      instanceId: parsed.editorInstanceId,
      projectName: parsed.projectName,
      projectPath: parsed.projectPath,
      host: parsed.host,
      port: parsed.port,
      token: parsed.token,
    });
    if (target === undefined) return undefined;
    return {
      version: stringValue(parsed.version) ?? STATE_VERSION,
      selectedAt: stringValue(parsed.lastVerifiedAt) ?? stringValue(parsed.updatedAt) ?? "",
      source: "gui",
      target,
      stateFile: path.resolve(connectionFile),
    };
  } catch {
    return undefined;
  }
}

export async function writeActiveUnityTarget(
  target: UnityTargetEntry,
  options: {
    env?: Record<string, string | undefined>;
    cwd?: string;
    stateFile?: string;
    now?: () => Date;
  } = {},
): Promise<ActiveUnityTargetState> {
  const normalized = normalizeUnityTarget(target);
  if (normalized === undefined) {
    throw new Error("select_unity_project: selected target is missing bridge host/port");
  }
  const env = options.env ?? processEnv();
  const stateFile = options.stateFile ?? unityTargetStateFile(env, options.cwd);
  const state: ActiveUnityTargetState = {
    version: STATE_VERSION,
    selectedAt: (options.now ?? (() => new Date()))().toISOString(),
    source: "session",
    target: normalized,
    stateFile,
  };
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  try {
    await fs.chmod(tmp, 0o600);
  } catch {
    // chmod is best-effort on Windows.
  }
  await fs.rename(tmp, stateFile);
  applyUnityTargetToEnv(normalized, env, stateFile);
  return state;
}

export function applyUnityTargetToEnv(
  target: UnityTargetEntry,
  env: Record<string, string | undefined> = processEnv(),
  stateFile?: string,
): void {
  if (target.host !== undefined) env.UNITY_MCP_HOST = target.host;
  if (target.port !== undefined) env.UNITY_MCP_PORT = String(target.port);
  env.UNITY_MCP_TOKEN = target.token ?? "";
  env.UOS_PROJECT_DIR = target.projectPath ?? "";
  env.UOS_PROJECT_NAME = target.projectName ?? "";
  env.UOS_CONTEXT_DIR = target.projectPath !== undefined ? path.join(target.projectPath, ".uos") : "";
  env.UOS_EDITOR_INSTANCE_ID = target.instanceId ?? "";
  if (stateFile !== undefined) env.UOS_TARGET_SESSION_FILE = stateFile;
}

export function publicUnityTarget(target: UnityTargetEntry, index?: number): Record<string, unknown> {
  return {
    index,
    instanceId: target.instanceId,
    projectName: target.projectName,
    projectPath: target.projectPath,
    host: target.host,
    port: target.port,
    unityVersion: target.unityVersion,
    uosPackageName: target.uosPackageName,
    uosPackageVersion: target.uosPackageVersion,
    protocolVersion: target.protocolVersion,
    autoStartBridge: target.autoStartBridge,
    selectors: selectorValues(target),
  };
}

export function sameUnityTarget(a: UnityTargetEntry | undefined, b: UnityTargetEntry | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.instanceId !== undefined && b.instanceId !== undefined) {
    return equals(a.instanceId, b.instanceId);
  }
  if (a.projectPath !== undefined && b.projectPath !== undefined) {
    return normalizePath(a.projectPath) === normalizePath(b.projectPath);
  }
  return a.host !== undefined
    && b.host !== undefined
    && equals(a.host, b.host)
    && a.port !== undefined
    && b.port !== undefined
    && a.port === b.port;
}

export function targetConfigKey(target: UnityTargetEntry): string {
  return [
    target.host ?? "",
    target.port !== undefined ? String(target.port) : "",
    target.token ?? "",
  ].join(":");
}

function unityTargetFromEnv(env: Record<string, string | undefined>): UnityTargetEntry | undefined {
  const host = stringValue(env.UNITY_MCP_HOST);
  const port = parsePort(env.UNITY_MCP_PORT);
  if (host === undefined || port === undefined) return undefined;
  return normalizeUnityTarget({
    host,
    port,
    token: stringValue(env.UNITY_MCP_TOKEN) ?? "",
    projectPath: stringValue(env.UOS_PROJECT_DIR),
    projectName: stringValue(env.UOS_PROJECT_NAME),
    instanceId: stringValue(env.UOS_EDITOR_INSTANCE_ID),
  });
}

function normalizeUnityTarget(value: unknown): UnityTargetEntry | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const host = stringValue(raw.host);
  const port = numberValue(raw.port) ?? parsePort(typeof raw.port === "string" ? raw.port : undefined);
  if (host === undefined || port === undefined) return undefined;
  return {
    instanceId: stringValue(raw.instanceId),
    projectName: stringValue(raw.projectName),
    projectPath: stringValue(raw.projectPath),
    host,
    port,
    token: typeof raw.token === "string" ? raw.token : "",
    unityVersion: stringValue(raw.unityVersion),
    uosPackageName: stringValue(raw.uosPackageName),
    uosPackageVersion: stringValue(raw.uosPackageVersion),
    protocolVersion: stringValue(raw.protocolVersion),
    autoStartBridge: typeof raw.autoStartBridge === "boolean" ? raw.autoStartBridge : undefined,
  };
}

function selectorValues(entry: UnityTargetEntry): string[] {
  return [
    entry.instanceId,
    entry.projectName,
    entry.projectPath,
    entry.projectPath !== undefined ? normalizePath(entry.projectPath) : undefined,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function parsePort(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizePath(value: string): string {
  return path.normalize(value.trim()).replace(/[\\/]+$/, "").toLowerCase();
}

function equals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function processEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

function defaultCwd(): string {
  return (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? ".";
}
