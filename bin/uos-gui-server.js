import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  buildForwardArgs,
  buildLaunchEnv,
  callUnityTool,
  cleanupRunContextAttachment,
  configureUnityExecutableForGui,
  discoverUnityProjectCatalog,
  evaluateLaunchBridgeCapabilities,
  formatLaunchBridgeCapabilityFailure,
  installUnityPackage,
  launchUnityProject,
  prepareRunContextAttachment,
  uninstallUnityPackage,
} from "./uos-core.js";
import {
  classifyGuiChatRoute,
  collectSessionIdFromEvents,
  createGuiApproval,
  formatGuiLightLocalReply,
  findGuiProject,
  guiConnectionPath,
  guiConnectionTarget,
  guiProjectId,
  guiProjectBaseEnv,
  guiUploadsDir,
  isGuiManagedEditorForConnection,
  normalizeUploadedFileRecord,
  parseOpencodeJsonEventLine,
  publicGuiProjectCatalog,
  publicGuiConnection,
  readGuiConnection,
  readGuiActivity,
  readGuiBlueprintSummary,
  readGuiLightContext,
  readGuiSessions,
  redactSecrets,
  refreshGuiProjectContext,
  updateGuiConnection,
  upsertGuiSession,
  writeGuiConnection,
} from "./uos-gui-core.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultStaticDir = path.join(repoRoot, "gui", "dist");
const activeSessions = new Map();

export async function runUosGui(options = {}) {
  const server = await startUosGuiServer(options);
  const url = server.url;
  if (options.open !== false) {
    openBrowser(url, options);
  }
  const log = options.log ?? console.error;
  log(`[uos gui] ${url}`);
  return server;
}

export async function startUosGuiServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const staticDir = options.staticDir ?? defaultStaticDir;
  const port = Number.isInteger(options.port) ? options.port : 0;
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/api/")) {
        await handleApi(req, res, { ...options, staticDir });
        return;
      }
      await serveStatic(req, res, staticDir);
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const match = new URL(req.url ?? "/", `http://${host}`).pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (match === null) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const session = ensureMemorySession(match[1]);
      session.clients.add(ws);
      for (const event of session.events.slice(-200)) {
        ws.send(JSON.stringify(event));
      }
      ws.on("close", () => session.clients.delete(ws));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    server,
    wss,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve) => {
      wss.close(() => server.close(resolve));
    }),
  };
}

async function handleApi(req, res, options) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const method = req.method ?? "GET";
  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, app: "uos-gui", repoRoot });
    return;
  }
  if (method === "GET" && url.pathname === "/api/projects") {
    const catalog = await loadCatalog(options);
    sendJson(res, 200, { ok: true, ...publicGuiProjectCatalog(catalog) });
    return;
  }

  const projectAction = url.pathname.match(/^\/api\/projects\/([^/]+)\/([^/]+)$/);
  if (projectAction !== null && method === "POST") {
    const [, projectId, action] = projectAction;
    const catalog = await loadCatalog(options);
    const project = findGuiProject(catalog, projectId);
    if (project === undefined) {
      sendJson(res, 404, { ok: false, error: "project not found" });
      return;
    }
    if (action === "install") {
      const result = await installUnityPackage({ projectPath: project.projectPath, repoRoot });
      sendJson(res, 200, { ok: true, result: redactSecrets(result) });
      return;
    }
    if (action === "uninstall") {
      const result = await uninstallUnityPackage({ projectPath: project.projectPath, repoRoot });
      sendJson(res, 200, { ok: true, result: redactSecrets(result) });
      return;
    }
    if (action === "open-unity") {
      const body = await readJsonBody(req);
      const connection = await createLaunchingGuiConnection(project, projectId, options);
      const launchUnityProjectImpl = options.launchUnityProject ?? launchUnityProject;
      const result = await launchUnityProjectImpl(project.projectPath, {
        ...options,
        unityPath: body.unityExecutable,
        unityEnv: {
          UOS_BRIDGE_HOST: connection.host,
          UOS_BRIDGE_PORT: String(connection.port),
          UOS_BRIDGE_TOKEN: connection.token,
          UOS_GUI_SESSION_ID: connection.guiSessionId,
        },
      });
      const nextConnection = result.ok === true
        ? (await updateGuiConnection(project.projectPath, {
            status: "waiting-bridge",
            error: undefined,
          })).connection
        : (await updateGuiConnection(project.projectPath, {
            status: "error",
            error: result.error ?? "Unity launch failed",
          })).connection;
      await refreshGuiProjectContext(project.projectPath, { project }).catch(() => {});
      sendJson(res, result.ok ? 200 : 409, {
        ok: result.ok === true,
        result: redactSecrets(result),
        connection: publicGuiConnection(nextConnection),
      });
      return;
    }
    if (action === "unity-executable") {
      const body = await readJsonBody(req);
      const result = await configureUnityExecutableForGui({
        projectPath: project.projectPath,
        unityExecutable: body.unityExecutable,
        default: body.default,
      }, options);
      sendJson(res, 200, { ok: true, result: redactSecrets(result) });
      return;
    }
  }

  if (method === "POST" && url.pathname === "/api/sessions") {
    const body = await readJsonBody(req);
    const catalog = await loadCatalog(options);
    const project = findGuiProject(catalog, body.projectId);
    if (project === undefined) {
      sendJson(res, 404, { ok: false, error: "project not found" });
      return;
    }
    const session = await upsertGuiSession(project.projectPath, {
      projectId: body.projectId,
      projectPath: project.projectPath,
      projectName: project.projectName,
      attachedFiles: [],
      opencodeSessionId: undefined,
    });
    await refreshGuiProjectContext(project.projectPath, { project }).catch(() => {});
    activeSessions.set(session.guiSessionId, {
      ...session,
      project,
      events: [],
      clients: new Set(),
    });
    sendJson(res, 200, { ok: true, session: publicSession(session) });
    return;
  }

  const sessionRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (sessionRoute !== null) {
    const [, guiSessionId, action = "context"] = sessionRoute;
    const session = ensureMemorySession(guiSessionId);
    const project = await refreshSessionProject(session, options);
    if (project === undefined) {
      sendJson(res, 404, { ok: false, error: "session project not found" });
      return;
    }
    if (method === "GET" && action === "context") {
      sendJson(res, 200, { ok: true, session: publicSession(session), project: redactSecrets(project) });
      return;
    }
    if (method === "POST" && action === "files") {
      const body = await readJsonBody(req, { limitBytes: 80 * 1024 * 1024 });
      const files = await saveUploadedFiles(project.projectPath, guiSessionId, body);
      session.attachedFiles = [...new Set([...(session.attachedFiles ?? []), ...files.map((file) => file.path)])];
      await persistSession(project.projectPath, session);
      emitSessionEvent(session, { type: "files", files });
      sendJson(res, 200, { ok: true, files });
      return;
    }
    if (method === "POST" && action === "messages") {
      const body = await readJsonBody(req);
      const message = typeof body.message === "string" && body.message.trim().length > 0
        ? body.message.trim()
        : undefined;
      if (message === undefined) {
        sendJson(res, 400, { ok: false, error: "message is required" });
        return;
      }
      const contextResult = await refreshGuiProjectContext(project.projectPath, { project }).catch(() => undefined);
      const lightContext = contextResult?.context ?? await readGuiLightContext(project.projectPath).catch(() => undefined) ?? {};
      const route = classifyGuiChatRoute(message, lightContext);
      emitSessionEvent(session, { type: "chat-route", route: route.route, reason: route.reason });
      if (route.route === "light-local") {
        emitSessionEvent(session, {
          type: "text",
          route: route.route,
          text: formatGuiLightLocalReply(message, lightContext, route),
        });
      } else if (route.route === "light-model") {
        runLightModelTurn(session, project, message, lightContext, options).catch((err) => {
          emitSessionEvent(session, { type: "error", route: "light-model", text: err instanceof Error ? err.message : String(err) });
        });
      } else if (!isGuiProjectConnected(project)) {
        emitSessionEvent(session, {
          type: "full-blocked",
          route: "full-ochestrator",
          text: "Unity 제작/수정 작업은 GUI-managed Unity 연결이 필요합니다. Projects 탭에서 Unity 열기를 눌러 Connected 상태로 만든 뒤 다시 요청해 주세요.",
        });
      } else {
        runHeadlessTurn(session, project, message, options).catch((err) => {
          emitSessionEvent(session, { type: "error", route: "full-ochestrator", text: err instanceof Error ? err.message : String(err) });
        });
      }
      sendJson(res, 202, { ok: true, session: publicSession(session) });
      return;
    }
    if (method === "GET" && action === "blueprints") {
      sendJson(res, 200, { ok: true, ...(await readGuiBlueprintSummary(project.projectPath)) });
      return;
    }
    if (method === "POST" && action === "approvals") {
      const body = await readJsonBody(req);
      const approval = await createGuiApproval(project.projectPath, body);
      session.currentApproval = approval;
      await persistSession(project.projectPath, session);
      emitSessionEvent(session, { type: "approval", approval: redactSecrets(approval) });
      sendJson(res, 200, approval);
      return;
    }
    if (method === "GET" && action === "activity") {
      sendJson(res, 200, { ok: true, activity: await readGuiActivity(project.projectPath), events: session.events.slice(-200) });
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}

async function runHeadlessTurn(session, project, message, options) {
  if (session.running === true) {
    emitSessionEvent(session, { type: "error", text: "A UOS turn is already running." });
    return;
  }
  session.running = true;
  emitSessionEvent(session, { type: "run-start", text: message });
  const turnApproval = await prepareGuiTurnApproval(session, project, message, options);
  const baseEnv = guiProjectBaseEnv(project, options.env ?? process.env);
  if (turnApproval?.path !== undefined) {
    baseEnv.UOS_GUI_APPROVAL_ID = turnApproval.approval?.approvalId ?? "";
    baseEnv.UOS_GUI_APPROVAL_FILE = turnApproval.path;
  }
  baseEnv.UOS_GUI_MODE = "1";
  baseEnv.UOS_GUI_CONNECTION_FILE = guiConnectionPath(project.projectPath);
  delete baseEnv.UOS_TARGET_SESSION_FILE;
  const launchInputs = {
    files: Array.isArray(session.attachedFiles) ? session.attachedFiles : [],
  };
  let attachment;
  const parsedEvents = [];
  let child;
  try {
    const connection = await readGuiConnection(project.projectPath);
    const target = guiConnectionTarget(connection, { projectName: project.projectName });
    if (target === undefined) {
      emitSessionEvent(session, {
        type: "bridge-blocked",
        text: "GUI-managed Unity connection is not ready. Open this project from the UOS GUI, wait until it shows Connected, then try again.",
        connection: redactSecrets(connection),
      });
      return;
    }
    emitSessionEvent(session, {
      type: "bridge-preflight",
      text: "Checking Unity bridge before starting Ochestrator.",
    });
    const callUnityToolImpl = options.callUnityTool ?? callUnityTool;
    let projectInfo;
    try {
      projectInfo = await callUnityToolImpl(target, "get_project_info", {}, {
        timeoutMs: options.bridgePreflightTimeoutMs ?? 5_000,
      });
    } catch (err) {
      await updateGuiConnection(project.projectPath, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      emitSessionEvent(session, {
        type: "bridge-blocked",
        text: "The GUI-managed Unity connection failed verification. Close this Unity Editor and reopen it from the UOS GUI.",
      });
      return;
    }
    await updateGuiConnection(project.projectPath, {
      status: "connected",
      lastVerifiedAt: new Date().toISOString(),
      error: undefined,
    });
    emitSessionEvent(session, {
      type: "bridge-ready",
      text: `Unity bridge is available for ${projectInfo?.projectName ?? project.projectName ?? "the selected project"}.`,
      projectInfo: {
        projectName: projectInfo?.projectName,
        projectPath: projectInfo?.projectPath,
        unityVersion: projectInfo?.unityVersion,
        supportedTools: projectInfo?.supportedTools,
        writeTools: projectInfo?.writeTools,
      },
    });
    const buildLaunchEnvImpl = options.buildLaunchEnv ?? buildLaunchEnv;
    const launchEnv = await buildLaunchEnvImpl(target, baseEnv, {
      ...options,
      env: baseEnv,
      launchInputs,
      files: launchInputs.files,
      bridgeCapabilities: true,
    });
    launchEnv.UOS_GUI_CONNECTION_FILE = guiConnectionPath(project.projectPath);
    delete launchEnv.UOS_TARGET_SESSION_FILE;
    if (launchInputs.materialsDir === undefined) {
      delete launchEnv.UNITY_MCP_MATERIALS_DIR;
    }
    const evaluateLaunchBridgeCapabilitiesImpl = options.evaluateLaunchBridgeCapabilities ?? evaluateLaunchBridgeCapabilities;
    const readiness = evaluateLaunchBridgeCapabilitiesImpl(launchEnv);
    if (!readiness.ready) {
      emitSessionEvent(session, {
        type: "bridge-blocked",
        text: formatLaunchBridgeCapabilityFailure(readiness),
        readiness,
      });
      return;
    }
    attachment = await prepareRunContextAttachment(launchEnv.UOS_CONTEXT_SUMMARY, target, {
      repoRoot,
      launchInputs,
      env: launchEnv,
    });
    const printOpencodeLogs = options.printOpencodeLogs ?? true;
    const reuseOpencodeSession = shouldReuseGuiOpencodeSession(options);
    const opencodeArgs = buildForwardArgs([
      "run",
      "--format",
      "json",
      ...(printOpencodeLogs === true ? ["--print-logs"] : []),
      ...(reuseOpencodeSession && session.opencodeSessionId !== undefined ? ["--session", session.opencodeSessionId] : []),
      message,
    ], target, {
      launchInputs,
      files: launchInputs.files,
      env: launchEnv,
      contextFiles: attachment?.file,
    });
    emitSessionEvent(session, { type: "opencode-start", args: redactedArgs(opencodeArgs) });
    const spawnOpencodeImpl = options.spawnOpencode ?? spawnOpencode;
    const result = await spawnOpencodeImpl(opencodeArgs, {
      cwd: repoRoot,
      env: launchEnv,
      timeoutMs: options.opencodeRunTimeoutMs ?? defaultOpencodeRunTimeoutMs(session, options.env ?? process.env),
      onChild: (nextChild) => {
        child = nextChild;
        session.activeChild = nextChild;
      },
      onLine: (line, stream) => {
        const event = parseOpencodeJsonEventLine(line);
        if (event === undefined) return;
        parsedEvents.push(event);
        emitSessionEvent(session, { ...event, stream });
      },
    });
    const opencodeSessionId = collectSessionIdFromEvents(parsedEvents);
    const timedOut = parsedEvents.some((event) => event?.type === "opencode-timeout");
    if (opencodeSessionId !== undefined) {
      session.opencodeSessionId = opencodeSessionId;
      session.needsNewOpencodeSession = false;
    } else if (session.opencodeSessionId === undefined) {
      session.needsNewOpencodeSession = true;
    }
    session.lastExitCode = result.code;
    if (timedOut || result.code !== 0) {
      delete session.opencodeSessionId;
      session.needsNewOpencodeSession = true;
    }
    session.running = false;
    await persistSession(project.projectPath, session);
    await refreshGuiProjectContext(project.projectPath, { project }).catch(() => {});
    emitSessionEvent(session, {
      type: result.code === 0 ? "run-complete" : "run-failed",
      exitCode: result.code,
      needsNewOpencodeSession: session.needsNewOpencodeSession === true,
    });
  } catch (err) {
    emitSessionEvent(session, {
      type: "run-error",
      text: err instanceof Error ? err.message : String(err),
    });
  } finally {
    session.running = false;
    if (session.activeChild === child) delete session.activeChild;
    await persistSession(project.projectPath, session).catch(() => {});
    await cleanupRunContextAttachment(attachment);
  }
}

async function prepareGuiTurnApproval(session, project, message, options) {
  if (options.autoApproveGuiMutations === false) return session.currentApproval;
  const projectPath = project?.projectPath ?? session.projectPath;
  if (projectPath === undefined) return session.currentApproval;
  const approval = await createGuiApproval(projectPath, {
    type: "unity-mutation-turn",
    source: {
      route: "full-ochestrator",
      guiSessionId: session.guiSessionId,
      messagePreview: String(message ?? "").slice(0, 160),
    },
  }, {
    ttlMs: options.guiTurnApprovalTtlMs ?? 30 * 60 * 1000,
  });
  session.currentApproval = approval;
  await persistSession(projectPath, session).catch(() => {});
  emitSessionEvent(session, {
    type: "approval-prepared",
    approval: redactSecrets(approval),
  });
  return approval;
}

async function runLightModelTurn(session, project, message, lightContext, options) {
  if (session.running === true) {
    emitSessionEvent(session, { type: "error", route: "light-model", text: "A UOS turn is already running." });
    return;
  }
  session.running = true;
  const timeoutMs = options.lightModelTimeoutMs ?? 8_000;
  try {
    const smallModel = await resolveGuiSmallModelConfig(options);
    if (smallModel === undefined) {
      emitSessionEvent(session, {
        type: "text",
        route: "light-model",
        fallback: true,
        text: formatLightModelUnavailableReply("빠른 답변 모델이 설정되어 있지 않습니다."),
      });
      return;
    }
    const prompt = formatLightModelPrompt(message, lightContext);
    emitSessionEvent(session, {
      type: "light-model-start",
      route: "light-model",
      provider: smallModel.provider,
      model: smallModel.model,
      timeoutMs,
    });
    const startedAt = Date.now();
    const callLightModelImpl = options.callLightModel ?? callLightModelDirect;
    const response = await callLightModelImpl({
      provider: smallModel.provider,
      model: smallModel.model,
      prompt,
      message,
      lightContext: redactSecrets(lightContext),
      timeoutMs,
      maxTokens: options.lightModelMaxTokens ?? 700,
      temperature: options.lightModelTemperature ?? 0.25,
    }, {
      env: options.env ?? process.env,
      fetch: options.fetch ?? globalThis.fetch,
    });
    emitSessionEvent(session, {
      type: "light-model-complete",
      route: "light-model",
      provider: smallModel.provider,
      model: smallModel.model,
      elapsedMs: Date.now() - startedAt,
      intent: response.intent,
      requiresUnity: response.requiresUnity === true,
      suggestedNextRoute: response.suggestedNextRoute,
    });
    emitSessionEvent(session, {
      type: "text",
      route: "light-model",
      text: response.answer,
      choices: response.choices,
      intent: response.intent,
      requiresUnity: response.requiresUnity === true,
      suggestedNextRoute: response.suggestedNextRoute,
      confidence: response.confidence,
    });
    session.lastExitCode = 0;
    await persistSession(project.projectPath, session);
  } catch (err) {
    emitSessionEvent(session, {
      type: "light-model-error",
      route: "light-model",
      text: err instanceof Error ? err.message : String(err),
    });
    emitSessionEvent(session, {
      type: "text",
      route: "light-model",
      fallback: true,
      text: formatLightModelUnavailableReply(err instanceof Error ? err.message : String(err)),
      error: err instanceof Error ? err.message : String(err),
    });
    session.lastExitCode = 1;
  } finally {
    session.running = false;
    delete session.activeChild;
    await persistSession(project.projectPath, session).catch(() => {});
  }
}

async function resolveGuiSmallModelConfig(options = {}) {
  const env = options.env ?? process.env;
  if (typeof options.lightModel === "string" && options.lightModel.trim().length > 0) {
    return parseLightModelRef(options.lightModel.trim());
  }
  if (typeof env.UOS_LIGHT_MODEL === "string" && env.UOS_LIGHT_MODEL.trim().length > 0) {
    return parseLightModelRef(env.UOS_LIGHT_MODEL.trim());
  }
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(repoRoot, "opencode.json"), "utf8"));
    const model = firstStringValue(parsed.light_model, parsed.small_model);
    return model !== undefined ? parseLightModelRef(model) : undefined;
  } catch {
    return undefined;
  }
}

function formatLightModelPrompt(message, lightContext) {
  return JSON.stringify({
    instruction: [
      "You are UOS GUI light chat.",
      "Answer in Korean, briefly and planner-friendly.",
      "Do not call tools.",
      "Do not claim you changed Unity.",
      "Use only the provided context.",
      "Return one JSON object only.",
    ],
    responseSchema: {
      kind: "LightModelResponse",
      answer: "string shown to the user",
      intent: "general-question | status-explanation | planning-advice | route-suggestion",
      requiresUnity: false,
      suggestedNextRoute: "none | planning | unity-edit",
      choices: ["optional 2-3 short user choices"],
      confidence: "number from 0 to 1",
    },
    context: redactSecrets(lightContext),
    userMessage: message,
  }, null, 2);
}

function formatLightModelUnavailableReply(reason) {
  return [
    "빠른 답변 모델을 사용할 수 없습니다.",
    `원인: ${reason}`,
    "Unity를 수정하거나 전체 Ochestrator를 실행하지는 않았습니다.",
    "opencode 인증 상태를 확인한 뒤 다시 시도하거나, 제작/수정 작업이라면 구체적인 작업 요청으로 보내 주세요.",
  ].join("\n");
}

async function callLightModelDirect(request, options = {}) {
  if (request.provider === "anthropic") return await callAnthropicLightModel(request, options);
  if (request.provider === "openai") return await callOpenAiLightModel(request, options);
  throw new Error(`Unsupported light model provider: ${request.provider}`);
}

async function callAnthropicLightModel(request, options = {}) {
  const fetchImpl = requireFetch(options.fetch);
  const env = options.env ?? process.env;
  const auth = await resolveAnthropicLightModelAuth(env);
  const response = await fetchWithTimeout(fetchImpl, "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...anthropicAuthHeaders(auth),
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: "You are UOS GUI light chat. Return a single JSON object and never call tools.",
      messages: [{ role: "user", content: request.prompt }],
    }),
  }, request.timeoutMs);
  const data = await readProviderJson(response, "Anthropic");
  const text = Array.isArray(data.content)
    ? data.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim()
    : "";
  return normalizeLightModelResponse(text, request);
}

async function resolveAnthropicLightModelAuth(env = process.env) {
  const opencodeAuth = await readOpencodeAnthropicAuth(env);
  if (opencodeAuth?.status === "valid") return opencodeAuth.auth;

  const apiKey = firstStringValue(env.ANTHROPIC_API_KEY, env.CLAUDE_API_KEY);
  if (apiKey !== undefined) return { type: "api-key", apiKey, source: "env" };

  if (opencodeAuth?.status === "expired") {
    throw new Error(`opencode Anthropic auth is expired. Run \`opencode providers login anthropic\`. (${opencodeAuth.source})`);
  }
  throw new Error("opencode Anthropic auth was not found. Run `opencode providers login anthropic`.");
}

function anthropicAuthHeaders(auth) {
  if (auth.type === "oauth") {
    return {
      "authorization": `Bearer ${auth.accessToken}`,
      "anthropic-dangerous-direct-browser-access": "true",
      "x-app": "cli",
      "user-agent": "uos-gui-light-model",
      "x-client-request-id": randomUUID(),
    };
  }
  return { "x-api-key": auth.apiKey };
}

async function readOpencodeAnthropicAuth(env = process.env, nowMs = Date.now()) {
  const candidates = [];
  for (const file of opencodeAuthFileCandidates(env)) {
    const auth = await readOpencodeAnthropicAuthFile(file, nowMs);
    if (auth !== undefined) candidates.push(auth);
  }
  for (const file of opencodeAccountFileCandidates(env)) {
    const auth = await readOpencodeAnthropicAccountFile(file, nowMs);
    if (auth !== undefined) candidates.push(auth);
  }
  const valid = candidates.find((item) => item.status === "valid");
  if (valid !== undefined) return valid;
  return candidates.find((item) => item.status === "expired");
}

async function readOpencodeAnthropicAuthFile(file, nowMs) {
  const data = await readJsonIfExists(file);
  const value = data?.anthropic;
  const credential = normalizeOpencodeAnthropicCredential(value, nowMs, file);
  return credential !== undefined ? credential : undefined;
}

async function readOpencodeAnthropicAccountFile(file, nowMs) {
  const data = await readJsonIfExists(file);
  if (data === undefined) return undefined;
  const credentials = collectOpencodeAnthropicCredentials(data, nowMs, file);
  const active = credentials.find((item) => item.active === true);
  if (active !== undefined) return active;
  return credentials.sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0))[0];
}

function collectOpencodeAnthropicCredentials(value, nowMs, source, pathHint = []) {
  if (value === undefined || value === null || typeof value !== "object") return [];
  const found = [];
  const credential = normalizeOpencodeAnthropicCredential(value.credential ?? value, nowMs, source);
  const hint = pathHint.join("/").toLowerCase();
  const service = String(value.serviceID ?? value.serviceId ?? value.provider ?? value.description ?? "").toLowerCase();
  const looksAnthropic = hint.includes("anthropic") || service.includes("anthropic") || service.includes("claude") || value.anthropic !== undefined;
  if (credential !== undefined && looksAnthropic) {
    found.push({ ...credential, active: value.active === true });
  }
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined && child !== null && typeof child === "object") {
      found.push(...collectOpencodeAnthropicCredentials(child, nowMs, source, [...pathHint, key]));
    }
  }
  return found;
}

function normalizeOpencodeAnthropicCredential(value, nowMs, source) {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const accessToken = firstStringValue(value.access, value.accessToken);
  const expiresAt = normalizeEpochMs(value.expires ?? value.expiresAt);
  if (accessToken === undefined || expiresAt === undefined) return undefined;
  const auth = {
    type: "oauth",
    accessToken,
    source,
    expiresAt,
  };
  return expiresAt > nowMs + 60_000
    ? { status: "valid", source, expiresAt, auth }
    : { status: "expired", source, expiresAt, auth };
}

function opencodeAuthFileCandidates(env = process.env) {
  if (typeof env.UOS_OPENCODE_AUTH_FILE === "string" && env.UOS_OPENCODE_AUTH_FILE.trim().length > 0) {
    return [path.resolve(env.UOS_OPENCODE_AUTH_FILE)];
  }
  const files = [];
  const home = homedir();
  files.push(path.join(home, ".local", "share", "opencode", "auth.json"));
  if (process.platform === "win32") {
    files.push(path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "opencode", "auth.json"));
  }
  return [...new Set(files)];
}

function opencodeAccountFileCandidates(env = process.env) {
  if (typeof env.UOS_OPENCODE_ACCOUNT_FILE === "string" && env.UOS_OPENCODE_ACCOUNT_FILE.trim().length > 0) {
    return [path.resolve(env.UOS_OPENCODE_ACCOUNT_FILE)];
  }
  const files = [];
  files.push(path.join(homedir(), ".local", "share", "opencode", "account.json"));
  return [...new Set(files)];
}

async function readJsonIfExists(file) {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text);
  } catch (err) {
    if (err?.code === "ENOENT") return undefined;
    return undefined;
  }
}

function normalizeEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeEpochMs(numeric);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function callOpenAiLightModel(request, options = {}) {
  const fetchImpl = requireFetch(options.fetch);
  const env = options.env ?? process.env;
  const apiKey = firstStringValue(env.OPENAI_API_KEY);
  if (apiKey === undefined) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetchWithTimeout(fetchImpl, "https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model,
      max_output_tokens: request.maxTokens,
      temperature: request.temperature,
      input: [
        { role: "system", content: "You are UOS GUI light chat. Return a single JSON object and never call tools." },
        { role: "user", content: request.prompt },
      ],
    }),
  }, request.timeoutMs);
  const data = await readProviderJson(response, "OpenAI");
  return normalizeLightModelResponse(extractOpenAiResponseText(data), request);
}

function parseLightModelRef(value) {
  const raw = String(value ?? "").trim();
  const slash = raw.indexOf("/");
  if (slash > 0) {
    const provider = raw.slice(0, slash).toLowerCase();
    const model = raw.slice(slash + 1);
    if (provider === "anthropic" || provider === "openai") return { provider, model };
  }
  if (/^(claude|anthropic\.)/i.test(raw)) return { provider: "anthropic", model: raw.replace(/^anthropic\./i, "") };
  if (/^(gpt|o\d|chatgpt)/i.test(raw)) return { provider: "openai", model: raw };
  return { provider: "anthropic", model: raw };
}

function normalizeLightModelResponse(text, request) {
  const raw = String(text ?? "").trim();
  const parsed = parseLooseJsonObject(raw);
  const answer = firstStringValue(parsed?.answer, raw);
  if (answer === undefined || answer.trim().length === 0) {
    throw new Error("light model returned an empty answer");
  }
  return {
    kind: "LightModelResponse",
    answer: answer.trim(),
    intent: firstStringValue(parsed?.intent) ?? "general-question",
    requiresUnity: parsed?.requiresUnity === true,
    suggestedNextRoute: firstStringValue(parsed?.suggestedNextRoute) ?? "none",
    choices: Array.isArray(parsed?.choices)
      ? parsed.choices.filter((item) => typeof item === "string" && item.trim().length > 0).slice(0, 3)
      : undefined,
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : undefined,
  };
}

function parseLooseJsonObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs ?? 8_000));
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error(`light model timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderJson(response, providerName) {
  const text = await response.text();
  let data;
  try {
    data = text.trim().length > 0 ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = firstStringValue(data?.error?.message, data?.message, text) ?? `${providerName} request failed`;
    throw new Error(`${providerName} light model error: ${message}`);
  }
  return data;
}

function extractOpenAiResponseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const output = Array.isArray(data?.output) ? data.output : [];
  return output.flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .map((part) => firstStringValue(part?.text, part?.content?.text, part?.content))
    .filter((part) => part !== undefined)
    .join("\n")
    .trim();
}

function requireFetch(fetchImpl) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available for light model calls");
  return fetchImpl;
}

function firstStringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function isGuiProjectConnected(project) {
  return project?.status === "connected" && project?.connection?.status === "connected";
}

function defaultOpencodeRunTimeoutMs(session, env = process.env) {
  const sessionSpecific = session?.opencodeSessionId !== undefined
    ? readPositiveIntegerEnv(env.UOS_GUI_OPENCODE_RESUME_TIMEOUT_MS)
    : readPositiveIntegerEnv(env.UOS_GUI_OPENCODE_FIRST_TIMEOUT_MS);
  return sessionSpecific
    ?? readPositiveIntegerEnv(env.UOS_GUI_OPENCODE_TIMEOUT_MS)
    ?? (session?.opencodeSessionId !== undefined ? 480_000 : 600_000);
}

function shouldReuseGuiOpencodeSession(options = {}) {
  if (options.reuseOpencodeSession === true) return true;
  const value = String((options.env ?? process.env).UOS_GUI_REUSE_OPENCODE_SESSION ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readPositiveIntegerEnv(value) {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function spawnOpencode(args, options) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1, options.timeoutMs ?? 300_000);
    const child = spawn("opencode", args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    options.onChild?.(child);
    let stdout = "";
    let stderr = "";
    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      options.onLine?.(JSON.stringify({
        type: "opencode-waiting",
        text: `Ochestrator is still running (${elapsedSeconds}s).`,
        elapsedSeconds,
      }), "stderr");
    }, options.heartbeatMs ?? 10_000);
    heartbeat.unref?.();
    const timeout = setTimeout(() => {
      options.onLine?.(JSON.stringify({
        type: "opencode-timeout",
        text: `Ochestrator timed out after ${timeoutMs}ms.`,
        timeoutMs,
      }), "stderr");
      terminateProcessTree(child);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      stdout = drainLines(stdout, (line) => options.onLine(line, "stdout"));
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      stderr = drainLines(stderr, (line) => options.onLine(line, "stderr"));
    });
    child.once("error", (err) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      reject(err);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (stdout.trim().length > 0) options.onLine(stdout, "stdout");
      if (stderr.trim().length > 0) options.onLine(stderr, "stderr");
      resolve({ code, signal });
    });
  });
}

function terminateProcessTree(child) {
  if (child?.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref?.();
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  try { child.kill(); } catch { /* best effort */ }
}

function drainLines(buffer, onLine) {
  const parts = buffer.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  for (const line of parts) onLine(line);
  return rest;
}

async function saveUploadedFiles(projectPath, guiSessionId, body = {}) {
  const dir = guiUploadsDir(projectPath, guiSessionId);
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  for (const file of Array.isArray(body.files) ? body.files : []) {
    if (typeof file?.name !== "string" || typeof file?.dataBase64 !== "string") continue;
    const safeName = path.basename(file.name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const out = path.join(dir, safeName);
    await fs.writeFile(out, Buffer.from(file.dataBase64, "base64"));
    files.push(normalizeUploadedFileRecord(out));
  }
  for (const inputPath of Array.isArray(body.paths) ? body.paths : []) {
    if (typeof inputPath !== "string" || inputPath.trim().length === 0) continue;
    const resolved = path.resolve(inputPath);
    const out = path.join(dir, path.basename(resolved));
    await fs.copyFile(resolved, out);
    files.push(normalizeUploadedFileRecord(out));
  }
  return files;
}

async function createLaunchingGuiConnection(project, projectId, options = {}) {
  const host = options.guiBridgeHost ?? "127.0.0.1";
  const connection = {
    version: "1.0.0",
    projectId: projectId ?? guiProjectId(project.projectPath),
    projectPath: path.resolve(project.projectPath),
    guiSessionId: `gui-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    host,
    port: await allocateTcpPort(host),
    token: randomUUID().replace(/-/g, ""),
    status: "launching",
  };
  return (await writeGuiConnection(project.projectPath, connection)).connection;
}

function allocateTcpPort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close((err) => {
        if (err) reject(err);
        else if (Number.isInteger(port) && port > 0) resolve(port);
        else reject(new Error("[uos gui] failed to allocate Unity bridge port"));
      });
    });
  });
}

async function persistSession(projectPath, session) {
  await upsertGuiSession(projectPath, {
    guiSessionId: session.guiSessionId,
    projectId: session.projectId,
    projectPath: session.projectPath,
    projectName: session.projectName,
    attachedFiles: session.attachedFiles ?? [],
    opencodeSessionId: session.opencodeSessionId,
    needsNewOpencodeSession: session.needsNewOpencodeSession === true,
    currentApproval: session.currentApproval,
    lastExitCode: session.lastExitCode,
  });
}

async function refreshSessionProject(session, options) {
  if (session.projectId === undefined) {
    const saved = await loadSavedSession(session.guiSessionId, options);
    Object.assign(session, saved);
  }
  const catalog = await loadCatalog(options);
  const project = findGuiProject(catalog, session.projectId);
  if (project === undefined) return session.project;
  session.project = project;
  session.projectPath = project.projectPath ?? session.projectPath;
  session.projectName = project.projectName ?? session.projectName;
  return session.project;
}

async function loadSavedSession(guiSessionId, options) {
  const catalog = await loadCatalog(options);
  for (const project of catalog.projects ?? []) {
    const data = await readGuiSessions(project.projectPath).catch(() => ({ sessions: [] }));
    const found = data.sessions.find((item) => item.guiSessionId === guiSessionId);
    if (found !== undefined) return found;
  }
  return { guiSessionId };
}

function ensureMemorySession(guiSessionId) {
  if (!activeSessions.has(guiSessionId)) {
    activeSessions.set(guiSessionId, {
      guiSessionId,
      events: [],
      clients: new Set(),
    });
  }
  return activeSessions.get(guiSessionId);
}

function emitSessionEvent(session, event) {
  const next = {
    ts: new Date().toISOString(),
    ...redactSecrets(event),
  };
  session.events ??= [];
  session.events.push(next);
  session.events = session.events.slice(-500);
  for (const client of session.clients ?? []) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(next));
  }
}

async function loadCatalog(options) {
  const catalog = await (options.discoverUnityProjectCatalog ?? discoverUnityProjectCatalog)({
    ...options,
    repoRoot,
  });
  return await decorateGuiCatalog(catalog, options);
}

async function decorateGuiCatalog(catalog = {}, options = {}) {
  const projects = [];
  for (const project of catalog.projects ?? []) {
    projects.push(await decorateGuiProject(project, options));
  }
  return {
    ...catalog,
    count: projects.length,
    projects,
  };
}

async function decorateGuiProject(project, options = {}) {
  let connection = await readGuiConnection(project.projectPath).catch((err) => ({
    version: "1.0.0",
    projectId: guiProjectId(project.projectPath),
    projectPath: path.resolve(project.projectPath),
    guiSessionId: "invalid",
    host: "127.0.0.1",
    port: 1,
    token: "invalid",
    status: "error",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: err instanceof Error ? err.message : String(err),
  }));
  const rawBridge = project.bridge?.live === true ? project.bridge : undefined;
  const matchingEditor = isGuiManagedEditorForConnection(rawBridge?.editor, connection)
    ? rawBridge.editor
    : undefined;

  if (connection !== undefined && matchingEditor !== undefined && connection.status !== "error") {
    connection = await verifyGuiConnection(project, connection, matchingEditor, options);
  } else if (connection?.status === "connected") {
    connection = (await updateGuiConnection(project.projectPath, {
      status: "closed",
      error: "GUI-managed Unity bridge is no longer live.",
    })).connection;
  }

  const bridge = connection?.status === "connected" && matchingEditor !== undefined
    ? {
        live: true,
        editor: {
          ...matchingEditor,
          token: connection.token,
          host: connection.host,
          port: connection.port,
          instanceId: connection.editorInstanceId ?? matchingEditor.instanceId,
        },
      }
    : { live: false };
  const externalBridge = rawBridge !== undefined && matchingEditor === undefined
    ? rawBridge
    : undefined;
  const status = guiCatalogStatus(project, connection, bridge, externalBridge);
  return {
    ...project,
    status,
    connected: status === "connected",
    sessionReady: status === "connected",
    connection,
    externalBridge,
    bridge,
  };
}

async function verifyGuiConnection(project, connection, editor, options = {}) {
  const target = {
    instanceId: editor.instanceId,
    projectName: editor.projectName ?? project.projectName,
    projectPath: editor.projectPath ?? project.projectPath,
    host: editor.host ?? connection.host,
    port: editor.port ?? connection.port,
    token: connection.token,
    unityVersion: editor.unityVersion,
    uosPackageName: editor.uosPackageName,
    uosPackageVersion: editor.uosPackageVersion,
    protocolVersion: editor.protocolVersion,
    autoStartBridge: editor.autoStartBridge,
    uosGuiSessionId: connection.guiSessionId,
  };
  const callUnityToolImpl = options.callUnityTool ?? callUnityTool;
  try {
    const info = await callUnityToolImpl(target, "get_project_info", {}, {
      timeoutMs: options.guiConnectionVerifyTimeoutMs ?? 2_000,
    });
    if (info?.projectPath !== undefined && normalizeComparablePath(info.projectPath) !== normalizeComparablePath(project.projectPath)) {
      throw new Error(`Unity bridge project mismatch: ${info.projectPath}`);
    }
    return (await updateGuiConnection(project.projectPath, {
      host: target.host,
      port: target.port,
      editorInstanceId: target.instanceId,
      status: "connected",
      lastVerifiedAt: new Date().toISOString(),
      error: undefined,
    })).connection;
  } catch (err) {
    return (await updateGuiConnection(project.projectPath, {
      host: target.host,
      port: target.port,
      editorInstanceId: target.instanceId,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    })).connection;
  }
}

function guiCatalogStatus(project, connection, bridge, externalBridge) {
  if (project.uos?.installed !== true) return "not-installed";
  if (bridge?.live === true) return "connected";
  if (connection?.status === "error") return "bridge-error";
  if (["created", "launching", "waiting-bridge"].includes(connection?.status)) return "waiting-bridge";
  if (externalBridge?.live === true) return "external";
  if (project.status === "needs-attention" || project.status === "live-needs-attention") return project.status;
  return "installed";
}

function normalizeComparablePath(value) {
  return String(value ?? "").trim().replace(/[\\/]+$/, "").toLowerCase();
}

async function readJsonBody(req, options = {}) {
  const limitBytes = options.limitBytes ?? 2 * 1024 * 1024;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return {};
  return JSON.parse(text);
}

function sendJson(res, status, value) {
  const text = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(text);
}

async function serveStatic(req, res, staticDir) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const resolved = path.resolve(staticDir, `.${requested}`);
  const root = path.resolve(staticDir);
  const file = (resolved === root || resolved.startsWith(root + path.sep)) && existsSync(resolved)
    ? resolved
    : path.join(root, "index.html");
  if (!existsSync(file)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>UOS GUI</title><main>Run <code>bun run gui:build</code> to build the UOS GUI.</main>");
    return;
  }
  res.writeHead(200, { "content-type": mimeType(file) });
  createReadStream(file).pipe(res);
}

function mimeType(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

function publicSession(session) {
  return redactSecrets({
    guiSessionId: session.guiSessionId,
    projectId: session.projectId,
    projectPath: session.projectPath,
    projectName: session.projectName,
    attachedFiles: session.attachedFiles ?? [],
    opencodeSessionId: session.opencodeSessionId,
    needsNewOpencodeSession: session.needsNewOpencodeSession === true,
    running: session.running === true,
    lastExitCode: session.lastExitCode,
  });
}

function redactedArgs(args) {
  return Array.isArray(args) ? args.map((arg) => String(arg).includes("TOKEN") ? "[redacted]" : arg) : [];
}

function openBrowser(url, options = {}) {
  const opener = options.openBrowser ?? defaultOpenBrowser;
  opener(url);
}

function defaultOpenBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
