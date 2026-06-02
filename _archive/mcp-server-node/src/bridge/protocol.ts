/**
 * Pure, transport-agnostic wire protocol for the sidecar <-> Unity Editor bridge.
 *
 * This module holds the deterministic parts (message encode/decode, handshake
 * validation, request/response correlation) so they are unit-testable without a
 * live Unity listener. The socket + reconnect lifecycle lives in bridgeClient.ts
 * and is verified against the real Editor (human-verified boundary).
 */

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

export function encodeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeServerMessage(raw: string): ServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`bridge: malformed JSON from Unity: ${truncate(raw)}`);
  }
  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) {
    throw new Error(`bridge: message missing "kind": ${truncate(raw)}`);
  }
  return parsed as ServerMessage;
}

function truncate(s: string, max = 120): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

export class HandshakeError extends Error {}

/**
 * Validate the server's response to a hello. Throws HandshakeError on reject or
 * on a major-version mismatch (the contract is incompatible across majors).
 */
export function checkWelcome(msg: ServerMessage, expectedVersion: string): void {
  if (msg.kind === "reject") {
    throw new HandshakeError(`Unity rejected handshake: ${msg.reason}`);
  }
  if (msg.kind !== "welcome") {
    throw new HandshakeError(`expected welcome, got "${msg.kind}"`);
  }
  if (majorOf(msg.v) !== majorOf(expectedVersion)) {
    throw new HandshakeError(
      `protocol version mismatch: sidecar ${expectedVersion} vs Unity ${msg.v} (major versions must match)`,
    );
  }
}

export function majorOf(version: string): string {
  return version.split(".")[0] ?? version;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Correlates outbound calls with their results by monotonically increasing id.
 * Transport-free: callers wire `send` and feed inbound results via `handle`.
 */
export class CallCorrelator {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly send: (msg: ClientMessage) => void,
    private readonly timeoutMs = 30_000,
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
        this.settleReject(id, err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Feed an inbound server message. Returns true if it resolved a pending call. */
  handle(msg: ServerMessage): boolean {
    if (msg.kind !== "result") return false;
    const entry = this.pending.get(msg.id);
    if (entry === undefined) return false;
    this.pending.delete(msg.id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg.data);
    } else {
      entry.reject(new Error(msg.error));
    }
    return true;
  }

  /** Reject all in-flight calls, e.g. on disconnect. */
  rejectAll(reason: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  get inFlight(): number {
    return this.pending.size;
  }

  private settleReject(id: number, err: Error): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.delete(id);
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.reject(err);
  }
}
