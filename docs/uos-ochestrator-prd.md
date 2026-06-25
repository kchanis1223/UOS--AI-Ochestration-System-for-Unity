# UOS Ochestrator PRD

## Purpose

UOS should evolve from a kiosk-focused Unity automation workflow into a general
Unity orchestration system. The user always talks to an Ochestrator. The
Ochestrator understands intent, selects the right accumulated work method,
uses internal submodel handoffs for planning/build/verification, applies
approved changes through the Editor layer, and reports progress and results
clearly.

## Problem

The former material-to-screen workflow is effective for material-to-UGUI work
but carried too many responsibilities when exposed as a user-facing agent:

- user intent interpretation
- planning-material analysis
- screen planning
- Unity bridge tool choice
- mutation execution
- preview capture
- visual verification
- follow-up repair
- kiosk-specific heuristics

This makes kiosk-specific learning hard to reuse without contaminating general
Unity tasks, and it makes non-kiosk work depend on a prompt designed for screen
generation.

## Goals

1. Keep the user-facing conversation anchored on a single Ochestrator.
2. Introduce explicit UOS modes that represent accumulated methods for different
   classes of Unity work.
3. Separate `Plan`, `Build`, and `Editor` responsibilities.
4. Preserve the current kiosk work as a specialized mode, not the global default.
5. Keep Unity mutation behind a single Editor execution boundary.
6. Make progress, mode choice, plan artifacts, build artifacts, and verification
   results visible and resumable.
7. Support multiple connected Unity projects by letting the Ochestrator list
   live projects and select the active edit target inside opencode.

## Non-Goals

- Replace all existing tools in one pass.
- Expose internal submodels as user-selectable opencode agents.
- Require Unity mutation for read-only planning or mode selection.
- Make kiosk behavior the default behavior for all UOS tasks.

## Target Architecture

```text
User
  <-> Ochestrator
        -> Mode registry / mode selector
        -> Internal submodel handoff / mode tools
        -> Plan artifacts
        -> Build artifacts
        -> Editor execution layer
        -> Unity Editor bridge
```

## Core Roles

### Ochestrator

- Talks to the user.
- Confirms or changes the active Unity project before editing when multiple
  projects are connected.
- Summarizes intent into a task brief.
- Selects a UOS mode.
- Creates internal handoffs for analysis/planning/build/verification.
- Manages approval points before large or destructive changes.
- Reviews submodel output.
- Reports progress, evidence, residual risk, and next actions.

### Mode / Internal Submodel

A mode routes one type of user work. It is selected by the Ochestrator and may
compose functional submodel handoffs plus an optional domain recipe. Neither
modes nor submodels are user-selectable opencode agents. Initial modes:

- `kiosk-content`: kiosk recipe for nested Ref folder -> kiosk screen structure
  -> Unity screens and navigation.
- `screen-from-material`: image/PPTX/PDF/DOCX/Markdown/text -> UI screen.
- `scene-object`: non-UI GameObject creation/update/delete.
- `visual-repair`: preview/reference compare -> targeted repair loop.
- `unity-inspection`: read-only project/context/screen/hierarchy inspection.
- `code-editor`: scripts, Editor scripts, asmdefs, packages, tests,
  diagnostics, and text project configuration.
- `general-editor`: constrained fallback executor used only after the
  Ochestrator confirms no specialist submodel owns the task.

### Plan

Produces a structured artifact that describes what should be built.

Examples:

- `KioskPlan`
- `PlanningIntent`
- `SceneObjectPlan`
- `VisualRepairPlan`
- `InspectionPlan`
- `CodeEditPlan`
- `WorkPlan`

### Build

Converts an approved plan into a concrete execution artifact.

Examples:

- `EditorChangeSet`
- `EditorCommandBatch`
- `InspectionReport`
- `CodeEditReport`
- `FallbackExecutionReport`

### Editor

The Editor layer is the only layer that mutates Unity. It applies approved
commands through bridge tools, captures evidence, and reports machine-readable
results.

### Unity Project Target

UOS can have multiple live Unity Editor bridges. The launcher may select an
initial target, but the Ochestrator can list connected projects and switch the
session target before mutation. After a switch, context and bridge readiness
must be reloaded for the selected project.

## User Experience

The user should be able to say:

- "이 Ref 폴더로 키오스크를 만들어줘."
- "이 PPTX로 화면을 만들어줘."
- "현재 화면을 reference와 비교해서 고쳐줘."
- "씬에 Cube와 조명을 배치해줘."
- "현재 프로젝트 상태를 보고해줘."

In each case the Ochestrator should:

1. identify the likely mode,
2. explain the selected mode when useful,
3. plan the work,
4. ask for approval at meaningful boundaries,
5. apply through the Editor,
6. verify,
7. summarize progress and next work.

## Success Criteria

- Mode selection is explicit, testable, and available to opencode.
- Kiosk-specific logic lives under `.opencode/recipes/kiosk.md` rather than a
  kiosk-specific submodel or the default agent.
- General material-to-screen tasks still work.
- Read-only inspection does not mutate Unity.
- Project selection can happen inside opencode without leaking bridge tokens to
  model output or user-facing summaries.
- Code/script/configuration requests route to `code-editor` instead of falling
  through to `general-editor`.
- `general-editor` remains a constrained fallback executor; repeated fallback
  patterns are promoted into a future submodel or recipe.
- Build paths produce evidence through previews, comparisons, hierarchy reads,
  or scene object lists.
- Progress survives context compaction through docs and `.omx/notepad.md`.

## Current Status

Implemented:

- deterministic mode registry and selector in `bin/mode-core.js`
- opencode tool `select_uos_mode`
- single user-facing opencode agent at `.opencode/agents/ochestrator.md`
- internal submodel handoff docs under `.opencode/submodels/`
- tests in `tests/uos-modes.test.ts`
- architectural notes in `docs/uos-ochestrator-rework.md`

Next:

- validate the Ochestrator-only UX in a live opencode session.
