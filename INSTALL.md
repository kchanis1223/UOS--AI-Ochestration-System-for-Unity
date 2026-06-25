# UOS Install Guide

This project has two moving parts:

1. A local UOS/opencode workspace in this repository.
2. A Unity Editor package installed into each Unity project that UOS should edit.

UOS itself should be launched locally through `uos`; it does not need to be run
from inside the Unity project directory.

## Prerequisites

| Requirement | Check |
|---|---|
| Unity 6 (`6000.0+`) | Unity Hub shows a 6000.x editor. |
| Bun 1.3+ | `bun --version` |
| Node 18+ | `node --version` |
| opencode CLI 1.15+ | `opencode --version` |
| Anthropic/opencode auth configured | `opencode auth list`, then `uos doctor --runtime` |

Optional for richer visual planning-material support:

| Optional dependency | Enables |
|---|---|
| LibreOffice (`soffice`) | PPTX slide rendering to PNG. |
| Microsoft PowerPoint on Windows | PPTX slide rendering to PNG fallback. |

PDF page rendering is handled by the project dependencies and does not require
an external PDF renderer.
PPTX text and positioned layout extraction are built in. LibreOffice or
PowerPoint is only needed when the agent must inspect rendered slide images.
For PPTX-driven UI, the agent can use `draft_planning_intent_from_pptx` to turn
one slide's extracted layout into a `PlanningIntent` draft before editing Unity.
When PPTX pictures should become Sprites, use `extract_embedded_images`,
`import_asset`, then rerun `draft_planning_intent_from_pptx` with `assetMap` so
the draft includes the returned Unity `assetPath`.
When a supported image, PDF, DOCX, or PPTX material should become a Unity
screen immediately, `create_screen_from_material` is the highest-level router:
images become reference screens, PPTX becomes an editable slide screen, and
text-forward PDF/DOCX/Markdown/text/CSV/JSON documents become editable document
screens. In auto mode, PDF/DOCX files without useful extracted text fall back to
visual reference workflows when possible. Use `mode: "reference"` or
`create_reference_screen_from_material` when the file should stay as a visual
reference screen.
With a live Unity bridge, `create_pptx_slide_screen` creates one slide as a
Unity screen in one call, while `create_pptx_deck_screens` creates multiple
selected slides as a screen flow and can add sequential transitions. Use
`prepare_pptx_ui_draft` instead when the slide-derived `PlanningIntent` should
be reviewed or revised before `create_ui_screen`.
For single image mockups or reference captures, `create_image_reference_screen`
imports the image as a Sprite and creates a full-screen reference screen in one
tool call. Use `prepare_image_ui_draft` instead when the generated
`PlanningIntent` should be reviewed or revised before `create_ui_screen`.
`read_planning_material` can be used first for visual inspection; it
automatically downscales large planning screenshots/mockups into bounded vision
attachments while preserving the original file path for import/reference-screen
workflows.
For PDF page references, `create_pdf_page_reference_screen` renders the selected
page to PNG, imports it as a Sprite, and creates the full-screen reference
screen in one call.
For PDF, Markdown, text, CSV, JSON, or DOCX planning documents whose body text
defines screen copy, sections, requirements, or CTA labels, use
`create_document_screen` to create the editable Unity screen in one call, or use
`draft_planning_intent_from_document` when the generated `PlanningIntent` should
be reviewed before calling `create_ui_screen`. Pass the draft tool's
`metadata.source` as the optional `create_ui_screen.source` argument so UOS can
persist which document drove the generated screen for later follow-up. Document
lines such as `Input: Player name = Lyx`, `Toggle: Remember me = on`,
`Slider: Music volume [0-100] = 70`, and
`Dropdown: Difficulty [Easy, Normal, Hard] = Normal` become editable UGUI
controls instead of paragraph text. Long body sections are drafted into a
ScrollView with `props.text`, so large PDF/DOCX/Markdown screens keep the
remaining copy available for inspection and follow-up edits.
For DOCX files with embedded screenshots or mockups,
`create_docx_image_reference_screen` extracts the selected embedded image,
imports it as a Sprite, and creates the full-screen reference screen in one
call.
For DOCX files whose body text defines screen copy, sections, requirements, or
CTA labels, use `draft_planning_intent_from_docx` to produce a reviewable
`PlanningIntent` before calling `create_ui_screen`.

Install project dependencies:

```bash
cd C:/Users/lyx/MCP_for_Unity_LYX
bun install
cd .opencode
npm install
cd ..
bun link
```

The `.opencode` install is required for auto-discovered opencode plugins such
as `claude-auth.ts`, which wraps `opencode-claude-auth` for Claude OAuth
sessions. After `bun link`, `uos` should be available in a new terminal.

## Launch The GUI Workbench

The default user-facing entry is now the local browser GUI:

```bash
uos
```

This starts a local backend on `127.0.0.1`, opens the browser workbench, and
keeps Unity project selection, file attachment, Ochestrator chat,
ProductionBlueprint approval, and activity logs out of the terminal. The
developer terminal TUI is still available when needed:

For GUI Chat, open Unity from the Projects tab with `Open Unity` and wait for
`Connected`. The GUI uses only its own `.uos/gui/connection.json` session;
Unity Editors opened outside the GUI are shown as external and are not used for
GUI Chat.

```bash
uos chat
uos tui
UOS_DISABLE_GUI=1 uos
```

Build the GUI assets after changing files in `gui/`:

```bash
bun run gui:build
```

## Install The Unity Package Into A Target Project

For a consumer Unity project, let UOS embed its package into
`<your-project>/Packages/com.lyx.oh-my-unity`:

```bash
uos install-unity D:/Unity/MyGame
uos install-unity --project D:/Unity/MyGame --dry-run
uos install-unity --project D:/Unity/MyGame --force
uos install-unity --project D:/Unity/MyGame --manifest-link --package ../Packages/com.lyx.oh-my-unity
```

The default package source is this repository's local Unity package. UOS copies
that package into the target Unity project, removes any
`com.lyx.oh-my-unity` manifest dependency, and normalizes
`Packages/packages-lock.json` when it exists:

```json
"com.lyx.oh-my-unity": {
  "version": "file:com.lyx.oh-my-unity",
  "source": "embedded"
}
```

Use `--package <path>` when you want to embed another local package path instead
of the default local checkout. Re-run with `--force` to replace an existing
embedded copy from the current source checkout. Use `--manifest-link` only while
developing the UOS package itself; it writes a local manifest dependency and is
not share-safe.
After a non-dry-run install, the command also runs the same package metadata
check used by `uos doctor --project`: package installs report the package
version, `com.unity.ugui` dependency, and any package-name/dependency problems
before you reopen Unity.

Then reopen or refresh the Unity project. Unity should show the package in
Package Manager as an in-project package.

## Start A Unity Editor Bridge

In the target Unity project, the bridge auto-starts by default after the package
loads. To inspect or control it manually:

1. Open `Window > Oh My Unity > Monitor`.
2. Confirm that `Auto start bridge when this Unity project opens` is enabled.
3. Confirm that the server is listening, or click `Start`.
4. The bridge publishes a local registry entry so `uos` can discover it.

From a terminal:

```bash
uos doctor
uos doctor --project D:/Unity/MyGame
uos doctor --runtime
uos wait --timeout-ms 60000
uos ready
uos ready --wait --unity-project MyGame
uos projects
uos projects --json
uos mvp --wait --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx
uos mvp --wait --unity-project MyGame --uos-file lobby.pptx --json --save .uos/mvp-evidence.json
uos mvp-progress .uos/mvp-evidence.json
uos context --unity-project MyGame
uos context --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx
uos chat
uos chat --uos-wait --uos-wait-timeout-ms 60000
uos e2e --project D:/Unity/MyGame --unity "C:/Program Files/Unity/Hub/Editor/6000.0.68f1/Editor/Unity.exe"
uos e2e --project D:/Unity/MyGame --read-only --entry-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx
uos e2e --project D:/Unity/MyGame --read-only --public-mvp-json --uos-materials ./Assets/Planning --uos-file lobby.pptx
uos e2e --project D:/Unity/MyGame --read-only --public-chat-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx
uos e2e --project D:/Unity/MyGame --read-only --public-run-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx
uos e2e --project D:/Unity/MyGame --read-only --public-run-ai --uos-materials ./Assets/Planning --uos-file lobby.pptx --public-run-ai-screen-name LobbyDeckAI --public-run-ai-timeout-ms 300000
uos e2e --project D:/Unity/MyGame --screen-from-material README.md --public-smoke
uos e2e --project D:/Unity/MyGame --screen-from-material README.md --ai-only --ai-follow-up --preview --public-smoke
uos e2e --project D:/Unity/MyGame --screen-from-material README.md --verify ./Assets/Planning/reference.png --post-smoke-entry-dry-run
uos e2e --project D:/Unity/MyGame --secondary-project D:/Unity/OtherGame --read-only
uos e2e --project D:/Unity/MyGame --secondary-project D:/Unity/OtherGame --read-only --public-mvp-json --public-chat-dry-run --public-run-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx
```

Expected output:

```text
[uos] connected Unity projects:
  1. MyGame - D:/Unity/MyGame (127.0.0.1:17801, Unity 6000.x) id=...
```

Use `uos projects --json` for scripts that need project names, paths, instance
ids, and selector candidates without scraping the human-readable list. The JSON
does not include bridge tokens.

`uos doctor` is the first troubleshooting command. It reports required local
files, opencode agent/tool/plugin resources, `node`/`bun`/`opencode`
availability, optional PPTX renderer discovery, and every Unity Editor registry
entry as `live`, `unreachable`, or `invalid`. It also summarizes material
capabilities, including whether PPTX rendered slide images are available or
whether UOS will rely on built-in PPTX text/layout extraction.
`uos doctor --project <UnityProjectPath>` also inspects that project's
`Packages/manifest.json`, reports whether `com.lyx.oh-my-unity` is installed,
validates local package metadata such as the `com.unity.ugui` dependency needed
by the UGUI backend, and warns when manifest and embedded UOS package installs
coexist.
`uos doctor --runtime` is slower because it starts `opencode debug config`; use
it before real AI sessions to catch duplicate resolved plugins and expired
Claude/opencode auth.
`uos ready` is the concise AI-session gate. It runs the runtime check and exits
non-zero until required commands/resources, auth, and either a live Unity bridge
or explicit bridge env are available. When live bridges are available, it prints
token-redacted project selector hints for the next `--unity-project` command.
If Unity was force-closed and old entries remain, run
`uos doctor --clean-stale` to remove registry files whose Editor process is no
longer running.
After opening or refreshing a target Unity project, `uos wait` can block until a
bridge registry entry becomes reachable. Pass `--unity-project <selector>` to
wait for one specific project instead of any live Editor.
`uos ready --wait --unity-project <selector>` combines that bridge wait with
the full opencode/auth readiness check.
`uos mvp --wait --unity-project <selector> --uos-file <file>` is the read-only
MVP walkthrough preflight. It validates the selected bridge metadata and launch
material, then prints the `ready`, `context`, dry-run, actual AI edit, and
follow-up chat commands to run with the user. It also prints acceptance gates
for the evidence to collect at each step, including package install/runtime,
readiness, public preflight, dry-run forwarding, real AI edit, and follow-up
edit proof. Add `--json` when a script needs the same token-redacted status,
command sequence, and acceptance gates. Add `--save <file>` to persist that
JSON as an MVP evidence bundle for the next user-led validation session. Run
`uos mvp-progress <file>` at the start of the next session to print the current
preflight state, pending user-evidence gates, and next command group.
`uos e2e` is the repeatable local check for this whole bridge path. It starts
Unity in batchmode for the target project, waits for the bridge registry entry,
runs a default write/revise/preview smoke screen, stops Unity, and cleans stale
registry entries. Pass `--read-only` when you only want `get_project_info` and
`list_screens`, add `--entry-dry-run` when you also want to verify the selected
project's `uos chat` launch prompt/env without starting opencode, or add normal
smoke flags such as `--save`, `--materials`, or `--import`. Add
`--post-smoke-entry-dry-run` when you want the same selected-project TUI launch
context checked after smoke has created or verified persisted `.uos` screen
state. Add `--public-mvp-json` when you want E2E to also invoke the public
`uos mvp --unity-project ... --json` preflight and verify the generated
walkthrough commands against the selected live bridge. Add `--public-chat-dry-run` when you want E2E to also invoke the public
`uos chat --unity-project ... --uos-dry-run` entrypoint and verify the same TUI
startup prompt, selected-project environment, and attached-file context that a
human-operated chat session will receive. Add `--public-run-dry-run` when you want E2E to also invoke the public
`uos --unity-project ... --uos-dry-run run --continue ...` CLI path and verify
selected-project, material-directory, attached-file, and run-context forwarding
without starting opencode. Add `--public-run-ai` when you want E2E to invoke the
public `uos --unity-project ... run ...` path for a real opencode material edit
and verify `.uos/work-journal.jsonl` contains `read_planning_material` followed
by `create_screen_from_material`; use `--public-run-ai-screen-name` to make
image/PPTX/document proof screens easy to identify. Add `--public-smoke` when you want E2E to also invoke the public
`uos smoke --unity-project ...` CLI process against the selected live bridge,
instead of relying only on the in-process smoke helper. Combine
`--public-smoke` with `--ai-only --ai-follow-up` to verify that the public CLI
can run the two-turn opencode material conversation and continued context edit
against the selected project.
Use `uos --help`, `uos <command> --help`, or `uos help <command>` for
UOS-specific command help. opencode information commands still pass through, so
`uos run --help`, `uos models`, and `uos --version` do not require a live Unity
project.

## Launch UOS

Interactive target selection:

```bash
uos chat
uos chat --uos-wait --uos-wait-timeout-ms 60000
uos chat --unity-project MyGame --continue
uos
```

Deterministic selection:

```bash
uos enter --unity-project MyGame
uos --unity-project 1
uos --unity-project MyGame
uos --unity-project D:/Unity/MyGame run "create a settings screen from Assets/Planning"
uos --unity-project MyGame --uos-materials D:/PlanningDecks run "create a lobby screen from the supplied deck"
uos --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx run "create a lobby screen from this deck"
uos --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx --uos-dry-run run "create a lobby screen"
```

Selectors can be a 1-based index from `uos projects`, an Editor instance id, a
project name, a project path, or an unambiguous substring.
When `uos` prompts interactively because multiple projects are live, you can
enter any of those same selector forms, not only the list number.
In non-interactive or ambiguous-selector failures, UOS prints copyable
`select: --unity-project ...` hints for the matching live projects.
Use `--uos-materials <dir>` when planning materials live outside the selected
Unity project. UOS injects that directory as `UNITY_MCP_MATERIALS_DIR` for
`analyze_planning_materials`, `list_planning_materials`,
`read_planning_material`, `create_reference_screen_from_material`, PPTX/PDF
rendering, and image import workflows. For one-shot `uos run ...` sessions,
UOS also writes the concise `.uos` context summary to a temporary Markdown file
and attaches it through opencode's `run --file` path. Repeat `--uos-file <file>`
or `--uos-attach <file>` to expose explicit materials through
`UOS_ATTACHED_FILES` and `get_uos_context`. Text-like files (`txt`, `md`,
`csv`, `json`, `yaml`, `jsonl`) are also attached through opencode's
`run --file` path for first-turn model visibility. Binary or visual files such
as images, PDF, DOCX, and PPTX stay off opencode `--file` and are read through
UOS tools such as `read_planning_material`. Relative file paths resolve against
the explicit material directory, then the selected Unity project root.
When bypassing project selection with explicit bridge env vars, also set
`UOS_PROJECT_DIR` so relative material paths still resolve against the Unity
project root.
Before launching opencode, UOS validates the explicit material directory and
attached files, then prints a launch summary to stderr. Set
`UOS_LAUNCH_SUMMARY=0` to suppress that summary in scripted environments.
When persisted `.uos` context exists, that summary also surfaces screen count,
the active screen, latest verification or preview status, and material
candidate count before the TUI starts.
UOS starts opencode from this repository root and always injects
`--agent ochestrator` for `uos run ...` and default TUI launches. User-facing
UOS sessions do not support choosing specialist agents directly. `opencode.json`
also disables opencode's native `build` and `plan` primary agents so Tab-based
agent switching only exposes `ochestrator` after relaunch. The Ochestrator is
the only conversational agent: it calls `get_uos_context`, selects a UOS mode
with `select_uos_mode`, uses internal submodel handoff documents under
`.opencode/submodels/`, and keeps Unity mutations behind the Editor bridge
tools. For fresh TUI launches, UOS also injects a startup `--prompt` containing
the selected project, bridge capability cache, launch materials, attached file
hints, the configured default response language from
`uos setup --language <code|name>`, and a bounded `.uos` context summary excerpt.
That prompt tells the agent to call `get_uos_context` first and use
`recommendedLaunchWorkflow` before mutating Unity. Continued TUI sessions started with `--continue` or
`--session <id>` receive the same startup prompt so the resumed conversation
re-grounds on the selected Unity Editor project while opencode preserves the
existing session history. Pass an explicit `--prompt` to override that startup
prompt.
For real launches, UOS fails fast when the selected bridge reports missing
required editing tools; `--uos-dry-run` still prints the resolved launch without
starting opencode.
Use `--uos-dry-run`, `--uos-preflight`, or `--uos-print-launch` to inspect the
resolved launch summary, forwarded opencode argv, and injected UOS environment
without starting opencode.
Use `uos context --unity-project <selector>` when you want the same selection
and material resolution as a real session, but only need a read-only report of
the selected project, attached files, material root, and concise `.uos` context
summary. When launch materials are present, the summary also lists supported
candidate files by kind and source with recommended first tools, so you can
confirm what the first AI turn will see before mutating Unity. Add `--json` for
token-redacted automation output. During real `uos` launches, the selected
bridge's token-free `supportedTools` and `writeTools` capability cache is also
available through `get_uos_context.selectedUnity`.

Before starting an AI session, you can smoke-test the selected bridge:

```bash
# read-only bridge check
uos smoke --unity-project MyGame

# verify opencode AI can call read/write UOS tools and clean up a temporary object
uos smoke --unity-project MyGame --ai-run

# run only the AI scene-object edit/delete path with explicit object metadata
uos smoke --unity-project MyGame --ai-only --scene-object --object-name AIOnlyCube --object-type Cube

# create a small sample screen and capture a preview
uos smoke --unity-project MyGame --write --preview --name UOSSmokeScreen

# create, inspect, revise, and preview a small sample screen
uos smoke --unity-project MyGame --write --revise --preview --name UOSRevisionSmoke

# verify active-screen `.uos` context follow-up editing
uos smoke --unity-project MyGame --write --context-follow-up --preview --name UOSContextSmoke

# create, list, update, delete, and persist a non-UI scene object round-trip
uos smoke --unity-project MyGame --scene-object --object-name UOSSmokeCube --object-type Cube --save

# create two smoke screens and verify a button-triggered transition
uos smoke --unity-project MyGame --write --flow --preview --name UOSFlowSmoke

# import a material, create UI, capture preview, and save the scene
uos smoke --unity-project MyGame --write --preview --save --import ./Plans/logo.png --asset-path Assets/UOS/Imported/logo.png

# capture a preview and record a combined verification against a mockup/reference
uos smoke --unity-project MyGame --verify ./Plans/main-menu-reference.png

# scan a planning folder, import the first image found, create UI, and capture preview
uos smoke --unity-project MyGame --materials ./Assets/Planning --preview

# run the AI material-screen router itself against the live Unity bridge
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --preview --save --name LobbyFromDeck

# verify opencode AI reads a planning material and calls the material-to-screen tool
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --ai-run --name LobbyFromDeck

# run only the AI material path after the read-only bridge check
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --ai-only --name LobbyFromDeck

# verify a two-turn AI conversation: material screen creation, then opencode run --continue follow-up edit
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --ai-only --ai-follow-up --preview --name LobbyDeckConversation

# verify the same two-turn AI conversation path for a single image/mockup reference
uos smoke --unity-project MyGame --screen-from-material ./Plans/main-menu-reference.png --material-mode reference --ai-only --ai-follow-up --preview --name MainMenuImageConversation

# route the first supported image/PDF/DOCX/PPTX/document from a planning folder
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-first-material --material-mode auto --preview --save --name FirstPlanningMaterial

# create several PPTX slides as a Unity screen flow and activate the first screen
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --pptx-deck lobby.pptx --slides 1,2,3 --include-shape-panels --preview --save --name LobbyDeck

# launch Unity batchmode and run the default write/revise/preview smoke loop
uos e2e --project D:/Unity/MyGame --unity "C:/Program Files/Unity/Hub/Editor/6000.0.68f1/Editor/Unity.exe"

# launch Unity batchmode and verify non-UI scene object editing
uos e2e --project D:/Unity/MyGame --scene-object --object-type Cube
```

The write smoke test calls the same bridge path used by opencode tools, so it is
the quickest way to confirm that the selected Unity project can be modified.
`--ai-run` additionally starts `opencode run` and requires the AI/tool path to
call `get_uos_context` first, then `get_project_info`, `create_scene_object`,
and `delete_scene_object` against the selected Editor. Use `--ai-model`,
`--ai-timeout-ms`, or `--ai-object-name` to override that AI smoke. Combined
with `--screen-from-material` or `--screen-from-first-material`, it attaches the
selected material file and requires `get_uos_context`,
`read_planning_material`, and `create_screen_from_material`; combined with
`--pptx-deck`, it requires `get_uos_context`, `read_planning_material`, and
`create_pptx_deck_screens`. Use `--ai-only` to
skip direct material/UI smoke mutation and let only the opencode AI path mutate
Unity after the initial read-only bridge check. Combine `--ai-only` with
`--ai-follow-up` on a material or deck smoke to run a two-turn AI conversation:
the first opencode run creates the screen, and the second `opencode run
--continue` edits it through persisted `.uos` context. For image/reference
screens that have no editable text target yet, the follow-up turn adds a small
Text annotation through `add_ui_element_from_context`. With `--verify` or
`--compare`, the AI follow-up first calls
`inspect_screen_feedback_from_context` so persisted preview/diff diagnostics
guide the edit; large mismatches also require `get_scene_hierarchy_from_context`
and `move_ui_element_from_context`, then
`verify_screen_against_reference_from_context` to re-check the moved layout
against the reference. Pass `--ai-feedback-iterations <N>` to let the smoke
runner continue the same opencode session for up to N visual repair turns while
the latest verification still reports a large mismatch. After repeated move
repairs still leave a large mismatch, later repair turns escalate to
`delete_ui_element_from_context`, `add_ui_element_from_context`, and another
`verify_screen_against_reference_from_context` pass. Smoke output includes each
AI repair turn's post-edit verification verdict, preview path, mismatch metric,
and diff path when those values are journaled. With `--scene-object`,
`--object-name` and `--object-type` are passed through to the AI scene-object
smoke prompt. Real opencode AI smoke runs also verify Unity-changing tool calls
against `<UnityProject>/.uos/work-journal.jsonl`, so a model merely naming a
tool is not enough to pass; material AI smoke also rejects journal records where
the screen/deck mutation appears before `read_planning_material`. The
fuller smoke form also checks `import_asset`, `capture_preview`, and
`save_scene`. `--revise` checks the follow-up editing loop by inspecting the
created hierarchy, updating an existing element, adding a new child element, and
moving an existing button, and deleting a temporary element. `--flow` creates a
second smoke screen and calls `create_screen_transition` with the generated
smoke button as the trigger. `--context-follow-up` checks the persisted-context
follow-up path: it activates the generated screen, resolves an editable
title/text target plus a parent panel or background from `.uos`-style context
without caller-supplied canonical ids, then records
`set_active_screen_from_context`, `update_ui_element_from_context`, and
`add_ui_element_from_context` journal entries while mutating Unity through the
same bridge calls. It can be combined with direct smoke screens,
`--screen-from-material`, `--screen-from-first-material`, and `--pptx-deck`, so
material-derived screens can be revised immediately after creation. The
context-resolved edit tools also accept natural
`query`/`parentQuery`/`triggerQuery` phrases such as `play button`,
`primary CTA`, `main panel`, `settings button`, `설정 버튼`, `현재 화면`, or
`큐브`, matched against persisted screen names, clientHintIds, element text,
types, and English/Korean type aliases.
`--scene-object` checks the non-UI Editor scene path by creating a primitive,
refreshing `list_scene_objects`, updating its name and transform, refreshing
again, deleting it, and persisting the resulting `sceneObjects` context.
Use `resolve_uos_context_target` first when the agent needs to confirm the
canonical screen/element match without calling Unity or mutating the Editor.
They can also select material-derived screens by persisted source metadata with
selectors such as `screenQuery: "lobby deck slide 2"`,
`sourcePathContains: "lobby.pptx"` plus `slideNumber: 2`, `pageNumber: 3`,
`imageNumber: 1`, or `latest: true`; transition tools expose the same selectors
as `from*` and `to*` variants. Active-screen phrases such as `current screen`
and `active screen` resolve to the persisted active screen. Mutating
`_from_context` tools refresh the live Unity hierarchy before resolving by
default, so manually changed UI text/layout and the actual active screen can
drive follow-up edits; pass `refreshHierarchy: false` only when an offline
persisted-context resolution is intentional. Dry-run resolution stays offline by
default; pass `refreshHierarchy: true` with `dryRun: true` only when the dry-run
should also inspect Unity. Successful `list_screens` calls also update `.uos`
screen names and active-screen state, and successful `list_scene_objects` calls
update `.uos` scene object ids/transforms, so read-only smoke checks improve
later conversational follow-up resolution.
Generated props support text styling (`text`, `fontSize`, `fontStyle`, `color`,
`align`) and common interactive control state (`placeholder`, `inputText`,
`isOn`, `value`, `minValue`, `maxValue`, `options`, `interactable`) so document
and deck emphasis plus control defaults can be carried into Unity UI.
For non-UI scene editing, use `create_scene_object` to create Empty,
primitive, Camera, and Light GameObjects with persistent `objectId` markers.
Use `list_scene_objects` before follow-up edits when ids are unknown, then
`resolve_scene_object_from_context`, `update_scene_object_from_context`, or
`delete_scene_object_from_context` when the user names an object naturally.
Use direct `update_scene_object` or `delete_scene_object` only when the exact
`objectId` is already known. Scene object records persist in `.uos/screens.json`
under `sceneObjects` for later UOS re-entry.
Relative `--import` paths resolve against
`UNITY_MCP_MATERIALS_DIR`, or the selected Unity project root when that variable
is not set. `--materials <dir>` resolves against the selected Unity project,
recursively scans while skipping generated Unity folders, imports the first
supported image, and uses it as the generated smoke UI sprite.
`--screen-from-material <file>` runs the same `create_screen_from_material`
router used by AI sessions, so images, PDFs, DOCX files, PPTX decks, and text
documents can be checked against the selected live bridge before a conversation.
Use `--material-mode reference`, `--pptx-mode rendered`, `--page`, `--slide`, or
`--image-number` for specific material routes. Add `--context-follow-up` to
verify that the generated material screen can be resolved and edited from
persisted context. `--screen-from-first-material`
combines that router with `--materials` or `--uos-materials`: it selects the
first supported image, PDF, DOCX, PPTX, text, Markdown, CSV, or JSON file from
the folder, honors `--material-kind`, and creates the screen through
`create_screen_from_material` instead of importing only the first image.
Editable document routes turn
`Input:`, `Field:`, `Toggle:`, `Checkbox:`, `Slider:`, `Range:`, `Dropdown:`,
and `Select:` lines into matching UGUI controls with placeholder,
checked/value/range, and option props. Inline defaults use `= value`, slider
ranges use `[min-max]`, and dropdown options use `[Option A, Option B]`. Long
document body text becomes ScrollView content instead of being omitted.
Write smoke runs also update
`<projectRoot>/.uos/`, including transitions and captured preview history,
matching the context handoff used by normal opencode tool calls.
`--pptx-deck <file>` runs the `create_pptx_deck_screens` path for multi-slide
flows: one screen per selected slide, sequential transitions by default, and
first-screen activation by default. Use `--slides 1,2,3`, `--first-slide`,
`--last-slide`, or `--max-slides` to narrow the deck, and
`--no-deck-transitions` or `--no-activate-first` for smaller checks. Add
`--include-shape-panels` when filled PPTX shapes should be generated as editable
Unity Panels.
During real AI sessions, screens can be verified against a planning mockup,
rendered PDF page, or rendered PPTX slide with `verify_screen_against_reference`;
it captures the preview, compares it, and attaches both the preview and diff.
For the same path from the CLI, use `uos smoke --verify <image>`; it records the
combined verification in `.uos` so follow-up AI sessions can see the preview,
diff, verdict, and metrics together.
Use `inspect_screen_feedback_from_context` after verification to reload one
screen's latest source/reference image, preview, visual diff, metrics, and
recommended next edit tools without calling Unity again.
Use `capture_preview` plus `compare_images` only when those steps need to be
controlled separately.
For PPTX materials, the default `create_reference_screen_from_material` path
creates editable Unity elements from slide layout. Use `pptxMode: "rendered"`
when the slide should be imported as one full-screen visual reference image;
that mode requires LibreOffice or PowerPoint and preserves the rendered slide
path in `.uos` context for later `compare_images` calls.

`uos e2e` launches Unity with `-nographics` by default for fast headless bridge
checks. Pass `--graphics` or `--no-nographics` when preview pixels must be
rendered by the local graphics device for visual verification.

When a target is selected, these variables are injected into opencode:

```text
UNITY_MCP_HOST
UNITY_MCP_PORT
UNITY_MCP_TOKEN
UOS_PROJECT_DIR
UOS_PROJECT_NAME
UOS_EDITOR_INSTANCE_ID
UOS_CONTEXT_DIR
UOS_CONTEXT_SUMMARY
UOS_ATTACHED_FILES
UNITY_MCP_MATERIALS_DIR
```

`UNITY_MCP_MATERIALS_DIR` defaults to the selected project root unless it is
already set. `UOS_ATTACHED_FILES` contains the validated `--uos-file` and
`--uos-attach` paths as JSON. `UOS_CONTEXT_SUMMARY` is present when the selected
project has persisted `.uos` history, launch materials, or attached files; it
includes recent screen/source/element context plus latest preview and visual
comparison metrics when they exist, including selector hints such as
`screenQuery`, `sourcePathContains`, and `slideNumber` for material-derived
screens. In `uos run ...`, that summary is also attached as a temporary
Markdown file so the first model request can read it directly.

## Optional Global opencode Wiring

The launcher now starts opencode from this repository root, so global wiring is
not required for normal `uos` usage. If you still want opencode to see the same
agents/tools/plugins when launched directly from other directories, run:

```bash
uos setup
uos setup --unity-projects D:/UnityProject --language ko
```

The setup command links this repo's `.opencode/agents`, `.opencode/tools`, and
`.opencode/plugins` into `~/.config/opencode`, rewrites the global
`opencode.jsonc` from this repo's config, merges `.opencode/package.json`
dependencies into the global opencode `package.json`, and runs
`npm install --ignore-scripts` there when dependencies are missing or changed.
Because the config copy includes `default_agent` and disabled native agents,
direct opencode launches outside this repository keep the same Ochestrator-only
agent surface after setup.
Pass `--unity-projects <dir>` to save the folder that contains user Unity
projects in `~/.config/uos/config.json`; the launcher project list will use that
root in the no-argument `uos` flow. Pass `--language <code|name>` such as `ko`,
`en`, `Japanese`, or `中文` to save the default response language used in UOS
startup prompts.
Existing global config, package manifest, and resource directories are backed up
before replacement. On Windows, setup uses directory junctions so administrator
privileges are not required. After setup, verify global opencode resource
discovery from any directory with `opencode debug config`. With a target Unity
project open, verify the full UOS session gate with `uos ready`.
Local plugins are auto-discovered from `.opencode/plugins`. Do not also add
`.opencode/plugins/uos.ts` as an explicit `plugin` entry, or opencode will load
the journal plugin twice. Keep `.opencode/package.json` installed because the
linked `claude-auth.ts` plugin depends on `opencode-claude-auth`.

## Verification

```bash
bun run test

$files = (Get-ChildItem -Path .opencode/tools -Filter *.ts).FullName
bun build $files --target=bun --outdir=.omx/tmp/check

node --check bin/uos.js
node --check bin/uos-core.js
node --check bin/uos-setup.js
```

Unity EditMode tests:

```powershell
& "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  -batchmode -nographics `
  -projectPath "C:\Users\lyx\MCP_for_Unity_LYX" `
  -runTests -testPlatform EditMode `
  -testResults "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\editmode-results-current.xml" `
  -logFile "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\unity-current.log"
```

Live bridge E2E smoke:

```powershell
node bin\uos.js e2e `
  --project "C:\Users\lyx\MCP_for_Unity_LYX" `
  --unity "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  --context-follow-up `
  --log-file "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\uos-e2e-context-follow-up.log"

node bin\uos.js e2e `
  --project "C:\Users\lyx\MCP_for_Unity_LYX" `
  --unity "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  --screen-from-material README.md `
  --material-mode auto `
  --context-follow-up `
  --preview `
  --name UOSReadmeMaterialFollowUp `
  --log-file "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\uos-e2e-readme-material-follow-up.log"

node bin\uos.js e2e `
  --graphics `
  --project "C:\Users\lyx\MCP_for_Unity_LYX" `
  --unity "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  --screen-from-material "TestResults\uos-document-controls-smoke.md" `
  --material-mode auto `
  --preview `
  --name UOSDocumentControlsLayout `
  --log-file "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\uos-e2e-document-controls-layout.log"

node bin\uos.js e2e `
  --project "C:\Users\lyx\MCP_for_Unity_LYX" `
  --unity "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  --screen-from-material "TestResults\uos-image-reference-smoke.png" `
  --material-mode reference `
  --preview `
  --name UOSImageReference `
  --log-file "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\uos-e2e-image-material.log"

node bin\uos.js e2e `
  --project "C:\Users\lyx\MCP_for_Unity_LYX" `
  --unity "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  --verify "TestResults\uos-image-reference-smoke.png" `
  --name UOSVisualVerify `
  --log-file "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\uos-e2e-visual-verify.log"

node bin\uos.js e2e `
  --graphics `
  --project "C:\Users\lyx\MCP_for_Unity_LYX" `
  --unity "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  --pptx-deck "TestResults\uos-pptx-colored-shapes-smoke.pptx" `
  --slides 1,2 `
  --include-shape-panels `
  --preview `
  --name UOSPptxColorDeckFill `
  --log-file "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\uos-e2e-pptx-color-deck-fill.log"
```

This verifies the real local loop: Unity package auto-start, registry publish,
UOS target discovery, readiness, create/update/add, hierarchy-backed revision,
active-screen context follow-up edits, material-derived context follow-up edits,
preview capture through the selected Editor bridge, document and image material
routing through `create_screen_from_material`, visual reference verification through
`verify_screen_against_reference`, multi-slide PPTX flow creation through
`create_pptx_deck_screens`, PPTX text color/text-box fill/shape fill rendering
through a graphics-device preview, document control declaration layout through
a graphics-device preview, non-UI scene object create/list/update/delete through
`uos e2e --scene-object`, Editor shutdown, and stale registry cleanup.

The current machine has also exercised real multi-Editor selection through
`uos e2e --secondary-project`: this project and a temporary
`uos-e2e-secondary-project` project were opened simultaneously, `uos projects
--json` reported both live Editors, the second bridge fell back to an ephemeral
port when 17801 was already occupied, and read-only smoke connected to each
project independently. The same multi-Editor E2E path can include
`--public-mvp-json`, `--public-chat-dry-run`, and `--public-run-dry-run` to
verify that the public launcher receives the current selected project's
`--unity-project` selector for each Editor, including secondary projects. The log is
`TestResults/uos-e2e-multi-editor-selection.log`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `uos projects` prints no live bridge | Unity is not open, bridge auto-start is disabled, Monitor is stopped, or the registry is stale. | Open the Unity project with the UOS package installed. If it still does not appear, open Window > Oh My Unity > Monitor and click `Start`, then run `uos doctor --clean-stale`. |
| Unsure why a project is not selectable | Registry entry is unreachable, stale, invalid, package is not installed, or required CLI dependency is missing. | Run `uos doctor --project <UnityProjectPath>` and inspect the install/registry/dependency sections. Use `uos doctor --clean-stale` for stale entries. |
| `bridge: not connected to Unity` | opencode started without bridge env or target went offline. | Relaunch through `uos`, then retry. |
| Relative planning file path is not found | File is outside selected project root. | Use an absolute path or set `UNITY_MCP_MATERIALS_DIR`. |
| Multiple projects match a selector | Selector is ambiguous. | Use index, instance id, or full project path. |
| opencode auth fails | Provider login is missing or plugin auth is unavailable/expired. | Run `uos doctor --runtime`; if it reports expired Claude credentials, run `claude` to re-authenticate. |
| `.uos/work-journal.jsonl` records each tool call twice | The UOS plugin was loaded both explicitly and by `.opencode/plugins` discovery. | Remove the local `file://.../.opencode/plugins/uos.ts` entry from opencode config and rerun `uos doctor --runtime`. |
