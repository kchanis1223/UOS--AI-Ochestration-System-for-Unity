# UOS Ochestrator Rework Tasks

Progress legend:

- `[x]` done
- `[~]` in progress
- `[ ]` pending

## Progress Snapshot

- Overall: 12 / 12 Ochestrator task groups complete; 6 / 6 terminal launcher
  UX tasks complete; GUI workbench v1 is in implementation.
- Current focus: browser GUI workbench validation for project selection,
  headless Ochestrator chat, file attachment, Blueprint approval, and activity
  review.
- Next implementation task: user-led live validation of `uos` opening the GUI
  and driving a real Unity project through the common
  `ProductionBlueprint -> Plan -> Build -> Editor -> Verify` flow.

## Task 1 - Mode Foundation

Status: `[x]`

Goal: make UOS work modes explicit, testable, and callable from opencode before
any internal submodel handoff or Unity mutation begins.

- `[x]` Add mode registry with initial modes.
- `[x]` Add deterministic selector.
- `[x]` Add opencode tool `select_uos_mode`.
- `[x]` Add selector tests.
- `[x]` Add PRD/rework docs.
- `[x]` Decide CLI/debug command is optional; opencode tool is enough for the
  first Ochestrator pass.

Artifacts:

- `bin/mode-core.js`
- `.opencode/tools/select_uos_mode.ts`
- `tests/uos-modes.test.ts`
- `docs/uos-ochestrator-prd.md`
- `docs/uos-ochestrator-rework.md`

Verification:

- `bun run test` passes.

## Task 2 - Ochestrator Agent

Status: `[x]`

Goal: introduce a top-level Ochestrator prompt that becomes the normal user
conversation surface.

- `[x]` Add `.opencode/agents/ochestrator.md`.
- `[x]` Require `get_uos_context` and `select_uos_mode` near session start.
- `[x]` Define delegation rules for internal submodel modes.
- `[x]` Define approval points before broad build/mutation.
- `[x]` Update launcher default agent from `planner-to-screen` to
  `ochestrator` once prompt is ready.
- `[x]` Remove direct specialist invocation from the user-facing UOS path;
  `ochestrator` is the only supported UOS agent.
- `[x]` Add Ochestrator prompt tests.

Verification:

- `[x]` Prompt tests confirm Ochestrator requires context, mode selection, Editor
  boundary, and progress reporting.
- `[x]` Existing material-to-screen tests still pass after default-agent switch.

## Task 3 - Demote Planner-To-Screen To Functional Submodels

Status: `[x]`

Goal: reduce the former `planner-to-screen` workflow from global primary agent
to internal functional submodel handoffs for material understanding and UI
screen work.

- `[x]` Move material understanding guidance to
  `.opencode/submodels/material-understanding.md`.
- `[x]` Move material-to-screen UI guidance to
  `.opencode/submodels/ui-screen-builder.md`.
- `[x]` Remove top-level orchestration language from the specialist prompt.
- `[x]` Keep material reading, PlanningIntent drafting, UI creation, preview,
  and repair guidance.
- `[x]` Ensure Ochestrator can hand off screen tasks to it internally.

Verification:

- `[x]` Prompt tests distinguish Ochestrator responsibilities from internal
  submodel responsibilities.

## Task 4 - Plan/Build/Editor Artifact Contract

Status: `[x]`

Goal: define common artifacts so modes can plan/build without directly mutating
Unity.

- `[x]` Define `WorkPlan` base fields.
- `[x]` Define `EditorChangeSet` / `EditorCommandBatch` shape.
- `[x]` Define mode-specific plan artifacts:
  `KioskPlan`, `PlanningIntent`, `SceneObjectPlan`, `VisualRepairPlan`.
- `[x]` Add validation helpers and tests.
- `[x]` Decide where artifacts persist in `.uos`.

Verification:

- `[x]` Unit tests validate representative artifacts.
- `[x]` Existing plugin journaling remains backward compatible.

Artifacts:

- `bin/artifact-core.js`
- `tests/uos-artifacts.test.ts`

## Task 5 - Kiosk Mode Stage 1 Hardening

Status: `[x]`

Goal: move current kiosk knowledge into `kiosk-content` mode as a reusable
method.

- `[x]` Extend `KioskPlan` with `layoutReference`.
- `[x]` Add `contentMedia`.
- `[x]` Add `specSources`.
- `[x]` Detect `화면 구성.png` / `화면구성.png` as layout references.
- `[x]` Distinguish content photos from layout references.
- `[x]` Add tests with Korean folder/material names.

Verification:

- `[x]` `uos kiosk-plan` and `plan_kiosk_structure` produce enriched metadata.
- `[x]` Existing deterministic kiosk tests still pass.

Artifacts:

- `bin/kiosk-core.js`
- `tests/kiosk.test.ts`

## Task 6 - Kiosk Mode Stage 2 Build

Status: `[x]`

Goal: build an approved `KioskPlan` into Unity screens and navigation through
the Editor layer.

- `[x]` Add `build_kiosk_from_plan` or equivalent mode build tool.
- `[x]` Generate menu screens from child nodes.
- `[x]` Generate detail screens from folder materials.
- `[x]` Route layout references through reference/editable screen strategies.
- `[x]` Wire drilldown/back/home transitions.
- `[x]` Capture previews and persist source metadata.
- `[x]` Add dry-run mode before Unity mutation.

Verification:

- `[x]` Unit tests for build command generation.
- `[x]` Live Unity mutation smoke is deferred to Task 7 because the Editor
  execution boundary owns applying `EditorCommandBatch` artifacts.

Artifacts:

- `bin/kiosk-build-core.js`
- `.opencode/tools/build_kiosk_from_plan.ts`
- `tests/kiosk-build.test.ts`

## Task 7 - Editor Execution Boundary

Status: `[x]`

Goal: make Unity mutation flow through a clear Editor layer instead of being
spread across planning prompts.

- `[x]` Document Editor-only mutation rule in prompts and docs.
- `[x]` Add helper abstractions for applying `EditorCommandBatch`.
- `[x]` Preserve bridge tool compatibility.
- `[x]` Add progress/evidence output from Editor calls.

Verification:

- `[x]` Tests prove read-only planning does not call bridge mutation tools.
- `[x]` Mutation tools still journal correctly.

Artifacts:

- `bin/editor-batch-core.js`
- `tests/editor-batch.test.ts`
- `.opencode/agents/ochestrator.md`
- `docs/uos-ochestrator-rework.md`

## Task 8 - Progress Reporting And Resume

Status: `[x]`

Goal: make Ochestrator progress visible, resumable, and useful for iterative
improvement.

- `[x]` Define `.uos` progress records for current task/mode/plan/build state.
- `[x]` Add progress summary formatting.
- `[x]` Include mode, current step, completed steps, evidence, and blockers.
- `[x]` Update `get_uos_context` to surface active Ochestrator progress.
- `[x]` Add tests for persisted progress.

Verification:

- `[x]` A resumed session can report current mode, active plan, completed steps,
  and next action without rereading the entire conversation.

Artifacts:

- `bin/ochestrator-progress-core.js`
- `tests/ochestrator-progress.test.ts`
- `.opencode/tools/_uos_context.ts`
- `tests/uos-context.test.ts`

## Task 9 - In-Session Unity Project Selection

Status: `[x]`

Goal: allow the Ochestrator inside opencode to list connected Unity projects
and switch the active edit target before applying Editor commands.

- `[x]` Define a session target state that can override launcher-selected env.
- `[x]` Add read-only `list_unity_projects`.
- `[x]` Add `select_unity_project` for index/id/name/path selectors.
- `[x]` Make bridge calls follow the session-selected target.
- `[x]` Make `get_uos_context` load the selected project's `.uos` context after
  switching.
- `[x]` Make the UOS journaling plugin write to the active selected project.
- `[x]` Update Ochestrator guidance.
- `[x]` Run tests and fix regressions.

Verification:

- `[x]` Unit tests cover list/select, token redaction, and selected-context
  loading.
- `[x]` Full `bun run test` passes.

Artifacts:

- `.opencode/tools/_unity_target_state.ts`
- `.opencode/tools/list_unity_projects.ts`
- `.opencode/tools/select_unity_project.ts`
- `.opencode/tools/_bridge.ts`
- `.opencode/tools/get_uos_context.ts`
- `.opencode/plugins/uos.ts`
- `tests/unity-target-selection.test.ts`
- `tests/uos-context.test.ts`

## Task 10 - Ochestrator-Only User Agent Surface

Status: `[x]`

Goal: make the user-facing opencode agent surface match the target
`Ochestrator -> internal submodels -> Editor` architecture.

- `[x]` Keep only `.opencode/agents/ochestrator.md` as a UOS opencode agent.
- `[x]` Move material-to-screen guidance out of `.opencode/agents/` and into
  `.opencode/submodels/material-understanding.md` plus
  `.opencode/submodels/ui-screen-builder.md`.
- `[x]` Add internal functional submodel handoff docs for scene objects, visual
  verification, inspection, code editing, and general editing.
- `[x]` Keep kiosk-specific workflow under `.opencode/recipes/kiosk.md` instead
  of a kiosk-specific submodel.
- `[x]` Add `handoffFile` metadata to mode registry entries.
- `[x]` Update `select_uos_mode` output to show internal submodels, optional
  recipe, and primary handoff file.
- `[x]` Normalize UOS opencode launches to `--agent ochestrator`, even when a
  custom `--agent` is supplied.
- `[x]` Disable opencode native `build` and `plan` primary agents in
  `opencode.json` so Tab-based agent switching exposes only `Ochestrator`.
- `[x]` Update docs/tests to describe Plan and Build as artifacts, not
  user-selectable agents.

Verification:

- `[x]` Unit tests confirm only Ochestrator remains in `.opencode/agents`.
- `[x]` Launcher tests confirm custom `--agent` inputs are normalized to
  `Ochestrator`.
- `[x]` `opencode agent list` confirms `build` and `plan` are no longer exposed
  in this project config.

## Launcher UX Rework - No-Arg Project List

Status: `[x]` implementation complete; user-led live validation pending.

Goal: make `uos` with no extra command open the UOS/opencode flow through a
project list sourced from the user's configured Unity projects folder.

Requested behavior:

- `uos` from cmd opens the opencode/UOS screen without requiring an additional
  subcommand.
- The launcher discovers Unity projects under a user-configured root supplied
  during setup.
- The list shows whether each project is connected to UOS.
- The user can connect/disconnect from the list.
- The user can click a project, or use arrow keys and Enter, to enter that
  project's UOS session.

Task breakdown:

- `[x]` Task 1 - Save Unity project discovery roots during setup.
  - Add `uos setup --unity-projects <dir>`.
  - Add `uos setup --language <code|name>` for default Ochestrator response
    language.
  - Store roots in `~/.config/uos/config.json`.
  - Add setup parser/config tests.
- `[x]` Task 2 - Scan configured roots for Unity project folders.
  - Detect `ProjectSettings/ProjectVersion.txt`.
  - Exclude Unity generated folders.
  - Return deterministic name/path/version records.
- `[x]` Task 3 - Merge scanned projects with live bridge/package status.
  - Show UOS package installed/missing state.
  - Show live bridge connected/disconnected state.
  - Preserve token redaction.
- `[x]` Task 4 - Add no-arg launcher project list UI.
  - Default `uos` should enter this flow instead of requiring a live bridge.
  - Keep explicit opencode management commands targetless.
- `[x]` Task 5 - Add keyboard and mouse selection/actions.
  - Arrow keys and Enter select a project.
  - Mouse click selects a row/action where terminal mouse input is available.
  - Provide keyboard fallback for all actions.
- `[x]` Task 6 - Enter selected project's opencode Ochestrator session.
  - Inject selected Unity/project env.
  - If disconnected, guide or perform connect action before mutation.

Implementation notes:

- Project lists now render as aligned tables with status, UOS, bridge, project,
  Unity version, and path columns instead of repeated two-line rows.
- The raw-mode launcher also shows a selected-project details panel and the
  exact Enter action.
- Selecting a project whose UOS package is missing automatically runs the UOS
  install step before opening opencode.
- Keyboard UI supports Up/Down, Enter, `c` connect/update, `d` disconnect, and
  `q` quit.
- Mouse UI enables xterm SGR mouse tracking where the terminal supports it:
  clicking a project row enters the project, clicking the status/action column
  toggles connect/disconnect.
- `UOS_SIMPLE_PROJECT_SELECT=1` keeps the plain numeric prompt fallback.
- Disconnected project entry is allowed; the Ochestrator startup prompt
  receives project status, UOS package status, and live bridge status so it can
  avoid mutation before connection.

Artifacts so far:

- `bin/uos-config-core.js`
- `bin/uos-core.js`
- `bin/uos.js`
- `bin/uos-setup.js`
- `tests/uos-setup.test.ts`
- `tests/uos-core.test.ts`

## Task 11 - Detail Active Functional Submodels

Status: `[x]`

Goal: define the seven active functional submodels in enough detail that the
Ochestrator can route work, compose recipes, request approval, and produce
consistent artifacts without exposing submodels as user-selectable agents.

Active submodels:

- `[x]` `material-understanding`
- `[x]` `ui-screen-builder`
- `[x]` `scene-object-editor`
- `[x]` `code-editor`
- `[x]` `visual-verification`
- `[x]` `unity-inspection`
- `[x]` `general-editor`

Definition checklist for each submodel:

- `[x]` Responsibility and non-responsibility boundaries.
- `[x]` Inputs and required context freshness.
- `[x]` Output artifact schema.
- `[x]` Allowed tools and forbidden tools.
- `[x]` Normal workflow.
- `[x]` Approval gates.
- `[x]` Evidence and persistence expectations.
- `[x]` Failure/blocker handling.
- `[x]` Handoff rules to other submodels or recipes.

Working document:

- `docs/uos-submodel-definition-plan.md`

## Task 12 - ProductionBlueprint Pipeline Connection

Status: `[x]`

Goal: connect the `ProductionBlueprint` contract to the actual Ochestrator
tooling, resume context, and Plan/Build source metadata without changing the
small-edit fast path.

- `[x]` Add persisted ProductionBlueprint helper functions.
- `[x]` Add read/write/list/latest/summary behavior for
  `.uos/ochestrator/blueprints`.
- `[x]` Add `draft_production_blueprint` opencode tool for validation and
  planner-friendly artifact summaries.
- `[x]` Add optional `blueprint` references to `OchestratorProgress`.
- `[x]` Surface latest/active blueprint summaries through `get_uos_context`.
- `[x]` Add invalid blueprint blockers to context output.
- `[x]` Define broad-work criteria and small-edit fast path in Ochestrator
  guidance.
- `[x]` Standardize blueprint approval choices.
- `[x]` Carry `source.blueprintId` and `source.blueprintPath` through kiosk
  Plan/Build metadata when provided.

Verification:

- `[x]` Targeted bun tests cover artifact persistence, progress refs, context
  summaries, opencode tool schema, prompt contract, and kiosk source refs.
