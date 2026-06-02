import { describe, it, expect, vi } from "vitest";
import {
  CallCorrelator,
  checkWelcome,
  decodeServerMessage,
  encodeClientMessage,
  HandshakeError,
  majorOf,
  type ClientMessage,
  type ServerMessage,
} from "../src/bridge/protocol.js";

describe("encode/decode", () => {
  it("round-trips a client message", () => {
    const msg: ClientMessage = { kind: "call", id: 1, tool: "list_screens", args: {} };
    expect(JSON.parse(encodeClientMessage(msg))).toEqual(msg);
  });

  it("decodes a valid server message", () => {
    const raw = JSON.stringify({ kind: "welcome", v: "1.0.0" });
    expect(decodeServerMessage(raw)).toEqual({ kind: "welcome", v: "1.0.0" });
  });

  it("throws on malformed JSON", () => {
    expect(() => decodeServerMessage("{not json")).toThrow(/malformed JSON/);
  });

  it("throws on a message without kind", () => {
    expect(() => decodeServerMessage(JSON.stringify({ foo: 1 }))).toThrow(/missing "kind"/);
  });
});

describe("checkWelcome", () => {
  it("accepts a matching major version", () => {
    expect(() => checkWelcome({ kind: "welcome", v: "1.4.2" }, "1.0.0")).not.toThrow();
  });

  it("rejects a major mismatch", () => {
    expect(() => checkWelcome({ kind: "welcome", v: "2.0.0" }, "1.0.0")).toThrow(HandshakeError);
  });

  it("rejects an explicit reject", () => {
    expect(() => checkWelcome({ kind: "reject", reason: "bad token" }, "1.0.0")).toThrow(/bad token/);
  });

  it("rejects an unexpected message kind", () => {
    expect(() => checkWelcome({ kind: "pong" }, "1.0.0")).toThrow(/expected welcome/);
  });
});

describe("majorOf", () => {
  it("extracts the major component", () => {
    expect(majorOf("1.2.3")).toBe("1");
    expect(majorOf("12.0.0")).toBe("12");
  });
});

describe("CallCorrelator", () => {
  it("correlates a result to its call", async () => {
    const sent: ClientMessage[] = [];
    const c = new CallCorrelator((m) => sent.push(m), 0);
    const promise = c.call("list_screens", { a: 1 });
    expect(c.inFlight).toBe(1);
    const sentMsg = sent[0];
    expect(sentMsg?.kind).toBe("call");
    const id = sentMsg?.kind === "call" ? sentMsg.id : -1;
    const reply: ServerMessage = { kind: "result", id, ok: true, data: { screens: [] } };
    expect(c.handle(reply)).toBe(true);
    await expect(promise).resolves.toEqual({ screens: [] });
    expect(c.inFlight).toBe(0);
  });

  it("rejects on an error result", async () => {
    const sent: ClientMessage[] = [];
    const c = new CallCorrelator((m) => sent.push(m), 0);
    const promise = c.call("create_ui_screen", {});
    const sentMsg = sent[0];
    const id = sentMsg?.kind === "call" ? sentMsg.id : -1;
    c.handle({ kind: "result", id, ok: false, error: "busy: single-writer lock held" });
    await expect(promise).rejects.toThrow(/busy/);
  });

  it("ignores results for unknown ids", () => {
    const c = new CallCorrelator(() => {}, 0);
    expect(c.handle({ kind: "result", id: 999, ok: true, data: null })).toBe(false);
  });

  it("rejectAll fails every in-flight call", async () => {
    const c = new CallCorrelator(() => {}, 0);
    const p1 = c.call("a", {});
    const p2 = c.call("b", {});
    expect(c.inFlight).toBe(2);
    c.rejectAll("connection lost");
    await expect(p1).rejects.toThrow(/connection lost/);
    await expect(p2).rejects.toThrow(/connection lost/);
    expect(c.inFlight).toBe(0);
  });

  it("times out a call", async () => {
    vi.useFakeTimers();
    try {
      const c = new CallCorrelator(() => {}, 1000);
      const promise = c.call("slow", {});
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects the call if send throws", async () => {
    const c = new CallCorrelator(() => {
      throw new Error("socket not open");
    }, 0);
    await expect(c.call("x", {})).rejects.toThrow(/socket not open/);
  });
});
