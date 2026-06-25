# UOS for Unity

UOS (Unity Orchestration System) is a local opencode-based Ochestrator for
Unity Editor automation. It is not meant to run inside a Unity project folder.
Instead, the Unity package starts an Editor bridge, and the local `uos` launcher
opens a browser-based GUI workbench. The GUI discovers configured Unity
projects, lets you install/link UOS, opens Unity when needed, and runs the
Ochestrator through headless `opencode run` with the selected project context
injected into the environment. The older terminal TUI remains available through
`uos chat` and `uos tui`.

Status: alpha. The bridge, UGUI screen tools, local Editor discovery, and
planning-material readers are implemented. End-to-end UX hardening is still in
progress.

## Current Architecture

```text
local browser GUI
  uos
    -> starts a local 127.0.0.1 GUI backend
    -> discovers configured Unity projects and live bridge registry entries
    -> selects one target project in Projects
    -> runs opencode headlessly from this UOS repo root
    -> injects UNITY_MCP_HOST / PORT / TOKEN / UOS_PROJECT_DIR
    -> streams Ochestrator events, Blueprint approval, assets, and activity

Unity Editor project
  Packages/com.lyx.oh-my-unity
    -> auto-starts the WebSocket bridge by default
    -> Window > Oh My Unity > Monitor shows status and manual controls
    -> publishes a local registry entry under the user profile
    -> applies UI changes in the active scene through the UGUI backend
```

## Main Components

| Path | Role |
|---|---|
| `bin/uos.js` | Local UOS launcher. Opens the GUI by default and preserves developer CLI/TUI subcommands. |
| `bin/uos-core.js` | Registry discovery, handshake, selector parsing, and target env construction. |
| `bin/uos-gui-server.js` | Local browser GUI backend, REST API, WebSocket events, and headless opencode runner. |
| `bin/uos-gui-core.js` | GUI project ids, token redaction, sessions, approvals, uploads, and event parsing. |
| `gui/` | React+Vite browser workbench for Projects, Chat, Blueprint, Assets, and Activity. |
| `Packages/com.lyx.oh-my-unity/` | Unity 6 Editor package with WebSocket bridge and UGUI backend. |
| `.opencode/agents/ochestrator.md` | Only user-facing UOS opencode agent. Selects modes, creates internal submodel handoffs, and reports progress. |
| `.opencode/submodels/` | Internal submodel handoff documents. These are not user-selectable opencode agents. |
| `.opencode/tools/` | Bun-native opencode tools for Unity bridge calls and planning materials. |
| `.opencode/plugins/uos.ts` | Auto-discovered local plugin that best-effort journals successful UI mutations and preview captures. |
| `.opencode/plugins/claude-auth.ts` | Auto-discovered wrapper for `opencode-claude-auth`; strips the upstream config hook while preserving Claude OAuth auth/model hooks. |
| `.opencode/package.json` | npm dependencies required by local opencode plugins. Run `npm install` in `.opencode` after a clean checkout. |

## Launcher Commands

```bash
# show UOS launcher help and command-specific help
uos --help
uos ready --help
uos help smoke

# default user flow: open the local browser workbench
uos
uos gui
uos gui --no-open --port 0

# optional setup: store the folder that contains user Unity projects and response language
uos setup --unity-projects D:/UnityProject --language ko

# list live Unity Editor projects known to UOS
uos projects
uos projects --json

# wait for any live Editor bridge, or for a specific selected project
uos wait --timeout-ms 60000
uos wait --unity-project MyGame --timeout-ms 60000

# read-only MVP validation preflight; prints the walkthrough commands to run next
uos mvp --wait --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx
uos mvp --wait --unity-project MyGame --uos-file lobby.pptx --json --save .uos/mvp-evidence.json
uos mvp-progress .uos/mvp-evidence.json

# inspect selected project/material/.uos context without starting opencode
uos context --unity-project MyGame
uos context --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx
uos context --unity-project MyGame --json

# diagnose local dependencies, opencode resources, and Unity bridge discovery state
uos doctor
uos doctor --project D:/Unity/MyGame
uos doctor --clean-stale

# embed the UOS Unity package into another Unity project for share-safe projects
uos install-unity D:/Unity/MyGame
uos install-unity --project D:/Unity/MyGame --dry-run
uos install-unity --project D:/Unity/MyGame --force
uos install-unity --project D:/Unity/MyGame --manifest-link --package ../Packages/com.lyx.oh-my-unity

# slower check for resolved opencode config, duplicate plugins, and auth plugin state
uos doctor --runtime

# concise AI-session readiness gate; exits non-zero when blocked
uos ready
uos ready --wait --unity-project MyGame

# developer terminal TUI; prompts for a target if more than one live Editor exists
uos chat
uos tui
uos chat --uos-wait --uos-wait-timeout-ms 60000
uos chat --unity-project MyGame --continue

# opencode management commands pass through without selecting a Unity project
uos models
uos --print-logs models
uos --version
uos run --help

# validate selection/material/file forwarding without starting opencode
uos --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx --uos-dry-run run "create the lobby UI"

# deterministic selection for scripts or multi-Editor sessions
uos --unity-project 1
uos --unity-project MyGame
uos --unity-project D:/Unity/MyGame run "create the main menu from Assets/Plans"
uos --unity-project MyGame --uos-materials D:/PlanningDecks run "create the lobby UI from the supplied materials"
uos --unity-project MyGame --uos-materials D:/PlanningDecks --uos-file lobby.pptx run "create the lobby UI from this deck"

# verify the selected Editor bridge without starting opencode
uos smoke --unity-project MyGame

# verify opencode can call UOS tools through AI and perform a temporary scene-object edit
uos smoke --unity-project MyGame --ai-run

# run only the AI scene-object edit/delete path with explicit object metadata
uos smoke --unity-project MyGame --ai-only --scene-object --object-name AIOnlyCube --object-type Cube

# create a small sample UI screen through the selected bridge
uos smoke --unity-project MyGame --write --preview --name UOSSmokeScreen

# create, inspect, revise, and preview a small sample UI screen
uos smoke --unity-project MyGame --write --revise --preview --name UOSRevisionSmoke

# verify context-resolved follow-up edits using active-screen `.uos` context
uos smoke --unity-project MyGame --write --context-follow-up --preview --name UOSContextSmoke

# create, list, update, delete, and persist a non-UI scene object round-trip
uos smoke --unity-project MyGame --scene-object --object-name UOSSmokeCube --object-type Cube --save

# create two smoke screens and wire a button-triggered transition between them
uos smoke --unity-project MyGame --write --flow --preview --name UOSFlowSmoke

# verify material import, UI creation, preview capture, and scene save
uos smoke --unity-project MyGame --write --preview --save --import ./Plans/logo.png --asset-path Assets/UOS/Imported/logo.png

# capture a preview and compare it against a local reference/mockup image
uos smoke --unity-project MyGame --write --preview --compare ./Plans/main-menu-reference.png

# capture a preview and record a combined screen verification for AI follow-up
uos smoke --unity-project MyGame --verify ./Plans/main-menu-reference.png

# verify broad planning-material discovery, first image import, UI creation, and preview
uos smoke --unity-project MyGame --materials ./Assets/Planning --preview

# run the same smart material router used by AI tools against the live Unity bridge
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --preview --save --name LobbyFromDeck

# verify opencode AI reads a planning material and calls the material-to-screen tool
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --ai-run --name LobbyFromDeck

# run only the AI material path after the read-only bridge check, without direct smoke mutation first
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --ai-only --name LobbyFromDeck

# verify a two-turn AI conversation: material screen creation, then opencode run --continue follow-up edit
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-material lobby.pptx --ai-only --ai-follow-up --preview --name LobbyDeckConversation

# verify the same two-turn AI conversation path for a single image/mockup reference
uos smoke --unity-project MyGame --screen-from-material ./Plans/main-menu-reference.png --material-mode reference --ai-only --ai-follow-up --preview --name MainMenuImageConversation

# route the first supported image/PDF/DOCX/PPTX/document from a planning folder
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --screen-from-first-material --material-mode auto --preview --save --name FirstPlanningMaterial

# create several PPTX slides as a Unity screen flow and activate the first screen
uos smoke --unity-project MyGame --uos-materials ./Assets/Planning --pptx-deck lobby.pptx --slides 1,2,3 --include-shape-panels --preview --save --name LobbyDeck

# launch Unity batchmode, wait for its bridge, run write/revise/preview smoke, then stop Unity
uos e2e --project D:/Unity/MyGame --unity "C:/Program Files/Unity/Hub/Editor/6000.0.68f1/Editor/Unity.exe"

# launch Unity batchmode and verify non-UI scene object editing
uos e2e --project D:/Unity/MyGame --scene-object --object-type Cube

# launch Unity and verify selected-project UOS chat launch forwarding without starting opencode
uos e2e --project D:/Unity/MyGame --read-only --entry-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx

# launch Unity and verify public `uos mvp --json` preflight command generation
uos e2e --project D:/Unity/MyGame --read-only --public-mvp-json --uos-materials ./Assets/Planning --uos-file lobby.pptx

# launch Unity and verify the public `uos chat` TUI entrypoint without starting opencode
uos e2e --project D:/Unity/MyGame --read-only --public-chat-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx

# launch Unity and verify public `uos run --continue` selection/material forwarding without starting opencode
uos e2e --project D:/Unity/MyGame --read-only --public-run-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx

# launch Unity and verify public `uos run` can drive an AI material edit
uos e2e --project D:/Unity/MyGame --read-only --public-run-ai --uos-materials ./Assets/Planning --uos-file lobby.pptx --public-run-ai-screen-name LobbyDeckAI --public-run-ai-timeout-ms 300000

# launch Unity and also run the public `uos smoke` CLI against the selected bridge
uos e2e --project D:/Unity/MyGame --screen-from-material README.md --public-smoke

# verify the public `uos smoke` CLI can run a two-turn opencode AI material conversation
uos e2e --project D:/Unity/MyGame --screen-from-material README.md --ai-only --ai-follow-up --preview --public-smoke

# verify TUI re-entry context after smoke creates/verifies persisted .uos screen state
uos e2e --project D:/Unity/MyGame --screen-from-material README.md --verify ./Assets/Planning/reference.png --post-smoke-entry-dry-run

# launch two Unity Editors and verify each selected project independently
uos e2e --project D:/Unity/MyGame --secondary-project D:/Unity/OtherGame --read-only

# launch two Unity Editors and verify public mvp/chat/run entry selection for each project
uos e2e --project D:/Unity/MyGame --secondary-project D:/Unity/OtherGame --read-only --public-mvp-json --public-chat-dry-run --public-run-dry-run --uos-materials ./Assets/Planning --uos-file lobby.pptx
```

In the browser workbench, Chat only uses a GUI-managed Unity connection. Open
the project with `Open Unity` in the Projects tab and wait for `Connected`.
Unity Editors opened outside the GUI are shown as external and are not used for
GUI Chat. The GUI connection state is stored in `.uos/gui/connection.json`, and
bridge tokens are never returned by the GUI API.

Supported selector flags are `--unity-project`, `--uos-project`, and
`--uos-target`. A selector can be a 1-based list index, Editor instance id,
project name, full project path, or an unambiguous substring.
When multiple Unity Editor bridges are live, interactive `uos chat`, `uos
enter`, and bare `uos` prompts you to choose one by list index, Editor instance
id, project name, project path, or an unambiguous substring. Add `--uos-wait`
when launching UOS immediately after opening Unity; UOS waits for the selected
or first live bridge before entering opencode. Non-interactive runs must pass a
selector explicitly, for example `--unity-project 2` or `--unity-project
MyGame`, so scripts do not accidentally edit the wrong project. Multi-project
and ambiguous-selector errors include copyable `select: --unity-project ...`
hints for the matching live projects.
Use `uos projects --json` when automation needs a machine-readable list of live
projects and selector candidates. The JSON output intentionally omits bridge
tokens.
An explicit selector from `--unity-project`, `--uos-project`, `--uos-target`,
`UOS_UNITY_PROJECT`, or `UOS_TARGET` takes precedence over inherited
`UNITY_MCP_HOST` / `UNITY_MCP_PORT` / `UNITY_MCP_TOKEN` values. UOS skips
registry selection only when no selector is supplied and a complete explicit
bridge environment is already present, or when `UOS_SKIP_PROJECT_SELECT=1`.
`uos ready` uses the same precedence: selector env requires a matching live
registry entry instead of treating an inherited bridge env as the selected
target.

When a target is selected, `UNITY_MCP_MATERIALS_DIR` defaults to that Unity
project root. This lets relative planning material paths resolve against the
selected Unity project instead of the UOS repo. Use `--uos-materials <dir>` for
an explicit material root. Inherited `UNITY_MCP_MATERIALS_DIR` values are
ignored for registry-selected targets unless `UOS_INHERIT_MATERIALS_DIR=1` is
set, which prevents stale material roots from a previous session from affecting
a newly selected project. If the selected project already has `.uos` history,
launch materials, or attached files, `uos` also injects a concise
`UOS_CONTEXT_SUMMARY` into the opencode process environment.
The launcher regenerates this summary for the selected target on every launch
and ignores any inherited `UOS_CONTEXT_SUMMARY` from the parent shell, so stale
context from another Unity project is not forwarded.
Likewise, `UOS_ATTACHED_FILES` is rewritten from the current `--uos-file` /
`--uos-attach` inputs and any inherited value is cleared when no files are
attached for this launch.
That summary includes recent screen/source/element context plus latest preview
and visual comparison metrics when they exist, including selector hints such as
`screenQuery`, `sourcePathContains`, and `slideNumber` for material-derived
screens. Follow-up runs can start from the previous verification state without
requiring the user to know canonical ids. For one-shot `uos run ...` sessions,
UOS also writes a temporary Markdown attachment for the initial model prompt.
When a summary exists, the attachment includes it; on a brand-new project it
still includes the selected project, material roots, bridge capability cache
when available, and a startup checklist so the first AI turn can call
`get_uos_context` before mutating Unity.
Use `--uos-materials <dir>` or `--uos-materials-dir <dir>` when a session should
read planning images, PDFs, DOCX files, or PPTX decks from a folder outside the
selected Unity project. Relative `--uos-materials` paths resolve against the
selected Unity project root. Repeat `--uos-file <file>` or
`--uos-attach <file>` to expose explicit materials through `UOS_ATTACHED_FILES`
and `get_uos_context`. For one-shot `uos run ...` sessions, text-like files
(`txt`, `md`, `csv`, `json`, `yaml`, `jsonl`) are also attached through
opencode's `run --file` path for first-turn model visibility. Binary or visual
files such as images, PDF, DOCX, and PPTX stay off opencode `--file` and are
read through UOS tools such as `read_planning_material`; relative file paths
resolve against the explicit material directory, then the selected Unity project
root. In default interactive TUI launches, all attached files are exposed
through `UOS_ATTACHED_FILES` and `get_uos_context` rather than opencode
`--file`; use `uos run ...` with text materials when the files must be visible
as first-turn model attachments. Use
`--uos-max-material-candidates`, `--uos-max-material-depth`, and
`--uos-max-material-scan-files` to bound the launch context summary for broad
planning folders before the first AI turn; UOS also passes those limits through
environment variables so `get_uos_context` uses the same defaults inside the
session. Inherited `UOS_MAX_MATERIAL_CANDIDATES`, `UOS_MAX_MATERIAL_DEPTH`, and
`UOS_MAX_MATERIAL_SCAN_FILES` values are ignored for registry-selected targets
unless `UOS_INHERIT_MATERIAL_LIMITS=1` is set, so stale limits cannot hide
materials in a newly selected project.
When you skip project selection by providing explicit bridge env vars, set
`UOS_PROJECT_DIR` too so relative `--uos-materials` and `--uos-file` paths still
resolve against the Unity project root. In explicit bridge mode, an inherited
`UNITY_MCP_MATERIALS_DIR` is still treated as the material root.
Before launching opencode, UOS validates the explicit material directory and
attached files, then prints a launch summary to stderr. Set
`UOS_LAUNCH_SUMMARY=0` to suppress that summary in scripted environments.
When persisted `.uos` context exists, that summary also surfaces screen count,
the active screen, latest verification or preview status, and material
candidate count before the TUI starts.
UOS starts opencode from this repository root and always injects
`--agent ochestrator` for `uos run ...` and TUI launches, including TUI
launches with flags such as `--model`. User-facing UOS sessions do not support
choosing specialist agents directly. `opencode.json` also disables opencode's
native `build` and `plan` primary agents so Tab-based agent switching only
exposes `ochestrator` after relaunch. The Ochestrator is the only
conversational agent: it calls `get_uos_context`, selects a UOS mode with
`select_uos_mode`, uses internal submodel handoff documents under
`.opencode/submodels/`, and keeps Unity mutations behind the Editor bridge
tools. For fresh TUI launches, UOS also injects a `--prompt` that tells the
agent to call `get_uos_context` first and follow `recommendedLaunchWorkflow`
before mutating Unity. That startup prompt includes the selected project, bridge
capability cache, launch materials, attached file hints, the configured default
response language from `uos setup --language <code|name>`, and a bounded `.uos`
context summary excerpt. Continued TUI sessions started with `--continue` or
`--session <id>` receive the same UOS startup prompt so the resumed conversation
re-grounds on the currently selected Unity Editor project while opencode
preserves the existing session history.
Pass an explicit `--prompt` to override that startup prompt.
For real launches, UOS fails fast when the selected bridge reports missing
required editing tools; `--uos-dry-run` still prints the resolved launch without
starting opencode.
Use `--uos-dry-run`, `--uos-preflight`, or `--uos-print-launch` to print the
resolved launch summary, forwarded opencode argv, and injected UOS environment
without starting opencode.

`uos context` is the read-only version of that launch handoff. It uses the same
selector precedence as real launches, validates the same `--uos-materials` and
`--uos-file` inputs, then prints the selected project, material roots, attached
files, and the concise `.uos` context summary that will be injected into an AI
session.
When launch materials are present, the summary also lists supported candidate
files by kind and source, with the first recommended tools for each candidate,
so the user can confirm what the first AI turn will see before mutating Unity.
`get_uos_context` exposes the same launch handoff as structured
`recommendedLaunchWorkflow` metadata, so the agent can read attached files,
scan material folders, use `create_screen_from_material` as the broad default
creation route, choose candidate-specific create/draft alternatives when
needed, and verify results in a stable order during interactive sessions.
For selected Unity targets, `get_uos_context.selectedUnity` also includes the
launcher's token-free bridge capability cache when available, including
`supportedTools` and `writeTools`, so the first AI turn can see whether Unity
editing calls are expected to work before mutating the scene.
Use `--max-material-candidates`, `--max-material-depth`, and
`--max-material-scan-files` to bound broad material folders. Use `--json` when
scripts need the token-redacted report.

`uos smoke` runs a direct bridge check before the AI loop. Without `--write`,
it calls `get_project_info` and `list_screens`. Add `--ai-run` to start
`opencode run` against the selected project and require the AI path to call
`get_uos_context` first, then `get_project_info`, `create_scene_object`, and
`delete_scene_object` for a temporary scene-object round-trip. Use `--ai-model`,
`--ai-timeout-ms`, and `--ai-object-name` when the default smoke model or object
name needs to be overridden. When `--ai-run` is combined with
`--screen-from-material` or `--screen-from-first-material`, the AI smoke prompt
also attaches the selected material file and requires the AI/tool path to call
`get_uos_context`, `read_planning_material`, and `create_screen_from_material`.
When combined with `--pptx-deck`, it requires `get_uos_context`,
`read_planning_material`, and
`create_pptx_deck_screens`. Use `--ai-only` when you want the initial
`get_project_info`/`list_screens` bridge check plus the AI path only, without
running the direct material/UI/scene-object smoke mutation first. Combine
`--ai-only` with `--ai-follow-up` on a material or deck smoke to run a two-turn
AI conversation: the first opencode run creates the screen, and the second
`opencode run --continue` edits it through persisted `.uos` context. For
image/reference screens that have no editable text target yet, the follow-up
turn adds a small Text annotation through `add_ui_element_from_context`. With
`--verify` or `--compare`, the AI follow-up first calls
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
and diff path when those values are journaled. With
`--scene-object`, `--object-name` and `--object-type` are passed through to the
AI scene-object smoke prompt. Real opencode AI smoke runs also verify the
Unity-changing tool calls against `<UnityProject>/.uos/work-journal.jsonl`, so a
model merely naming a tool is not enough to pass; material AI smoke also rejects
journal records where the screen/deck mutation appears before
`read_planning_material`. With `--write`, direct smoke also calls
`create_ui_screen` with a small normalized `PlanningIntent`; `--revise` then
inspects the generated hierarchy, updates an existing text element, adds a new
child element under the smoke panel, moves an existing button, and deletes a
temporary element. `--flow` creates a second smoke screen and calls
`create_screen_transition` from the main smoke screen to that destination using
the generated smoke button as the trigger. `--context-follow-up` activates the
created screen, resolves an editable title/text target plus a parent panel or
background from `.uos`-style context without caller-supplied canonical ids, then performs
`set_active_screen_from_context`, `update_ui_element_from_context`, and
`add_ui_element_from_context` journal updates while mutating Unity through the
same bridge calls. It works with direct smoke screens as well as screens made
by `--screen-from-material`, `--screen-from-first-material`, or `--pptx-deck`.
`--scene-object` checks the non-UI Editor scene path by
creating a primitive, refreshing `list_scene_objects`, updating its name and
transform, refreshing again, deleting it, and persisting the resulting
`sceneObjects` context. `--preview` adds a `capture_preview`
call for the final smoke screen. `--import <file>` first calls `import_asset`
and applies the returned Unity asset path as a smoke UI sprite.
`--materials <dir>` recursively scans that planning-material directory, skipping
generated Unity folders, imports the first supported image, and applies it as
the smoke UI sprite. Relative `--import` paths resolve against
`UNITY_MCP_MATERIALS_DIR`, or the selected Unity project root when that variable
is not set. Relative `--materials` paths resolve against the selected Unity
project root. `--screen-from-material <file>` runs the same
`create_screen_from_material` router used by AI sessions against the selected
live bridge, so image/PDF/DOCX/PPTX/document material creation can be checked
before a conversation; use `--material-mode reference`, `--pptx-mode rendered`,
`--page`, `--slide`, or `--image-number` for specific material routes. Add
`--context-follow-up` to verify that the material-derived screen can immediately
be edited through persisted-context selectors.
`--screen-from-first-material` combines that router with `--materials` or
`--uos-materials`: it picks the first supported image, PDF, DOCX, PPTX, text,
Markdown, CSV, or JSON file from the folder, honors `--material-kind` filters,
and creates the screen through `create_screen_from_material` instead of the
older first-image sprite smoke path.
Editable document routes also recognize simple control declaration lines such
as `Input: Player name`, `Input: Player name = Lyx`,
`Toggle: Remember me = on`, `Slider: Music volume [0-100] = 70`, and
`Dropdown: Difficulty [Easy, Normal, Hard] = Normal`, converting them into
matching UGUI controls instead of body text.
`--pptx-deck <file>` exercises the multi-slide PPTX flow path used by
`create_pptx_deck_screens`: it creates one screen per selected slide, creates
sequential transitions by default, activates the first generated screen by
default, and can be narrowed with `--slides 1,2,3`, `--first-slide`,
`--last-slide`, or `--max-slides`. Use `--no-deck-transitions` or
`--no-activate-first` for narrower bridge checks.
`--compare <image>` implies `--write --preview`, compares the saved
preview PNG against a local reference/mockup image, writes a diff PNG under
`<projectRoot>/.uos/comparisons/` by default, and records the visual metrics in
the persisted UOS context. `--verify <image>` exercises the combined
`verify_screen_against_reference` path instead, so the next AI session sees one
screen verification record containing both the captured preview and visual diff.
`--save` calls `save_scene`; pass `--scene Assets/SomeScene.unity` to choose a
scene path. Write smoke runs also update `<projectRoot>/.uos/` so the next AI
session can see the smoke-created screen, transition, imported asset, captured
preview, visual comparison, verification result, and saved scene.
Context-resolved tools can also select material-derived screens by persisted
source metadata, for example `screenQuery: "lobby deck slide 2"`,
`sourcePathContains: "lobby.pptx"` with `slideNumber: 2`, `pageNumber: 3`,
`imageNumber: 1`, or `latest: true`. Use these selectors for follow-up requests
such as "edit the button on deck slide 2" when the user does not know the
generated `screenId`.

`uos e2e` automates the live bridge check that otherwise has to be done by
hand. It launches the target project in Unity batchmode, waits for that
project's bridge registry entry, runs a default write/revise/preview smoke
screen named `UOSE2ESmoke`, stops Unity, and removes stale registry entries.
Pass `--read-only` for a non-mutating bridge check, `--keep-open` to leave the
batchmode Editor running, and any normal smoke flags such as `--save`,
`--materials`, `--import`, or `--name` after the E2E options. E2E runs use
`-nographics` by default for fast headless checks; pass `--graphics` or
`--no-nographics` when preview pixels need to be rendered by the local graphics
device for visual verification.

`uos doctor` keeps the default path fast and performs static checks only.
It also prints a material-capabilities section so you can tell whether images,
PDFs, DOCX/PPTX text, embedded Office images, PPTX editable layout extraction,
and rendered PPTX slide images are available on the current machine.
`uos doctor --project <UnityProjectPath>` also inspects that project's
`Packages/manifest.json` and embedded packages, reports whether
`com.lyx.oh-my-unity` is installed, validates package metadata such as the
`com.unity.ugui` dependency, and warns when manifest and embedded UOS package
installs coexist. `uos install-unity` embeds the package by default and
normalizes `Packages/packages-lock.json` when present, so shared projects do not
keep a `file:C:/Users/...` dependency on the original UOS machine. It also
prints the same post-install package check, so package metadata issues are
visible before reopening Unity.
`uos doctor --runtime` also starts `opencode debug config`, which can take
longer because provider/auth plugins are loaded. Use it before real AI sessions
to catch duplicate resolved plugins and expired Claude/opencode authentication.
`uos doctor` also probes the installed opencode CLI help to confirm UOS-required
handoff flags such as `run --file`, `run --agent`, and interactive `--agent`
are available.
`uos ready` is the concise gate for AI sessions: it runs the runtime check,
requires a live Unity Editor bridge or explicit bridge env, and exits non-zero
when auth, opencode resources, opencode handoff flags, or bridge discovery are
not ready. When live bridges are available, it also prints token-redacted project
selector hints.
Both `uos doctor` and `uos ready` ask live bridges for token-free
`get_project_info.supportedTools` / `writeTools` metadata, so missing Unity-side
editing capabilities such as `create_ui_screen`, `add_ui_element`, or
`save_scene` are visible before starting an AI session.
`uos wait` polls the local Unity Editor registry until at least one live bridge,
or the selected `--unity-project`, is reachable. `uos ready --wait` performs the
same bridge wait first, then runs the full readiness gate including opencode
runtime/auth checks. Use either after opening or refreshing a Unity project
before running `uos projects`, `uos smoke`, or a real UOS session.
`uos mvp` is the read-only user-led validation preflight. It checks the selected
bridge capability metadata and supplied planning material, then prints the exact
`uos ready`, `uos context`, dry-run, AI edit, and follow-up chat commands for
the MVP walkthrough without starting opencode or mutating Unity. It also prints
acceptance gates that say what evidence to collect for package install/runtime,
readiness, public preflight, dry-run forwarding, the real AI edit, and the
follow-up edit. Add `--json` when an automation needs the same token-redacted
preflight status, command sequence, and acceptance gates.
Use `--save <file>` to persist that token-redacted JSON as an MVP evidence
bundle for the next validation session. Use `uos mvp-progress <file>` to read
that bundle and print automatic preflight state, user-evidence progress, pending
gates, and the next command group to run with the user.
Local plugins are discovered from `.opencode/plugins`. Do not also list
`.opencode/plugins/uos.ts` in `opencode.json`, or opencode will load the same
journal plugin twice. After a clean checkout, run `npm install` in `.opencode`
so plugin dependencies such as `opencode-claude-auth` are available before
`uos run`, `uos ready`, or `uos doctor --runtime`. For optional direct opencode
launches outside this repository, `uos setup` rewrites the global
`opencode.jsonc` from this repo's `opencode.json`, merges
`.opencode/package.json` dependencies into the global opencode config directory,
and runs `npm install --ignore-scripts` there. That keeps the global direct
opencode path on the same Ochestrator-only agent surface. Pass
`--unity-projects <dir>` during setup to save the folder that contains user
Unity projects in `~/.config/uos/config.json`; pass
`--language <code|name>` such as `ko`, `en`, `Japanese`, or `中文` to save the
default response language used in UOS startup prompts. The launcher project list
will use the configured Unity root in the no-argument `uos` flow.

## Local AI Support Tools

The agent can use local tools to inspect selected-project context and planning
files before editing Unity:

All screen-resolving `_from_context` tools accept `screenQuery`, `sourceKind`,
`sourcePath`, `sourcePathContains`, `pageNumber`, `slideNumber`, `imageNumber`,
and `latest` in addition to exact screen id/name selectors. Element edit tools
combine those screen selectors with `query`, while transition tools expose the
same idea as `from*` and `to*` selectors. This lets the agent resolve screens by
the material that created them, such as `lobby.pptx` slide 2 or a PDF page.
Active-screen phrases such as `current screen` and `active screen` resolve to
the persisted active screen. Mutation-oriented `_from_context` tools refresh the
live Unity hierarchy before resolving by default, so manually changed element
text, layout, parentage, and the currently active screen can be used in follow-up
edits. Dry-run resolution stays offline by default; pass `refreshHierarchy:
true` with `dryRun: true` only when the dry-run should also inspect Unity.

| Tool | Current behavior |
|---|---|
| `get_uos_context` | Loads persisted `.uos` project/screen/element/asset/source/preview/comparison/journal context, exposes token-free `selectedUnity` metadata for the active project/Editor bridge, exposes launch material candidates and launch-attached files, returns structured `recommendedLaunchWorkflow` metadata for the next read/scan/create/verify actions, summarizes per-screen visual feedback diagnostics and next-tool hints, and attaches any still-existing launch files, persisted source materials, source/reference images, latest visual diff images, and latest previews for follow-up editing. |
| `resolve_uos_context_target` | Resolves one persisted screen and optionally one element from `.uos` context without calling Unity; use before edits when the user names a prior screen, material source, or element but canonical ids are not already known. |
| `analyze_planning_materials` | Builds a concise material brief from the launch material folder and attached files, ranks likely source files, extracts short text snippets, and recommends the next concrete material tools to call. |
| `list_planning_materials` | Finds supported files under a directory, optionally recursively while skipping generated Unity folders, and reports kind, mime type, image dimensions, PPTX slide count, and embedded image counts when available. |
| `read_planning_material` | Attaches the file, extracts text when possible, returns planning metadata, automatically downscales large images into bounded vision attachments, renders a bounded set of leading PDF pages as PNG vision attachments, and attaches a bounded set of embedded DOCX/PPTX raster images for first-pass vision while keeping original paths for import/reference workflows. |
| `extract_embedded_images` | Extracts embedded raster images from DOCX/PPTX files as vision attachments. |
| `create_screen_from_material` | With a live Unity bridge, auto-routes any supported material into a Unity screen: images become reference screens, PPTX becomes an editable slide screen, and text-forward PDF/DOCX/Markdown/text/CSV/JSON documents become editable document screens. In auto mode, PDF/DOCX files without useful extracted text fall back to visual reference workflows when possible. Use `mode: "reference"` for PDF/DOCX visual reference screens. |
| `create_reference_screen_from_material` | With a live Unity bridge, auto-routes an image, PDF page, DOCX embedded image, or PPTX slide into the matching import/render/extract workflow, creates a full-screen reference screen, and records the created screen context. PPTX defaults to editable layout conversion; pass `pptxMode: "rendered"` when a rendered slide PNG should be imported as one reference Image. |
| `create_docx_image_reference_screen` | With a live Unity bridge, extracts one embedded DOCX image, imports it as a Sprite, creates a full-screen reference screen, and records the created screen context. |
| `draft_planning_intent_from_document` | Converts PDF, DOCX, Markdown, text, CSV, or JSON body text into a valid `PlanningIntent` draft with title/body text, CTA/button candidates, and control declarations such as `Input: Player = Lyx`, `Toggle: Remember = on`, `Slider: Volume [0-100] = 70`, and `Dropdown: Difficulty [Easy, Normal, Hard] = Normal` for review before `create_ui_screen`. Long body text is drafted into a ScrollView instead of being dropped. |
| `create_document_screen` | With a live Unity bridge, extracts text from PDF, DOCX, Markdown, text, CSV, or JSON, drafts and validates a `PlanningIntent`, creates the Unity screen, and records source metadata for follow-up context. Document control declarations become editable UGUI controls, and long body text becomes scrollable UGUI content. |
| `draft_planning_intent_from_docx` | Converts DOCX body text into a valid `PlanningIntent` draft with title/body text and CTA/button candidates for review before `create_ui_screen`. |
| `pdf_to_images` | Renders selected PDF pages into PNG attachments with `pdf-parse`. |
| `create_pdf_page_reference_screen` | With a live Unity bridge, renders one PDF page to PNG, imports it as a Sprite, creates a full-screen reference screen, and records the created screen context. |
| `preprocess_image` | Crops, resizes, and transcodes images with `sharp`. |
| `create_image_reference_screen` | With a live Unity bridge, imports a single mockup/reference image as a Sprite, creates a full-screen reference screen, and records the created screen context. |
| `prepare_image_ui_draft` | With a live Unity bridge, imports a single mockup/reference image as a Sprite and returns a full-screen `PlanningIntent` draft with `props.sprite` populated. |
| `pptx_to_images` | Renders PPTX slides through LibreOffice/PowerPoint when available; when rendering is unavailable, falls back to slide text/layout plus embedded PPTX image attachments for vision. |
| `extract_pptx_layout` | Extracts PPTX slide dimensions, positioned text boxes, picture bounds, normalized rects, text emphasis as `fontStyle`, text/fill colors, and suggested Unity element types without requiring a slide renderer. |
| `draft_planning_intent_from_pptx` | Converts one PPTX slide layout into a valid `PlanningIntent` draft that can be validated, revised, then passed to `create_ui_screen`; carries PPTX bold/italic text into `props.fontStyle`, text/fill colors into `props.color`, and accepts extracted image metadata plus imported asset mappings to populate `props.sprite`. |
| `create_pptx_slide_screen` | With a live Unity bridge, extracts one PPTX slide layout, imports matched pictures as Sprites, creates the Unity screen, and records the created screen context. |
| `create_pptx_deck_screens` | With a live Unity bridge, converts selected PPTX slides into multiple Unity screens, optionally creates sequential transitions, optionally activates the first screen, and records every generated screen in context. |
| `prepare_pptx_ui_draft` | With a live Unity bridge, extracts PPTX pictures, imports matched pictures as Sprites, and returns a `PlanningIntent` draft with `props.sprite` populated. |
| `compare_images` | Compares a reference/mockup image with a rendered preview, returns normalized difference metrics, and attaches a diff PNG for visual follow-up. |
| `verify_screen_against_reference` | Captures a Unity screen preview, compares it against a reference/mockup image, attaches both preview and diff images, and records the verification in `.uos` context. |
| `inspect_screen_feedback_from_context` | Resolves one persisted screen by screen id/name or source selector and summarizes its source material, latest preview, latest comparison metrics, structured visual `diagnostics`, diff/source/preview attachments, structured `recommendedTools`, and recommended next steps before conversational follow-up edits. |
| `capture_preview_from_context` | Resolves one persisted screen from `.uos` context by screen id/name, source selector, or the persisted active screen when no screen is named, then captures a preview; use when a follow-up request names a prior screen or material source but not its canonical screenId. |
| `verify_screen_against_reference_from_context` | Resolves one persisted screen from `.uos` context by screen id/name or source selector and compares it against an explicit reference image or the screen's persisted source/reference image; use when the user asks to verify a prior material-derived screen against the original. |
| `verify_screens_against_references_from_context` | Resolves multiple persisted screens by source filters, captures each preview, and compares each against its persisted source/reference image; use for PPTX decks, multi-page flows, or requests such as "verify all screens from this deck". |
| `get_scene_hierarchy_from_context` | Resolves one persisted screen from `.uos` context by screen id/name, source selector, or the persisted active screen when no screen is named, then inspects that screen's live Unity hierarchy; use before follow-up edits when the screenId is not already known. |
| `import_asset` | Copies local files into the selected Unity project's `Assets/` folder and imports images as Sprites. |
| `create_scene_object` | Creates a non-UI Unity scene GameObject such as Empty, Cube, Sphere, Camera, PointLight, DirectionalLight, or SpotLight, then returns a persistent `objectId` for conversational follow-up edits. |
| `list_scene_objects` | Lists UOS-created non-UI scene objects with ids, hierarchy paths, active state, transform, and components. |
| `update_scene_object` | Updates a UOS-created scene object's name, parent, active state, or local transform by `objectId`. |
| `delete_scene_object` | Deletes a UOS-created scene object by `objectId`. |
| `resolve_scene_object_from_context` | Resolves one persisted scene object by object id/name/type/path/query, refreshing live `list_scene_objects` first by default. |
| `update_scene_object_from_context` | Resolves one persisted scene object from `.uos` context, then updates name, parent, active state, or local transform without requiring the user to know `objectId`. |
| `delete_scene_object_from_context` | Resolves one persisted scene object from `.uos` context, then deletes it without requiring the user to know `objectId`. |
| `add_ui_element_from_context` | Resolves one persisted screen by screen id/name, source selector, or the active screen when no screen is named, plus an optional parent element from `.uos` context by parent clientHintId, current text, type, canonical parentElementId, or `parentQuery` such as `main panel`, then calls `add_ui_element`; use for conversational follow-up adds when ids are not already known. |
| `update_ui_element_from_context` | Resolves one persisted element from `.uos` context by screen name/id, source selector, clientHintId, current text, type, canonical elementId, or natural `query` such as `play button`, `primary CTA`, or `settings button`, preferring a single active-screen match when no screen is named, then calls `update_ui_element`; use for conversational follow-up edits when the elementId is not already known. |
| `move_ui_element_from_context` | Resolves one persisted element from `.uos` context by screen id/name, source selector, clientHintId, current text, type, canonical elementId, or natural `query`, preferring a single active-screen match when no screen is named, then calls `move_ui_element`; use for conversational layout follow-ups when the elementId is not already known. |
| `delete_ui_element_from_context` | Resolves one persisted element from `.uos` context by screen id/name, source selector, clientHintId, current text, type, canonical elementId, or natural `query`, preferring a single active-screen match when no screen is named, then calls `delete_ui_element`; use for conversational follow-up deletes when the elementId is not already known. |
| `create_screen_transition_from_context` | Resolves source/target screens by screen id/name or source selector and resolves an optional trigger element from `.uos` context, defaulting the source to the active screen when omitted, then calls `create_screen_transition`; use `triggerQuery` for conversational navigation edits such as connecting a `play button` to a named screen. |
| `set_active_screen_from_context` | Resolves one persisted screen from `.uos` context by screen id/name or source selector, then activates it and hides the other registered screens; use for conversational requests such as "show the shop screen" or "show deck slide 2". |

Supported material extensions include `png`, `jpg`, `jpeg`, `webp`, `gif`,
`bmp`, `pdf`, `pptx`, `docx`, `txt`, `md`, `csv`, and `json`.

## Unity Editing Tools

Bridge tools currently cover:

- `get_project_info`
- `resolve_uos_context_target`
- `import_asset`
- `get_scene_hierarchy`
- `get_scene_hierarchy_from_context`
- `capture_preview`
- `capture_preview_from_context`
- `list_screens`
- `create_scene_object`
- `list_scene_objects`
- `update_scene_object`
- `update_scene_object_from_context`
- `delete_scene_object`
- `delete_scene_object_from_context`
- `resolve_scene_object_from_context`
- `validate_planning_intent`
- `create_ui_screen`
- `add_ui_element`
- `add_ui_element_from_context`
- `update_ui_element`
- `update_ui_element_from_context`
- `move_ui_element`
- `move_ui_element_from_context`
- `delete_ui_element`
- `delete_ui_element_from_context`
- `create_screen_transition`
- `create_screen_transition_from_context`
- `set_active_screen`
- `set_active_screen_from_context`
- `verify_screen_against_reference`
- `verify_screen_against_reference_from_context`
- `verify_screens_against_references_from_context`
- `inspect_screen_feedback_from_context`
- `save_scene`

`get_project_info` returns the live Editor's token-free project/bridge identity
plus `supportedTools` and `writeTools`, so the AI can confirm which selected
Unity project it is editing and which Unity-side mutations are available before
calling write tools.

Successful `list_screens` calls update `.uos` screen names and active-screen
state, and successful `list_scene_objects` calls update `.uos` scene-object
ids/transforms, so the cheapest live inspection at session start also improves
later `current screen` and scene-object conversational resolution.

For non-UI scene editing, use `create_scene_object` to create Empty,
primitive, Camera, and Light GameObjects with a persistent `objectId`; use
`list_scene_objects` before follow-up edits when the object id is not already
known, or use `resolve_scene_object_from_context` for a read-only match. For
natural follow-ups such as `move the cube left`, use
`update_scene_object_from_context`; for removal follow-ups, use
`delete_scene_object_from_context`. Use direct `update_scene_object` and
`delete_scene_object` only when the exact `objectId` is already known. This
path is separate from UGUI screen tools and is intended for direct Editor scene
layout work. Scene object records are stored in `.uos/screens.json` under
`sceneObjects` for later UOS re-entry.

The UGUI backend supports screen creation, screen activation, element mutation,
movement, deletion, parenting follow-up `add_ui_element` calls with
`element.parentElementId`, anchor-aware RectTransform placement, Button label
reuse, InputField placeholder/value reuse, text props including `text`,
`fontSize`, `fontStyle`, `color`, and `align`, interactive control props
including `placeholder`, `inputText`, `isOn`, `value`, `minValue`, `maxValue`,
`options`, and `interactable`, functional default child hierarchies for
InputField, Toggle, Slider, ScrollView, and Dropdown controls, ScrollView
`props.text` content, and Undo registration for generated changes. Use
`validate_planning_intent` before `create_ui_screen` when
the intent was derived from images, documents, or PPTX slides so schema and
parent-link mistakes are caught before Unity mutates the scene. When the intent
came from a draft/material tool, pass that tool's `metadata.source` as the
optional top-level `source` argument to `create_ui_screen`; UOS persists it in
`.uos/screens.json` for later conversational follow-up, but does not send it to
Unity. Use `save_scene`
after approval to persist generated UI in a scene asset. `get_scene_hierarchy`
and `get_scene_hierarchy_from_context` report live element ids, inferred type,
normalized rect, anchor preset, and inspectable props so follow-up edits can be
based on the actual scene state. Use
`add_ui_element_from_context` when `.uos` context identifies the destination
screen or parent but the canonical `screenId` or `parentElementId` is not
already in the conversation; use `parentQuery` for phrases like `main panel`
when structured parent selectors are not obvious. When no destination screen is
named, it defaults to the persisted active screen if one exists. Use
`update_ui_element_from_context` or `move_ui_element_from_context` or
`delete_ui_element_from_context` when `.uos` context identifies the target by
screen name, clientHintId, current text, type, or natural `query` but the
canonical elementId is not already in the conversation; if multiple screens
match, a single active-screen candidate is preferred. Natural queries are
matched against screen names, clientHintIds, element text, element types, and
English/Korean type aliases, so phrases such as `play button`, `primary CTA`,
`settings button`, `설정 버튼`, `현재 화면`, or `큐브` can resolve common
follow-up targets. Screen-resolving context tools also accept material source selectors: `screenQuery` searches
screen identity plus persisted source metadata, and `sourceKind`, `sourcePath`,
`sourcePathContains`, `pageNumber`, `slideNumber`, `imageNumber`, and `latest`
narrow screens created from images, documents, PDF pages, DOCX images, or PPTX
slides. Use those selectors before mutating when the user's reference is
material-based, such as `deck slide 2` or `README.md latest`. These mutating
context tools refresh the live Unity hierarchy by default before resolving the
target, and then persist that refreshed state back into `.uos` when the mutation
succeeds. Dry-run resolution stays offline unless `refreshHierarchy: true` is
explicitly provided. Use
`create_screen_transition_from_context`
when `.uos` context identifies source/target screens and the trigger by screen
name, button text, clientHintId, or `triggerQuery` but the canonical transition
ids are not already in the conversation; when the source is omitted, it defaults
to the persisted active screen, but the target screen must still be named. Use
`set_active_screen_from_context` when `.uos`
context identifies a prior screen that should become the visible/active screen.
Use `capture_preview_from_context` and
`verify_screen_against_reference_from_context` when `.uos` context identifies a
prior screen or material source but the canonical screenId or reference path is
not already in the conversation. Use
`verify_screens_against_references_from_context` when several material-derived
screens should be checked together, such as all rendered slides from a PPTX
deck. After preview/verification, the metric summary,
preview, and diff attachment are persisted in `.uos` and help drive the next
revision across follow-up sessions. Use `inspect_screen_feedback_from_context`
to reload one screen's latest source/reference, preview, comparison metrics, and
diff attachments before deciding the next `update/move/add/delete_*_from_context`
edit.
For any supported image, PDF, DOCX, or PPTX material that should appear directly
in Unity, use `create_screen_from_material` as the default fast path; it chooses
editable document/PPTX generation or visual reference generation based on the
material type and `mode`. Use `create_reference_screen_from_material` when the
result should explicitly be a visual reference screen. For a single image mockup that should
appear directly in Unity, use
`create_image_reference_screen` to perform import and screen creation in one
tool call; use `prepare_image_ui_draft` instead when the draft should be
reviewed or revised before mutation.
For a PDF page that should appear directly in Unity, use
`create_pdf_page_reference_screen` to render, import, and create the reference
screen in one tool call. For a PDF or plain text planning document whose body
text defines screen copy, sections, requirements, or CTA labels, use
`create_document_screen` to create the editable Unity screen in one call. Use
`draft_planning_intent_from_document` instead when the generated
`PlanningIntent` should be reviewed or revised before `create_ui_screen`.
When the document includes `Input:`, `Field:`, `Toggle:`, `Checkbox:`,
`Slider:`, `Range:`, `Dropdown:`, or `Select:` lines, those lines are drafted
as editable controls rather than paragraph text; control drafts include useful
default props such as InputField placeholders, unchecked Toggle state, Slider
range/value, and Dropdown options/value. Inline defaults are supported with
`= value`, slider ranges with `[min-max]`, and dropdown options with
`[Option A, Option B]`. Long document body sections are drafted as a ScrollView
with `props.text`, so PDF/DOCX/Markdown screens keep the remaining copy
available for inspection and follow-up edits.
For a DOCX that contains screenshots or mockups, use
`create_docx_image_reference_screen` to extract a selected embedded image and
create the reference screen in one tool call. For a DOCX whose body text defines
screen copy, sections, requirements, or CTA labels, use
`draft_planning_intent_from_docx`, then validate and revise the generated
`PlanningIntent` before `create_ui_screen`.
For a PPTX deck that should become a multi-screen Unity flow, use
`create_pptx_deck_screens` with explicit `slideNumbers` or a
`firstSlide`/`lastSlide` range; pass `createTransitions: true` to connect
consecutive slides and `activateFirst: true` to show the first generated screen.
For one PPTX slide that should become a Unity screen immediately, use
`create_pptx_slide_screen`; use `prepare_pptx_ui_draft` when the slide-derived
draft should be reviewed or revised before mutation. When a deck slide should
stay as a visual reference image instead of editable elements, call
`create_reference_screen_from_material` with `pptxMode: "rendered"`; this needs
LibreOffice or PowerPoint and records both the source deck and rendered slide
path in `.uos` context.

## Development Verification

```bash
bun run test

$files = (Get-ChildItem -Path .opencode/tools -Filter *.ts).FullName
bun build $files --target=bun --outdir=.omx/tmp/check

node --check bin/uos.js
node --check bin/uos-core.js
node --check bin/uos-setup.js
```

Unity EditMode verification on this machine:

```powershell
& "C:\Program Files\Unity\Hub\Editor\6000.0.68f1\Editor\Unity.exe" `
  -batchmode -nographics `
  -projectPath "C:\Users\lyx\MCP_for_Unity_LYX" `
  -runTests -testPlatform EditMode `
  -testResults "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\editmode-results-current.xml" `
  -logFile "C:\Users\lyx\MCP_for_Unity_LYX\TestResults\unity-current.log"
```

The current local baseline is 208 Bun tests passing and 54 Unity EditMode tests
passing.

Live bridge E2E verification:

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

Current local evidence: a batchmode Unity Editor published a live registry entry,
`uos e2e --context-follow-up` selected the project, created a UGUI smoke screen,
revised it, resolved the active screen and elements from persisted `.uos`-style
context, applied `set_active_screen_from_context`,
`update_ui_element_from_context`, and `add_ui_element_from_context` journal
updates through the real bridge, captured a preview PNG, stopped Unity, and
cleaned one stale registry entry. The log is
`TestResults/uos-e2e-context-follow-up.log`. A second real E2E run with
`--screen-from-material README.md --material-mode auto --context-follow-up --preview`
exercised the same material router used by AI sessions, created an editable
document-derived UGUI screen, persisted the source as
`create_screen_from_material`/`md`/`editable` in `.uos/screens.json`, resolved
`md_title` and `md_background` from `.uos`-style context, applied
`update_ui_element_from_context` and `add_ui_element_from_context` updates
through the real bridge, captured a preview PNG, stopped Unity, and cleaned one
stale registry entry. The log is
`TestResults/uos-e2e-readme-material-follow-up.log`. A third real E2E run used
`--screen-from-material TestResults\uos-image-reference-smoke.png` with
`--material-mode reference --preview`. It imported a 1920x1080 PNG mockup into
`Assets/UOS/Imported/uos-image-reference-smoke.png`, created an image reference
screen, persisted the source as `create_screen_from_material`/`image`/`reference`
with asset paths, captured a preview PNG, stopped Unity, and cleaned one stale
registry entry. The log is `TestResults/uos-e2e-image-material.log`. A fourth
real E2E run used `--verify TestResults\uos-image-reference-smoke.png` against a
UGUI smoke screen. It captured a preview, compared it against the reference
image, wrote a diff PNG under `.uos/comparisons`, persisted the visual metrics
so `get_uos_context` reports `comparisons=1`, stopped Unity, and cleaned one
stale registry entry. The log is `TestResults/uos-e2e-visual-verify.log`. A
fifth real E2E run used
`--pptx-deck TestResults\uos-pptx-deck-smoke.pptx --slides 1,2 --preview`. It
created two editable slide-derived UGUI screens with four elements each, created
the `next-slide-1` transition, activated slide 1,
persisted both screen sources as `create_pptx_deck_screens`/`pptx`/`editable`,
captured a preview PNG, stopped Unity, and cleaned one stale registry entry. The
log is `TestResults/uos-e2e-pptx-deck.log`. A sixth real E2E run used
`uos e2e --secondary-project` to open this project and a temporary
`uos-e2e-secondary-project` Unity project at the same time. `uos projects
--json` reported both live Editors, with the second bridge falling back from
port 17801 to an ephemeral port, and read-only smoke selected and connected to
each project independently. Multi-editor E2E can also be combined with
`--public-mvp-json`, `--public-chat-dry-run`, and `--public-run-dry-run`; UOS
then spawns the public launcher for each selected target and verifies that
`--unity-project` is the current project path, not a stale or first-listed
Editor. The log is
`TestResults/uos-e2e-multi-editor-selection.log`. A seventh real E2E run used
`--graphics --pptx-deck TestResults\uos-pptx-colored-shapes-smoke.pptx --slides 1,2 --include-shape-panels --preview`.
It created editable PPTX-derived screens that preserved title text color
(`#FFCC00`), title text-box fill (`#102030` as a backing Panel), and shape fill
(`#445566`), captured a nonblank Direct3D preview, stopped Unity, and cleaned
one stale registry entry. Pixel analysis of the captured preview found 96,810
title-fill pixels, 2,790 yellow text pixels, and 62,208 accent-panel pixels. The
log is `TestResults/uos-e2e-pptx-color-deck-fill.log`. An eighth real E2E run
used `--graphics --screen-from-material TestResults\uos-document-controls-smoke.md --material-mode auto --preview --name UOSDocumentControlsLayout`.
It created an editable document-derived screen with InputField, Toggle, Slider,
Dropdown, and Button elements, captured a preview with no Dropdown/Button
overlap, stopped Unity, and cleaned one stale registry entry. The log is
`TestResults/uos-e2e-document-controls-layout.log`. A ninth real E2E run used
`--scene-object --object-type Cube`. It opened this project in batchmode,
published the bridge registry entry through auto-start, created a UOS-marked
Cube scene object, refreshed `list_scene_objects`, updated its name and local
transform to position `(2,3,4)`, deleted it, persisted six scene-object records
in `.uos`, stopped Unity, and cleaned one stale registry entry. The log is
`TestResults/uos-e2e-scene-object.log`.

## Remaining Work

- Add CI coverage for multi-Editor `uos e2e --secondary-project` once a runner
  can host multiple Unity Editor instances.
- Exercise PPTX rasterization on machines with LibreOffice or PowerPoint
  installed, while keeping the current text fallback for renderer-less systems.
- Expand UI generation beyond the current UGUI surface and harden the
  verification/revision loop against richer production visual specs.
