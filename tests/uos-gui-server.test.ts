import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startUosGuiServer } from "../bin/uos-gui-server.js";
import { guiProjectId, writeGuiConnection } from "../bin/uos-gui-core.js";

const projectDir = resolve(join(import.meta.dir, "..", ".omx", "tmp", "uos-gui-server-e2e"));
const projectId = guiProjectId(projectDir);
const GUI_SESSION_ID = "gui-e2e-session";
const EDITOR_INSTANCE_ID = "editor-e2e";
const BRIDGE_TOKEN = "gui-e2e-token";

const REQUIRED_TOOLS = JSON.parse(
  await readFile(join(import.meta.dir, "..", "bridge-capabilities.json"), "utf8"),
);

function fakeProjectInfo() {
  return {
    projectName: "E2EGame",
    projectPath: projectDir,
    unityVersion: "6000.0.68f1",
    uosPackageName: "com.lyx.oh-my-unity",
    uosPackageVersion: "0.1.0",
    protocolVersion: "1.0.0",
    bridgeHost: "127.0.0.1",
    bridgePort: 4242,
    autoStartBridge: true,
    editorInstanceId: EDITOR_INSTANCE_ID,
    supportedTools: REQUIRED_TOOLS.requiredTools,
    writeTools: REQUIRED_TOOLS.requiredWriteTools,
  };
}

function fakeCatalog() {
  return {
    count: 1,
    projects: [
      {
        projectId,
        projectName: "E2EGame",
        projectPath: projectDir,
        uos: { installed: true, packageName: "com.lyx.oh-my-unity" },
        bridge: {
          live: true,
          editor: {
            instanceId: EDITOR_INSTANCE_ID,
            projectName: "E2EGame",
            projectPath: projectDir,
            host: "127.0.0.1",
            port: 4242,
            uosGuiSessionId: GUI_SESSION_ID,
          },
        },
      },
    ],
  };
}

const unityCalls: string[] = [];
const opencodeSpawns: Array<{ args: string[] }> = [];

const serverOptions = {
  open: false,
  discoverUnityProjectCatalog: async () => fakeCatalog(),
  callUnityTool: async (_target: any, tool: string) => {
    unityCalls.push(tool);
    if (tool === "get_project_info") return fakeProjectInfo();
    return { ok: true };
  },
  spawnOpencode: async (args: string[], options: any) => {
    opencodeSpawns.push({ args });
    options.onChild?.({ pid: 4242 });
    const lines = [
      JSON.stringify({ type: "step", sessionID: "ses_e2e_1" }),
      JSON.stringify({ type: "tool", tool: "get_uos_context", sessionID: "ses_e2e_1" }),
      JSON.stringify({ type: "tool", tool: "create_ui_screen", sessionID: "ses_e2e_1" }),
      JSON.stringify({ type: "message", role: "assistant", text: "로비 화면을 생성했습니다.", sessionID: "ses_e2e_1" }),
    ];
    for (const line of lines) options.onLine?.(line, "stdout");
    return { code: 0 };
  },
};

let server: Awaited<ReturnType<typeof startUosGuiServer>>;
let baseUrl = "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${path}`, init);
  return { status: res.status, body: await res.json() };
}

async function waitForEvent(guiSessionId: string, type: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api(`/api/sessions/${guiSessionId}/activity`);
    const events = body.events ?? [];
    const found = events.find((event: any) => event?.type === type);
    if (found !== undefined) return { found, events };
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const { body } = await api(`/api/sessions/${guiSessionId}/activity`);
  throw new Error(`timed out waiting for event ${type}; saw ${JSON.stringify((body.events ?? []).map((e: any) => e.type))}`);
}

beforeAll(async () => {
  await rm(projectDir, { recursive: true, force: true });
  await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
  await writeGuiConnection(projectDir, {
    projectId,
    projectPath: projectDir,
    guiSessionId: GUI_SESSION_ID,
    host: "127.0.0.1",
    port: 4242,
    token: BRIDGE_TOKEN,
    status: "connected",
    editorInstanceId: EDITOR_INSTANCE_ID,
  });
  server = await startUosGuiServer(serverOptions);
  baseUrl = server.url;
});

afterAll(async () => {
  await server?.close();
  await rm(projectDir, { recursive: true, force: true });
});

describe("uos-gui-server end-to-end with mocked bridge and opencode", () => {
  test("health endpoint responds", async () => {
    const { status, body } = await api("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.app).toBe("uos-gui");
  });

  test("project catalog reports the GUI-managed project as connected", async () => {
    const { status, body } = await api("/api/projects");
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    const project = body.projects[0];
    expect(project.projectId).toBe(projectId);
    expect(project.status).toBe("connected");
    expect(project.connected).toBe(true);
    expect(unityCalls).toContain("get_project_info");
    expect(JSON.stringify(body)).not.toContain(BRIDGE_TOKEN);
  });

  test("full Ochestrator turn streams bridge, approval, opencode, and completion events", async () => {
    const created = await api("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    expect(created.status).toBe(200);
    const guiSessionId = created.body.session.guiSessionId;
    expect(typeof guiSessionId).toBe("string");

    const message = await api(`/api/sessions/${guiSessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "기획서대로 로비 화면을 만들어줘" }),
    });
    expect(message.status).toBe(202);

    const { events } = await waitForEvent(guiSessionId, "run-complete");
    const types = events.map((event: any) => event.type);
    expect(types).toContain("chat-route");
    expect(events.find((event: any) => event.type === "chat-route")?.route).toBe("full-ochestrator");
    expect(types).toContain("approval-prepared");
    expect(types).toContain("bridge-ready");
    expect(types).toContain("opencode-start");
    expect(types).toContain("tool");
    expect(types).toContain("run-complete");
    expect(JSON.stringify(events)).not.toContain(BRIDGE_TOKEN);

    expect(opencodeSpawns.length).toBe(1);
    const args = opencodeSpawns[0].args;
    expect(args[0]).toBe("run");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(args).toContain("--agent");
    expect(args).toContain("ochestrator");

    const context = await api(`/api/sessions/${guiSessionId}/context`);
    expect(context.status).toBe(200);
    expect(context.body.session.opencodeSessionId).toBe("ses_e2e_1");
    expect(context.body.session.lastExitCode).toBe(0);
  });

  test("light-local route answers without spawning opencode", async () => {
    const spawnsBefore = opencodeSpawns.length;
    const created = await api("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const guiSessionId = created.body.session.guiSessionId;
    await api(`/api/sessions/${guiSessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "현재 연결 상태 알려줘" }),
    });
    const { events } = await waitForEvent(guiSessionId, "text");
    const route = events.find((event: any) => event.type === "chat-route");
    expect(route?.route).toBe("light-local");
    expect(opencodeSpawns.length).toBe(spawnsBefore);
  });
});
