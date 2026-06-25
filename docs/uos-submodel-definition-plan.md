# UOS Submodel Definition Plan

This document tracks the detailed definition pass for the seven active UOS
functional submodels.

## Definition Order

1. `material-understanding`
2. `ui-screen-builder`
3. `visual-verification`
4. `unity-inspection`
5. `scene-object-editor`
6. `code-editor`
7. `general-editor`

The first three are ordered first because material interpretation, screen
building, and visual verification form the MVP path for image/document/PPTX to
Unity UI work.

## Common Decision Template

For each submodel, decide:

- Purpose: what this submodel exists to do.
- Non-goals: what it must not own.
- Inputs: required context, optional context, and accepted artifacts.
- Outputs: artifact names and minimum schema.
- Tools: allowed tools, forbidden tools, and read/write classification.
- Workflow: normal step sequence.
- Approval: operations that must return to Ochestrator/user before mutation.
- Evidence: what must be persisted or reported after work.
- Failure handling: when to stop, retry, ask, or hand off.
- Handoff: next submodels or recipes this submodel may call into.

## Status

| Submodel | Status | Notes |
| --- | --- | --- |
| `material-understanding` | Defined | MVP inputs, artifact schema, classification rules, confirmation gates, failure handling, and handoff rules decided. |
| `ui-screen-builder` | Defined | UGUI MVP backend, build modes, UIScreenBuildPlan, PlanningIntent rules, approval gates, failure handling, and handoff rules decided. |
| `visual-verification` | Defined | VisualVerificationReport, verdict thresholds, repair loop limits, approval gates, failure handling, and handoff rules decided. |
| `unity-inspection` | Defined | UnityInspectionReport, target selection boundary, read/edit readiness, read-only workflow, failure handling, and handoff rules decided. |
| `scene-object-editor` | Defined | SceneObjectPlan schema, supported object types, context resolution rules, mutation approval gates, failure handling, and handoff rules decided. |
| `code-editor` | Defined | CodeEditPlan and CodeEditReport schemas, editable roots, validation rules, approval gates, failure handling, and handoff rules decided. |
| `general-editor` | Defined | Fallback executor boundary, Ochestrator-owned routing, WorkPlan/FallbackExecutionReport schemas, approval gates, promotion rules, failure handling, and handoff recommendation rules decided. |

## Current Decision

All seven active submodels are defined. Next work should use these contracts to
update Ochestrator behavior, implementation helpers, or live validation.

## material-understanding Decisions

Confirmed:

- MVP required inputs are image, PPTX, PDF, and DOCX.
- The submodel does not auto-progress to the next stage.
- The Ochestrator must confirm the interpreted result with the user before
  `ui-screen-builder` or any other next submodel proceeds.
- Ambiguity must be reduced to 20 percent or less before proceeding.
- If ambiguity is above 20 percent, the Ochestrator should run a re-question
  loop with 2-3 concrete choices plus optional free-form input.
- Where available, choices should support arrow-key movement and Enter
  selection; free-form input remains available.

Confirmed artifact schema:

```json
{
  "version": "1.0.0",
  "sources": [],
  "sourceType": "image | pptx | pdf | docx | mixed",
  "detectedScreens": [],
  "layoutReferences": [],
  "contentMedia": [],
  "textRequirements": [],
  "navigationHints": [],
  "assumptions": [],
  "ambiguity": {
    "estimate": 0,
    "drivers": []
  },
  "clarificationRequest": {
    "required": false,
    "question": "",
    "choices": [],
    "freeFormAllowed": true
  },
  "recommendedNextSubmodels": [],
  "evidence": []
}
```

Confirmed classification criteria:

- `layoutReferences`: visual references that define screen layout, placement,
  size, hierarchy, or intended appearance.
- `contentMedia`: images or embedded media intended to appear inside the final
  Unity content.
- `textRequirements`: copy, labels, descriptions, instructions, button text,
  or data tables that should become UI content.
- `navigationHints`: screen order, links, back/home/drilldown behavior, menu
  hierarchy, or flow diagrams.
- `unsupportedInput`: files that cannot be read, cannot be mapped to MVP input
  types, or need manual conversion.

Confirmed failure handling:

- Stop when no MVP input can be read.
- Stop when extraction fails and no alternate extraction route exists.
- Stop when ambiguity cannot be reduced to 20 percent or less.
- Stop when selected Unity project context is missing or stale enough to affect
  interpretation.
- Stop when the material implies broad/destructive creation without user
  confirmation.

Confirmed handoff rules:

- `ui-screen-builder` for confirmed UI screens, layout, content, or navigation.
- `visual-verification` after UI work when references or quality targets exist.
- `scene-object-editor` for clearly non-UI GameObject work.
- `code-editor` for scripts, configuration, or project-file edits.
- `general-editor` only when no more specific functional submodel applies.

## ui-screen-builder Decisions

Confirmed:

- MVP UI backend is UGUI.
- `ui-screen-builder` must not interpret raw image/PPTX/PDF/DOCX materials
  before `material-understanding` has produced a confirmed interpretation.
- `ui-screen-builder` may perform implementation-level interpretation, but must
  not perform semantic reinterpretation of confirmed `MaterialUnderstanding`.
- `MaterialUnderstanding` does not need exhaustive pixel/element detail; it must
  provide enough confirmed meaning, classification, source references, and
  evidence for implementation-level conversion.
- Input interpretation must be confirmed by the Ochestrator/user, with
  ambiguity at or below 20 percent.
- Screen building uses one of three build modes:
  - `editable`: UGUI element reconstruction.
  - `reference`: source material rendered/imported as a reference screen.
  - `hybrid`: reference background plus editable overlay; requires explicit
    user confirmation.
- Image-only mockups default to `reference` unless the user confirms editable
  reconstruction.
- PPTX with readable layout/text defaults to `editable`.
- text-forward PDF/DOCX defaults to `editable`.
- low-confidence element semantics default to `reference` plus clarification,
  not automatic editable reconstruction.

Confirmed `UIScreenBuildPlan` schema:

```json
{
  "version": "1.0.0",
  "kind": "UIScreenBuildPlan",
  "source": "MaterialUnderstanding | direct-user-intent | existing-PlanningIntent",
  "buildMode": "editable | reference | hybrid",
  "targetScreens": [],
  "planningIntents": [],
  "transitions": [],
  "approval": {
    "required": true,
    "reason": ""
  },
  "verification": {
    "required": true,
    "targets": []
  },
  "assumptions": [],
  "evidence": []
}
```

Confirmed `PlanningIntent` rules:

- `version` must be `1.0.0`.
- `screenName` must be non-empty and stable.
- `referenceCanvas` must include positive `width` and `height`.
- `rect` values are normalized to 0..1 with top-left origin.
- `clientHintId` is advisory and authoritative only within one
  `create_ui_screen` call.
- follow-up edits must use canonical `elementId` values returned by the bridge.

Confirmed MVP element types:

- `Panel`
- `Text`
- `Button`
- `Image`
- `InputField`
- `Toggle`
- `Slider`
- `ScrollView`
- `Dropdown`

Confirmed approval gates:

- creating or replacing more than one screen,
- deleting UI elements,
- rewiring transitions,
- saving the scene,
- importing many assets,
- choosing `hybrid` mode,
- converting low-confidence material interpretation into editable UI,
- modifying an existing user-authored or previously generated screen.

Confirmed failure handling:

- Stop when selected Unity project context is missing or stale.
- Stop when required bridge UI tools are unavailable.
- Stop when user confirmation is missing.
- Stop when ambiguity is above 20 percent.
- Stop when `PlanningIntent` validation fails.
- Stop when source assets cannot be imported.
- Stop when target screen/element identity is ambiguous.
- Stop when requested UI cannot be represented with MVP UGUI element types.

Confirmed handoff rules:

- `visual-verification` after screen creation/revision when references or
  quality targets exist.
- `unity-inspection` when target screen/element identity is ambiguous.
- `code-editor` when required UI behavior needs scripts or project-file changes.
- `scene-object-editor` when the confirmed request leaves UI scope.
- `general-editor` only when no more specific functional submodel applies.

## visual-verification Decisions

Confirmed:

- `visual-verification` verifies Unity UI output and may perform visual
  implementation analysis.
- It must not semantically reinterpret confirmed `MaterialUnderstanding`.
- It must not rebuild whole screens without returning to `ui-screen-builder`.
- Baseline verdicts are `close`, `needs review`, `different`, and
  `unavailable`.
- MVP repair loops are limited to at most 3 iterations per screen.
- `close` stops automatic repair and reports evidence.
- `needs review` may produce targeted repair after Ochestrator approval.
- `different` usually requires target/source verification or return to
  `ui-screen-builder`.
- `aspectRatioDelta > 0.02` indicates canvas/source/build-mode investigation
  before local tweaks.

Confirmed `VisualVerificationReport` schema:

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

Confirmed approval gates:

- applying any mutating repair command,
- deleting UI elements,
- adding replacement UI elements,
- changing more than three elements in one iteration,
- running a second or third repair iteration,
- verifying or repairing multiple screens,
- returning to `ui-screen-builder` for broad rebuild.

Confirmed failure handling:

- Stop when project context is missing or stale.
- Stop when target screen/reference/preview cannot be resolved.
- Stop when comparison cannot be produced.
- Stop when hierarchy lacks enough element ids for targeted repair.
- Stop when repair would require semantic reinterpretation.
- Stop after 3 MVP repair iterations.
- Stop when comparison gets worse without a clear corrective action.

Confirmed handoff rules:

- `unity-inspection` for ambiguous screen, element, preview, or context identity.
- `ui-screen-builder` for wrong build mode, wrong canvas, broad layout failure,
  missing screen structure, or whole-screen rebuild.
- `material-understanding` only when confirmed source classification or screen
  meaning appears wrong.
- `code-editor` when visual behavior needs scripts or project-file changes.
- `general-editor` only when no more specific functional submodel applies.

## unity-inspection Decisions

Confirmed:

- `unity-inspection` is the read-only baseline before mutation when target,
  bridge readiness, active screen, element identity, scene object identity, or
  persisted `.uos` context is unclear.
- `select_unity_project` is allowed because it changes only the active bridge
  target for the session and does not mutate Unity content.
- Target switching still requires explicit user choice when multiple live
  projects are possible or a selector is ambiguous.
- Always call `get_uos_context` after switching target.
- Inspection readiness and editing readiness are separate.
- Inspection may succeed while editing is blocked.
- Bridge tokens must never be recorded or echoed.

Confirmed `UnityInspectionReport` schema:

```json
{
  "version": "1.0.0",
  "kind": "UnityInspectionReport",
  "target": {
    "projectName": "",
    "projectPath": "",
    "editorInstanceId": "",
    "selectionSource": "launcher | session | env | user | unknown",
    "targetStateFile": ""
  },
  "liveProjects": [],
  "bridge": {
    "host": "",
    "port": "",
    "protocolVersion": "",
    "supportedTools": [],
    "writeTools": []
  },
  "readiness": {
    "inspection": "ready | warning | blocked | unknown",
    "editing": "ready | warning | blocked | unknown",
    "blockers": [],
    "warnings": []
  },
  "context": {
    "hasContext": false,
    "contextDir": "",
    "activeScreenId": "",
    "screenCount": 0,
    "sceneObjectCount": 0,
    "activeOchestratorProgress": false
  },
  "screens": [],
  "hierarchy": {
    "requested": false,
    "rootCount": 0,
    "nodeCount": 0,
    "truncated": false
  },
  "sceneObjects": [],
  "recommendations": [],
  "evidence": []
}
```

Confirmed approval/choice gates:

- No approval required for read-only inspection.
- Explicit user choice required before ambiguous target switching.
- If inspection turns into mutation, return to Ochestrator for mode selection
  and mutation approval.

Confirmed failure handling:

- Stop when no live bridge is found and live inspection is required.
- Stop when target selection is ambiguous.
- Stop when selected target is no longer live.
- Stop when context/project directory cannot be resolved.
- Stop when read-only bridge calls fail.
- Stop when bridge readiness is blocked for the requested mutation.
- Stop when requested screen, element, or scene object identity cannot be
  resolved.

Confirmed handoff rules:

- `material-understanding` for planning materials needing interpretation.
- `ui-screen-builder` for confirmed UI creation/revision.
- `visual-verification` for preview/reference comparison or visual feedback.
- `scene-object-editor` for non-UI GameObjects.
- `code-editor` for scripts/config/project-file issues.
- `general-editor` only when no more specific functional submodel applies.

## scene-object-editor Decisions

Confirmed:

- `scene-object-editor` owns non-UI Unity GameObject work through UOS
  scene-object bridge tools.
- It is for simple spatial content: primitives, cameras, lights, empty parents,
  markers, hierarchy parenting, active state, and local transforms.
- It must not own UGUI screen work, raw planning-material interpretation, code
  edits, asset imports, complex materials, custom components, prefabs, or broad
  scene design outside bridge support.
- Supported MVP creation types are `Empty`, `Cube`, `Sphere`, `Capsule`,
  `Cylinder`, `Plane`, `Quad`, `Camera`, `PointLight`, `DirectionalLight`, and
  `SpotLight`.
- Call `get_uos_context` at the start of the handoff.
- Use `list_scene_objects` or `resolve_scene_object_from_context` before
  follow-up edits when canonical `objectId` is not already known.
- Use direct `update_scene_object` and `delete_scene_object` only when exact
  `objectId` is known.
- Use `update_scene_object_from_context` and `delete_scene_object_from_context`
  when the user refers to a prior object by name, type, path, or natural query.

Confirmed `SceneObjectPlan` schema:

```json
{
  "version": "1.0.0",
  "kind": "SceneObjectPlan",
  "id": "",
  "modeId": "scene-object-editor",
  "title": "",
  "goal": "",
  "status": "draft | needs-approval | approved | blocked | done | cancelled",
  "target": {
    "projectName": "",
    "projectPath": "",
    "scenePath": ""
  },
  "scope": "create | update | delete | inspect | mixed",
  "steps": [],
  "operations": [
    {
      "id": "",
      "action": "create | update | delete | resolve | list | save",
      "objectId": "",
      "selector": {},
      "objectType": "Empty | Cube | Sphere | Capsule | Cylinder | Plane | Quad | Camera | PointLight | DirectionalLight | SpotLight",
      "name": "",
      "parentId": "",
      "active": true,
      "transform": {
        "position": { "x": 0, "y": 0, "z": 0 },
        "rotation": { "x": 0, "y": 0, "z": 0 },
        "scale": { "x": 1, "y": 1, "z": 1 }
      },
      "requiresApproval": true,
      "risk": "low | medium | high"
    }
  ],
  "approval": {
    "required": true,
    "reasons": []
  },
  "verification": {
    "required": true,
    "readbackTools": ["list_scene_objects"],
    "expectedObjects": []
  },
  "assumptions": [],
  "evidence": []
}
```

Confirmed approval gates:

- deleting any object,
- saving a scene,
- mutating more than one scene object,
- changing camera or light objects,
- changing parent relationships,
- hiding/deactivating objects,
- applying transforms with unclear units, coordinate space, or target,
- using `latest` to resolve among multiple matching objects,
- mutating an object not created or tracked by UOS,
- proceeding when bridge write readiness is warning or blocked.

Confirmed failure handling:

- Stop when project context is missing or stale.
- Stop when required scene-object bridge tools are unavailable.
- Stop when requested object type is unsupported.
- Stop when target object cannot be resolved to exactly one canonical object.
- Stop when update payload has no `name`, `parentId`, `active`, or `transform`
  change.
- Stop when requested work needs components, scripts, prefabs, assets,
  materials, or editor operations outside bridge support.
- Stop when readback cannot confirm the expected object state.
- Stop when save fails or the requested save path is outside the Unity project.

Confirmed handoff rules:

- `unity-inspection` for unclear project, bridge, hierarchy, or target identity.
- `ui-screen-builder` for screens, UGUI elements, canvas layout, or transitions.
- `material-understanding` when image, PPTX, PDF, or DOCX interpretation is
  needed first.
- `visual-verification` for preview/reference comparison after visual scene
  changes.
- `code-editor` for scripts, components, custom behavior, prefabs, project
  files, or build settings.
- `general-editor` only when no more specific functional submodel applies.

## code-editor Decisions

Confirmed:

- `code-editor` owns code and text-file edits when Unity bridge commands are
  insufficient.
- It may edit C# scripts, Editor scripts, asmdefs, package files, text
  configuration, tests, generated source assets, and UOS helper code.
- It must not own UGUI screen bridge work, scene-object bridge work, raw
  planning-material interpretation, or visual verification.
- It must not directly mutate Unity scenes, prefabs, serialized binary assets,
  imported media, dependencies, or package installations without explicit
  Ochestrator approval.
- The editable root must be clear: selected Unity project, UOS package, UOS
  local tooling, or a user-approved mixed root.
- Read relevant files and search existing patterns before editing.
- Manual edits use `apply_patch`.
- Validation should run narrow checks first, then broaden only when the changed
  surface justifies it.

Confirmed `CodeEditPlan` schema:

```json
{
  "version": "1.0.0",
  "kind": "CodeEditPlan",
  "id": "",
  "modeId": "code-editor",
  "title": "",
  "goal": "",
  "status": "draft | needs-approval | approved | blocked | done | cancelled",
  "target": {
    "workspaceRoot": "",
    "unityProjectPath": "",
    "uosPackagePath": "",
    "scope": "unity-project | uos-package | uos-local-tooling | mixed"
  },
  "files": [
    {
      "path": "",
      "role": "source | editor-source | test | config | package | generated | docs",
      "operation": "create | update | delete | inspect",
      "risk": "low | medium | high"
    }
  ],
  "steps": [],
  "approval": {
    "required": true,
    "reasons": []
  },
  "validation": {
    "required": true,
    "commands": [],
    "unityBatchmode": false
  },
  "assumptions": [],
  "evidence": []
}
```

Confirmed `CodeEditReport` schema:

```json
{
  "version": "1.0.0",
  "kind": "CodeEditReport",
  "planId": "",
  "changedFiles": [
    {
      "path": "",
      "operation": "create | update | delete",
      "summary": ""
    }
  ],
  "diagnostics": [],
  "validation": [
    {
      "command": "",
      "status": "passed | failed | skipped",
      "summary": ""
    }
  ],
  "followUp": {
    "requiresUnityBridge": false,
    "recommendedSubmodel": "",
    "reason": ""
  },
  "residualRisk": [],
  "evidence": []
}
```

Confirmed approval gates:

- deleting, renaming, or moving user-authored files,
- editing Unity `ProjectSettings`, `Packages/manifest.json`, lockfiles,
  asmdefs, serialized `.unity`, `.prefab`, `.asset`, `.mat`, or `.meta` files,
- dependency upgrades, package installation, or network downloads,
- broad rewrites, generated-code replacement, or cross-cutting architecture
  changes,
- changing public APIs, serialized field names, namespaces, assembly
  boundaries, or package names,
- modifying files outside the selected target root,
- running long Unity batchmode commands that are not required for validation,
- applying fixes when diagnostics point to several incompatible causes,
- resolving overlapping user edits in target files.

Confirmed failure handling:

- Stop when target root cannot be determined.
- Stop when requested files are outside the selected root.
- Stop when relevant files cannot be found or read.
- Stop when existing user changes overlap the intended patch in a way that
  makes the safe edit unclear.
- Stop when unsupported binary/serialized Unity asset edits are required.
- Stop when dependency or package changes are needed but not approved.
- Stop when diagnostics are insufficient to choose between incompatible fixes.
- Stop when validation cannot run and the change is too risky to leave
  unverified.
- Stop when requested behavior requires live Unity mutation instead of code
  edits.

Confirmed handoff rules:

- `unity-inspection` for unclear project, bridge readiness, hierarchy, or
  context identity.
- `material-understanding` when image, PPTX, PDF, DOCX, or planning-material
  interpretation is needed first.
- `ui-screen-builder` for screen or UGUI element creation/revision.
- `scene-object-editor` for non-UI GameObject mutation.
- `visual-verification` for preview/reference comparison after code changes
  affect visual output.
- `general-editor` only when no more specific functional submodel applies.

## general-editor Decisions

Confirmed:

- `general-editor` is a constrained fallback executor, not a fallback
  Ochestrator.
- Ochestrator owns routing, ambiguity reduction, approval, next-submodel
  decisions, and progress reporting.
- `general-editor` may run only after Ochestrator checks
  `material-understanding`, `ui-screen-builder`, `scene-object-editor`,
  `code-editor`, `visual-verification`, and `unity-inspection` and finds no
  clear owner.
- `general-editor` must not choose the user-facing workflow or submodel
  sequence.
- It must not own material interpretation, UI screen building, scene-object
  mutation, code/file editing, visual verification, or inspection-only work.
- Repeated fallback patterns must be reported as promotion candidates for a
  future submodel or recipe.

Confirmed fallback `WorkPlan` schema:

```json
{
  "version": "1.0.0",
  "kind": "WorkPlan",
  "id": "",
  "modeId": "general-editor",
  "title": "",
  "goal": "",
  "status": "draft | needs-approval | approved | blocked | done | cancelled",
  "fallback": {
    "reason": "",
    "excludedSubmodels": [
      "material-understanding",
      "ui-screen-builder",
      "scene-object-editor",
      "code-editor",
      "visual-verification",
      "unity-inspection"
    ],
    "promotionCandidate": false,
    "promotionReason": ""
  },
  "target": {
    "projectName": "",
    "projectPath": "",
    "scenePath": ""
  },
  "steps": [],
  "approvalRequired": true,
  "validation": {
    "required": true,
    "readbackTools": []
  },
  "assumptions": [],
  "evidence": []
}
```

Confirmed `FallbackExecutionReport` schema:

```json
{
  "version": "1.0.0",
  "kind": "FallbackExecutionReport",
  "planId": "",
  "target": {
    "projectName": "",
    "projectPath": "",
    "scenePath": ""
  },
  "commands": [],
  "verification": {
    "status": "passed | failed | skipped",
    "summary": ""
  },
  "promotion": {
    "candidate": false,
    "suggestedSubmodel": "",
    "suggestedRecipe": "",
    "reason": ""
  },
  "residualRisk": [],
  "evidence": []
}
```

Confirmed approval gates:

- any mutation,
- saving a scene,
- using a bridge tool not explicitly allowed in the handoff,
- executing a task whose specialist ownership is uncertain,
- handling a repeated fallback pattern for the second time,
- broad project/editor settings changes,
- any operation that may affect builds, packages, assets, scenes, prefabs,
  scripts, UI screens, scene objects, or visual output.

Confirmed failure handling:

- Stop when fallback reason is missing.
- Stop when any specialist submodel clearly owns the task.
- Stop when target project or bridge readiness is unclear.
- Stop when the requested operation needs a forbidden tool.
- Stop when the work is broad enough to deserve a new specialist submodel or
  recipe before execution.
- Stop when approval is missing for mutation or save.
- Stop when readback cannot confirm the fallback change.
- Stop when the same fallback pattern appears repeatedly.

Confirmed handoff recommendation rules:

- Return to the Ochestrator instead of routing directly.
- Recommend `material-understanding` for planning material interpretation.
- Recommend `ui-screen-builder` for screens, UGUI elements, canvas layout, or
  transitions.
- Recommend `scene-object-editor` for non-UI GameObjects.
- Recommend `code-editor` for scripts, files, packages, components, or project
  settings.
- Recommend `visual-verification` for preview/reference comparison or visual
  repair.
- Recommend `unity-inspection` for unclear target, context, bridge, hierarchy,
  or object identity.
- Recommend a new submodel or recipe when fallback work repeats or gains a
  stable method.
