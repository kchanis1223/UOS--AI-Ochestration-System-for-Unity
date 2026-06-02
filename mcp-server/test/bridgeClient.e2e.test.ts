import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { AddressInfo } from "node:net";
import { BridgeClient } from "../src/bridge/bridgeClient.js";
import { dispatchToolCall } from "../src/tools/dispatch.js";

/**
 * Headless e2e for the sidecar bridge: a real WebSocket server stands in for the
 * Unity Editor listener so the bridgeClient socket lifecycle (handshake, request
 * correlation, ping/pong, reconnect, version/token rejection) is exercised end
 * to end without an actual Editor. Complements protocol.test.ts (transport-free)
 * and dispatch.test.ts (fake caller).
 */

interface FakeUnity {
  port: number;
  close: () => Promise<void>;
  /** Replace the per-connection behavior at runtime (e.g. between reconnects). */
  setHandler: (handler: (socket: WsWebSocket) => void) => void;
  /** Forcibly drop all live client sockets to simulate a domain reload. */
  dropAllClients: () => void;
}

function startFakeUnity(initialHandler: (socket: WsWebSocket) => void): Promise<FakeUnity> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    let handler = initialHandler;
    const liveSockets = new Set<WsWebSocket>();

    wss.on("connection", (socket) => {
      liveSockets.add(socket);
      socket.on("close", () => liveSockets.delete(socket));
      handler(socket);
    });
    wss.on("error", reject);
    wss.on("listening", () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const s of liveSockets) s.terminate();
            wss.close(() => res());
          }),
        setHandler: (h) => {
          handler = h;
        },
        dropAllClients: () => {
          for (const s of liveSockets) s.terminate();
        },
      });
    });
  });
}

/** Default fake-Unity behavior: accept any token, respond to calls with echo data. */
function welcomeAndEcho(socket: WsWebSocket): void {
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as { kind: string; id?: number; tool?: string; args?: unknown };
    if (msg.kind === "hello") {
      socket.send(JSON.stringify({ kind: "welcome", v: "1.0.0" }));
      return;
    }
    if (msg.kind === "ping") {
      socket.send(JSON.stringify({ kind: "pong" }));
      return;
    }
    if (msg.kind === "call") {
      socket.send(
        JSON.stringify({ kind: "result", id: msg.id, ok: true, data: { echoedTool: msg.tool, args: msg.args } }),
      );
    }
  });
}

function makeClient(port: number, overrides: Partial<{ token: string; version: string }> = {}): BridgeClient {
  return new BridgeClient({
    host: "127.0.0.1",
    port,
    sharedToken: overrides.token ?? "test-token",
    protocolVersion: overrides.version ?? "1.0.0",
    callTimeoutMs: 2_000,
    reconnectBaseMs: 25,
    reconnectMaxMs: 100,
    heartbeatMs: 0, // disabled by default; tests that need heartbeat opt in
  });
}

function waitForStatus(client: BridgeClient, target: "connected" | "disconnected"): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (client.currentStatus === target) {
      resolve(undefined);
      return;
    }
    const off = client.onStatus((status, detail) => {
      if (status === target) {
        off();
        resolve(detail);
      }
    });
  });
}

let toCleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of toCleanup.reverse()) await fn();
  toCleanup = [];
});

describe("BridgeClient over a real WebSocket", () => {
  it("completes the handshake and round-trips a call", async () => {
    const unity = await startFakeUnity(welcomeAndEcho);
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());

    client.connect();
    await waitForStatus(client, "connected");
    const result = await client.call("list_screens", { foo: "bar" });
    expect(result).toEqual({ echoedTool: "list_screens", args: { foo: "bar" } });
  });

  it("propagates a Unity-side error result as a rejection", async () => {
    const unity = await startFakeUnity((socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { kind: string; id?: number };
        if (msg.kind === "hello") {
          socket.send(JSON.stringify({ kind: "welcome", v: "1.0.0" }));
        } else if (msg.kind === "call") {
          socket.send(
            JSON.stringify({ kind: "result", id: msg.id, ok: false, error: "busy: another write is in progress" }),
          );
        }
      });
    });
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());
    client.connect();
    await waitForStatus(client, "connected");

    await expect(client.call("create_ui_screen", {})).rejects.toThrow(/busy/);
  });

  it("rejects on protocol major-version mismatch and stops reconnecting", async () => {
    const unity = await startFakeUnity((socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { kind: string };
        if (msg.kind === "hello") {
          socket.send(JSON.stringify({ kind: "welcome", v: "2.0.0" }));
        }
      });
    });
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());
    client.connect();
    const detail = await waitForStatus(client, "disconnected");
    expect(detail).toMatch(/protocol version mismatch/);
  });

  it("rejects on a Unity 'reject' frame (bad token)", async () => {
    const unity = await startFakeUnity((socket) => {
      socket.on("message", () => {
        socket.send(JSON.stringify({ kind: "reject", reason: "invalid token" }));
      });
    });
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port, { token: "wrong" });
    toCleanup.push(() => client.close());
    client.connect();
    const detail = await waitForStatus(client, "disconnected");
    expect(detail).toMatch(/invalid token/);
  });

  it("correlates multiple in-flight calls by id", async () => {
    const unity = await startFakeUnity((socket) => {
      const queue: Array<{ id: number; data: unknown }> = [];
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { kind: string; id?: number; tool?: string };
        if (msg.kind === "hello") {
          socket.send(JSON.stringify({ kind: "welcome", v: "1.0.0" }));
          return;
        }
        if (msg.kind === "call" && msg.id !== undefined) {
          queue.push({ id: msg.id, data: { tool: msg.tool } });
          // Drain in reverse to prove correlation isn't order-sensitive.
          if (queue.length === 2) {
            for (const entry of queue.reverse()) {
              socket.send(JSON.stringify({ kind: "result", id: entry.id, ok: true, data: entry.data }));
            }
          }
        }
      });
    });
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());
    client.connect();
    await waitForStatus(client, "connected");

    const [a, b] = await Promise.all([client.call("list_screens", {}), client.call("capture_preview", { screenId: "s" })]);
    expect(a).toEqual({ tool: "list_screens" });
    expect(b).toEqual({ tool: "capture_preview" });
  });

  it("rejects in-flight calls when the connection drops", async () => {
    const unity = await startFakeUnity((socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { kind: string };
        if (msg.kind === "hello") {
          socket.send(JSON.stringify({ kind: "welcome", v: "1.0.0" }));
        }
        // Calls are swallowed; we then kill the socket from the test.
      });
    });
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());
    client.connect();
    await waitForStatus(client, "connected");

    const pending = client.call("list_screens", {});
    unity.dropAllClients();
    await expect(pending).rejects.toThrow(/connection to Unity lost/);
  });

  it("reconnects after the server drops the socket", async () => {
    const unity = await startFakeUnity(welcomeAndEcho);
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());
    client.connect();
    await waitForStatus(client, "connected");

    // Simulate a domain reload: drop the live socket and wait for re-handshake.
    unity.dropAllClients();
    await waitForStatus(client, "disconnected");
    await waitForStatus(client, "connected");

    const result = await client.call("list_screens", {});
    expect(result).toEqual({ echoedTool: "list_screens", args: {} });
  });

  it("plumbs dispatchToolCall through a real bridge round-trip", async () => {
    const unity = await startFakeUnity((socket) => {
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { kind: string; id?: number; tool?: string };
        if (msg.kind === "hello") {
          socket.send(JSON.stringify({ kind: "welcome", v: "1.0.0" }));
          return;
        }
        if (msg.kind === "call" && msg.id !== undefined) {
          socket.send(
            JSON.stringify({
              kind: "result",
              id: msg.id,
              ok: true,
              data: { screenId: "screen-1", elements: [{ clientHintId: "p", elementId: "elem-1" }] },
            }),
          );
        }
      });
    });
    toCleanup.push(() => unity.close());

    const client = makeClient(unity.port);
    toCleanup.push(() => client.close());
    client.connect();
    await waitForStatus(client, "connected");

    const outcome = await dispatchToolCall(
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "Home",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [{ clientHintId: "p", type: "Panel", rect: { x: 0, y: 0, w: 1, h: 1 } }],
        },
      },
      (tool, args) => client.call(tool, args),
    );
    expect(outcome.isError).toBe(false);
    expect(outcome.data).toMatchObject({ screenId: "screen-1" });
  });
});
