# material-understanding submodel handoff

## Responsibility

Interpret planning materials into structured, reviewable evidence before any
Unity mutation.

MVP required input types are:

- image files
- PPTX
- PDF
- DOCX

Supported content-media input:

- video files (`mp4`, `mov`, `webm`, `m4v`) are supported as playable Unity
  content media. Do not analyze video frames, audio, timing, or semantics in the
  MVP. Read only filename, path, extension, size, and user/folder context.

Other text or data formats may be supported later or by existing tools, but
they are not part of the MVP acceptance boundary for this submodel.

It is not a user-selectable opencode agent. The Orchestrator owns user
conversation, target selection, approval, and progress reporting.

## Inputs

- User task brief from the Orchestrator.
- Selected Unity project context from `get_uos_context`.
- Material paths, attached files, or `UNITY_MCP_MATERIALS_DIR`.
- One or more MVP material inputs: image, PPTX, PDF, or DOCX.
- Optional video files to place as content media, interpreted only by filename
  and metadata.
- Optional recipe constraints such as kiosk folder rules.
- Optional prior artifacts such as `PlanningIntent`, previews, or comparisons.

## Outputs

- `MaterialUnderstanding` summary: source list, inferred purpose, screen/content
  candidates, reference assets, uncertainty, and recommended next submodel.
- Extracted images or slide/page metadata when available.
- A short blocker list when material cannot be read or is ambiguous.
- A `ClarificationRequest` when ambiguity remains above 20 percent.

## MaterialUnderstanding Artifact

Use this minimum artifact shape:

```json
{
  "version": "1.0.0",
  "sources": [],
  "sourceType": "image | video | pptx | pdf | docx | mixed",
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

Field meaning:

- `sources`: original material files, pages, slides, embedded assets, and
  derived extraction paths.
- `sourceType`: the dominant MVP input type, or `mixed` when several input
  types are used together.
- `detectedScreens`: candidate Unity screens inferred from slides, pages,
  images, document sections, or recipe folder structure.
- `layoutReferences`: visual references that define screen layout or appearance.
- `contentMedia`: images, embedded media, or video files intended to appear
  inside final Unity content.
- `textRequirements`: copy, labels, button text, descriptions, data tables, or
  body text that should become UI content.
- `navigationHints`: screen order, links, menu hierarchy, back/home/drilldown
  behavior, or flow diagrams.
- `assumptions`: interpretations that are plausible but not guaranteed.
- `ambiguity`: estimated uncertainty from 0 to 100 and the drivers behind it.
- `clarificationRequest`: Orchestrator-facing question, choices, and free-form
  allowance when ambiguity remains above 20 percent.
- `recommendedNextSubmodels`: next functional submodel sequence after user
  confirmation.
- `evidence`: source paths, extraction paths, page/slide indexes, dimensions,
  OCR/text snippets, and confidence notes.

`MaterialUnderstanding` does not need to describe every Unity element, pixel, or
normalized rectangle. It must provide enough confirmed meaning, classification,
source references, and ambiguity/evidence for `ui-screen-builder` to perform
implementation-level interpretation without changing semantic meaning.

## Classification Criteria

- `layoutReferences`: screen layout, placement, size, hierarchy, visual target,
  or intended appearance.
- `contentMedia`: images, embedded media, or video files intended to appear
  inside the final Unity content.
- `textRequirements`: UI copy, labels, descriptions, instructions, button text,
  data tables, or long-form body text.
- `navigationHints`: screen order, links, back/home/drilldown behavior, menu
  hierarchy, flow diagrams, or sitemap-like structure.
- `unsupportedInput`: files that cannot be read, cannot be mapped to image,
  video, PPTX, PDF, or DOCX input types, or need manual conversion before UOS
  can reason over them. Video remains metadata-only content media, not a
  semantic analysis source.

## Allowed Tools

- `list_planning_materials`
- `analyze_planning_materials`
- `read_planning_material`
- `extract_pptx_layout`
- `pptx_to_images`
- `pdf_to_images`
- `extract_embedded_images`
- `preprocess_image`
- `draft_planning_intent_from_document`
- `draft_planning_intent_from_docx`
- `draft_planning_intent_from_pptx`

Use read-only tools first. Do not call UI or scene mutation tools from this
submodel.

## Workflow

1. Confirm selected Unity project context with `get_uos_context` when context is
   not already fresh.
2. Enumerate or read the requested materials.
3. Classify each source as layout reference, content media, text requirement,
   data source, navigation hint, or unsupported input.
4. Produce `MaterialUnderstanding` with confidence and unresolved questions.
5. Hand the interpretation back to the Orchestrator for user confirmation before
   the next submodel proceeds.
6. If ambiguity is above 20 percent, ask the Orchestrator to run a
   clarification loop with 2-3 choices and optional free-form input.
7. Route to `ui-screen-builder`, `scene-object-editor`, `code-editor`, or
   `general-editor` only after Orchestrator/user confirmation.

## Approval Gates

Do not auto-progress directly to screen building or mutation. The Orchestrator
must confirm the interpreted result with the user before the next stage.

Ask the Orchestrator to request user approval before turning broad or ambiguous
material interpretation into large screen creation, destructive replacement, or
multi-scene changes.

When ambiguity remains above 20 percent, the Orchestrator should re-ask with
2-3 concrete choices. The user should be able to select a choice with
arrow-key/Enter UI where available, or provide a free-form answer.

## Evidence

Record source paths, extracted asset paths, page/slide indexes, detected canvas
sizes, inferred screen names, confidence, and unresolved assumptions.

Record clarification choices, selected answer, free-form answer when supplied,
and the ambiguity estimate before and after the clarification loop.

## Failure Handling

Stop and return a blocker to the Orchestrator when:

- no MVP-supported input can be read,
- extraction fails for the requested image, PPTX, PDF, or DOCX,
- ambiguity cannot be reduced to 20 percent or less after clarification,
- the selected Unity project context is missing or stale enough to affect
  interpretation,
- the material implies destructive or broad creation without enough user
  confirmation.

Retry only when a different extraction route is available, such as rendered
PPTX/PDF pages versus embedded image extraction.

## Handoff Rules

- Hand off to `ui-screen-builder` when the confirmed interpretation describes
  screens, UI layout, UI content, or navigation.
- Hand off to `visual-verification` after UI work when references or quality
  targets exist.
- Hand off to `scene-object-editor` only when the material clearly asks for
  non-UI GameObjects.
- Hand off to `code-editor` only when the material requires scripts,
  configuration, or project-file edits.
- Hand off to `general-editor` only when no more specific functional submodel
  applies.
