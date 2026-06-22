# UOS Completion Audit - 2026-06-05

This audit maps the original UOS goal to current evidence. It is intentionally
stricter than the MVP handoff: the goal is not complete until every requirement
below has direct evidence from the current worktree, command output, runtime
behavior, or user-led validation.

## Objective

Build UOS (Unity Orchestration System) as a local opencode-based orchestrator.
On UOS entry, the user can select one connected Unity Editor project. An AI can
understand images, documents, and PPTX files, then converse with the user while
directly editing the selected Unity project's Editor/UI.

## Audit Verdict

Status: MVP validation ready, not full-goal complete.

The local launcher, Unity bridge, opencode agent/tools, material readers,
context persistence, public entry proof paths, and automated regression tests
are in place. The remaining proof needed for full completion is a user-led
walkthrough against a separate consumer Unity project with real planning
material and interactive opencode authentication/model settings.

## Requirement Evidence Matrix

| Requirement | Current evidence | Verdict |
|---|---|---|
| UOS runs locally, not from inside each Unity project | `README.md` and `INSTALL.md` document local `uos` launch, `bun link`, `uos install-unity`, and selected-project flags. `bin/uos.js` dispatches project selection before opencode launch. | Proved for launcher design; user onboarding still needs consumer-project walkthrough |
| UOS discovers connected Unity Editor projects | `uos projects`, `uos wait`, `uos ready`, registry discovery, stale cleanup, selector tests, and live E2E evidence in `TestResults/*` logs. | Proved locally |
| UOS lets the user choose one connected project at entry | `selectUnityTarget`, selector parsing, interactive prompt tests, non-interactive ambiguity tests, public chat/run/mvp per-project E2E unit coverage. | Proved locally; live two-Editor user walkthrough still recommended |
| Selected bridge env is injected into opencode | `buildTargetEnv`, `formatLaunchSummary`, dry-run tests, public chat/run dry-run E2E, token-redacted output checks. | Proved locally |
| opencode-based AI conversation starts through UOS | `uos chat`, `uos enter`, and top-level `uos run` paths exist; launcher injects `planner-to-screen`; public run AI E2E logs prove real `uos run` material edits over README/image/PPTX. | Proved locally; user's preferred auth/model still needs interactive check |
| AI can understand image files | Material tests cover image metadata/downscale/import/reference screen paths; public run AI image proof created a screen without passing binary file through opencode `--file`. | Proved locally |
| AI can understand documents | Material tests cover Markdown/text/CSV/JSON/PDF/DOCX extraction, document-screen routing, controls, scrollable text, and public README AI proof. | Proved locally |
| AI can understand PPTX | Material tests cover PPTX text/layout/picture extraction, slide/deck routing, colored shape fill preservation, and public run AI PPTX proof. | Proved for built-in extraction; rendered-slide image support still depends on LibreOffice/PowerPoint |
| AI can directly edit Unity Editor/UI | Unity EditMode 54/54 passed; live E2E logs cover screen create/update/add/delete/move, active screen, preview, verification, transitions, scene objects, and material-derived screens. | Proved locally |
| Follow-up conversation can reuse prior context | `.uos` context tests, context-resolved tool tests, post-smoke TUI re-entry proof, AI follow-up smoke tests, and public chat/run dry-run context output. | Proved locally |
| User can run an MVP validation preflight before real edits | `uos mvp` text/JSON report, `uos e2e --public-mvp-json`, tests, README/INSTALL, and handoff plan. | Proved locally |
| Sensitive bridge tokens are not exposed in public reports | Public command result sanitization tests cover stdout/stderr/error and failure messages for public smoke/chat/run/run-AI/mvp wrappers. | Proved locally for covered paths |
| Full user-facing MVP is complete | Requires a successful walkthrough on a separate consumer Unity project using real user planning material, followed by a real AI edit and follow-up edit. | Not yet proved |

## Current Automated Verification Baseline

Run these from `C:\Users\lyx\MCP_for_Unity_LYX` before starting user-led
validation:

```powershell
node --check bin\uos.js
node --check bin\uos-core.js
node --check bin\uos-setup.js
bun test .\tests\uos-core.test.ts
bun run test
git diff --check
node .\bin\uos.js projects --json
```

Latest recorded result:

- `bin\uos.js`, `bin\uos-core.js`, `bin\uos-setup.js`: syntax checks pass.
- `bun test .\tests\uos-core.test.ts`: 117 pass, 0 fail.
- `bun run test`: 219 pass, 0 fail.
- `git diff --check`: no whitespace errors; CRLF conversion warnings only.
- `uos projects --json`: `count: 0` after cleanup.

Latest Unity-side regression evidence:

- `TestResults/editmode-results-20260605-uos-current.xml`: 54/54 EditMode
  tests passed.

## User-Led MVP Acceptance Gates

These gates must pass with the user before calling the full objective complete.

1. Consumer Unity project install:

```powershell
uos install-unity D:\Unity\MyGame --embed --dry-run
uos install-unity D:\Unity\MyGame --embed
uos doctor --project D:\Unity\MyGame
```

Acceptance evidence:

- Package install check reports `com.lyx.oh-my-unity`.
- Unity opens the consumer project without compile errors.
- `Window > Oh My Unity > Monitor` shows the bridge running or startable.

2. Connected project selection:

```powershell
uos projects
uos ready --wait --unity-project MyGame
uos context --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx
```

Acceptance evidence:

- The intended project appears with the correct project path.
- `ready` reports no AI-session blockers.
- `context` reports selected Unity metadata and the supplied planning material.

3. MVP preflight:

```powershell
uos mvp --wait --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx --json
uos e2e --project D:\Unity\MyGame --read-only --public-mvp-json --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx
```

Acceptance evidence:

- JSON preflight reports `ok: true`.
- JSON preflight includes `acceptanceGates` for package install/runtime,
  readiness, public preflight, dry-run forwarding, real AI edit, and follow-up
  edit proof.
- JSON preflight includes `preflightSummary.status`, commandLine coverage,
  bridge tool counts, and acceptance gate ids for quickly checking the automatic
  preflight state before collecting user-led evidence.
- JSON preflight includes per-gate `evidenceStatus`, and
  `preflightSummary.acceptanceGates` groups gates into `pendingUserEvidence`,
  `optionalUserEvidence`, and `blockedByPreflight`.
- `uos mvp --save <file>` persists the same token-redacted JSON as an evidence
  bundle for handoff and follow-up validation.
- `uos mvp-progress <file>` reads the saved evidence bundle and reports
  automatic preflight state, user-evidence progress, pending gates, and the next
  command group without launching Unity or opencode.
- The generated command sequence includes `uos doctor --project` and
  `uos doctor --runtime` before the real AI edit gates.
- Public MVP E2E requires those key `commandLines` and fails if they are
  missing from `uos mvp --json`.
- Public MVP E2E also requires `preflightSummary.status` to be
  `ready-for-user-validation`, `preflightSummary.next` to be
  `run-user-led-mvp-gates`, and `preflightSummary.commandLines.missing` to be
  empty.
- Public MVP E2E also requires the preflight summary evidence-state arrays to
  exist and rejects summaries that list any `blockedByPreflight` gates.
- When the selected target exposes a project path, Public MVP E2E also requires
  the generated `publicMvpE2E` commandLine.
- Public MVP E2E also fails if those `commandLines` point at a stale project
  selector or omit the supplied planning material.
- Public E2E invokes `uos mvp --unity-project <selected> --json` and exits 0.
- The generated command sequence includes `ready`, `context`, dry-run, real AI
  edit, and follow-up chat commands.

4. Public entry dry-run:

```powershell
uos chat --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx --uos-dry-run
uos --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx --uos-dry-run run "create the lobby UI from this deck"
```

Acceptance evidence:

- Dry-run output names the selected project.
- Bridge token values are redacted.
- Attached files and material root are visible through UOS context guidance.
- Binary/visual attachments are not forwarded as opencode `--file`.

5. Real AI material edit:

```powershell
uos --unity-project MyGame --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx run "Read the attached deck, create an editable Unity lobby screen, capture a preview, and summarize what changed."
```

Acceptance evidence:

- The AI calls `get_uos_context` and `read_planning_material`.
- The AI creates or updates a Unity screen through UOS tools.
- `.uos/work-journal.jsonl` records the material read and Unity mutation.
- A preview is captured or can be captured immediately after the edit.

6. Conversational follow-up edit:

```powershell
uos chat --unity-project MyGame --continue
```

Acceptance evidence:

- The AI can identify the previously generated screen from `.uos` context.
- A user-requested visible element change is applied through context-resolved
  tools without asking for raw screenId/elementId.
- Preview or verification output reflects the follow-up edit.

7. Optional multi-Editor acceptance:

```powershell
uos e2e --project D:\Unity\MyGame --secondary-project D:\Unity\OtherGame --read-only --public-mvp-json --public-chat-dry-run --public-run-dry-run --uos-materials D:\Plans --uos-file D:\Plans\lobby.pptx
```

Acceptance evidence:

- Both Editors appear as separate live projects.
- Each public command receives its own `--unity-project` path.
- No spawned command accidentally targets the first or stale Editor.

## Open Risks

- Full onboarding has not yet been observed on a separate consumer Unity
  project with the user's actual planning material.
- opencode auth and model selection are user-environment dependent and should
  be checked with `uos doctor --runtime` before the real edit.
- PPTX rendered-image inspection requires LibreOffice or PowerPoint; current
  extraction/layout paths work without those renderers.
- The worktree is intentionally dirty and contains many untracked development
  artifacts. Do not reset or revert without reviewing ownership and intent.

## Next-Session Instruction

Start by reading this audit and
`docs/handoff/2026-06-05-uos-mvp-handoff.md`. Refresh the automated baseline,
then run the user-led MVP acceptance gates with the user. Keep the global goal
active until those gates pass with direct evidence.
