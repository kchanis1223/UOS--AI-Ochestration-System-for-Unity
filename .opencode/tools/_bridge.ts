/**
 * .opencode/tools/_bridge.ts
 *
 * Module-level singleton WebSocket bridge to the Unity Editor listener.
 * Ported from mcp-server/src/bridge/{bridgeClient,protocol}.ts for the Bun runtime.
 *
 * Protocol: application-level JSON over a single WebSocket.
 *   client -> {kind:"hello", v, token}
 *   server -> {kind:"welcome", v}  |  {kind:"reject", reason}
 *   client -> {kind:"call", id, tool, args}
 *   server -> {kind:"result", id, ok:true, data}  |  {kind:"result", id, ok:false, error}
 *   client -> {kind:"ping"}   server -> {kind:"pong"}
 *
 * ADR-0001 axes (verified in _bridge.test.ts):
 *   1. connect:           ws://host:port handshake + welcome version check
 *   2. ping/pong:         application-level JSON heartbeat (NOT WS control frames)
 *   3. close-frame:       normal close → status disconnected, schedule reconnect
 *   4. error propagation: server result.ok=false → call() rejects with that error
 *   (backpressure: verification-only; not implemented in legacy bridge either)
 */

export const PROTOCOL_VERSION = "1.0.0";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17801;

export interface BridgeConfig {
  host: string;
  port: number;
  sharedToken: string;
  protocolVersion: string;
  callTimeoutMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  heartbeatMs: number;
}

export type ClientMessage =
  | { kind: "hello"; v: string; token: string }
  | { kind: "call"; id: number; tool: string; args: unknown }
  | { kind: "ping" };

export type ServerMessage =
  | { kind: "welcome"; v: string }
  | { kind: "reject"; reason: string }
  | { kind: "result"; id: number; ok: true; data: unknown }
  | { kind: "result"; id: number; ok: false; error: string }
  | { kind: "pong" };

type BridgeStatus = "disconnected" | "connecting" | "connected";

export class HandshakeError extends Error {}

function majorOf(version: string): string {
  return version.split(".")[0] ?? version;
}

function checkWelcome(msg: ServerMessage, expectedVersion: string): void {
  if (msg.kind === "reject") throw new HandshakeError(`Unity rejected handshake: ${msg.reason}`);
  if (msg.kind !== "welcome") throw new HandshakeError(`expected welcome, got "${msg.kind}"`);
  if (majorOf(msg.v) !== majorOf(expectedVersion)) {
    throw new HandshakeError(
      `protocol version mismatch: client ${expectedVersion} vs Unity ${msg.v} (major versions must match)`,
    );
  }
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class CallCorrelator {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  constructor(
    private readonly send: (msg: ClientMessage) => void,
    private readonly timeoutMs: number,
  ) {}
  call(tool: string, args: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer =
        this.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`bridge: call "${tool}" (id ${id}) timed out after ${this.timeoutMs}ms`));
            }, this.timeoutMs)
          : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ kind: "call", id, tool, args });
      } catch (err) {
        const entry = this.pending.get(id);
        if (entry !== undefined) {
          this.pending.delete(id);
          if (entry.timer !== undefined) clearTimeout(entry.timer);
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  }
  handle(msg: ServerMessage): boolean {
    if (msg.kind !== "result") return false;
    const entry = this.pending.get(msg.id);
    if (entry === undefined) return false;
    this.pending.delete(msg.id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.data);
    else entry.reject(new Error(msg.error));
    return true;
  }
  rejectAll(reason: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}

export class BridgeClient {
  private ws: WebSocket | undefined;
  private status: BridgeStatus = "disconnected";
  private readonly correlator: CallCorrelator;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private closedByUser = false;
  private welcomePromise: Promise<void> | undefined;
  private welcomeResolve: (() => void) | undefined;
  private welcomeReject: ((err: Error) => void) | undefined;

  constructor(private readonly config: BridgeConfig) {
    this.correlator = new CallCorrelator(
      (msg) => this.rawSend(JSON.stringify(msg)),
      config.callTimeoutMs,
    );
  }

  get currentStatus(): BridgeStatus {
    return this.status;
  }

  connect(): Promise<void> {
    if (this.status === "connected") return Promise.resolve();
    if (this.welcomePromise !== undefined) return this.welcomePromise;
    this.closedByUser = false;
    this.welcomePromise = new Promise<void>((resolve, reject) => {
      this.welcomeResolve = resolve;
      this.welcomeReject = reject;
    });
    this.openSocket();
    return this.welcomePromise;
  }

  async call(tool: string, args: unknown): Promise<unknown> {
    if (this.status !== "connected") await this.connect();
    return this.correlator.call(tool, args);
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.correlator.rejectAll("bridge: client closed");
    this.ws?.close();
    this.ws = undefined;
    this.status = "disconnected";
  }

  private openSocket(): void {
    this.status = "connecting";
    const url = `ws://${this.config.host}:${this.config.port}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.rawSend(
        JSON.stringify({ kind: "hello", v: this.config.protocolVersion, token: this.config.sharedToken } satisfies ClientMessage),
      );
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      this.onMessage(raw);
    });
    ws.addEventListener("close", () => this.onClose());
    ws.addEventListener("error", () => {
      // Web API error event carries no detail; closure follows.
    });
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) {
        throw new Error(`malformed message`);
      }
      msg = parsed as ServerMessage;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.welcomeReject?.(new HandshakeError(`bridge: ${detail}`));
      this.welcomePromise = undefined;
      this.welcomeResolve = undefined;
      this.welcomeReject = undefined;
      return;
    }

    if (this.status === "connecting") {
      try {
        checkWelcome(msg, this.config.protocolVersion);
        this.reconnectAttempts = 0;
        this.status = "connected";
        this.startHeartbeat();
        this.welcomeResolve?.();
      } catch (err) {
        if (err instanceof HandshakeError) this.closedByUser = true;
        this.welcomeReject?.(err instanceof Error ? err : new Error(String(err)));
        this.ws?.close();
      } finally {
        this.welcomePromise = undefined;
        this.welcomeResolve = undefined;
        this.welcomeReject = undefined;
      }
      return;
    }

    if (msg.kind === "pong") return;
    this.correlator.handle(msg);
  }

  private onClose(): void {
    this.stopHeartbeat();
    this.correlator.rejectAll("bridge: connection to Unity lost");
    this.status = "disconnected";
    if (this.welcomeReject !== undefined) {
      this.welcomeReject(new Error("bridge: closed before welcome"));
      this.welcomePromise = undefined;
      this.welcomeResolve = undefined;
      this.welcomeReject = undefined;
    }
    if (!this.closedByUser) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const base = this.config.reconnectBaseMs;
    const max = this.config.reconnectMaxMs;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private startHeartbeat(): void {
    if (this.config.heartbeatMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      try {
        this.rawSend(JSON.stringify({ kind: "ping" } satisfies ClientMessage));
      } catch {
        // Send may throw if socket closed mid-tick; onClose will handle cleanup.
      }
    }, this.config.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private rawSend(data: string): void {
    if (this.ws === undefined || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("bridge: socket not open");
    }
    this.ws.send(data);
  }
}

function resolveConfig(): BridgeConfig {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const portRaw = env["UNITY_MCP_PORT"]?.trim();
  const port = portRaw !== undefined && portRaw.length > 0
    ? (Number.parseInt(portRaw, 10) || DEFAULT_PORT)
    : DEFAULT_PORT;
  const host = env["UNITY_MCP_HOST"]?.trim() || DEFAULT_HOST;
  const sharedToken = env["UNITY_MCP_TOKEN"]?.trim() ?? "";
  return {
    host,
    port,
    sharedToken,
    protocolVersion: PROTOCOL_VERSION,
    callTimeoutMs: 30_000,
    reconnectBaseMs: 500,
    reconnectMaxMs: 10_000,
    heartbeatMs: 15_000,
  };
}

let _singleton: BridgeClient | undefined;
export function bridge(): BridgeClient {
  if (_singleton === undefined) _singleton = new BridgeClient(resolveConfig());
  return _singleton;
}

/** Convenience: call a Unity-side tool. Lazy-connects on first use. */
export async function call(tool: string, args: unknown): Promise<unknown> {
  return bridge().call(tool, args);
}
