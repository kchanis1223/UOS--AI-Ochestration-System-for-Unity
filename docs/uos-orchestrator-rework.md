# UOS Orchestrator Rework

This document tracks the UOS architecture split from a single
material-to-screen workflow into a general Unity orchestration system.

## Target Model

```text
User
  <-> Orchestrator
        -> Mode selector
        -> Internal submodel handoff
        -> Plan / Build artifacts
        -> Editor execution layer
        -> Unity Editor bridge
```

The user should always talk to the Orchestrator. The Orchestrator understands
the task, selects a work mode, follows an internal submodel handoff for the
specialized method, reviews the result, and reports progress. The Editor layer
is the only layer that applies Unity mutations. Users do not select submodels
or talk directly to specialist prompts.

When multiple Unity Editor projects are connected, the Orchestrator can list
them and switch the active opencode session target before any Editor mutation.
After switching, it reloads `get_uos_context` so project context and bridge
readiness match the selected target.

## Role Boundaries

- Orchestrator: understands intent, selects mode, decomposes work, creates
  internal handoffs, manages approval points, reviews output, and reports
  status.
- Internal submodel: owns an accumulated method for one kind of work, such as
  kiosk content, material-to-screen, scene objects, code editing, inspection,
  visual repair, or constrained fallback execution.
  Submodels are handoff documents and tool paths, not user-selectable opencode
  agents.
- Plan: produces a structured artifact such as `KioskPlan`, `PlanningIntent`,
  `SceneObjectPlan`, `VisualRepairPlan`, `CodeEditPlan`, or `WorkPlan`.
- Build: converts an approved plan into `EditorChangeSet` or
  `EditorCommandBatch`. Code and fallback flows may instead produce
  `CodeEditReport` or `FallbackExecutionReport`.
- Editor: applies approved commands through bridge tools, captures evidence,
  and returns machine-readable results.

The Editor boundary is artifact-first. Broad or multi-step mutations should be
represented as an `EditorCommandBatch`, reviewed for approval needs and
read/write classification, then tracked as `EditorBatchProgress` while each
bridge command produces evidence. Planning and build tools may generate batches,
but they should not directly mutate Unity.

## Initial Task Split

1. Add a deterministic UOS mode registry and selector.
2. Add an Orchestrator-facing tool that records mode choice before internal
   submodel work.
3. Introduce an Orchestrator agent prompt and move the former material-to-screen
   prompt into an internal submodel handoff.
4. Define the common `Plan -> Build -> Editor` artifacts.
5. Move kiosk-specific rules into the `kiosk` recipe used by `kiosk-content`
   mode.
6. Implement kiosk Stage 2: build approved `KioskPlan` into Unity screens and
   transitions.
7. Add the Editor execution boundary and batch progress helpers.
8. Add Orchestrator progress reporting and verification summaries.
9. Add in-session Unity project listing and selection for multi-project UOS
   work.

## Current Implementation

- `bin/mode-core.js` registers the routing modes, including `code-editor` and
  the constrained `general-editor` fallback, and exposes `selectUosMode`.
- `.opencode/tools/select_uos_mode.ts` exposes that selector to opencode.
- `.opencode/agents/orchestrator.md` is the only user-facing UOS opencode
  agent.
- `.opencode/submodels/` stores internal submodel handoff documents.
- `bin/artifact-core.js` defines `WorkPlan`, `EditorChangeSet`, and
  `EditorCommandBatch` validation.
- `bin/kiosk-core.js` produces the enriched `KioskPlan`.
- `bin/kiosk-build-core.js` converts a `KioskPlan` into a dry-run
  `EditorChangeSet` for review.
- `bin/editor-batch-core.js` standardizes read-only checks, approval detection,
  progress records, and evidence capture for Editor batch execution.
- `bin/orchestrator-progress-core.js` persists resumable
  `OrchestratorProgress` records under `.uos/orchestrator/progress.json`.
- `get_uos_context` surfaces active Orchestrator progress so a resumed session
  can continue from the current mode, step, evidence, blockers, and next action.
- `list_unity_projects` and `select_unity_project` let opencode sessions choose
  the active Unity Editor bridge target without exposing bridge tokens.
- Tests protect the mode registry, artifact contracts, kiosk planning/building,
  Editor batch progress helpers, persisted progress resume behavior, and
  in-session Unity target selection.
