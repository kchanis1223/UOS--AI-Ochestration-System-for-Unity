import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  classifyGuiChatRoute,
  collectSessionIdFromEvents,
  createGuiApproval,
  formatGuiLightLocalReply,
  guiConnectionPath,
  guiProjectContextPaths,
  guiProjectId,
  materialKindForFile,
  normalizeUploadedFileRecord,
  parseOpencodeJsonEventLine,
  publicGuiProjectCatalog,
  refreshGuiProjectContext,
  updateGuiConnection,
  validateGuiApproval,
  validateGuiConnection,
  writeGuiConnection,
} from "../bin/uos-gui-core.js";
import { launchUnityProject, resolveUnityExecutableForGui } from "../bin/uos-core.js";
import { startUosGuiServer } from "../bin/uos-gui-server.js";

describe("UOS GUI core", () => {
  test("public project catalog uses stable ids and redacts bridge secrets", () => {
    const catalog = publicGuiProjectCatalog({
      projects: [{
        projectName: "Alpha",
        projectPath: "D:/Unity/Alpha",
        status: "connected",
        bridge: {
          live: true,
          editor: {
            projectName: "Alpha",
            projectPath: "D:/Unity/Alpha",
            host: "127.0.0.1",
            port: 19001,
            token: "secret-token",
          },
        },
      }],
    });

    expect(catalog.count).toBe(1);
    expect(catalog.projects[0].projectId).toBe(guiProjectId("D:/Unity/Alpha"));
    expect(JSON.stringify(catalog)).not.toContain("secret-token");
    expect(JSON.stringify(catalog)).not.toContain("token");
  });

  test("normalizes opencode json events and session ids", () => {
    const events = [
      parseOpencodeJsonEventLine(JSON.stringify({ type: "session", sessionID: "ses_123" })),
      parseOpencodeJsonEventLine(JSON.stringify({ type: "message", role: "assistant", text: "Ready" })),
      parseOpencodeJsonEventLine(JSON.stringify({ type: "tool", tool: "get_uos_context" })),
      parseOpencodeJsonEventLine(JSON.stringify({ type: "opencode-timeout", timeoutMs: 600_000, elapsedSeconds: 600 })),
      parseOpencodeJsonEventLine("timestamp=2026-06-22T08:55:28.992Z level=ERROR message=\"stream error\" providerID=anthropic modelID=claude-opus-4-8 error.error=\"AI_APICallError: Overloaded\""),
    ];

    expect(collectSessionIdFromEvents(events)).toBe("ses_123");
    expect(events[1]?.text).toBe("Ready");
    expect(events[2]?.tool).toBe("get_uos_context");
    expect(events[3]?.timeoutMs).toBe(600_000);
    expect(events[3]?.elapsedSeconds).toBe(600);
    expect(events[4]).toMatchObject({
      type: "provider-overloaded",
      provider: "anthropic",
      model: "claude-opus-4-8",
    });
    expect(parseOpencodeJsonEventLine("plain log line")).toEqual({ type: "log", text: "plain log line" });
  });

  test("classifies video as playable media, not analysis target", () => {
    expect(materialKindForFile("intro.mp4")).toBe("video-media");
    expect(normalizeUploadedFileRecord("C:/Plans/intro.mp4")).toMatchObject({
      kind: "video-media",
      analysisTarget: false,
    });
    expect(normalizeUploadedFileRecord("C:/Plans/deck.pptx")).toMatchObject({
      kind: "pptx",
      analysisTarget: true,
    });
  });

  test("routes role and self-introduction questions to local chat", () => {
    const lightContext = {
      project: { name: "GuiProject", connected: false },
      connection: { status: "waiting-bridge" },
      screens: { count: 0 },
      nextActions: ["Unity 열기", "현재 상태 확인", "기획 자료 첨부"],
    };

    for (const message of [
      "너의 역할에 대해 알려줘",
      "자기소개 해봐",
      "넌 누구야?",
      "UOS를 소개해줘",
      "오케스트레이터 역할이 뭐야?",
    ]) {
      expect(classifyGuiChatRoute(message, lightContext)).toMatchObject({
        route: "light-local",
      });
    }

    const reply = formatGuiLightLocalReply("너의 역할에 대해 알려줘", lightContext);
    expect(reply).toContain("UOS Ochestrator");
    expect(reply).toContain("Unity");
  });

  test("routes only explicit production work to full ochestrator by default", () => {
    const lightContext = {
      project: { name: "GuiProject", connected: true },
      connection: { status: "connected" },
    };

    expect(classifyGuiChatRoute("이 구조가 왜 느린지 설명해줘", lightContext)).toMatchObject({
      route: "light-model",
      reason: "default-general-chat",
    });
    expect(classifyGuiChatRoute("사용자 입장에서 이 기능이 어떤 의미인지 같이 고민해보자", lightContext)).toMatchObject({
      route: "light-model",
    });
    expect(classifyGuiChatRoute("버튼을 추가해줘.", lightContext)).toMatchObject({
      route: "full-ochestrator",
      reason: "work-request",
    });
    expect(classifyGuiChatRoute("PPTX를 읽고 Unity 화면을 만들어줘.", lightContext)).toMatchObject({
      route: "full-ochestrator",
      reason: "work-request",
    });
  });

  test("creates and validates GUI approval files", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-approval-test");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    try {
      const result = await createGuiApproval(root, {
        approvalId: "approval-1",
        type: "blueprint",
        source: { blueprintId: "bp-1" },
      }, {
        nowMs: Date.parse("2026-06-22T00:00:00.000Z"),
        ttlMs: 1000,
      });
      const approval = JSON.parse(await Bun.file(result.path).text());
      expect(validateGuiApproval(approval, {
        projectDir: root,
        nowMs: Date.parse("2026-06-22T00:00:00.500Z"),
      }).ok).toBe(true);
      expect(validateGuiApproval(approval, {
        projectDir: root,
        nowMs: Date.parse("2026-06-22T00:00:02.000Z"),
      }).errors).toContain("approval.expiresAt: expired");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("creates GUI connection files without exposing tokens in public API", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-connection-test");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    try {
      const result = await writeGuiConnection(root, {
        projectPath: root,
        guiSessionId: "gui-1",
        host: "127.0.0.1",
        port: 19001,
        token: "secret-token",
        status: "connected",
      });
      expect(result.path).toBe(guiConnectionPath(root));
      expect(validateGuiConnection(result.connection).ok).toBe(true);
      expect(result.connection.projectId).toBe(guiProjectId(root));
      const publicCatalog = publicGuiProjectCatalog({
        projects: [{
          projectName: "GuiProject",
          projectPath: root,
          status: "connected",
          uos: { installed: true },
          connection: result.connection,
          bridge: {
            live: true,
            editor: {
              projectPath: root,
              host: "127.0.0.1",
              port: 19001,
              token: "secret-token",
            },
          },
        }],
      });
      expect(JSON.stringify(publicCatalog)).not.toContain("secret-token");
      expect(JSON.stringify(publicCatalog)).not.toContain("\"token\"");
      expect(publicCatalog.projects[0].connection.authFingerprint).toMatch(/^[a-f0-9]{12}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("updates GUI connection files safely during concurrent refreshes", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-connection-concurrent-test");
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });

    try {
      await writeGuiConnection(root, {
        projectPath: root,
        guiSessionId: "gui-concurrent",
        host: "127.0.0.1",
        port: 19001,
        token: "secret-token",
        status: "waiting-bridge",
      });

      await Promise.all(Array.from({ length: 12 }, (_, index) => updateGuiConnection(root, {
        status: "connected",
        editorInstanceId: `editor-${index}`,
        lastVerifiedAt: new Date(Date.parse("2026-06-22T00:00:00.000Z") + index).toISOString(),
      })));

      const connection = JSON.parse(await readFile(guiConnectionPath(root), "utf8"));
      expect(connection.status).toBe("connected");
      expect(connection.editorInstanceId).toMatch(/^editor-/);
      expect(validateGuiConnection(connection).ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refreshes generated project context cache without leaking secrets", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-project-context-test");
    await rm(root, { recursive: true, force: true });
    await mkdir(join(root, ".uos"), { recursive: true });

    try {
      await writeFile(join(root, ".uos", "screens.json"), JSON.stringify({
        screens: {
          main: { id: "main", name: "Main", elements: [{ id: "title" }] },
        },
      }), "utf8");
      await writeGuiConnection(root, {
        projectPath: root,
        guiSessionId: "gui-context",
        host: "127.0.0.1",
        port: 19001,
        token: "secret-token",
        status: "connected",
      });

      const result = await refreshGuiProjectContext(root, {
        project: {
          projectName: "ContextProject",
          unityVersion: "6000.0.1f1",
          status: "connected",
          uos: { installed: true, installKind: "embedded" },
        },
      });
      const paths = guiProjectContextPaths(root);
      const light = JSON.parse(await readFile(paths.lightContext, "utf8"));
      const state = await readFile(paths.currentState, "utf8");

      expect(result.ok).toBe(true);
      expect(light.project.name).toBe("ContextProject");
      expect(light.screens.count).toBe(1);
      expect(JSON.stringify(light)).not.toContain("secret-token");
      expect(JSON.stringify(light)).not.toContain("\"token\"");
      expect(state).toContain("UOS Current State");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves and launches Unity Editor for GUI without batchmode flags", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-unity-launch-test");
    const project = join(root, "UnityProject");
    const unityExe = join(root, "Unity.exe");
    await rm(root, { recursive: true, force: true });

    try {
      await mkdir(join(project, "ProjectSettings"), { recursive: true });
      await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n", "utf8");
      await writeFile(unityExe, "fake", "utf8");

      const resolved = await resolveUnityExecutableForGui(project, {
        config: {
          unityEditors: {
            "6000.0.1f1": unityExe,
          },
        },
      });
      expect(resolved).toMatchObject({
        ok: true,
        unityPath: resolve(unityExe),
        source: "configured-version",
      });

      const calls: any[] = [];
      const launched = await launchUnityProject(project, {
        config: {
          defaultUnityExecutable: unityExe,
        },
        unityEnv: {
          UOS_BRIDGE_TOKEN: "session-token",
        },
        launchUnity: async (command: string, args: string[], options: any) => {
          calls.push({ command, args, options });
          return { pid: 1234 };
        },
      });
      expect(launched.ok).toBe(true);
      expect(calls[0].args).toEqual(["-projectPath", resolve(project)]);
      expect(calls[0].args).not.toContain("-batchmode");
      expect(calls[0].args).not.toContain("-nographics");
      expect(calls[0].options.unityEnv.UOS_BRIDGE_TOKEN).toBe("session-token");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("open Unity API creates a GUI-owned connection", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-open-unity-session-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    let capturedEnv: Record<string, string> | undefined;
    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "installed",
          uos: { installed: true, installKind: "embedded" },
          bridge: { live: false },
        }],
      }),
      launchUnityProject: async (_projectPath, options) => {
        capturedEnv = options.unityEnv;
        return {
          ok: true,
          launched: true,
          projectPath: project,
          unityPath: "C:/Unity/Unity.exe",
          args: ["-projectPath", project],
          pid: 1234,
        };
      },
    });

    try {
      const projects = await getJson(`${app.url}/api/projects`);
      const data = await postJson(`${app.url}/api/projects/${projects.projects[0].projectId}/open-unity`, {});
      expect(data.ok).toBe(true);
      expect(capturedEnv?.UOS_BRIDGE_HOST).toBe("127.0.0.1");
      expect(Number.parseInt(capturedEnv?.UOS_BRIDGE_PORT ?? "", 10)).toBeGreaterThan(0);
      expect(capturedEnv?.UOS_BRIDGE_TOKEN).toMatch(/^[a-f0-9]{32}$/);
      expect(capturedEnv?.UOS_GUI_SESSION_ID).toMatch(/^gui-/);
      expect(JSON.stringify(data)).not.toContain(capturedEnv?.UOS_BRIDGE_TOKEN);
      expect(JSON.stringify(data)).not.toContain("\"token\"");

      const connection = JSON.parse(await readFile(guiConnectionPath(project), "utf8"));
      expect(connection.guiSessionId).toBe(capturedEnv?.UOS_GUI_SESSION_ID);
      expect(connection.token).toBe(capturedEnv?.UOS_BRIDGE_TOKEN);
      expect(connection.status).toBe("waiting-bridge");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("full chat message reports bridge blockers instead of hanging silently", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-blocked-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "installed",
          uos: { installed: true, installKind: "embedded" },
          bridge: { live: false },
        }],
      }),
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "버튼을 추가해줘.",
      });
      expect(response.ok).toBe(true);

      const event = await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "full-blocked");
      expect(event.text).toContain("Unity 제작/수정 작업은 GUI-managed Unity 연결이 필요합니다");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("light local chat responds without starting opencode or requiring Unity connection", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-light-local-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    let spawnCalls = 0;
    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "installed",
          uos: { installed: true, installKind: "embedded" },
          bridge: { live: false },
        }],
      }),
      spawnOpencode: async () => {
        spawnCalls += 1;
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "안녕?",
      });
      expect(response.ok).toBe(true);

      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "chat-route" && item.route === "light-local");
      const text = await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "text" && item.route === "light-local");
      expect(text.text).toContain("안녕하세요");
      expect(spawnCalls).toBe(0);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("general non-work chat uses direct small model without spawning opencode", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-light-model-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    let spawnCalls = 0;
    let modelRequest: any;
    let modelOptions: any;
    const app = await startUosGuiServer({
      open: false,
      lightModel: "test/small",
      env: {
        ...process.env,
        UNITY_MCP_TOKEN: "secret-token",
        UNITY_MCP_HOST: "127.0.0.1",
        UOS_GUI_CONNECTION_FILE: "secret-connection",
        UOS_CONTEXT_SUMMARY: "heavy context",
      },
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "installed",
          uos: { installed: true, installKind: "embedded" },
          bridge: { live: false },
        }],
      }),
      callLightModel: async (request, options) => {
        modelRequest = request;
        modelOptions = options;
        return {
          answer: "UOS 구조가 느린 이유는 일반 질문도 무거운 실행 경로로 들어갔기 때문입니다.",
          intent: "general-question",
          requiresUnity: false,
          suggestedNextRoute: "none",
          choices: ["라우팅 개선", "모델 호출 개선"],
          confidence: 0.91,
        };
      },
      spawnOpencode: async () => {
        spawnCalls += 1;
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "이 구조가 왜 느린지 설명해줘.",
      });
      expect(response.ok).toBe(true);

      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "chat-route" && item.route === "light-model");
      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "light-model-start" && item.route === "light-model");
      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "light-model-complete" && item.route === "light-model");
      const text = await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "text" && item.route === "light-model");
      expect(text.text).toContain("무거운 실행 경로");
      expect(text.choices).toEqual(["라우팅 개선", "모델 호출 개선"]);
      expect(modelRequest).toMatchObject({
        provider: "anthropic",
        model: "test/small",
        timeoutMs: 8_000,
      });
      expect(modelRequest.prompt).toContain("\"userMessage\"");
      expect(JSON.stringify(modelRequest.lightContext)).not.toContain("secret-token");
      expect(modelOptions.env.UNITY_MCP_TOKEN).toBe("secret-token");
      expect(spawnCalls).toBe(0);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("light model uses opencode Anthropic auth store without direct API keys", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-opencode-auth-test");
    const project = join(root, "UnityProject");
    const authFile = join(root, "auth.json");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });
    await writeFile(authFile, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "opencode-access-token",
        refresh: "opencode-refresh-token",
        expires: Date.now() + 10 * 60 * 1000,
      },
    }), "utf8");

    let capturedHeaders: Record<string, string> = {};
    let spawnCalls = 0;
    const app = await startUosGuiServer({
      open: false,
      lightModel: "anthropic/test-small",
      env: {
        UOS_OPENCODE_AUTH_FILE: authFile,
        UOS_OPENCODE_ACCOUNT_FILE: join(root, "missing-account.json"),
      },
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "installed",
          uos: { installed: true, installKind: "embedded" },
          bridge: { live: false },
        }],
      }),
      fetch: async (_url, init) => {
        capturedHeaders = Object.fromEntries(new Headers(init.headers).entries());
        return new Response(JSON.stringify({
          content: [{
            type: "text",
            text: JSON.stringify({
              kind: "LightModelResponse",
              answer: "opencode 인증으로 빠른 답변을 생성했습니다.",
              intent: "general-question",
              requiresUnity: false,
              suggestedNextRoute: "none",
              confidence: 0.88,
            }),
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      spawnOpencode: async () => {
        spawnCalls += 1;
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "UOS 구조를 간단히 설명해줘.",
      });
      expect(response.ok).toBe(true);

      const text = await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "text" && item.route === "light-model");
      const activity = await getJson(`${app.url}/api/sessions/${session.guiSessionId}/activity`);

      expect(text.text).toContain("opencode 인증");
      expect(capturedHeaders.authorization).toBe("Bearer opencode-access-token");
      expect(capturedHeaders["x-api-key"]).toBeUndefined();
      expect(spawnCalls).toBe(0);
      expect(JSON.stringify(activity)).not.toContain("opencode-access-token");
      expect(JSON.stringify(activity)).not.toContain("opencode-refresh-token");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("expired opencode Anthropic auth blocks light model without calling provider", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-expired-opencode-auth-test");
    const project = join(root, "UnityProject");
    const authFile = join(root, "auth.json");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });
    await writeFile(authFile, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "expired-access-token",
        refresh: "expired-refresh-token",
        expires: Date.now() - 10_000,
      },
    }), "utf8");

    let fetchCalls = 0;
    const app = await startUosGuiServer({
      open: false,
      lightModel: "anthropic/test-small",
      env: {
        UOS_OPENCODE_AUTH_FILE: authFile,
        UOS_OPENCODE_ACCOUNT_FILE: join(root, "missing-account.json"),
      },
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "installed",
          uos: { installed: true, installKind: "embedded" },
          bridge: { live: false },
        }],
      }),
      fetch: async () => {
        fetchCalls += 1;
        return new Response("{}", { status: 200 });
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "UOS 구조를 간단히 설명해줘.",
      });
      expect(response.ok).toBe(true);

      const error = await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "light-model-error");
      const text = await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "text" && item.route === "light-model");

      expect(error.text).toContain("opencode Anthropic auth is expired");
      expect(text.text).toContain("opencode 인증 상태");
      expect(fetchCalls).toBe(0);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("project catalog marks non-GUI Unity editors as external, not connected", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-external-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "connected",
          uos: { installed: true, installKind: "embedded" },
          bridge: {
            live: true,
            editor: {
              projectName: "GuiProject",
              projectPath: project,
              host: "127.0.0.1",
              port: 19001,
              token: "manual-token",
            },
          },
        }],
      }),
    });

    try {
      const projects = await getJson(`${app.url}/api/projects`);
      expect(projects.projects[0].status).toBe("external");
      expect(projects.projects[0].bridge.live).toBe(false);
      expect(projects.projects[0].externalBridge.live).toBe(true);
      expect(JSON.stringify(projects)).not.toContain("manual-token");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("chat message streams bridge and opencode events for responsive GUI updates", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-chat-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    let spawnedArgs: string[] = [];
    let spawnedOptions: any;
    await writeGuiConnection(project, {
      projectPath: project,
      guiSessionId: "gui-connected",
      host: "127.0.0.1",
      port: 19001,
      token: "secret-token",
      status: "connected",
      editorInstanceId: "editor-1",
    });
    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "connected",
          uos: { installed: true, installKind: "embedded" },
          bridge: {
            live: true,
            editor: {
              projectName: "GuiProject",
              projectPath: project,
              host: "127.0.0.1",
              port: 19001,
              token: "secret-token",
              uosGuiSessionId: "gui-connected",
              supportedTools: ["get_project_info"],
              writeTools: ["create_ui_screen"],
            },
          },
        }],
      }),
      callUnityTool: async () => ({
        projectName: "GuiProject",
        projectPath: project,
        unityVersion: "6000.0.1f1",
        supportedTools: ["get_project_info"],
        writeTools: ["create_ui_screen"],
      }),
      buildLaunchEnv: async (_target, env) => ({
        ...env,
        UOS_CONTEXT_SUMMARY: "GUI test context",
      }),
      evaluateLaunchBridgeCapabilities: () => ({ ready: true }),
      spawnOpencode: async (args, options) => {
        spawnedArgs = args;
        spawnedOptions = options;
        options.onLine?.(JSON.stringify({ type: "session", sessionID: "ses_gui_1" }), "stdout");
        options.onLine?.(JSON.stringify({ type: "message", role: "assistant", text: "Unity 상태를 확인했습니다." }), "stdout");
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "버튼을 추가해줘.",
      });
      expect(response.ok).toBe(true);

      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "bridge-ready");
      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "approval-prepared");
      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "opencode-start");

      expect(spawnedArgs).toEqual(expect.arrayContaining(["run", "--agent", "ochestrator", "--format", "json"]));
      expect(spawnedArgs).toContain("--print-logs");
      expect(spawnedOptions.timeoutMs).toBe(600_000);
      expect(spawnedOptions.env.UOS_GUI_APPROVAL_FILE).toBeDefined();
      const approval = JSON.parse(await readFile(spawnedOptions.env.UOS_GUI_APPROVAL_FILE, "utf8"));
      expect(approval.type).toBe("unity-mutation-turn");
      expect(approval.source).toMatchObject({
        route: "full-ochestrator",
        guiSessionId: session.guiSessionId,
        messagePreview: "버튼을 추가해줘.",
      });
      expect(spawnedOptions.env.UOS_GUI_APPROVAL_ID).toBe(approval.approvalId);
      expect(validateGuiApproval(approval, { projectDir: project }).ok).toBe(true);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("chat uses GUI connection file and ignores stale target session state", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-token-refresh-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    let preflightToken = "";
    let spawnedConnectionFile = "";
    await writeGuiConnection(project, {
      projectPath: project,
      guiSessionId: "gui-connected",
      host: "127.0.0.1",
      port: 19001,
      token: "new-token",
      status: "connected",
      editorInstanceId: "editor-1",
    });
    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "connected",
          uos: { installed: true, installKind: "embedded" },
          bridge: {
            live: true,
            editor: {
              projectName: "GuiProject",
              projectPath: project,
              host: "127.0.0.1",
              port: 19001,
              token: "new-token",
              uosGuiSessionId: "gui-connected",
              supportedTools: ["get_project_info"],
              writeTools: ["create_ui_screen"],
            },
          },
        }],
      }),
      callUnityTool: async (target) => {
        preflightToken = target.token;
        return {
          projectName: "GuiProject",
          projectPath: project,
          supportedTools: ["get_project_info"],
          writeTools: ["create_ui_screen"],
        };
      },
      buildLaunchEnv: async (_target, env) => ({
        ...env,
        UOS_CONTEXT_SUMMARY: "GUI test context",
      }),
      evaluateLaunchBridgeCapabilities: () => ({ ready: true }),
      spawnOpencode: async (_args, options) => {
        spawnedConnectionFile = options.env.UOS_GUI_CONNECTION_FILE;
        expect(options.env.UOS_TARGET_SESSION_FILE).toBeUndefined();
        expect(options.env.UNITY_MCP_MATERIALS_DIR).toBeUndefined();
        options.onLine?.(JSON.stringify({ type: "session", sessionID: "ses_gui_2" }), "stdout");
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const staleStateFile = join(project, ".uos", "ochestrator", "unity-target-session.json");
      await mkdir(join(project, ".uos", "ochestrator"), { recursive: true });
      await writeFile(staleStateFile, JSON.stringify({
        version: "1.0.0",
        selectedAt: "2026-06-22T00:00:00.000Z",
        source: "session",
        target: {
          projectName: "GuiProject",
          projectPath: project,
          host: "127.0.0.1",
          port: 19001,
          token: "old-token",
        },
      }, null, 2), "utf8");

      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "버튼을 추가해줘.",
      });
      expect(response.ok).toBe(true);

      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "run-complete");
      expect(preflightToken).toBe("new-token");
      expect(spawnedConnectionFile).toBe(guiConnectionPath(project));
      const staleState = JSON.parse(await readFile(staleStateFile, "utf8"));
      expect(staleState.target.token).toBe("old-token");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("GUI full chat does not reuse opencode sessions unless explicitly enabled", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-session-reuse-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    const spawnedArgs: string[][] = [];
    await writeGuiConnection(project, {
      projectPath: project,
      guiSessionId: "gui-connected",
      host: "127.0.0.1",
      port: 19001,
      token: "secret-token",
      status: "connected",
      editorInstanceId: "editor-1",
    });
    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
        projects: [{
          projectName: "GuiProject",
          projectPath: project,
          status: "connected",
          uos: { installed: true, installKind: "embedded" },
          bridge: {
            live: true,
            editor: {
              projectName: "GuiProject",
              projectPath: project,
              host: "127.0.0.1",
              port: 19001,
              token: "secret-token",
              uosGuiSessionId: "gui-connected",
              supportedTools: ["get_project_info"],
              writeTools: ["create_ui_screen"],
            },
          },
        }],
      }),
      callUnityTool: async () => ({
        projectName: "GuiProject",
        projectPath: project,
        supportedTools: ["get_project_info"],
        writeTools: ["create_ui_screen"],
      }),
      buildLaunchEnv: async (_target, env) => ({
        ...env,
        UOS_CONTEXT_SUMMARY: "GUI test context",
      }),
      evaluateLaunchBridgeCapabilities: () => ({ ready: true }),
      spawnOpencode: async (args, options) => {
        spawnedArgs.push(args);
        options.onLine?.(JSON.stringify({ type: "session", sessionID: `ses_gui_${spawnedArgs.length}` }), "stdout");
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "버튼을 추가해줘.",
      });
      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "run-complete");

      await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "버튼을 하나 더 추가해줘.",
      });
      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "run-complete" && item.exitCode === 0 && spawnedArgs.length === 2);

      expect(spawnedArgs).toHaveLength(2);
      expect(spawnedArgs[0]).not.toContain("--session");
      expect(spawnedArgs[1]).not.toContain("--session");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("chat blocks without retry when GUI connection token is rejected", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "gui-server-token-retry-test");
    const project = join(root, "UnityProject");
    await rm(root, { recursive: true, force: true });
    await mkdir(project, { recursive: true });

    const preflightTokens: string[] = [];
    let spawnCalls = 0;
    await writeGuiConnection(project, {
      projectPath: project,
      guiSessionId: "gui-connected",
      host: "127.0.0.1",
      port: 19001,
      token: "old-token",
      status: "connected",
      editorInstanceId: "editor-1",
    });
    const app = await startUosGuiServer({
      open: false,
      discoverUnityProjectCatalog: async () => ({
          projects: [{
            projectName: "GuiProject",
            projectPath: project,
            status: "connected",
            uos: { installed: true, installKind: "embedded" },
            bridge: {
              live: true,
              editor: {
                projectName: "GuiProject",
                projectPath: project,
                host: "127.0.0.1",
                port: 19001,
                token: "old-token",
                uosGuiSessionId: "gui-connected",
                supportedTools: ["get_project_info"],
                writeTools: ["create_ui_screen"],
              },
            },
          }],
      }),
      callUnityTool: async (target) => {
        preflightTokens.push(target.token);
        throw new Error("[uos] Unity rejected handshake: invalid token");
      },
      buildLaunchEnv: async (_target, env) => ({
        ...env,
        UOS_CONTEXT_SUMMARY: "GUI test context",
      }),
      evaluateLaunchBridgeCapabilities: () => ({ ready: true }),
      spawnOpencode: async (_args, options) => {
        spawnCalls += 1;
        options.onLine?.(JSON.stringify({ type: "session", sessionID: "ses_gui_3" }), "stdout");
        return { code: 0, signal: null };
      },
    });

    try {
      const session = await createGuiSession(app.url, project);
      const response = await postJson(`${app.url}/api/sessions/${session.guiSessionId}/messages`, {
        message: "버튼을 추가해줘.",
      });
      expect(response.ok).toBe(true);

      await waitForSessionEvent(app.url, session.guiSessionId, (item) => item.type === "full-blocked");
      expect(preflightTokens).toEqual(["old-token"]);
      expect(spawnCalls).toBe(0);
      const connection = JSON.parse(await readFile(guiConnectionPath(project), "utf8"));
      expect(connection.status).toBe("error");
      expect(connection.error).toContain("invalid token");
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createGuiSession(baseUrl: string, projectPath: string) {
  const projects = await getJson(`${baseUrl}/api/projects`);
  const project = projects.projects.find((item: any) => resolve(item.projectPath) === resolve(projectPath));
  expect(project).toBeDefined();
  const data = await postJson(`${baseUrl}/api/sessions`, { projectId: project.projectId });
  return data.session;
}

async function waitForSessionEvent(baseUrl: string, guiSessionId: string, predicate: (event: any) => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const data = await getJson(`${baseUrl}/api/sessions/${guiSessionId}/activity`);
    const event = (data.events ?? []).find(predicate);
    if (event !== undefined) return event;
    await sleep(25);
  }
  throw new Error("timed out waiting for GUI session event");
}

async function getJson(url: string) {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return await response.json();
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  expect({ ok: response.ok, status: response.status, data }).toMatchObject({ ok: true });
  return data;
}
