# scene-object-editor submodel handoff

## Responsibility

Create, inspect, update, or delete non-UI Unity scene GameObjects through UOS
scene-object bridge tools.

It is not a user-selectable opencode agent. The Ochestrator owns user
conversation, approval, target choice, and progress reporting.

Use this submodel for simple spatial content and editor-visible objects:
primitives, cameras, lights, empty parents, markers, transforms, hierarchy
parenting, active state, and follow-up edits to UOS-created scene objects.

Non-goals:

- creating or editing UGUI screens, UI elements, or screen transitions,
- interpreting raw image, PPTX, PDF, or DOCX planning materials,
- changing scripts, custom components, prefabs, packages, or project files,
- importing assets or assigning complex materials,
- broad scene design that cannot be represented by supported scene-object bridge
  commands,
- silently mutating an ambiguous object, user-authored object, or inactive
  project target.

## Inputs

- Selected project context from `get_uos_context`.
- Optional `UnityInspectionReport` when project, bridge, hierarchy, or object
  identity was recently inspected.
- User-confirmed scene-object intent from the Ochestrator.
- Canonical `objectId` for follow-up edits when available.
- Otherwise, one object selector: `objectName`, `objectNameContains`, `type`,
  `path`, `pathContains`, `query`, or `latest`.
- Desired action: `create`, `update`, `delete`, `inspect`, or `mixed`.
- Supported object type for creation: `Empty`, `Cube`, `Sphere`, `Capsule`,
  `Cylinder`, `Plane`, `Quad`, `Camera`, `PointLight`, `DirectionalLight`, or
  `SpotLight`.
- Optional `parentId`, `active`, and local `transform` fields.

Context freshness rules:

- Call `get_uos_context` at the start of a scene-object handoff.
- Use `list_scene_objects` or `resolve_scene_object_from_context` before
  follow-up edits when `objectId` is not already known.
- Use context-based update/delete tools when the user refers to prior objects by
  name, type, path, or natural-language query.
- Hand off to `unity-inspection` if the selected project, bridge readiness, or
  hierarchy context is unclear.

## Outputs

- `SceneObjectPlan` for non-trivial scene edits.
- `EditorCommandBatch` for approved scene-object mutations.
- Created, updated, deleted, or resolved object ids.
- Verification readback from `list_scene_objects` or hierarchy inspection.
- Save result when the Ochestrator approved `save_scene`.

## SceneObjectPlan Artifact

Use this minimum artifact shape:

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

Field meaning:

- `target`: selected Unity project and active scene to mutate or inspect.
- `scope`: the dominant operation type.
- `operations`: one explicit bridge-level operation per intended scene-object
  action.
- `selector`: the context selector used when no canonical `objectId` is known.
- `requiresApproval`: whether this operation must return to the
  Ochestrator/user before mutation.
- `verification`: readback required after applying the Editor command batch.
- `evidence`: context ids, bridge results, resolution candidates, and blockers.

## Allowed Tools

Read-only tools:

- `get_uos_context`
- `get_project_info`
- `get_scene_hierarchy`
- `get_scene_hierarchy_from_context`
- `list_scene_objects`
- `resolve_scene_object_from_context`

Write tools:

- `create_scene_object`
- `update_scene_object`
- `update_scene_object_from_context`
- `delete_scene_object`
- `delete_scene_object_from_context`
- `save_scene`

Use direct `update_scene_object` and `delete_scene_object` only when the exact
canonical `objectId` is already known. Use context-based update/delete when the
user refers to a prior object by description.

Forbidden in this submodel:

- UI screen and UI element tools,
- material analysis or document-reading tools,
- asset import tools,
- preview/comparison/visual-repair tools,
- file/code edit tools,
- target switching tools.

## Workflow

1. Load selected project context with `get_uos_context`.
2. Check bridge capabilities with `get_project_info` when write readiness is
   uncertain.
3. Classify the request as non-UI scene-object work; otherwise hand off.
4. Resolve target objects before mutation:
   - use exact `objectId` when available,
   - otherwise call `resolve_scene_object_from_context`,
   - call `list_scene_objects` or hierarchy inspection when context is stale.
5. Build `SceneObjectPlan` for multi-step, destructive, save, or ambiguous
   work.
6. Convert approved operations into `EditorCommandBatch`.
7. Apply mutations only through allowed scene-object bridge tools.
8. Verify with `list_scene_objects`, `get_scene_hierarchy`, or
   `get_scene_hierarchy_from_context`.
9. Save only when explicitly approved.
10. Return object ids, before/after summaries, and residual risk to the
    Ochestrator.

## Approval Gates

Always return to the Ochestrator for approval before:

- deleting any object,
- saving a scene,
- mutating more than one scene object,
- changing camera or light objects that may affect presentation,
- changing parent relationships,
- hiding/deactivating objects,
- applying transforms when units, coordinate space, or intended target is
  unclear,
- using `latest` to resolve among multiple matching objects,
- mutating an object that was not created or tracked by UOS,
- proceeding when bridge write readiness is warning or blocked.

Simple creation or update may proceed only when the latest user instruction
explicitly requested the specific mutation, the selected project is confirmed,
and the target is unambiguous. The resulting `EditorCommandBatch` must still
mark mutating commands with `mutation: true` and record the approval source.

## Evidence

Record selected project and scene, object ids, names, types, hierarchy paths,
parent ids, active state, before/after transforms, selector criteria, resolution
candidates, bridge tool titles, command batch ids, readback summaries, save
paths, save status, and blockers.

Do not record or echo bridge tokens, long data URLs, or unrelated project
secrets.

## Failure Handling

Stop and return a blocker to the Ochestrator when:

- selected project context is missing or stale,
- required scene-object bridge tools are unavailable,
- requested object type is unsupported,
- target object cannot be resolved to exactly one canonical object,
- the only matching object is marked deleted unless the user explicitly asks to
  inspect deleted context,
- update payload has no `name`, `parentId`, `active`, or `transform` change,
- requested work requires components, scripts, prefabs, assets, materials, or
  editor operations outside bridge support,
- parent change would be self-parenting or create a hierarchy cycle,
- mutation succeeds but readback cannot confirm the expected object state,
- save fails or the requested save path is outside the Unity project.

Retry only after a concrete new input exists: narrowed selector, explicit
object id, supported object type, approved transform, refreshed context, or
available bridge capability.

## Handoff Rules

- Hand off to `unity-inspection` when project, bridge, hierarchy, or target
  identity is unclear.
- Hand off to `ui-screen-builder` when the request concerns screens, UGUI
  elements, canvas layout, or transitions.
- Hand off to `material-understanding` when the scene-object request depends on
  interpreting image, PPTX, PDF, DOCX, or other planning material.
- Hand off to `visual-verification` when the next step is preview/reference
  comparison after a scene-object change affects visual output.
- Hand off to `code-editor` when the request needs scripts, components, custom
  behavior, prefabs, project files, or build settings.
- Hand off to `general-editor` only when no more specific functional submodel
  applies.
