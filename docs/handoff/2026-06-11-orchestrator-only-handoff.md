# 2026-06-11 Orchestrator-Only Agent Handoff

## Decision

UOS user-facing opencode sessions should expose only `orchestrator`.

Users should not choose Plan, Build, `planner-to-screen`, or other specialist
agents. The Orchestrator selects the work mode, follows an internal submodel
handoff, manages approval/progress, and applies changes through the Editor
boundary.

## Implemented

- `.opencode/agents/` now contains only `orchestrator.md`.
- Former `planner-to-screen` guidance moved to
  `.opencode/submodels/screen-from-material.md`.
- Added internal submodel handoff docs:
  - `.opencode/submodels/kiosk-content.md`
  - `.opencode/submodels/screen-from-material.md`
  - `.opencode/submodels/scene-object.md`
  - `.opencode/submodels/visual-repair.md`
  - `.opencode/submodels/unity-inspection.md`
  - `.opencode/submodels/general-editor.md`
- Mode registry entries now include `handoffFile`.
- `select_uos_mode` output now reports the internal submodel and handoff file.
- UOS launcher argument construction normalizes user-provided `--agent` values
  to `--agent orchestrator`.
- `opencode.json` sets `default_agent` to `orchestrator` and disables
  opencode's native `build` and `plan` primary agents. This removes those
  entries from Tab-based agent switching after a fresh launch.
- `uos smoke --ai-agent` only accepts `orchestrator`.
- Docs/tests now describe Plan and Build as artifacts, not user-selectable
  agents.

## Validation

- `node --check bin\uos-core.js`
- `opencode agent list` shows only `orchestrator (primary)` for the user-facing
  UOS agent surface.
- `bun test .\tests\orchestrator-agent.test.ts .\tests\planning-intent.test.ts .\tests\uos-modes.test.ts .\tests\uos-core.test.ts .\tests\uos-setup.test.ts`

Targeted validation result: 149 pass, 0 fail.

## Next Live Check

Run `uos` from a normal terminal and confirm the opencode agent list exposes
only `orchestrator` for UOS. If an already-open opencode session still shows
`build` or `plan`, close and relaunch so the updated config is loaded. Then
validate that entering a project still starts the Orchestrator and that the
first turn calls `get_uos_context` and `select_uos_mode`.
