# UOS Internal Submodels

Only `Ochestrator` is a user-selectable opencode agent.

Files in this directory define internal functional submodels. A submodel is a
capability contract: it owns one reusable method, its accepted inputs, expected
outputs, approval gates, and evidence. A submodel is not a content domain,
workflow recipe, opencode agent, or user-selectable model.

Domain-specific flows such as kiosk, FPS, arcade, XR, or exhibition content
belong under `.opencode/recipes/` and compose one or more functional submodels.
Recipes are specific content menus, not the common UOS production process.

The common process is owned by the Ochestrator: understand materials and user
intent, reduce ambiguity, draft a `ProductionBlueprint`, get user approval,
convert the approved blueprint into Plan/Build artifacts, apply Editor commands,
and verify the result.

## Required Functional Submodels

- `material-understanding`: interpret MVP planning inputs, specifically image,
  PPTX, PDF, and DOCX materials, into structured planning evidence.
- `ui-screen-builder`: convert approved material understanding or user intent
  into Unity UI screens and editable UGUI element plans.
- `scene-object-editor`: create, inspect, update, or delete non-UI Unity
  GameObjects through scene-object bridge tools.
- `code-editor`: modify Unity project code/assets on disk when bridge tools are
  insufficient, with tests or static checks where available.
- `visual-verification`: capture previews, compare references, diagnose
  mismatch, and drive targeted repair loops.
- `unity-inspection`: read selected project, bridge, screen, hierarchy, scene,
  and persisted UOS context without mutating Unity.
- `general-editor`: constrained fallback executor for small approved Unity work
  that has no dedicated submodel yet; it must not perform Ochestrator routing.

## Required Sections

Each submodel document must include:

- `## Responsibility`
- `## Inputs`
- `## Outputs`
- `## Allowed Tools`
- `## Workflow`
- `## Approval Gates`
- `## Evidence`

## Normal Flow

1. User talks to `Ochestrator`.
2. Ochestrator calls `get_uos_context`.
3. Ochestrator calls `select_uos_mode`.
4. Ochestrator selects functional submodel handoffs and optional recipes.
5. Submodels return bounded evidence for material understanding, inspection,
   screen planning, code edits, or verification.
6. Ochestrator drafts a `ProductionBlueprint` for broad creation work and
   reduces build-relevant ambiguity to 20 percent or less.
7. User approves or revises the blueprint.
8. Approved blueprint becomes mode-specific Plan/Build artifacts.
9. The Editor boundary applies approved Unity bridge commands.
10. Verification compares the result against the approved blueprint and
    references.
