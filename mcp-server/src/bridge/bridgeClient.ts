import WebSocket from "ws";
import {
  CallCorrelator,
  checkWelcome,
  decodeServerMessage,
  encodeClientMessage,
  HandshakeError,
} from "./protocol.js";

export interface BridgeConfig {
  host: string;
  port: number;
  sharedToken: string;
  protocolVersion: string;
  callTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  heartbeatMs?: number;
}

export type BridgeStatus = "disconnected" | "connecting" | "connected";

type StatusListener = (status: BridgeStatus, detail?: string) => void;

/**
 * Live WebSocket bridge to the Unity Editor listener with handshake, shared-token
 * auth, version check, request/response correlation, and reconnect-with-backoff.
 *
 * Verification boundary: the correlation/handshake logic is unit-tested via
 * protocol.ts with a fake transport; this class's socket lifecycle is verified
 * against the real Unity Editor listener (human-verified, cannot run headless).
 */
export class BridgeClient {
  private ws: WebSocket | undefined;
  private status: BridgeStatus = "disconnected";
  private readonly correlator: CallCorrelator;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private closedByUser = false;
  private readonly statusListeners = new Set<StatusListener>();

  constructor(private readonly config: BridgeConfig) {
    this.correlator = new CallCorrelator(
      (msg) => this.rawSend(encodeClientMessage(msg)),
      config.callTimeoutMs ?? 30_000,
    );
  }

  get currentStatus(): BridgeStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  async call(tool: string, args: unknown): Promise<unknown> {
    if (this.status !== "connected") {
      throw new Error(`bridge: not connected to Unity (status: ${this.status})`);
    }
    return this.correlator.call(tool, args);
  }

  close(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.correlator.rejectAll("bridge: client closed");
    this.ws?.close();
    this.ws = undefined;
    this.setStatus("disconnected");
  }

  private openSocket(): void {
    this.setStatus("connecting");
    const url = `ws://${this.config.host}:${this.config.port}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.rawSend(
        encodeClientMessage({ kind: "hello", v: this.config.protocolVersion, token: this.config.sharedToken }),
      );
    });

    ws.on("message", (data: WebSocket.RawData) => this.onMessage(data.toString()));
    ws.on("close", () => this.onClose());
    ws.on("error", (err: Error) => this.setStatus(this.status, err.message));
  }

  private onMessage(raw: string): void {
    let msg;
    try {
      msg = decodeServerMessage(raw);
    } catch (err) {
      this.setStatus(this.status, err instanceof Error ? err.message : String(err));
      return;
    }

    if (this.status === "connecting") {
      try {
        checkWelcome(msg, this.config.protocolVersion);
        this.reconnectAttempts = 0;
        this.setStatus("connected");
        this.startHeartbeat();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.setStatus("disconnected", detail);
        // Version/token mismatch is not transient: stop retrying.
        if (err instanceof HandshakeError) {
          this.closedByUser = true;
        }
        this.ws?.close();
      }
      return;
    }

    if (msg.kind === "pong") return;
    this.correlator.handle(msg);
  }

  private onClose(): void {
    this.stopHeartbeat();
    this.correlator.rejectAll("bridge: connection to Unity lost");
    this.setStatus("disconnected");
    if (!this.closedByUser) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const base = this.config.reconnectBaseMs ?? 500;
    const max = this.config.reconnectMaxMs ?? 10_000;
    const delay = Math.min(base * 2 ** this.reconnectAttempts, max);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatMs ?? 15_000;
    if (interval <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      this.rawSend(encodeClientMessage({ kind: "ping" }));
    }, interval);
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

  private setStatus(status: BridgeStatus, detail?: string): void {
    this.status = status;
    for (const listener of this.statusListeners) listener(status, detail);
  }
}
