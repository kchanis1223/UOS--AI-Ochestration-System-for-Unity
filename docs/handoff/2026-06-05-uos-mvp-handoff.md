# UOS MVP Handoff - 2026-06-05

## Goal

UOS (Unity Orchestration System) is a local opencode-based orchestrator for
Unity Editor control. It must not require running from inside each Unity
project. On entry, UOS discovers connected Unity Editor projects, lets the user
select one target, then starts an AI conversation that can understand images,
documents, and PPTX files and directly edit the selected Unity Editor.

## Current MVP Status

The project is ready for user-led MVP validation. The local hub architecture,
Unity Editor bridge, opencode tool surface, planning-material routing, public
launcher proof paths, and Unity EditMode regression evidence are in place.

Progress snapshot:

| Area | Progress | Status |
|---|---:|---|
| Local UOS hub and project selection | 90% | Live registry discovery, selectors, wait/ready/context/chat/run flow implemented |
| Unity Editor bridge and UGUI editing | 88% | Bridge protocol, screen CRUD, controls, preview, verification, save, scene objects covered |
| Planning material understanding | 85% | Image/PDF/DOCX/PPTX/text readers and material-to-screen router implemented |
| Conversational follow-up context | 82% | Persisted `.uos` context, active screen resolution, context tools, AI follow-up loops implemented |
| Public user entry proof | 89% | Public `uos chat`, `uos run`, `uos smoke`, public run AI, and public `uos mvp --json` preflight paths covered |
| Docs and onboarding | 87% | README/INSTALL updated; `uos mvp` prints text/JSON walkthrough commands, acceptance gates, and E2E can verify them |
| Security and production hardening | 76% | Launch/context token masking and public command stdout/stderr/error redaction are covered by tests |

Overall implementation progress: about 89%.
MVP validation readiness: about 94%.
Production readiness: about 76%.

## Delivered Artifacts

Main local launcher:

- `bin/uos.js`
- `bin/uos-core.js`
- `bin/uos-setup.js`

Unity package:

- `Packages/com.lyx.oh-my-unity/Editor/Bridge/*`
- `Packages/com.lyx.oh-my-unity/Editor/Generation/*`
- `Packages/com.lyx.oh-my-unity/Editor/Panel/MonitorWindow.cs`
- `Packages/com.lyx.oh-my-unity/Runtime/*`
- `Packages/com.lyx.oh-my-unity/Tests/Editor/*`

opencode agent/tools/plugin:

- `.opencode/agents/planner-to-screen.md`
- `.opencode/plugins/uos.ts`
- `.opencode/plugins/claude-auth.ts`
- `.opencode/tools/*`

Docs and state:

- `README.md`
- `INSTALL.md`
- `docs/adr/0001-bridge-implementation.md`
- `.omx/context/local-uos-hub-20260604T023957Z.md`
- `docs/handoff/2026-06-05-uos-mvp-handoff.md`
- `docs/handoff/2026-06-05-uos-completion-audit.md`

Key generated evidence:

- `TestResults/editmode-results-20260605-uos-current.xml`
- `TestResults/unity-editmode-20260605-uos-current.log`
- `TestResults/uos-e2e-public-run-ai.log`
- `TestResults/uos-e2e-public-run-ai-image-nofile.log`
- `TestResults/uos-e2e-public-run-ai-pptx-nofile.log`
- `TestResults/uos-e2e-public-chat-dry-run.log`
- `TestResults/uos-e2e-public-run-dry-run.log`
- `TestResults/uos-e2e-multi-editor-selection.log`

## Verified Evidence

Latest verified command results are recorded in
`.omx/context/local-uos-hub-20260604T023957Z.md`:

- `bun run test`: 219 pass, 0 fail.
- `node --check bin\uos.js`: passed.
- `node --check bin\uos-core.js`: passed.
- `node --check bin\uos-setup.js`: passed.
- Unity EditMode: 54/54 passed in
  `TestResults/editmode-results-20260605-uos-current.xml`.
- Public `uos run` AI over README material: passed.
- Public `uos run` AI over image material: passed. The binary file was not
  forwarded through opencode `--file`; it remained usable through UOS tools.
- Public `uos run` AI over PPTX material: passed. The binary file was not
  forwarded through opencode `--file`; it remained usable through UOS tools.
- Multi-editor public selection unit E2E: passed for per-project public
  `uos mvp --json`, chat, and run dry-run forwarding.
- `git diff --check`: no whitespace errors, only existing CRLF conversion
  warnings.
- Public command redaction regression: public smoke/chat/run/run-AI success
  output and public run failure output do not retain raw bridge/env token values.
- Public `uos mvp --json` E2E preflight regression: selected-project and
  multi-editor E2E paths spawn the public launcher, parse `ok: true`, and
  require all expected acceptance gate ids and walkthrough command lines before
  reporting. When the selected live target has a project path, the generated
  `publicMvpE2E` walkthrough command is also required. The E2E rejects stale
  walkthrough command lines that do not reference the selected Unity project or
  supplied planning material. It also requires `preflightSummary.status` to be
  `ready-for-user-validation`, with no missing walkthrough command lines.
- `uos mvp --json` includes `preflightSummary`, a compact automatic-status
  object with ready/blocked status, bridge tool counts, required/present/missing
  walkthrough command keys, and acceptance gate ids for evidence capture.
  `acceptanceGates` now also carry per-gate `evidenceStatus`, and the summary
  groups gates into pending user evidence, optional evidence, and preflight
  blockers.
- `uos mvp --save <file>` writes the same token-redacted JSON preflight as an
  MVP evidence bundle for the next user-led validation session.
- `uos mvp-progress <file>` reads that saved bundle and prints automatic
  preflight state, user-evidence progress, pending gates, and the next command
  group to run with the user.
- `uos e2e --public-mvp-json` prints a compact public MVP block with parsed
  JSON status, preflight status/next step, command line coverage, acceptance
  gate count, command line validation, and preflight summary validation.
- `uos projects --json` after cleanup: `count: 0`.
- No Unity process remained after the latest recorded verification runs.

## What Works Now

- `uos projects`, `uos wait`, `uos ready`, `uos context`, `uos chat`,
  `uos enter`, `uos mvp`, `uos smoke`, and `uos e2e` are implemented.
- UOS can select a connected Unity Editor target by index, project name, or
  project path.
- Launcher injects bridge env into opencode:
  - `UNITY_MCP_HOST`
  - `UNITY_MCP_PORT`
  - `UNITY_MCP_TOKEN`
  - `UOS_PROJECT_DIR`
  - `UOS_CONTEXT_DIR`
  - `UOS_ATTACHED_FILES`
- `uos chat` and `uos run` use the `planner-to-screen` agent by default unless
  the user overrides it.
- Text-like explicit `--uos-file` attachments are also passed to opencode
  `run --file`.
- Binary/visual attachments such as PNG/PDF/DOCX/PPTX are intentionally not
  passed to opencode `--file`; they remain available through
  `UOS_ATTACHED_FILES`, `get_uos_context`, and `read_planning_material`.
- `.uos` context persists screens, elements, scene objects, previews,
  verification data, imported assets, source material paths, and work journal
  records.
- Context-resolved tools can update/delete/move/add UI elements, set active
  screen, capture previews, verify references, and update scene objects using
  persisted context plus live hierarchy refresh.
- Visual feedback repair loops can inspect verification results, move layout,
  reverify, and escalate to replace after repeated large mismatches.
- `uos mvp` provides a read-only user-led validation preflight. It checks the
  selected bridge capability metadata and supplied planning material, then
  prints the exact project install check, opencode runtime check, readiness,
  context, dry-run, AI edit, and follow-up chat commands for the MVP
  walkthrough. It also prints acceptance gates for the evidence to collect at
  each step. `--json` provides the same token-redacted status, command sequence,
  acceptance gates, and per-gate user-evidence status for scripts. `--save`
  persists that JSON so the next session can resume from the same evidence
  bundle.
- `uos mvp-progress` / `uos mvp-status` reads a saved MVP evidence bundle and
  reports pending user evidence without launching Unity or opencode.
- `uos e2e --public-mvp-json` can now verify that public `uos mvp --json`
  command generation works against the selected live bridge before a real AI
  edit is attempted.

## MVP User Validation Plan

Run these with the user in a real target Unity project, not only this repository
project.

1. Install/link local UOS.

```powershell
cd C:\Users\lyx\MCP_for_Unity_LYX
bun install
cd .opencode
npm install
cd ..
bun link
```

2. Install the Unity package into a target project.

```powershell
uos install-unity D:\Unity\MyGame --embed --dry-run
uos install-unity D:\Unity\MyGame --embed
```

3. Open the target project in Unity 6000.x and confirm the bridge is running
   from `Window > Oh My Unity > Monitor`.

4. Confirm UOS sees the live Editor.

```powershell
uos projects
uos ready --wait --unity-project MyGame
uos context --unity-project MyGame
```

5. Run the read-only MVP walkthrough preflight with real planning material.

```powershell
uos mvp --wait --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx
uos mvp --wait --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx --json --save .uos\mvp-evidence.json
uos mvp-progress .uos\mvp-evidence.json
```

This prints the exact `ready`, `context`, dry-run, AI edit, and follow-up chat
commands to execute next; the JSON form is useful when saving or comparing
preflight results, and `--save` writes the token-redacted evidence bundle to
disk. In a ready preflight, required gates should remain
`pending-user-evidence`; this is expected because follow-up validation will be
run together with the user. `uos mvp-progress` is the quick next-session check
for the saved evidence state.

6. Validate the same MVP preflight through E2E public launcher proof.

```powershell
uos e2e --project D:\Unity\MyGame --read-only --public-mvp-json --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx
```

This starts the selected project path, waits for the bridge, and invokes
`uos mvp --unity-project <selected> --json` through the public CLI. Run this
with the user before the first real AI edit if the target project can be opened
and closed by the E2E command.

7. Validate public entry dry-run with real planning material.

```powershell
uos chat --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx --uos-dry-run
uos --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx --uos-dry-run run "create the lobby UI from this deck"
```

8. Validate one actual AI edit.

```powershell
uos --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx run "Read the attached deck, create an editable Unity lobby screen, capture a preview, and summarize what changed."
```

9. Validate follow-up conversation.

```powershell
uos chat --unity-project MyGame --continue
```

Ask the AI to adjust one visible element from the previous screen, then
capture/verify a preview.

## Known Gaps Before Calling MVP Complete

- User-facing onboarding has not yet been walked end-to-end with a separate
  consumer Unity project.
- Real multi-Editor verification has unit proof and public forwarding proof, but
  should be repeated with two actual live Unity Editors.
- PPTX rendered-image support depends on LibreOffice or PowerPoint for slide
  images. Text/layout extraction works without them, but visual slide rendering
  should be validated on the user's machine.
- opencode provider/auth flow should be checked interactively with the user's
  preferred model.
- The worktree is intentionally dirty with many implementation files and
  generated/untracked files. Do not reset or revert without reviewing
  user-owned changes.

## Suggested Next Session Start

1. Read this file, `docs/handoff/2026-06-05-uos-completion-audit.md`, and
   `.omx/context/local-uos-hub-20260604T023957Z.md`.
2. Run:

```powershell
git status --short
node --check bin\uos.js
node --check bin\uos-core.js
node --check bin\uos-setup.js
bun run test
```

3. With the user, run the MVP validation plan against a real Unity project.
   Use `docs/handoff/2026-06-05-uos-completion-audit.md` as the acceptance
   checklist and do not mark the full goal complete until every user-led gate
   has direct evidence.
4. If public command output changes again, re-run targeted redaction tests:

```powershell
bun test .\tests\uos-core.test.ts
bun run test
```

## Current Stop Point

Current MVP wrap-up and public preflight proof are implemented. The touched
areas are:

- `bin/uos-core.js`: `runPublicSmokeCli`
- `bin/uos-core.js`: `runPublicChatDryRunCli`
- `bin/uos-core.js`: `runPublicRunDryRunCli`
- `bin/uos-core.js`: `runPublicRunAiCli`
- `bin/uos-core.js`: `formatPublicSmokeResult`
- `bin/uos-core.js`: `trimCommandOutput`
- `tests/uos-core.test.ts`: selected-project public entry redaction coverage
  and public run failure redaction coverage
- `bin/uos.js` / `bin/uos-core.js`: `uos mvp` read-only validation preflight
  for user-led MVP walkthrough command generation and evidence bundle saving
- `bin/uos.js` / `bin/uos-core.js`: `uos mvp-progress` / `uos mvp-status`
  saved evidence progress report for next-session user validation
- `bin/uos-core.js`: `uos mvp` `acceptanceGates` text/JSON output and
  generated `uos doctor --project`, `uos doctor --runtime`, and public MVP E2E
  commands when the selected live target has a project path; JSON/text output
  also includes `preflightSummary` and per-gate `evidenceStatus` for user-led
  evidence capture. `saveMvpValidationReport` writes the same token-redacted
  JSON to disk for handoff.
- `bin/uos-core.js`: `uos e2e --public-mvp-json` public launcher proof for
  the same MVP preflight, including expected acceptance gate id and commandLine
  enforcement, required `publicMvpE2E` commandLine when projectPath is
  available, and selected-project/planning-material commandLine content
  validation. E2E also requires the preflight summary to expose pending,
  optional, and blocked evidence groups. E2E output now uses a dedicated public
  MVP formatter so users can see parsed/preflight/validation status without
  reading raw JSON.
- `tests/uos-core.test.ts`: public MVP preflight parser, selected-project,
  multi-editor, acceptance gate, and help coverage
- `README.md` / `INSTALL.md`: public MVP preflight and E2E command examples

Verification at this stop point:

```powershell
node --check bin\uos.js
node --check bin\uos-core.js
node --check bin\uos-setup.js
bun test .\tests\uos-core.test.ts
bun run test
git diff --check
```

Latest observed result: `bun test .\tests\uos-core.test.ts` reports 117 pass,
0 fail; `bun run test` reports 219 pass, 0 fail; node syntax checks pass for
`bin\uos.js`, `bin\uos-core.js`, and `bin\uos-setup.js`; `uos help mvp` shows
acceptance evidence gates; `git diff --check` reports no whitespace errors,
only existing CRLF conversion warnings.
