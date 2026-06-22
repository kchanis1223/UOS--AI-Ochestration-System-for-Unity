# kiosk recipe

## Domain

Folder-driven kiosk, exhibition, archive, museum, education, or information
display content where source folders, references, and media map into navigable
Unity UI screens.

This is a recipe, not a submodel. It must compose functional submodels instead
of becoming a separate content-specific submodel.

## Uses Functional Submodels

- `material-understanding`: classify planning sources, folder structure, layout
  references, content media, text requirements, navigation hints, and candidate
  Main folder structure.
- `ui-screen-builder`: build approved screens, elements, and transitions.
- `visual-verification`: compare generated screens against references and drive
  targeted repair.
- `unity-inspection`: inspect selected project and existing generated content.
- `general-editor` or `code-editor`: use only for unsupported edits.

## Orchestration Model

The Orchestrator reads this whole recipe and decomposes kiosk work into Task
Packets. A Task Packet is a bounded handoff unit, not a numeric progress range.
Each Task Packet should fit a practical context packet, be owned by one
functional submodel or the Editor layer, and produce one reviewable artifact or
evidence bundle.

Submodels may read the recipe, but they execute only the recipe slice included
in their handoff. They must not reinterpret the full kiosk workflow, choose the
next submodel, request broad filesystem or Unity mutation, or bypass
Orchestrator approval.

The Editor layer does not interpret this recipe. It executes only reviewed
Editor commands and records evidence.

Split Task Packets at artifact boundaries, approval boundaries, ambiguity
boundaries, and context-size boundaries. Avoid splitting work so finely that the
handoff overhead is larger than the work itself.

Each Task Packet handoff should include:

- task goal,
- relevant recipe slice,
- input artifacts from previous packets,
- bounded source references instead of all raw source,
- approval status,
- expected output artifact or evidence,
- stop conditions.

## Recipe Workflow

1. Task Packet: Target Resolution. Load selected Unity context and confirm the
   user-selected Ref root, target Main folder, and target scene/canvas.
2. Task Packet: Planning Understanding. Run material understanding over
   planning sources and draft a
   `KioskStructurePlan` that maps the planning intent into screens, screen
   roles, parent-child relationships, and unresolved ambiguities.
3. Task Packet: Folder Structure Plan. Propose the Main folder structure as a
   dry-run
   `FolderStructurePlan` before creating folders.
4. Task Packet: Material Placement Plan. Propose a `MaterialPlacementPlan` that
   maps Ref materials into the Main structure. Prefer copy or
   reference-manifest behavior; move/delete source files only after explicit
   approval.
5. Task Packet: Filesystem Apply. After approval, create or reuse the Main
   folder structure and place materials according to the approved plan.
6. Task Packet: Kiosk Plan. Produce or refresh `KioskPlan` from the approved
   Main structure.
7. Task Packet: Mapping Review. Summarize sitemap, material mapping, layout references,
   navigation, and Unity hierarchy mapping.
8. Task Packet: Editor Build Plan. Build a dry-run `EditorChangeSet` /
   `UnityHierarchyPlan` and review generated `EditorCommandBatch` entries
   before mutation.
9. Task Packet: Editor Apply. Apply approved commands through the Editor layer,
   preserving the logical Main folder hierarchy in screen roots, navigation, and
   metadata.
10. Task Packet: Verification. Capture previews, inspect hierarchy readback,
    verify key screens against references, and report unresolved mismatches.

## Artifacts

- `MaterialUnderstanding`
- `KioskStructurePlan`
- `FolderStructurePlan`
- `MaterialPlacementPlan`
- `KioskPlan`
- `UnityHierarchyPlan`
- `EditorChangeSet`
- `EditorCommandBatch`
- Preview/comparison records

## Evidence

Record source folder paths, screen names, reference mappings, content media
mappings, transition graph, created screen ids, preview paths, comparison paths,
filesystem actions, Unity hierarchy paths, approval ids, and unresolved
mismatches.

## Domain Rules

- Treat layout-reference assets as visual targets, not ordinary content media.
- Treat source images, videos, text, and documents as candidate content media
  unless folder naming or user context says otherwise.
- Preserve the original Ref materials by default. Copy materials into Main
  folders or create a manifest reference; move, rename, overwrite, or delete
  user-authored source files only after explicit approval.
- Main folders are the logical kiosk information architecture. Unity hierarchy
  should mirror that logic in screen roots, navigation, and metadata, but may
  add technical objects required by Canvas, layout, assets, and bridge tools.
- Preserve drilldown, back, home, and sitemap semantics in the navigation graph.
- Do not apply kiosk folder heuristics globally outside this recipe.

## Background-Composite Reconstruction Rules

Many kiosk Ref backgrounds are finished composite images: the `bg` already has
the logo, title, badge, caption, decorative panel/card, and divider artwork
baked in. Treat each `bg` as authoritative, not as a blank canvas.

Core rule:

> Reconstruction = `bg` + only the editable content that the `bg` does NOT
> already contain. Never recreate anything already painted into the `bg`.

- Before reconstructing a screen, actually open and inspect the `bg` image to
  see what is baked in (logo, title, badge, caption, panel/card, dividers) and
  to find the empty regions reserved for editable content.
- Do not generate or set decorative/label overlays that duplicate baked `bg`
  content. Default strip set: `logo`, `title`, `badge`, `caption`, `panel`.
  Generalize to "any structural or label element already visible in the `bg`".
- Place editable text (for example a landing description `body` and its
  `textbox` backing) only in the `bg`'s empty regions, confirmed by inspection.
- Provide an idempotent strip pass that removes baked-duplicate overlays across
  all screens, and stop the builder from generating them in the first place.
- When cloning a template screen, the clone inherits the template's overlay
  children. Run the strip pass after cloning so duplicates do not propagate.

## Sprite Import And Injection Rules

- UI background and photo sprites must be imported with `textureType=Sprite`
  AND `spriteImportMode=Single`. A `Multiple` sprite has no single main asset,
  so `LoadAssetAtPath<Sprite>` returns null and the `Image` renders incorrectly.
  Bridge/import steps may default to `Multiple`; force `Single` and self-heal on
  load.
- Enforce an explicit order: ensure the asset import is finished, then load,
  then assign. If a load/import returns null, log a warning and surface it as a
  failure. Never silently skip assignment on null (a silent skip leaves the
  cloned source sprite in place and looks like "every screen is the template").
- After a sprite-injection pass, detect failure automatically: if a template
  source sprite (for example the template `bg`) is still referenced N times
  across cloned screens, treat it as an injection failure signal.

## Verification Rules

- Data-correct does not mean screen-correct. A passing data audit (transition
  count, unique triggers, navigation graph) does NOT prove the screens render
  correctly.
- Always pair data audit with visual verification: `capture_preview` plus
  reference comparison on representative screens (landing, menu, detail) before
  declaring a build done.
- Verify by counting in-scene asset references: each per-location `bg` should be
  referenced where expected, and template assets should not leak into clones.

## Editor Execution Stability Rules

- Provide explicit `MenuItem` entry points for build/fix passes. Do not rely on
  `InitializeOnLoad` auto-run: it waits for Editor focus and is deferred during
  Play mode, so it cannot be triggered reliably from outside Unity.
- Assume builds require Edit mode with Auto Refresh ON; Play mode blocks scene
  mutation and saving.
- Make every build/fix pass idempotent so re-running is always safe.

## Multi-Pass And Template Safety Rules

These prevent the most common class of "I fixed it but it keeps coming back"
bugs, where the real cause is a hidden interaction between passes rather than the
pass being edited.

- Treat template/source objects as immutable. If screens are built by cloning a
  template, no later pass should mutate that template; otherwise the mutation
  silently propagates into every future clone. Clone from a pristine source, or
  re-assert the template's expected structure before cloning.
- A clone inherits the template's full current state (extra wrapper objects,
  components, ids, names), not its original design. After cloning, normalize the
  structure before editing it.
- Before positioning or editing an element, assert its actual structure instead
  of assuming it. Deep name lookups can keep succeeding after an element was
  re-parented or wrapped, so the edit silently targets the wrong (nested) object.
  Detect the wrapper and act on the correct level.
- When a bug survives several fixes, suspect a different pass or a side effect,
  not just the code under edit. Reproduce against the live rendered result, not
  the source/saved data, and confirm which pass last touched the target.
- Keep a single canonical id system. Duplicated ids (for example cloned ids that
  collide across screens) break tool/editor resolution and block visual
  verification, which in turn hides the real defect. Re-mint unique ids early.
- Distinguish "code changed" from "scene changed". With idempotent skips, editing
  a builder does not update already-built objects until they are rebuilt; always
  confirm a rebuild happened before concluding a fix failed.

## Approval Gates

- Ask before creating or changing the Main folder structure.
- Ask before copying, moving, renaming, overwriting, or deleting materials.
- Ask before broad Unity screen creation, replacement, transition wiring, or
  scene save.
- Ask again when a submodel returns ambiguity that changes the sitemap,
  material placement, or hierarchy mapping.

## Submodel Handoff Slices

- `material-understanding`: receives the planning sources and this recipe slice:
  draft `KioskStructurePlan`, classify materials, identify layout references,
  propose Main folder candidates, and return ambiguities to Orchestrator.
- `ui-screen-builder`: receives approved Main structure, `KioskPlan`, relevant
  material mappings, and this recipe slice: create dry-run screen and navigation
  commands without changing the approved information architecture.
- `visual-verification`: receives previews, references, and this recipe slice:
  verify key screens against layout references and report targeted repair needs.
- `unity-inspection`: receives target project/scene and this recipe slice:
  inspect existing screens and hierarchy without mutation.
- `general-editor` or `code-editor`: receives only a narrow, approved fallback
  slice when no specialist submodel owns the required edit.
