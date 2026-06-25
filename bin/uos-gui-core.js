import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { readLatestProductionBlueprint, listProductionBlueprints } from "./production-blueprint-core.js";
import { readOchestratorProgress } from "./ochestrator-progress-core.js";

const SECRET_KEYS = new Set([
  "token",
  "accessToken",
  "refreshToken",
  "password",
  "authorization",
  "UNITY_MCP_TOKEN",
]);

export const GUI_STATE_VERSION = "1.0.0";
export const GUI_APPROVAL_TTL_MS = 6 * 60 * 60 * 1000;
export const GUI_CONNECTION_STATUSES = new Set([
  "created",
  "launching",
  "waiting-bridge",
  "connected",
  "error",
  "closed",
]);

const guiConnectionWriteQueues = new Map();

export function normalizeGuiProjectPath(projectPath) {
  return String(projectPath ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

export function guiProjectId(projectPath) {
  const normalized = normalizeGuiProjectPath(projectPath);
  if (normalized.length === 0) return undefined;
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

export function redactSecrets(value, depth = 0) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  if (depth > 12) return "[redacted deep value]";
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key) || key.toLowerCase().includes("token")) {
      out[key] = typeof item === "string" && item.length > 0 ? "[redacted]" : item;
      continue;
    }
    out[key] = redactSecrets(item, depth + 1);
  }
  return out;
}

export function publicGuiProject(project) {
  const projectPath = typeof project?.projectPath === "string" ? project.projectPath : undefined;
  const id = guiProjectId(projectPath);
  const connection = publicGuiConnection(project?.connection);
  const externalBridge = publicExternalBridge(project?.externalBridge);
  const connectedBridge = project?.status === "connected" && project?.bridge?.live === true;
  return redactSecrets({
    ...project,
    connection,
    externalBridge,
    projectId: id,
    id,
    selected: false,
    bridge: {
      live: connectedBridge,
      editor: connectedBridge && project.bridge.editor !== undefined
        ? {
            instanceId: project.bridge.editor.instanceId,
            projectName: project.bridge.editor.projectName,
            projectPath: project.bridge.editor.projectPath,
            host: project.bridge.editor.host,
            port: project.bridge.editor.port,
            unityVersion: project.bridge.editor.unityVersion,
            uosPackageName: project.bridge.editor.uosPackageName,
            uosPackageVersion: project.bridge.editor.uosPackageVersion,
            protocolVersion: project.bridge.editor.protocolVersion,
            uosGuiSessionId: project.bridge.editor.uosGuiSessionId,
          }
        : undefined,
    },
  });
}

export function publicGuiProjectCatalog(catalog = {}) {
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  return {
    count: projects.length,
    projects: projects.map(publicGuiProject),
  };
}

export function findGuiProject(catalog = {}, projectId) {
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  return projects.find((project) => guiProjectId(project.projectPath) === projectId);
}

export function guiProjectTarget(project) {
  return guiConnectionTarget(project?.connection);
}

export function guiProjectBaseEnv(project, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (project?.projectPath !== undefined) {
    env.UOS_PROJECT_DIR = project.projectPath;
    env.UOS_CONTEXT_DIR = path.join(project.projectPath, ".uos");
    env.UNITY_MCP_MATERIALS_DIR ??= project.projectPath;
  }
  if (project?.projectName !== undefined) env.UOS_PROJECT_NAME = project.projectName;
  if (project?.bridge?.live !== true) {
    delete env.UNITY_MCP_HOST;
    delete env.UNITY_MCP_PORT;
    delete env.UNITY_MCP_TOKEN;
    delete env.UOS_EDITOR_INSTANCE_ID;
  }
  return env;
}

export function guiDir(projectDir) {
  return path.join(projectDir, ".uos", "gui");
}

export function guiConnectionPath(projectDir) {
  return path.join(guiDir(projectDir), "connection.json");
}

export function guiAuthFingerprint(secret) {
  if (typeof secret !== "string" || secret.length === 0) return undefined;
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

export function normalizeGuiConnection(input = {}, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const projectPath = firstString(input.projectPath, options.projectPath);
  const projectId = firstString(input.projectId) ?? guiProjectId(projectPath);
  const port = numberValue(input.port) ?? parsePort(String(input.port ?? ""));
  const status = GUI_CONNECTION_STATUSES.has(input.status) ? input.status : "created";
  return {
    version: input.version ?? GUI_STATE_VERSION,
    projectId,
    projectPath: projectPath !== undefined ? path.resolve(projectPath) : undefined,
    guiSessionId: firstString(input.guiSessionId),
    host: firstString(input.host) ?? "127.0.0.1",
    port,
    token: typeof input.token === "string" ? input.token : "",
    status,
    createdAt: firstString(input.createdAt) ?? now,
    updatedAt: firstString(input.updatedAt) ?? now,
    lastVerifiedAt: firstString(input.lastVerifiedAt),
    editorInstanceId: firstString(input.editorInstanceId),
    error: firstString(input.error),
  };
}

export function validateGuiConnection(connection) {
  const errors = [];
  if (connection === undefined || connection === null || typeof connection !== "object") {
    return { ok: false, errors: ["connection: must be an object"] };
  }
  if (connection.version !== GUI_STATE_VERSION) errors.push(`connection.version: must be ${GUI_STATE_VERSION}`);
  if (typeof connection.projectId !== "string" || connection.projectId.length === 0) errors.push("connection.projectId: required");
  if (typeof connection.projectPath !== "string" || connection.projectPath.length === 0) errors.push("connection.projectPath: required");
  if (typeof connection.guiSessionId !== "string" || connection.guiSessionId.length === 0) errors.push("connection.guiSessionId: required");
  if (typeof connection.host !== "string" || connection.host.length === 0) errors.push("connection.host: required");
  if (!Number.isInteger(connection.port) || connection.port <= 0) errors.push("connection.port: must be a positive integer");
  if (typeof connection.token !== "string" || connection.token.length === 0) errors.push("connection.token: required");
  if (!GUI_CONNECTION_STATUSES.has(connection.status)) errors.push("connection.status: invalid");
  if (Number.isNaN(Date.parse(String(connection.createdAt ?? "")))) errors.push("connection.createdAt: must be a date");
  if (Number.isNaN(Date.parse(String(connection.updatedAt ?? "")))) errors.push("connection.updatedAt: must be a date");
  if (connection.lastVerifiedAt !== undefined && Number.isNaN(Date.parse(String(connection.lastVerifiedAt)))) {
    errors.push("connection.lastVerifiedAt: must be a date");
  }
  return { ok: errors.length === 0, errors };
}

export async function readGuiConnection(projectDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(guiConnectionPath(projectDir), "utf8"));
    const connection = normalizeGuiConnection(parsed, { projectPath: projectDir });
    const validation = validateGuiConnection(connection);
    return validation.ok ? connection : { ...connection, status: "error", error: validation.errors.join("; ") };
  } catch (err) {
    if (err?.code === "ENOENT") return undefined;
    throw err;
  }
}

export async function writeGuiConnection(projectDir, connection) {
  const normalized = normalizeGuiConnection(connection, { projectPath: projectDir });
  const file = guiConnectionPath(projectDir);
  return await withGuiConnectionWriteLock(file, async () => {
    return await writeGuiConnectionUnlocked(file, normalized);
  });
}

async function writeGuiConnectionUnlocked(file, normalized) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    try {
      await fs.chmod(tmp, 0o600);
    } catch {
      // chmod is best-effort on Windows.
    }
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return { ok: true, connection: normalized, path: file };
}

export async function updateGuiConnection(projectDir, patch = {}) {
  const file = guiConnectionPath(projectDir);
  return await withGuiConnectionWriteLock(file, async () => {
    const current = await readGuiConnection(projectDir);
    const normalized = normalizeGuiConnection({
      ...(current ?? {}),
      ...patch,
      projectPath: patch.projectPath ?? current?.projectPath ?? projectDir,
      projectId: patch.projectId ?? current?.projectId ?? guiProjectId(projectDir),
      createdAt: patch.createdAt ?? current?.createdAt,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    }, { projectPath: projectDir });
    return await writeGuiConnectionUnlocked(file, normalized);
  });
}

function withGuiConnectionWriteLock(file, operation) {
  const previous = guiConnectionWriteQueues.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  guiConnectionWriteQueues.set(file, next);
  return next.finally(() => {
    if (guiConnectionWriteQueues.get(file) === next) {
      guiConnectionWriteQueues.delete(file);
    }
  });
}

export function publicGuiConnection(connection) {
  if (connection === undefined) return undefined;
  return {
    version: connection.version,
    projectId: connection.projectId,
    projectPath: connection.projectPath,
    guiSessionId: connection.guiSessionId,
    host: connection.host,
    port: connection.port,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
    editorInstanceId: connection.editorInstanceId,
    error: connection.error,
    authFingerprint: guiAuthFingerprint(connection.token),
  };
}

export function guiConnectionTarget(connection, options = {}) {
  if (connection === undefined) return undefined;
  if (options.requireConnected !== false && connection.status !== "connected") return undefined;
  const normalized = normalizeGuiConnection(connection);
  if (!validateGuiConnection(normalized).ok) return undefined;
  return {
    instanceId: normalized.editorInstanceId,
    projectName: firstString(options.projectName),
    projectPath: normalized.projectPath,
    host: normalized.host,
    port: normalized.port,
    token: normalized.token,
    uosGuiSessionId: normalized.guiSessionId,
  };
}

export function isGuiManagedEditorForConnection(editor, connection) {
  if (editor === undefined || connection === undefined) return false;
  return normalizeGuiProjectPath(editor.projectPath) === normalizeGuiProjectPath(connection.projectPath)
    && firstString(editor.uosGuiSessionId) === firstString(connection.guiSessionId);
}

export function guiSessionsPath(projectDir) {
  return path.join(guiDir(projectDir), "sessions.json");
}

export async function readGuiSessions(projectDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(guiSessionsPath(projectDir), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("sessions root must be an object");
    }
    return {
      version: parsed.version ?? GUI_STATE_VERSION,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch (err) {
    if (err?.code === "ENOENT") return { version: GUI_STATE_VERSION, sessions: [] };
    throw err;
  }
}

export async function writeGuiSessions(projectDir, data) {
  const file = guiSessionsPath(projectDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const next = {
    version: GUI_STATE_VERSION,
    sessions: Array.isArray(data?.sessions) ? data.sessions : [],
  };
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function upsertGuiSession(projectDir, session) {
  const data = await readGuiSessions(projectDir);
  const now = new Date().toISOString();
  const guiSessionId = session.guiSessionId ?? randomUUID();
  const nextSession = {
    createdAt: now,
    ...session,
    guiSessionId,
    updatedAt: now,
  };
  const without = data.sessions.filter((item) => item.guiSessionId !== guiSessionId);
  await writeGuiSessions(projectDir, { sessions: [...without, nextSession].slice(-50) });
  return nextSession;
}

export function guiUploadsDir(projectDir, guiSessionId) {
  return path.join(guiDir(projectDir), "uploads", guiSessionId);
}

export function guiProjectContextDir(projectDir) {
  return path.join(projectDir, ".uos", "context");
}

export function guiProjectContextPaths(projectDir) {
  const dir = guiProjectContextDir(projectDir);
  return {
    dir,
    projectBrief: path.join(dir, "project-brief.md"),
    currentState: path.join(dir, "current-state.md"),
    lightContext: path.join(dir, "light-context.json"),
    handoff: path.join(dir, "handoff.md"),
  };
}

export function materialKindForFile(filePath) {
  const ext = path.extname(String(filePath ?? "")).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) return "image";
  if (ext === ".pptx") return "pptx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return "video-media";
  return "file";
}

export function normalizeUploadedFileRecord(filePath) {
  return {
    path: filePath,
    name: path.basename(filePath),
    kind: materialKindForFile(filePath),
    analysisTarget: materialKindForFile(filePath) !== "video-media",
  };
}

export function parseOpencodeJsonEventLine(line) {
  const text = String(line ?? "").trim();
  if (text.length === 0) return undefined;
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    const providerOverload = parseProviderOverloadLog(text);
    if (providerOverload !== undefined) return providerOverload;
    return { type: "log", text };
  }
  return normalizeOpencodeEvent(event);
}

function parseProviderOverloadLog(text) {
  if (!/AI_APICallError:\s*Overloaded/i.test(text)) return undefined;
  return {
    type: "provider-overloaded",
    text,
    provider: regexGroup(text, /\bproviderID=([^\s]+)/),
    model: regexGroup(text, /\bmodelID=([^\s]+)/),
  };
}

function regexGroup(text, pattern) {
  const match = String(text ?? "").match(pattern);
  return match?.[1];
}

export function normalizeOpencodeEvent(event) {
  const sessionId = firstString(
    event?.sessionID,
    event?.sessionId,
    event?.session_id,
    event?.session?.id,
    event?.message?.sessionID,
    event?.metadata?.sessionID,
  );
  const tool = firstString(
    event?.tool,
    event?.toolName,
    event?.tool?.name,
    event?.part?.tool,
    event?.metadata?.tool,
  );
  const text = firstString(
    event?.text,
    event?.delta,
    event?.content,
    event?.message,
    event?.part?.text,
    event?.data?.text,
    event?.metadata?.summary,
  );
  const type = String(event?.type ?? event?.event ?? (tool !== undefined ? "tool" : text !== undefined ? "message" : "event"));
  const normalized = {
    type,
    sessionId,
    role: firstString(event?.role, event?.message?.role),
    text,
    tool,
    raw: redactSecrets(event),
  };
  for (const key of [
    "elapsedSeconds",
    "timeoutMs",
    "exitCode",
    "route",
    "provider",
    "model",
    "elapsedMs",
    "fallback",
    "choices",
    "projectInfo",
    "files",
    "args",
    "readiness",
    "connection",
  ]) {
    if (event?.[key] !== undefined) normalized[key] = redactSecrets(event[key]);
  }
  return normalized;
}

export function collectSessionIdFromEvents(events = []) {
  for (const event of events) {
    const sessionId = firstString(event?.sessionId);
    if (sessionId !== undefined) return sessionId;
  }
  return undefined;
}

export async function readGuiBlueprintSummary(projectDir) {
  const [latest, all] = await Promise.all([
    readLatestProductionBlueprint(projectDir).catch((err) => ({ ok: false, errors: [err instanceof Error ? err.message : String(err)] })),
    listProductionBlueprints(projectDir).catch(() => []),
  ]);
  return {
    latest,
    blueprints: Array.isArray(all) ? all : [],
  };
}

export async function readGuiActivity(projectDir) {
  const contextDir = path.join(projectDir, ".uos");
  const [progress, screens, project, connection, projectContext] = await Promise.all([
    readOchestratorProgress(projectDir).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) })),
    readJson(path.join(contextDir, "screens.json"), undefined),
    readJson(path.join(contextDir, "project.json"), undefined),
    readGuiConnection(projectDir).catch((err) => ({ status: "error", error: err instanceof Error ? err.message : String(err) })),
    readGuiLightContext(projectDir).catch(() => undefined),
  ]);
  return redactSecrets({
    progress,
    project,
    screens,
    connection: publicGuiConnection(connection),
    projectContext,
  });
}

export async function readGuiLightContext(projectDir) {
  return await readJson(guiProjectContextPaths(projectDir).lightContext, undefined);
}

export async function refreshGuiProjectContext(projectDir, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const contextDir = path.join(projectDir, ".uos");
  const paths = guiProjectContextPaths(projectDir);
  const [progress, screens, projectFile, connection, blueprintSummary, sessionsData] = await Promise.all([
    readOchestratorProgress(projectDir).catch(() => undefined),
    readJson(path.join(contextDir, "screens.json"), undefined),
    readJson(path.join(contextDir, "project.json"), undefined),
    readGuiConnection(projectDir).catch(() => undefined),
    readGuiBlueprintSummary(projectDir).catch(() => undefined),
    readGuiSessions(projectDir).catch(() => ({ sessions: [] })),
  ]);
  const publicConnection = publicGuiConnection(connection);
  const project = {
    name: firstString(options.project?.projectName, projectFile?.projectName, path.basename(projectDir)),
    path: path.resolve(projectDir),
    unityVersion: firstString(options.project?.unityVersion, projectFile?.unityVersion),
    status: firstString(options.project?.status),
    uosInstalled: options.project?.uos?.installed === true,
    uosInstallKind: firstString(options.project?.uos?.installKind),
    connected: options.project?.status === "connected" || connection?.status === "connected",
  };
  const screenList = summarizeScreensForLightContext(screens);
  const latestBlueprint = normalizeBlueprintSummary(blueprintSummary?.latest);
  const activeProgress = normalizeProgressSummary(progress);
  const latestSession = latestGuiSessionSummary(sessionsData.sessions);
  const nextActions = recommendGuiNextActions({
    project,
    screens: screenList,
    blueprint: latestBlueprint,
    progress: activeProgress,
    connection: publicConnection,
  });
  const lightContext = redactSecrets({
    version: GUI_STATE_VERSION,
    kind: "UosLightContext",
    generatedAt: now,
    project,
    connection: publicConnection,
    screens: {
      count: screenList.length,
      items: screenList,
    },
    blueprint: latestBlueprint,
    progress: activeProgress,
    lastSession: latestSession,
    nextActions,
    warnings: collectLightContextWarnings({ project, connection: publicConnection, blueprint: latestBlueprint }),
  });

  await fs.mkdir(paths.dir, { recursive: true });
  await Promise.all([
    fs.writeFile(paths.lightContext, `${JSON.stringify(lightContext, null, 2)}\n`, "utf8"),
    fs.writeFile(paths.projectBrief, formatProjectBrief(lightContext), "utf8"),
    fs.writeFile(paths.currentState, formatCurrentState(lightContext), "utf8"),
    fs.writeFile(paths.handoff, formatHandoff(lightContext), "utf8"),
  ]);
  return { ok: true, context: lightContext, paths };
}

export function classifyGuiChatRoute(message, lightContext = {}) {
  const text = normalizeMessageForRoute(message);
  if (text.length === 0) return { route: "light-local", reason: "empty" };
  if (hasFullWorkSignal(text)) return { route: "full-ochestrator", reason: "work-request" };
  if (hasLightModelSignal(text)) return { route: "light-model", reason: "natural-summary" };
  if (hasLightLocalSignal(text)) return { route: "light-local", reason: "local-info" };
  if (lightContext?.project !== undefined && text.length <= 80 && /^(지금|현재|다음|추천|상태|연결|프로젝트|화면)/.test(text)) {
    return { route: "light-local", reason: "short-status" };
  }
  return { route: "light-model", reason: "default-general-chat" };
}

export function formatGuiLightLocalReply(message, lightContext = {}, route = {}) {
  const text = normalizeMessageForRoute(message);
  const projectName = lightContext?.project?.name ?? "선택한 프로젝트";
  const connected = lightContext?.project?.connected === true || lightContext?.connection?.status === "connected";
  const screenCount = Number.isInteger(lightContext?.screens?.count) ? lightContext.screens.count : 0;
  const blueprint = lightContext?.blueprint;
  const actions = Array.isArray(lightContext?.nextActions) && lightContext.nextActions.length > 0
    ? lightContext.nextActions
    : ["기획 자료 첨부", "현재 상태 확인", "Production Blueprint 초안 작성"];

  if (/^(안녕|안녕하세요|하이|hi|hello|hey|반가워)/i.test(text)) {
    return [
      `안녕하세요. ${projectName} 작업을 도와드릴 수 있습니다.`,
      connected ? "Unity는 연결되어 있습니다." : "Unity 작업을 시작하려면 Projects에서 Unity를 열어 Connected 상태로 만들어야 합니다.",
      `추천 작업: ${actions.slice(0, 3).join(" / ")}`,
    ].join("\n");
  }

  if (hasRoleQuestionSignal(text)) {
    return [
      "저는 UOS Ochestrator입니다.",
      "기획자의 의도를 정리하고, 필요한 경우 Production Blueprint를 만든 뒤, 승인된 작업만 Unity Editor에 반영하도록 돕습니다.",
      "가벼운 안내와 현재 상태 질문은 바로 답하고, 자료 해석이나 화면 제작처럼 무거운 작업만 전체 Ochestrator 실행으로 넘깁니다.",
      connected
        ? `${projectName}은 현재 Unity와 연결되어 있어 제작 작업을 진행할 수 있습니다.`
        : `${projectName}은 아직 Unity와 연결되지 않았습니다. 제작 작업은 Projects 탭에서 Unity를 열어 Connected 상태가 된 뒤 진행됩니다.`,
    ].join("\n");
  }

  if (/(뭐 할 수|무엇을 할 수|가능|도움|사용법|help|메뉴)/i.test(text)) {
    return [
      "UOS에서는 다음 작업을 할 수 있습니다.",
      "- 기획 자료(PPTX/PDF/DOCX/이미지) 해석",
      "- Unity 화면, 버튼, 이미지, 전환 구성",
      "- 비디오를 재생 가능한 미디어 화면으로 배치",
      "- Production Blueprint 검토와 승인",
      "- 현재 프로젝트 상태와 다음 작업 정리",
      connected ? "Unity 연결이 되어 있어 제작 작업을 진행할 수 있습니다." : "현재는 가벼운 안내만 가능하며, 제작 작업은 Unity 연결 후 진행됩니다.",
    ].join("\n");
  }

  if (/(연결|connected|bridge)/i.test(text)) {
    return connected
      ? `${projectName}은 현재 GUI-managed Unity bridge에 연결되어 있습니다.`
      : `${projectName}은 아직 GUI-managed Unity bridge에 연결되어 있지 않습니다. Projects 탭에서 Unity 열기를 눌러 주세요.`;
  }

  if (/(다음|추천|뭘 하면|뭐 하면|할 일|작업)/i.test(text)) {
    return [
      `${projectName}의 다음 추천 작업입니다.`,
      ...actions.slice(0, 3).map((item, index) => `${index + 1}. ${item}`),
      "원하는 항목을 말해주면 필요한 경우 제작 단계로 넘기겠습니다.",
    ].join("\n");
  }

  return [
    `${projectName} 현재 상태입니다.`,
    `- Unity 연결: ${connected ? "Connected" : "연결 대기"}`,
    `- 화면 수: ${screenCount}`,
    `- Blueprint: ${blueprint?.title ?? blueprint?.id ?? "없음"}${blueprint?.status ? ` (${blueprint.status})` : ""}`,
    `- 다음 작업: ${actions.slice(0, 3).join(" / ")}`,
  ].join("\n");
}

function summarizeScreensForLightContext(screens) {
  const values = screens?.screens !== undefined && typeof screens.screens === "object"
    ? Object.values(screens.screens)
    : [];
  return values.slice(0, 20).map((screen) => ({
    id: firstString(screen?.id, screen?.screenId),
    name: firstString(screen?.name, screen?.screenName, screen?.title),
    active: screen?.active === true,
    elementCount: Array.isArray(screen?.elements) ? screen.elements.length : undefined,
  })).filter((screen) => screen.id !== undefined || screen.name !== undefined);
}

function normalizeBlueprintSummary(latest) {
  const blueprint = latest?.blueprint ?? latest;
  if (blueprint === undefined || blueprint === null || typeof blueprint !== "object") return undefined;
  return {
    id: firstString(blueprint.id),
    title: firstString(blueprint.title),
    status: firstString(blueprint.status),
    modeId: firstString(blueprint.modeId),
    recipeId: firstString(blueprint.recipeId),
    ambiguity: typeof blueprint.ambiguity?.estimate === "number" ? blueprint.ambiguity.estimate : undefined,
    path: firstString(latest?.path),
  };
}

function normalizeProgressSummary(progress) {
  if (progress === undefined || progress === null || typeof progress !== "object" || progress.ok === false) return undefined;
  return {
    status: firstString(progress.status),
    modeId: firstString(progress.modeId),
    taskTitle: firstString(progress.taskTitle, progress.title),
    currentStep: firstString(progress.currentStep),
    nextAction: firstString(progress.nextAction),
    updatedAt: firstString(progress.updatedAt),
  };
}

function latestGuiSessionSummary(sessions = []) {
  const latest = [...sessions].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0];
  if (latest === undefined) return undefined;
  return {
    guiSessionId: firstString(latest.guiSessionId),
    hasOpencodeSession: firstString(latest.opencodeSessionId) !== undefined,
    updatedAt: firstString(latest.updatedAt),
    lastExitCode: latest.lastExitCode,
  };
}

function recommendGuiNextActions({ project, screens, blueprint, progress, connection }) {
  if (connection?.status !== "connected" && project?.connected !== true) {
    return ["Projects 탭에서 Unity 열기", "연결 후 현재 상태 확인", "기획 자료 첨부"];
  }
  if (progress?.nextAction !== undefined) return [progress.nextAction, "현재 상태 확인", "작업 완료 요약 확인"];
  if (blueprint?.status === "needs-approval" || blueprint?.status === "draft") {
    return ["Production Blueprint 검토", "일부 수정 요청", "승인하고 제작 진행"];
  }
  if (screens.length > 0) return ["현재 화면 미리보기 확인", "화면 수정 요청", "다음 화면 또는 전환 추가"];
  return ["기획 자료 첨부", "Production Blueprint 초안 작성", "첫 화면 제작 요청"];
}

function collectLightContextWarnings({ project, connection, blueprint }) {
  const warnings = [];
  if (project?.uosInstalled !== true) warnings.push("UOS package is not installed in this project.");
  if (connection?.status !== "connected") warnings.push("Unity bridge is not connected.");
  if (blueprint?.status === "approved" && typeof blueprint.ambiguity === "number" && blueprint.ambiguity > 20) {
    warnings.push("Approved blueprint has ambiguity above 20 percent.");
  }
  return warnings;
}

function formatProjectBrief(context) {
  return [
    "# UOS Project Brief",
    "",
    "> Generated cache. Do not treat this file as user-authored memory.",
    "",
    `- Project: ${context.project?.name ?? "Unknown"}`,
    `- Path: ${context.project?.path ?? "Unknown"}`,
    `- Unity: ${context.project?.unityVersion ?? "Unknown"}`,
    `- UOS install: ${context.project?.uosInstalled ? context.project?.uosInstallKind ?? "installed" : "not installed"}`,
    "",
  ].join("\n");
}

function formatCurrentState(context) {
  const blueprint = context.blueprint;
  return [
    "# UOS Current State",
    "",
    `Generated: ${context.generatedAt}`,
    "",
    `- Unity connection: ${context.connection?.status ?? "unknown"}`,
    `- Screens: ${context.screens?.count ?? 0}`,
    `- Blueprint: ${blueprint?.title ?? blueprint?.id ?? "none"}${blueprint?.status ? ` (${blueprint.status})` : ""}`,
    `- Progress: ${context.progress?.taskTitle ?? context.progress?.status ?? "none"}`,
    "",
    "## Next Actions",
    ...(context.nextActions ?? []).map((item, index) => `${index + 1}. ${item}`),
    "",
  ].join("\n");
}

function formatHandoff(context) {
  return [
    "# UOS Handoff",
    "",
    `Project: ${context.project?.name ?? "Unknown"}`,
    `Connection: ${context.connection?.status ?? "unknown"}`,
    `Screens: ${context.screens?.count ?? 0}`,
    `Blueprint: ${context.blueprint?.title ?? context.blueprint?.id ?? "none"}`,
    "",
    "Next:",
    ...(context.nextActions ?? []).slice(0, 3).map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function normalizeMessageForRoute(message) {
  return String(message ?? "").trim().toLowerCase();
}

function hasRoleQuestionSignal(text) {
  return /(너의\s*역할|네\s*역할|너는\s*누구|넌\s*누구|너\s*뭐|자기\s*소개|자기소개|소개해|소개해줘|uos\s*소개|uos를\s*소개|uos가\s*뭐|ochestrator|오케스트레이터|정체)/i.test(text);
}

function hasLightLocalSignal(text) {
  return /^(안녕|안녕하세요|하이|hi|hello|hey|반가워)/i.test(text)
    || hasRoleQuestionSignal(text)
    || /(뭐 할 수|무엇을 할 수|가능|도움|사용법|help|메뉴|연결|connected|bridge|다음|추천|뭘 하면|뭐 하면|할 일|현재 상태|상태 알려)/i.test(text);
}

function hasLightModelSignal(text) {
  return /(자연스럽게|간단히 요약|요약해|설명해|브리핑)/i.test(text)
    && /(현재|상태|프로젝트|진행|컨텍스트|상황)/i.test(text);
}

function hasFullWorkSignal(text) {
  return /(만들|생성|제작|수정|변경|추가|삭제|저장|배치|가져오|import|읽고|분석|해석|기획서|pptx?|pdf|docx|이미지|비디오|영상|화면|버튼|전환|transition|blueprint|청사진|recipe|레시피|빌드|검증|preview|미리보기)/i.test(text)
    && !/(현재 상태|연결 상태|뭐 할 수|무엇을 할 수|도움|사용법|추천|다음).{0,12}(알려|보여|설명|요약)/i.test(text);
}

export async function createGuiApproval(projectDir, input = {}, options = {}) {
  const approvalId = input.approvalId ?? randomUUID();
  const nowMs = options.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const file = path.join(guiDir(projectDir), "approvals", `${safeFilePart(approvalId)}.json`);
  const approval = {
    version: GUI_STATE_VERSION,
    approvalId,
    projectDir: path.resolve(projectDir),
    projectId: guiProjectId(projectDir),
    type: input.type ?? "gui-approval",
    status: "approved",
    source: input.source,
    createdAt: now,
    expiresAt: new Date(nowMs + (options.ttlMs ?? GUI_APPROVAL_TTL_MS)).toISOString(),
    approvedBy: "uos-gui",
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  return { ok: true, approval, path: file };
}

export function validateGuiApproval(approval, options = {}) {
  const errors = [];
  const nowMs = options.nowMs ?? Date.now();
  if (approval === undefined || approval === null || typeof approval !== "object") {
    errors.push("approval: must be an object");
  } else {
    if (approval.version !== GUI_STATE_VERSION) errors.push(`approval.version: must be ${GUI_STATE_VERSION}`);
    if (approval.status !== "approved") errors.push('approval.status: must be "approved"');
    const expectedProjectDir = firstString(options.projectDir);
    if (expectedProjectDir !== undefined && path.resolve(String(approval.projectDir ?? "")) !== path.resolve(expectedProjectDir)) {
      errors.push("approval.projectDir: does not match selected project");
    }
    const expiresAt = Date.parse(String(approval.expiresAt ?? ""));
    if (!Number.isFinite(expiresAt)) errors.push("approval.expiresAt: must be a date");
    else if (expiresAt <= nowMs) errors.push("approval.expiresAt: expired");
  }
  return { ok: errors.length === 0, errors };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function publicExternalBridge(bridge) {
  if (bridge === undefined) return undefined;
  return {
    live: bridge.live === true,
    editor: bridge.editor !== undefined
      ? {
          instanceId: bridge.editor.instanceId,
          projectName: bridge.editor.projectName,
          projectPath: bridge.editor.projectPath,
          host: bridge.editor.host,
          port: bridge.editor.port,
          unityVersion: bridge.editor.unityVersion,
          uosPackageName: bridge.editor.uosPackageName,
          uosPackageVersion: bridge.editor.uosPackageVersion,
          protocolVersion: bridge.editor.protocolVersion,
          uosGuiSessionId: bridge.editor.uosGuiSessionId,
        }
      : undefined,
  };
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function parsePort(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function safeFilePart(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || randomUUID();
}
