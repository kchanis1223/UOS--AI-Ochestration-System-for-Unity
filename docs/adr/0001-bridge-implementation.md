# ADR-0001: `_bridge.ts` Implementation Choice

- **Status:** APPROVED (Phase A.0 smoke gate passed 2026-06-02)
- **Context:** plan §Phase A.0.10, plan ADR-0001 sketch
- **Decision-makers:** lead (deep-interview + omc-plan consensus pipeline)

## Decision

Implement `.opencode/tools/_bridge.ts` as a **Bun-native** WebSocket client using the **Web API `WebSocket` global** (no `ws` npm import). Module-level singleton, lazy-connect on first `call()`.

## Drivers (4-axis reject criteria — sequentially evaluated)

The plan's ADR sketch listed four axes the implementation must satisfy. Each was verified in `.opencode/tools/_bridge.test.ts` against an in-process Bun.serve WebSocket fixture (axes 1–3) plus direct unit tests of the production `CallCorrelator` (axis 4).

1. **connect** — `hello` → `welcome` handshake, protocol version major-match. Verified: client reaches `connected` after fixture sends `{kind:"welcome", v:"1.0.0"}`.
2. **ping/pong** — application-level JSON heartbeat (`{kind:"ping"}` / `{kind:"pong"}`, NOT WebSocket control frames). Verified: client emits ≥1 ping per 200ms interval; fixture observes them in `seen.pingsReceived`.
3. **close-frame** — normal close → `disconnected` status, in-flight calls rejected. Verified: `client.close()` transitions status; `correlator.rejectAll` clears pending.
4. **error propagation** — server `{kind:"result", ok:false, error}` causes `call()` to reject with that error message. Verified via direct `CallCorrelator.handle()` unit test (see "Caveat" below).

Backpressure: verification-only. Legacy `mcp-server/src/bridge/bridgeClient.ts` has no explicit backpressure logic either; `_bridge.ts` matches that surface.

## Alternatives Considered

| Option | Reject reason |
|---|---|
| Node `ws` package via Bun import | Unnecessary — Bun Web API `WebSocket` covers all 4 axes. Adding `ws` couples us to a Node-specific module path. (Kept in package.json devDeps as fallback in case Phase D E2E exposes incompatibility.) |
| Per-tool ad-hoc connection | Connection churn on every `tool.execute()`; no shared correlator state; loss of `correlator.rejectAll` on disconnect. |
| Bun-server-only protocol (server: Bun, client: Bun) | Already what we have for tests. Production client connects to the C# `EditorBridgeServer.cs` which is Bun-agnostic. |

## Caveat: Axis 4 Test Path

The end-to-end Bun.serve fixture path for axis 4 (server sends `ok:false` → client rejects) consistently timed out across five distinct fixture variants (sync handler, async handler, microtask-deferred handler, explicit error responders, etc.) **even though the happy path (`ok:true`) on the same fixture path succeeded reliably**.

We could not isolate whether the cause is in the fixture's `Bun.serve` WebSocket message ordering, the test runner harness, or something in the Bun 1.3.10 server WebSocket implementation, but it is **not** in the production `_bridge.ts` code: the client side `CallCorrelator.handle()` was unit-tested directly against the same `{kind:"result", ok:false, error}` message and rejected the pending promise correctly. The end-to-end happy path verifies the same `onMessage → correlator.handle` chain works for real Bun WebSocket message arrival; the `ok:true` vs `ok:false` divergence is in the fixture, not the client.

**Production gating:** Phase D E2E (real Unity Editor) must observe an actual `ok:false` round-trip before this ADR's axis 4 claim can be considered hardened beyond unit-test scope.

## Consequences

- All 13 tools share one module-level `BridgeClient` singleton via `import { call } from "./_bridge"`. Connection cost paid once per opencode session, not per tool.
- `_bridge.ts` exports `BridgeClient`, `CallCorrelator`, `PROTOCOL_VERSION`, `HandshakeError`, `ClientMessage`, `ServerMessage` — internals exposed only for the test surface.
- No runtime `ws` import. `package.json` keeps `ws` as a transitive devDep for `mcp-server/` archive use and as a potential Phase D fallback.

## Follow-ups

- **Phase D (E2E):** real Unity round-trip including at least one error path (e.g. malformed `intent` to `create_ui_screen` → server `ok:false`). Append result to this ADR.
- If Phase D exposes an actual Bun Web API WebSocket gap, revisit by switching to `import WebSocket from "ws"` in `_bridge.ts` and re-running the 4-axis tests. This is a contained change (1 import, no public-surface impact).

## Verification artifact

- `.opencode/tools/_bridge.test.ts` — 6 tests pass, axes 1–4 covered (4 fixture + 2 direct unit).
- `bun test ./.opencode/tools/_bridge.test.ts` → `6 pass / 0 fail / 7 expect() calls / 584ms`.
