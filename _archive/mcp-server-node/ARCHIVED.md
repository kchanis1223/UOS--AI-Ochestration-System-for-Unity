# mcp-server-node — ARCHIVED

This is the legacy Node.js stdio MCP sidecar (`@lyx/unity-conv-mcp-sidecar v0.1.0`) that proxied 13 tool calls to the Unity Editor over WebSocket. It is **no longer the runtime**.

## Why archived

- oh-my-unity v0.1 ships an **opencode.ai native** runtime at `.opencode/tools/*.ts` (Bun).
- Native tools consume the same `EditorBridgeServer` (WebSocket protocol unchanged) but skip the stdio MCP layer entirely: lower latency, `context.directory` injected directly, per-tool opencode permission grain.
- Decision rationale: see `.omc/specs/deep-interview-oh-my-unity-rebrand.md` Round 5 (Contrarian challenge passed) and `.omc/plans/plan-oh-my-unity-rebrand.md` Phase A.1 + ADR-0001.

## Kept here for

1. Source-of-truth reference when porting / debugging a tool — the original ajv schemas and dispatch logic are preserved.
2. `vitest` suites that were not migrated to Bun test (deliberate non-goal in v1).
3. Roll-back option if Bun native tools hit an unforeseen production wall.

## Do not

- `npm install` / `bun install` inside this directory — dependencies are stale.
- Use this server as the opencode MCP backend — opencode.json no longer references it.
- Edit the code here as the live source — all changes happen in `.opencode/tools/`.

## Migration map

| Legacy file | New location |
|---|---|
| `src/bridge/bridgeClient.ts` | `.opencode/tools/_bridge.ts` (BridgeClient + CallCorrelator merged) |
| `src/bridge/protocol.ts` | merged into `.opencode/tools/_bridge.ts` |
| `src/tools/definitions.ts` | one file per tool under `.opencode/tools/` |
| `src/tools/planningMaterials.ts` | `.opencode/tools/{list,read}_planning_material.ts` (+ stubs) |
| `src/tools/dispatch.ts` | n/a — opencode dispatches by file name |
| `src/server.ts` + `src/index.ts` | n/a — opencode runtime handles stdio |
| `test/*.test.ts` (vitest) | not migrated; kept here for reference only |

If you ever resurrect this directory, the `mcp-server-node` name is intentional — the `mcp-server` prefix is no longer accurate ("server" implied stdio MCP server; we no longer ship one).
