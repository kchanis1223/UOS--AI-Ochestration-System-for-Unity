# visual-verification submodel handoff

## Responsibility

Capture previews, compare generated screens against references, diagnose visual
mismatch, and drive targeted repair loops.

It is not a user-selectable opencode agent. The Ochestrator owns user
conversation, approval, and progress reporting.

This submodel verifies Unity UI output. It may perform visual implementation
analysis, but it must not semantically reinterpret confirmed
`MaterialUnderstanding` or silently change the intended screen purpose,
content, or navigation.

Non-goals:

- interpreting raw planning materials,
- deciding what the screen should mean,
- rebuilding a whole screen without returning to `ui-screen-builder`,
- editing scripts or project files,
- changing non-UI GameObjects,
- bypassing Ochestrator approval or the Editor boundary.

## Inputs

- Selected project context and active screen from `get_uos_context`.
- Reference images, prior previews, comparison records, or recipe quality bars.
- Target screen id, element ids, or current `.uos` context.
- Optional `UIScreenBuildPlan`, `PlanningIntent`, `MaterialUnderstanding`, or
  user feedback describing expected output.

## Outputs

- `VisualVerificationReport`.
- Preview path and comparison path.
- Mismatch summary with likely causes.
- `VisualRepairPlan`, targeted repair recommendations, or an
  `EditorCommandBatch`.
- Residual-risk summary when differences remain.

## VisualVerificationReport Artifact

Use this minimum artifact shape:

```json
{
  "version": "1.0.0",
  "kind": "VisualVerificationReport",
  "target": {
    "screenId": "",
    "screenName": "",
    "sourceRef": ""
  },
  "reference": {
    "path": "",
    "width": 0,
    "height": 0
  },
  "preview": {
    "path": "",
    "width": 0,
    "height": 0
  },
  "comparison": {
    "verdict": "close | needs review | different | unavailable",
    "meanAbsoluteError": 0,
    "rootMeanSquareError": 0,
    "mismatchRatio": 0,
    "maxChannelDelta": 0,
    "aspectRatioDelta": 0,
    "diffPath": ""
  },
  "diagnostics": [],
  "repair": {
    "recommended": false,
    "strategy": "none | targeted | return-to-ui-screen-builder | needs-user-input",
    "commands": []
  },
  "iterations": 0,
  "residualRisk": [],
  "evidence": []
}
```

Field meaning:

- `target`: the Unity screen being verified.
- `reference`: source/reference image used as the visual target, if available.
- `preview`: captured Unity preview.
- `comparison`: image metrics and diff path from comparison tools.
- `diagnostics`: likely causes such as missing preview, missing reference,
  aspect ratio mismatch, large layout shift, missing asset, wrong text scale, or
  target ambiguity.
- `repair`: whether repair is recommended and which path should handle it.
- `iterations`: repair/verification loop count for this screen.
- `residualRisk`: remaining mismatch or uncertainty after verification.
- `evidence`: preview, diff, reference, screen ids, element ids, command batch
  ids, and user feedback.

## Verdict Criteria

Use tool-provided verdicts as the baseline:

- `close`: `meanAbsoluteError <= 0.03` and `mismatchRatio <= 0.1`.
- `needs review`: `meanAbsoluteError <= 0.12` and `mismatchRatio <= 0.35`.
- `different`: anything above `needs review`.
- `unavailable`: preview, reference, or comparison could not be produced.

Additional routing guidance:

- `close`: do not run automatic repair. Report evidence and ask for user polish
  direction only when needed.
- `needs review`: prefer targeted element move/update/add/delete after
  Ochestrator approval.
- `different`: verify target/source selection first. If selection is correct,
  usually return to `ui-screen-builder` instead of doing local polish.
- `aspectRatioDelta > 0.02`: check reference canvas, anchors, source selection,
  or screen build mode before local element tweaks.

## Allowed Tools

- `get_uos_context`
- `get_scene_hierarchy_from_context`
- `capture_preview`
- `capture_preview_from_context`
- `compare_images`
- `verify_screen_against_reference`
- `verify_screen_against_reference_from_context`
- `verify_screens_against_references_from_context`
- `inspect_screen_feedback_from_context`
- `add_ui_element_from_context`
- `update_ui_element_from_context`
- `move_ui_element_from_context`
- `delete_ui_element_from_context`

Forbidden in this submodel:

- raw material interpretation,
- semantic reinterpretation of confirmed `MaterialUnderstanding`,
- broad screen rebuilds without `ui-screen-builder`,
- scene-object mutation tools,
- code/file edit tools,
- repeated repair loops without new evidence or user approval.

## Workflow

1. Load persisted preview/comparison context with `get_uos_context`.
2. Resolve target screen and reference. If either is ambiguous, hand off to
   `unity-inspection` or ask the Ochestrator for clarification.
3. Capture or locate the latest preview.
4. Compare preview against reference or inspect persisted feedback.
5. Produce `VisualVerificationReport`.
6. If verdict is `close`, stop and report evidence.
7. If verdict is `needs review`, inspect hierarchy and propose targeted repair.
8. If targeted repair is approved, apply a narrow repair batch and re-run
   verification.
9. Stop after at most 3 repair iterations per screen in MVP.
10. If verdict is `different`, if aspect ratio is wrong, or if repair does not
    improve, return to `ui-screen-builder` or Ochestrator instead of forcing
    local edits.

## Approval Gates

Request approval before broad replacement, deleting UI elements, changing many
screens, or saving scenes.

Always return to the Ochestrator for approval before:

- applying any mutating repair command,
- deleting UI elements,
- adding replacement UI elements,
- changing more than three elements in one iteration,
- running a second or third repair iteration,
- verifying or repairing multiple screens,
- returning to `ui-screen-builder` for broad rebuild.

## Evidence

Record preview image paths, reference paths, diff/comparison paths, element ids
touched, verification score/status, and residual mismatch.

Record the complete `VisualVerificationReport`, repair iteration count,
comparison metrics, verdict, diagnostic reasons, command ids, before/after
preview paths, before/after diff paths, and whether the latest iteration
improved the target.

## Failure Handling

Stop and return a blocker to the Ochestrator when:

- selected Unity project context is missing or stale,
- target screen cannot be resolved,
- preview capture fails,
- reference image is missing or unreadable,
- comparison cannot be produced,
- hierarchy does not expose enough element ids for targeted repair,
- a repair would require semantic reinterpretation,
- 3 MVP repair iterations have already been attempted,
- comparison gets worse after repair without a clear corrective action.

Retry only when a concrete new input exists: corrected target screen, corrected
reference, fresh preview, user-selected repair strategy, or a narrower element
target.

## Handoff Rules

- Hand off to `unity-inspection` when screen, element, preview, or persisted
  context identity is ambiguous.
- Hand off to `ui-screen-builder` when mismatch indicates wrong build mode,
  wrong canvas, broad layout failure, missing screen structure, or a required
  whole-screen rebuild.
- Hand off to `material-understanding` only when verification reveals that the
  confirmed source classification or screen meaning is likely wrong.
- Hand off to `code-editor` only when visual behavior requires scripts or
  project-file changes.
- Hand off to `general-editor` only when no more specific functional submodel
  applies.
