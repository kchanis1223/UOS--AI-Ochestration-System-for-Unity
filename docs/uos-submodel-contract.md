# UOS Submodel Contract

This document defines the internal contract for UOS submodels.

## Core Rule

Submodel = capability.

Recipe = specific content menu.

An internal submodel owns a reusable functional method. It does not represent a
content genre such as kiosk, FPS, arcade, XR, exhibition, education, or museum
content. Domain-specific behavior belongs in recipes, which compose submodels
and add menu-specific rules.

The common UOS production process is not a recipe. Reading materials,
clarifying user intent, drafting a blueprint, asking for approval, planning,
building, applying Editor commands, and verifying results are core UOS behavior
for every recipe.

## User Boundary

The user talks only to the UOS Orchestrator. Users must not be asked to choose a
submodel. The Orchestrator selects the required submodel sequence, creates the
handoff, manages approval, and reports progress.

## Editor Boundary

Submodels may plan, inspect, reason, and produce artifacts. Unity mutation must
still pass through the Editor execution layer and Unity bridge tools, or through
explicit code edits reviewed by the Orchestrator.

## Common Production Pipeline

For broad content creation, UOS follows this recipe-agnostic pipeline:

1. Resolve selected Unity project, source materials, and target scene/screen.
2. Interpret planning materials and user intent through functional submodels.
3. Reduce build-relevant ambiguity to 20 percent or less with Orchestrator-led
   clarification loops.
4. Draft a `ProductionBlueprint` that captures the user's intended experience
   before Unity mutation.
5. Ask the user to approve or revise the blueprint.
6. Convert the approved blueprint into mode-specific Plan artifacts.
7. Convert approved Plan artifacts into Build artifacts such as
   `EditorChangeSet` or `EditorCommandBatch`.
8. Apply approved Editor commands through the Editor boundary.
9. Verify against the approved blueprint and source/visual references.

`ProductionBlueprint` is a common UOS artifact, not a recipe. It is the
user-approved source of truth for intent, structure, source mapping,
interaction flow, assumptions, unresolved risks, and selected `recipeId`.
Recipe-specific details belong in a dedicated recipe section inside the
blueprint, for example `recipe.kiosk`.

PPTX, board views, screenshots, or other visual review documents may be derived
from `ProductionBlueprint`, but they are user-facing views of the blueprint, not
the internal source of truth.

## ProductionBlueprint Artifact

Use this minimum artifact shape for broad content creation before mode-specific
Plan/Build artifacts:

```json
{
  "version": "1.0.0",
  "kind": "ProductionBlueprint",
  "id": "",
  "modeId": "",
  "recipeId": "",
  "title": "",
  "goal": "",
  "status": "draft | needs-approval | approved | blocked | cancelled",
  "experience": {},
  "sources": [],
  "screens": [],
  "interactions": [],
  "assumptions": [],
  "risks": [],
  "ambiguity": {
    "estimate": 0,
    "drivers": []
  },
  "approval": {
    "required": true,
    "status": "needs-approval | approved"
  },
  "recipe": {},
  "evidence": []
}
```

Required fields are `version`, `kind`, `id`, `modeId`, `title`, `goal`,
`status`, `experience`, `sources`, `screens`, `interactions`, `assumptions`,
`risks`, `ambiguity`, `approval`, and `evidence`. `recipeId` and `recipe` are
optional for modes without a selected recipe. Approved blueprints must have
`ambiguity.estimate` at 20 or less and `approval.status` set to `approved`.

## Required Functional Submodels

| Submodel | Required because |
| --- | --- |
| `material-understanding` | UOS must understand MVP planning inputs: image, PPTX, PDF, and DOCX materials before building. |
| `ui-screen-builder` | UOS must create and revise editable Unity UI screens from approved intent. |
| `scene-object-editor` | UOS must handle non-UI GameObject work without forcing everything into UGUI. |
| `code-editor` | UOS must change Unity scripts/configuration when bridge commands are insufficient. |
| `visual-verification` | UOS must compare requested output against references and drive repair loops. |
| `unity-inspection` | UOS must safely inspect project state before mutation and during troubleshooting. |
| `general-editor` | UOS needs a constrained fallback executor while new patterns are quarantined and promoted; routing remains Orchestrator-owned. |

## Standard Submodel Sections

Every submodel handoff must include:

- `## Responsibility`
- `## Inputs`
- `## Outputs`
- `## Allowed Tools`
- `## Workflow`
- `## Approval Gates`
- `## Evidence`

## Artifact Expectations

Submodels should produce explicit artifacts instead of hidden reasoning:

- Material interpretation: `MaterialUnderstanding`
- Production agreement: `ProductionBlueprint` with common intent, source
  mapping, interaction flow, assumptions, ambiguity, approval state, selected
  `recipeId`, and optional recipe-specific extension fields
- UI screen creation: `PlanningIntent`, `EditorChangeSet`, or `EditorCommandBatch`
- Scene object work: `SceneObjectPlan` with target project/scene, operation
  list, supported object type, selector or canonical object id, approval
  reasons, verification readback expectations, or an approved
  `EditorCommandBatch`
- Code edits: `CodeEditPlan` for risky or multi-file edits, `CodeEditReport`
  with changed files, diagnostics, validation output, residual risk, and any
  follow-up Unity bridge recommendation
- Verification: `VisualVerificationReport`, preview paths, comparison paths,
  mismatch summary, repair recommendation, residual risk
- Inspection: `UnityInspectionReport`, target selection evidence, bridge
  readiness, project/screen/object identifiers, and recommended next actions
- General fallback: `WorkPlan` with fallback reason, excluded specialist
  submodels, approval source, verification readback, promotion candidate
  metadata, or `FallbackExecutionReport`

## Fallback Boundary

`general-editor` is not a fallback Orchestrator. It must not choose the
submodel sequence, reduce user ambiguity, or decide the next workflow. The
Orchestrator owns routing, confirmation, approval, and progress reporting.

Use `general-editor` only when the Orchestrator has checked the active
specialist submodels and found no clear owner. Repeated fallback patterns must
be reported as candidates for a new submodel or recipe instead of accumulating
inside `general-editor`.

## Recipe Expectations

Recipes live in `.opencode/recipes/` and must name the functional submodels they
compose. A recipe is a specific menu/workflow rule set, not the common UOS
production process. A recipe may add domain rules, naming conventions,
navigation patterns, content mapping, and quality bars, but it must not bypass
the submodel contract, the `ProductionBlueprint` approval gate, or Editor
boundary.

The Orchestrator reads the whole selected recipe and decomposes it into Task
Packets. A Task Packet is a bounded handoff unit sized by submodel ownership,
context packet size, artifact boundary, approval boundary, ambiguity boundary,
and handoff overhead. Submodels may read the recipe for context, but they
execute only the recipe slice included in their handoff. They must not choose
the global recipe workflow, decide the next submodel, or expand their task into
filesystem or Unity mutation that the Orchestrator has not approved.
