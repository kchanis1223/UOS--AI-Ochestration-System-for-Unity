import { existsSync, promises as fs, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import WebSocket from "ws";
import { discoverConfiguredUnityProjects, readUosConfig, saveUnityExecutableConfig } from "./uos-config-core.js";
import { dedupeEditorsByProject, normalizeProjectKey } from "./registry-dedupe.js";

export const PROTOCOL_VERSION = "1.0.0";
export const HANDSHAKE_TIMEOUT_MS = 1_000;
export const TOOL_CALL_TIMEOUT_MS = 30_000;
export const UNITY_PACKAGE_NAME = "com.lyx.oh-my-unity";
export const UNITY_UGUI_PACKAGE_NAME = "com.unity.ugui";
export const UNITY_UGUI_PACKAGE_VERSION = "2.0.0";
export const DEFAULT_UOS_AGENT = "ochestrator";
export const DEFAULT_UOS_TUI_PROMPT = "Start this UOS Unity editing session against the selected Unity Editor project only. Call get_uos_context before mutating Unity, then call select_uos_mode with the user's request or a concise task brief. Use the selected mode's internal submodel handoff and next actions to read launch-attached materials, scan material folders, inspect Unity state, plan/build through artifacts, and verify results through the Editor bridge tools. Do not ask the user to choose a specialist agent. Use planner-friendly language: say screen, button, image, transition, preview, and save before Unity-specific terms such as Scene, GameObject, Canvas, or prefab. If no user edit request is clear yet, summarize the selected project/material context, show a short recommended task menu with example prompts, and ask what to change before mutating Unity.";
const DEFAULT_E2E_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_E2E_STOP_TIMEOUT_MS = 15_000;
const DEFAULT_BRIDGE_CAPABILITY_TIMEOUT_MS = 3_000;
const DEFAULT_OPENCODE_AI_SMOKE_MODEL = "anthropic/claude-haiku-4-5";
const DEFAULT_OPENCODE_AI_SMOKE_TIMEOUT_MS = 180_000;
const DEFAULT_PUBLIC_RUN_DRY_RUN_PROMPT = "continue the selected UOS Unity editing session and summarize the attached material context";
const DEFAULT_PUBLIC_RUN_AI_SCREEN_NAME = "UOSPublicRunAI";
const OPENCODE_RUN_TEXT_ATTACHMENT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".jsonl", ".yaml", ".yml"]);
const OPENCODE_AI_SCENE_OBJECT_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "create_scene_object", "delete_scene_object"];
const OPENCODE_AI_MATERIAL_SCREEN_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "read_planning_material", "create_screen_from_material"];
const OPENCODE_AI_PPTX_DECK_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "read_planning_material", "create_pptx_deck_screens"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_UPDATE_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "update_ui_element_from_context", "capture_preview_from_context"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_ADD_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "add_ui_element_from_context", "capture_preview_from_context"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_UPDATE_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "update_ui_element_from_context", "capture_preview_from_context"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_ADD_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "add_ui_element_from_context", "capture_preview_from_context"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_MOVE_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "move_ui_element_from_context", "capture_preview_from_context"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_REVERIFY_MOVE_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "move_ui_element_from_context", "verify_screen_against_reference_from_context"];
const OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_REPLACE_SMOKE_TOOLS = ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "delete_ui_element_from_context", "add_ui_element_from_context", "verify_screen_against_reference_from_context"];
const OPENCODE_AI_SMOKE_JOURNAL_TOOLS = new Set([
  "read_planning_material",
  "create_scene_object",
  "delete_scene_object",
  "create_screen_from_material",
  "create_pptx_deck_screens",
  "inspect_screen_feedback_from_context",
  "get_scene_hierarchy_from_context",
  "update_ui_element_from_context",
  "add_ui_element_from_context",
  "move_ui_element_from_context",
  "delete_ui_element_from_context",
  "capture_preview_from_context",
  "verify_screen_against_reference_from_context",
]);
const OPENCODE_AI_SMOKE_MARKER = "UOS_AI_SMOKE_OK";
const OPENCODE_NON_TUI_COMMANDS = new Set([
  "completion",
  "acp",
  "mcp",
  "attach",
  "run",
  "debug",
  "providers",
  "auth",
  "agent",
  "upgrade",
  "uninstall",
  "serve",
  "web",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "pr",
  "session",
  "plugin",
  "plug",
  "db",
]);
const OPENCODE_GLOBAL_VALUE_FLAGS = new Set([
  "-m",
  "--model",
  "-s",
  "--session",
  "--prompt",
  "--agent",
  "--log-level",
  "--port",
  "--hostname",
  "--mdns-domain",
  "--cors",
]);
const OPENCODE_TARGETLESS_GLOBAL_FLAGS = new Set(["-h", "--help", "-v", "--version"]);
const SELECTOR_FLAGS = new Set(["--unity-project", "--uos-project", "--uos-target"]);
const MATERIAL_DIR_FLAGS = new Set(["--uos-materials", "--uos-materials-dir"]);
const ATTACHMENT_FLAGS = new Set(["--uos-file", "--uos-attach"]);
const DRY_RUN_FLAGS = new Set(["--uos-dry-run", "--uos-preflight", "--uos-print-launch"]);
const UOS_ENTRY_COMMANDS = new Set(["chat", "enter", "tui"]);
const SMOKE_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const SMOKE_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const SMOKE_SCREEN_MATERIAL_EXTENSIONS = new Set([
  ...SMOKE_IMAGE_EXTENSIONS,
  ...SMOKE_VIDEO_EXTENSIONS,
  ".pdf",
  ".docx",
  ".pptx",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
]);
const SMOKE_OPTION_REQUIRES_VALUE = new Set([
  "--name",
  "--screen-name",
  "--scene",
  "--scene-path",
  "--import",
  "--import-asset",
  "--screen-from-material",
  "--material-screen",
  "--create-screen-from-material",
  "--scene-object-name",
  "--object-name",
  "--scene-object-type",
  "--object-type",
  "--material-mode",
  "--material-kind",
  "--pptx-mode",
  "--pptx-deck",
  "--deck-from-pptx",
  "--create-pptx-deck",
  "--slides",
  "--slide-numbers",
  "--deck-slides",
  "--first-slide",
  "--last-slide",
  "--max-slides",
  "--transition-prefix",
  "--page",
  "--page-number",
  "--slide",
  "--slide-number",
  "--image-number",
  "--asset-dir",
  "--output-dir",
  "--materials",
  "--materials-dir",
  "--material-depth",
  "--material-max-files",
  "--asset-path",
  "--compare",
  "--compare-reference",
  "--reference",
  "--verify",
  "--verify-reference",
  "--compare-output",
  "--compare-max-width",
  "--compare-max-height",
  "--compare-threshold",
  "--ai-model",
  "--ai-agent",
  "--ai-title",
  "--ai-timeout-ms",
  "--ai-feedback-iterations",
  "--feedback-iterations",
  "--ai-repair-iterations",
  "--ai-object-name",
  "--ai-prompt",
]);
const SMOKE_MATERIAL_IGNORE_DIRS = new Set([
  ".git", ".omx", ".opencode", ".uos",
  "Library", "Temp", "Obj", "Logs", "UserSettings",
  "node_modules", "Build", "Builds",
]);
const SMOKE_SCENE_OBJECT_TYPES = new Set([
  "Empty",
  "Cube",
  "Sphere",
  "Capsule",
  "Cylinder",
  "Plane",
  "Quad",
  "Camera",
  "PointLight",
  "DirectionalLight",
  "SpotLight",
]);
const REQUIRED_UOS_TOOLS = [
  "get_project_info",
  "get_uos_context",
  "select_uos_mode",
  "resolve_uos_context_target",
  "analyze_planning_materials",
  "list_planning_materials",
  "read_planning_material",
  "create_screen_from_material",
  "create_reference_screen_from_material",
  "extract_embedded_images",
  "create_docx_image_reference_screen",
  "draft_planning_intent_from_docx",
  "draft_planning_intent_from_document",
  "create_document_screen",
  "pdf_to_images",
  "create_pdf_page_reference_screen",
  "pptx_to_images",
  "extract_pptx_layout",
  "draft_planning_intent_from_pptx",
  "create_pptx_slide_screen",
  "create_pptx_deck_screens",
  "prepare_pptx_ui_draft",
  "create_image_reference_screen",
  "prepare_image_ui_draft",
  "preprocess_image",
  "import_asset",
  "get_scene_hierarchy",
  "get_scene_hierarchy_from_context",
  "create_scene_object",
  "list_scene_objects",
  "update_scene_object",
  "update_scene_object_from_context",
  "delete_scene_object",
  "delete_scene_object_from_context",
  "resolve_scene_object_from_context",
  "capture_preview",
  "capture_preview_from_context",
  "compare_images",
  "verify_screen_against_reference",
  "verify_screen_against_reference_from_context",
  "verify_screens_against_references_from_context",
  "inspect_screen_feedback_from_context",
  "list_screens",
  "validate_planning_intent",
  "create_ui_screen",
  "add_ui_element",
  "add_ui_element_from_context",
  "update_ui_element",
  "update_ui_element_from_context",
  "move_ui_element",
  "move_ui_element_from_context",
  "delete_ui_element",
  "delete_ui_element_from_context",
  "create_screen_transition",
  "create_screen_transition_from_context",
  "set_active_screen",
  "set_active_screen_from_context",
  "save_scene",
];
const BRIDGE_CAPABILITY_CONTRACT = loadBridgeCapabilityContract();
const REQUIRED_UNITY_BRIDGE_TOOLS = BRIDGE_CAPABILITY_CONTRACT.requiredTools;
const REQUIRED_UNITY_WRITE_TOOLS = BRIDGE_CAPABILITY_CONTRACT.requiredWriteTools;
const DEFAULT_MVP_VALIDATION_PROMPT = "Read the attached planning material, create one editable Unity UI screen, capture a preview, and summarize what changed.";
const UOS_HELP_TOPIC_ALIASES = new Map([
  ["chat", "entry"],
  ["enter", "entry"],
  ["entry", "entry"],
  ["mvp", "mvp"],
  ["validate-mvp", "mvp"],
  ["mvp-check", "mvp"],
  ["mvp-progress", "mvp-progress"],
  ["mvp-status", "mvp-progress"],
  ["mvp-evidence", "mvp-progress"],
  ["setup", "setup"],
  ["install-unity", "install-unity"],
  ["install-package", "install-unity"],
  ["doctor", "doctor"],
  ["ready", "ready"],
  ["wait", "wait"],
  ["projects", "projects"],
  ["list", "projects"],
  ["context", "context"],
  ["ctx", "context"],
  ["smoke", "smoke"],
  ["e2e", "e2e"],
]);

function loadBridgeCapabilityContract() {
  const contractPath = fileURLToPath(new URL("../bridge-capabilities.json", import.meta.url));
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(contractPath, "utf8"));
  } catch (err) {
    throw new Error(`[uos] failed to read bridge capability contract: ${err instanceof Error ? err.message : String(err)}`);
  }
  const requiredTools = normalizeContractToolList(parsed?.requiredTools, "requiredTools");
  const requiredWriteTools = normalizeContractToolList(parsed?.requiredWriteTools, "requiredWriteTools");
  return { requiredTools, requiredWriteTools };
}

function normalizeContractToolList(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`[uos] bridge capability contract field ${field} must be an array`);
  }
  const tools = value
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  if (tools.length !== value.length) {
    throw new Error(`[uos] bridge capability contract field ${field} contains invalid tool names`);
  }
  return [...new Set(tools)];
}

export function parseUosHelpTopic(argv = []) {
  const first = stringValue(argv[0]);
  if (first === undefined) return undefined;
  if (first === "--help" || first === "-h") return "main";
  if (first === "help") {
    const topic = stringValue(argv[1]);
    return topic !== undefined ? normalizeUosHelpTopic(topic) ?? topic : "main";
  }
  const second = stringValue(argv[1]);
  if ((second === "--help" || second === "-h") && UOS_HELP_TOPIC_ALIASES.has(first)) {
    return UOS_HELP_TOPIC_ALIASES.get(first);
  }
  return undefined;
}

export function formatUosHelp(topic = "main") {
  const canonicalTopic = normalizeUosHelpTopic(topic);
  if (topic !== "main" && canonicalTopic === undefined) {
    return [
      `[uos] unknown help topic: ${topic}`,
      "",
      formatUosMainHelp(),
    ].join("\n");
  }
  switch (canonicalTopic ?? "main") {
    case "setup":
      return [
        "Usage: uos setup",
        "",
        "Link this repository's opencode agent, tools, and plugins into the global opencode config.",
        "",
        "Options:",
        "  --unity-projects <dir>       Save the folder that contains user Unity projects",
        "  --language <code|name>       Save the default UOS response language",
        "  --no-install-dependencies    Skip npm install in the global opencode config directory",
        "",
        "Run this after a clean checkout or after changing local opencode resources.",
      ].join("\n");
    case "entry":
      return [
        "Usage: uos chat [options] [opencode TUI flags]",
        "       uos enter [options] [opencode TUI flags]",
        "       uos [options] [opencode TUI flags]",
        "",
        "Start an interactive opencode TUI session for one selected Unity Editor project.",
        "",
        "UOS selects a live Unity Editor bridge first. If several projects are connected,",
        "interactive terminals prompt for one; non-interactive runs must pass a selector.",
        "",
        "Common options:",
        "  --unity-project <selector>          Select by index, instance id, name, or path",
        "  --uos-wait                         Wait for the selected/first live bridge before entering",
        "  --uos-wait-timeout-ms <ms>         Bridge wait timeout",
        "  --uos-wait-interval-ms <ms>        Bridge polling interval",
        "  --uos-materials <dir>               Planning material root for images/docs/PPTX",
        "  --uos-file <file>                   Expose a planning file; text also attaches to `uos run --file`",
        "  --uos-dry-run                       Print selection, launch env, and forwarded opencode argv",
        "  --continue                          Resume the last opencode TUI session with UOS context re-grounding",
        "  --session <id>                      Resume one opencode session with UOS context re-grounding",
        "",
        "Examples:",
        "  uos chat",
        "  uos chat --uos-wait --uos-wait-timeout-ms 60000",
        "  uos enter --unity-project MyGame --uos-materials ./Plans",
        "  uos chat --unity-project MyGame --continue",
        "  uos chat --model anthropic/claude-haiku-4-5",
      ].join("\n");
    case "mvp":
      return [
        "Usage: uos mvp [options]",
        "       uos validate-mvp [options]",
        "",
        "Run a read-only MVP validation preflight for one selected Unity Editor project.",
        "",
        "This checks launch inputs, selected bridge capability metadata, then prints",
        "the exact commands and acceptance evidence gates for the user-led MVP",
        "walkthrough without starting opencode.",
        "",
        "Options:",
        "  --unity-project <selector>          Select a live project by index, id, name, or path",
        "  --wait | --uos-wait                 Wait for the selected/first live bridge before checking",
        "  --wait-timeout-ms <ms>              Bridge wait timeout",
        "  --wait-interval-ms <ms>             Bridge polling interval",
        "  --uos-materials <dir>               Planning material directory",
        "  --uos-file <file>                   Launch-attached image/document/PPTX planning file",
        "  --prompt <text>                     Prompt used in the suggested AI edit command",
        "  --json                              Print token-redacted commands and acceptance gates",
        "  --save <file>                       Save the token-redacted JSON evidence bundle",
        "  --max-material-candidates <N>       Bound material candidates in launch context",
        "  --max-material-depth <N>            Bound material scan depth",
        "  --max-material-scan-files <N>       Bound material scan file count",
        "",
        "Example:",
        "  uos mvp --wait --unity-project MyGame --uos-materials D:/Plans --uos-file D:/Plans/lobby.pptx",
      ].join("\n");
    case "mvp-progress":
      return [
        "Usage: uos mvp-progress [evidence-file] [options]",
        "       uos mvp-status [evidence-file] [options]",
        "",
        "Read a token-redacted `uos mvp --save` evidence bundle and print the",
        "automatic preflight state plus pending user-led MVP evidence gates.",
        "",
        "Options:",
        "  --file <file>                       Evidence JSON path; defaults to .uos/mvp-evidence.json",
        "  --json                              Print machine-readable progress summary",
        "",
        "Example:",
        "  uos mvp-progress .uos/mvp-evidence.json",
      ].join("\n");
    case "install-unity":
      return [
        "Usage: uos install-unity <UnityProjectPath> [options]",
        "",
        "Embed the UOS Unity package into a Unity project's Packages folder.",
        "This is the default share-safe install mode; the project can move to another PC without a local UOS path.",
        "",
        "Options:",
        "  --project <path>            Unity project root",
        "  --unity-project <path>      Alias for --project",
        "  --package <path>            Local package path to embed; defaults to this UOS repo package",
        "  --manifest-link             Developer mode: write a manifest dependency instead of embedding",
        "  --no-embed                  Alias for --manifest-link",
        "  --embed                     Explicitly use the default embedded install mode",
        "  --force                     Re-copy an embedded package when it already exists",
        "  --dry-run                   Show the install change without writing it",
      ].join("\n");
    case "doctor":
      return [
        "Usage: uos doctor [options]",
        "",
        "Diagnose local dependencies, opencode resources, registry entries, and bridge readiness.",
        "",
        "Options:",
        "  --project <path>            Inspect a Unity project's UOS package install state",
        "  --clean-stale               Remove stale local Unity Editor registry entries",
        "  --runtime                   Check resolved opencode config and handoff flags",
        "  --runtime-timeout-ms <ms>   Timeout for runtime checks",
      ].join("\n");
    case "ready":
      return [
        "Usage: uos ready [options]",
        "",
        "Run the AI-session readiness gate. Exits 0 only when opencode and at least one selected Unity bridge are ready.",
        "",
        "Options:",
        "  --wait                      Wait for a live Unity Editor bridge before checking readiness",
        "  --unity-project <selector>  Select a live project by index, id, name, or path",
        "  --uos-target <selector>     Alias for --unity-project and implies --wait",
        "  --wait-timeout-ms <ms>      Bridge wait timeout",
        "  --wait-interval-ms <ms>     Bridge polling interval",
        "  --clean-stale               Remove stale registry entries before final readiness output",
        "  --runtime-timeout-ms <ms>   Timeout for opencode runtime checks",
      ].join("\n");
    case "wait":
      return [
        "Usage: uos wait [selector] [options]",
        "",
        "Wait until a Unity Editor bridge is live in the local registry.",
        "",
        "Options:",
        "  --unity-project <selector>  Select by index, id, name, or path",
        "  --timeout-ms <ms>           Wait timeout",
        "  --interval-ms <ms>          Polling interval",
        "  --json                      Print token-redacted machine-readable output",
      ].join("\n");
    case "projects":
      return [
        "Usage: uos projects [--json]",
        "",
        "List live Unity Editor projects discovered on this machine.",
        "",
        "The JSON form intentionally omits bridge tokens and includes selector candidates for scripts.",
      ].join("\n");
    case "context":
      return [
        "Usage: uos context [options]",
        "",
        "Print selected project, material, launch, and persisted .uos context without starting opencode.",
        "",
        "Options:",
        "  --unity-project <selector>          Select a live project",
        "  --uos-materials <dir>               Planning material directory",
        "  --uos-file <file>                   Launch-attached planning material file",
        "                                      Text files can attach to `uos run --file`; binary/visual files use UOS tools",
        "  --json                              Print machine-readable context",
        "  --max-chars <N>                     Bound persisted context text",
        "  --max-material-candidates <N>       Bound material candidates in launch context",
        "  --max-material-depth <N>            Bound material scan depth",
        "  --max-material-scan-files <N>       Bound material scan file count",
      ].join("\n");
    case "smoke":
      return [
        "Usage: uos smoke --unity-project <selector> [options]",
        "",
        "Verify a selected Unity bridge and optionally exercise write, material, AI, preview, and context follow-up paths.",
        "",
        "Common options:",
        "  --write --preview --save            Create a direct sample UI screen and optionally save",
        "  --context-follow-up                 Verify persisted-context follow-up edits",
        "  --screen-from-material <file>       Create a screen from image/video/PDF/DOCX/PPTX/text material",
        "  --screen-from-first-material        Route the first supported material from --uos-materials",
        "  --pptx-deck <file>                  Create a multi-screen PPTX flow",
        "  --ai-run | --ai-only                Verify opencode AI can call UOS tools",
        "  --ai-follow-up                      Verify opencode AI can edit an existing screen from .uos context",
        "  --ai-only --ai-follow-up            Run AI material creation, then opencode run --continue follow-up",
        "  --ai-feedback-iterations <N>        Re-run visual feedback repairs while verification remains different",
        "  --scene-object                      Verify non-UI scene object editing",
        "  --compare <image> | --verify <ref>  Capture and compare/record screen verification",
      ].join("\n");
    case "e2e":
      return [
        "Usage: uos e2e --project <UnityProjectPath> [options]",
        "",
        "Launch Unity batchmode, wait for the UOS bridge, run smoke, stop Unity, and clean stale registry entries.",
        "",
        "Options:",
        "  --unity <Unity.exe>                 Unity executable path",
        "  --selector <selector>               Select the launched project",
        "  --secondary-project <path>          Launch an additional project for multi-editor selection checks",
        "  --timeout-ms <ms>                   Bridge wait timeout",
        "  --stop-timeout-ms <ms>              Unity stop timeout",
        "  --log-file <path>                   Unity Editor log path",
        "  --keep-open                         Leave Unity running after smoke",
        "  --graphics | --headless             Control Unity batchmode graphics flags",
        "  --entry-dry-run                     Also verify selected-project UOS chat launch forwarding",
        "  --post-smoke-entry-dry-run          Verify UOS chat launch context again after smoke mutation",
        "  --public-smoke                      Also run the public `uos smoke` CLI against the selected bridge",
        "  --public-mvp | --public-mvp-json     Also verify public `uos mvp` preflight command generation",
        "  --public-chat-dry-run               Also verify public `uos chat` launch forwarding",
        "  --public-run-dry-run                Also verify public `uos run --continue` launch forwarding",
        "  --public-run-ai                     Also verify public `uos run` can perform an AI material edit",
        "  --uos-materials <dir>               Material root for --entry-dry-run launch context",
        "  --uos-file <file>                   Material file for --entry-dry-run launch context",
        "                                      Text files can attach to `uos run --file`; binary/visual files use UOS tools",
        "  ...                                 Smoke options are accepted after e2e options",
      ].join("\n");
    default:
      return formatUosMainHelp();
  }
}

function normalizeUosHelpTopic(topic) {
  const key = stringValue(topic);
  if (key === undefined || key === "main") return "main";
  return UOS_HELP_TOPIC_ALIASES.get(key);
}

function formatUosMainHelp() {
  return [
    "UOS (Unity Orchestration System)",
    "",
    "Usage:",
    "  uos [gui options]",
    "  uos <command> [options]",
    "",
    "Default entry:",
    "  uos                                  Open the local browser GUI workbench",
    "  uos gui --port 0                     Open the local browser GUI workbench",
    "  uos chat                             Start opencode TUI for a selected Unity Editor project",
    "  uos tui                              Same as `uos chat`",
    "  uos enter --unity-project MyGame     Deterministically enter one selected project",
    "  uos mvp --unity-project MyGame       Print a user-led MVP validation walkthrough",
    "  uos mvp-progress .uos/mvp-evidence.json",
    "  uos --unity-project MyGame           Select a live project deterministically",
    "  uos --uos-materials ./Plans run \"create the lobby UI from this deck\"",
    "",
    "UOS commands:",
    "  gui                                  Open the browser GUI workbench",
    "  chat | enter | tui                   Select a Unity project and start opencode TUI",
    "  mvp | validate-mvp                   Print a read-only MVP validation preflight",
    "  mvp-progress | mvp-status            Show progress from a saved MVP evidence bundle",
    "  setup                                Link local opencode resources",
    "  install-unity                        Install the UOS Unity package into a project",
    "  doctor                               Diagnose dependencies, registry, and bridge state",
    "  ready                                Check whether an AI editing session can start",
    "  wait                                 Wait for a live Unity Editor bridge",
    "  projects                             List live Unity Editor projects",
    "  context                              Print selected project/material/.uos context",
    "  smoke                                Verify bridge, AI, material, preview, and edit paths",
    "  e2e                                  Launch Unity, run smoke, then stop Unity",
    "",
    "Selector and material flags:",
    "  --unity-project <index|id|name|path> Select a connected Unity Editor project",
    "  --uos-wait                           Wait for a live bridge before selecting",
    "  --uos-materials <dir>                Planning material root for images/docs/PPTX",
    "  --uos-file <file>                    Attach planning material; text also attaches to `uos run --file`",
    "                                       Binary/visual files stay available through UOS tools",
    "  --uos-dry-run                        Print selected target, forwarded argv, and env",
    "",
    "opencode passthrough:",
    "  uos run --help                       Show opencode run help",
    "  uos models                           List opencode models without Unity selection",
    "  uos --version                        Show opencode version",
    "",
    "Run `uos help <command>` or `uos <command> --help` for UOS command-specific help.",
  ].join("\n");
}

export function normalizeUosEntryArgs(argv = []) {
  const first = stringValue(argv[0]);
  if (first !== undefined && UOS_ENTRY_COMMANDS.has(first)) return argv.slice(1);
  return argv;
}

export function parseUosArgs(argv) {
  const opencodeArgs = [];
  let selector;
  let materialsDir;
  let maxMaterialCandidates;
  let maxMaterialDepth;
  let maxMaterialScanFiles;
  let dryRun = false;
  let wait = false;
  let waitTimeoutMs;
  let waitIntervalMs;
  const files = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      opencodeArgs.push(...argv.slice(i + 1));
      break;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (SELECTOR_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a project selector`);
      }
      selector = value.trim();
      continue;
    }
    if (MATERIAL_DIR_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a planning material directory`);
      }
      materialsDir = value.trim();
      continue;
    }
    if (ATTACHMENT_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a file path`);
      }
      files.push(value.trim());
      continue;
    }
    if (key === "--uos-max-material-candidates") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      maxMaterialCandidates = parseBoundedInt(value, key, 0, 50);
      continue;
    }
    if (key === "--uos-max-material-depth") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      maxMaterialDepth = parseBoundedInt(value, key, 0, 20);
      continue;
    }
    if (key === "--uos-max-material-scan-files") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      maxMaterialScanFiles = parseBoundedInt(value, key, 1, 5000);
      continue;
    }
    if (DRY_RUN_FLAGS.has(key)) {
      dryRun = true;
      continue;
    }
    if (key === "--uos-wait") {
      wait = true;
      continue;
    }
    if (key === "--uos-wait-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      wait = true;
      waitTimeoutMs = parseBoundedInt(value, key, 1_000, 600_000);
      continue;
    }
    if (key === "--uos-wait-interval-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      wait = true;
      waitIntervalMs = parseBoundedInt(value, key, 100, 30_000);
      continue;
    }

    opencodeArgs.push(arg);
  }

  const parsed = { opencodeArgs, selector, materialsDir, files, dryRun };
  if (wait) parsed.wait = true;
  if (waitTimeoutMs !== undefined) parsed.waitTimeoutMs = waitTimeoutMs;
  if (waitIntervalMs !== undefined) parsed.waitIntervalMs = waitIntervalMs;
  if (maxMaterialCandidates !== undefined) parsed.maxMaterialCandidates = maxMaterialCandidates;
  if (maxMaterialDepth !== undefined) parsed.maxMaterialDepth = maxMaterialDepth;
  if (maxMaterialScanFiles !== undefined) parsed.maxMaterialScanFiles = maxMaterialScanFiles;
  return parsed;
}

export function shouldSelectUnityTarget(argv, env = process.env, options = {}) {
  if (env.UOS_SKIP_PROJECT_SELECT === "1") return false;
  const first = argv[0] ?? "";
  if (["--help", "-h", "help", "projects", "list", "doctor", "context", "ctx"].includes(first)) {
    return false;
  }
  if (isOpencodeTargetlessCommandArgs(argv)) return false;
  const selector = stringValue(options.selector) ?? selectorFromEnv(env);
  if (selector !== undefined) return true;
  if (env.UNITY_MCP_HOST && env.UNITY_MCP_PORT && env.UNITY_MCP_TOKEN) {
    return false;
  }
  return true;
}

export function shouldSelectUnityContextTarget(selector, env = process.env) {
  if (env.UOS_SKIP_PROJECT_SELECT === "1") return false;
  const resolvedSelector = stringValue(selector) ?? selectorFromEnv(env);
  if (resolvedSelector !== undefined) return true;
  return !hasExplicitBridgeEnv(env);
}

export function parseSmokeOptions(argv) {
  const options = {
    write: false,
    preview: false,
    save: false,
    revise: false,
    flow: false,
    contextFollowUp: false,
    sceneObjectRoundTrip: false,
    sceneObjectName: undefined,
    sceneObjectType: undefined,
    screenName: "UOSSmokeScreen",
    scenePath: undefined,
    importPath: undefined,
    materialScreenPath: undefined,
    materialScreenFromMaterials: false,
    materialScreenMode: undefined,
    materialScreenKind: undefined,
    materialScreenPptxMode: undefined,
    materialScreenPageNumber: undefined,
    materialScreenSlideNumber: undefined,
    materialScreenImageNumber: undefined,
    materialScreenAssetDir: undefined,
    materialScreenOutputDir: undefined,
    pptxDeckPath: undefined,
    pptxDeckSlideNumbers: undefined,
    pptxDeckFirstSlide: undefined,
    pptxDeckLastSlide: undefined,
    pptxDeckMaxSlides: undefined,
    pptxDeckCreateTransitions: true,
    pptxDeckActivateFirst: true,
    pptxDeckTransitionTriggerPrefix: undefined,
    pptxDeckIncludeShapePanels: undefined,
    materialsDir: undefined,
    materialDepth: 4,
    materialMaxFiles: 500,
    assetPath: undefined,
    importAsSprite: true,
    comparePath: undefined,
    verifyPath: undefined,
    compareOutputPath: undefined,
    compareMaxWidth: 1024,
    compareMaxHeight: 1024,
    compareThreshold: 0.05,
    aiRun: false,
    aiOnly: false,
    aiFollowUp: false,
    aiRunModel: undefined,
    aiRunAgent: undefined,
    aiRunTitle: undefined,
    aiRunTimeoutMs: DEFAULT_OPENCODE_AI_SMOKE_TIMEOUT_MS,
    aiFeedbackIterations: 1,
    aiRunObjectName: undefined,
    aiRunPrompt: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--preview") {
      options.preview = true;
      continue;
    }
    if (arg === "--save") {
      options.save = true;
      continue;
    }
    if (arg === "--revise" || arg === "--edit") {
      options.revise = true;
      options.write = true;
      continue;
    }
    if (arg === "--flow" || arg === "--transition") {
      options.flow = true;
      options.write = true;
      continue;
    }
    if (arg === "--context-follow-up" || arg === "--follow-up" || arg === "--context-edit") {
      options.contextFollowUp = true;
      options.write = true;
      continue;
    }
    if (arg === "--scene-object" || arg === "--scene-object-round-trip" || arg === "--object-round-trip") {
      options.sceneObjectRoundTrip = true;
      options.write = true;
      continue;
    }
    if (arg === "--ai-run" || arg === "--ai-smoke" || arg === "--opencode-run" || arg === "--opencode-ai-smoke") {
      options.aiRun = true;
      continue;
    }
    if (arg === "--ai-only" || arg === "--ai-run-only" || arg === "--opencode-only" || arg === "--opencode-ai-only") {
      options.aiRun = true;
      options.aiOnly = true;
      continue;
    }
    if (arg === "--ai-follow-up" || arg === "--ai-context-follow-up" || arg === "--opencode-follow-up") {
      options.aiRun = true;
      options.aiFollowUp = true;
      options.write = true;
      continue;
    }
    if (arg === "--no-sprite") {
      options.importAsSprite = false;
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (key === "--name" || key === "--screen-name") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a screen name`);
      }
      options.screenName = value.trim();
      continue;
    }
    if (key === "--scene-object-name" || key === "--object-name") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a scene object name`);
      }
      options.sceneObjectName = value.trim();
      options.sceneObjectRoundTrip = true;
      options.write = true;
      continue;
    }
    if (key === "--scene-object-type" || key === "--object-type") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      const type = value?.trim();
      if (type === undefined || !SMOKE_SCENE_OBJECT_TYPES.has(type)) {
        throw new Error(`[uos] ${key} requires one of ${[...SMOKE_SCENE_OBJECT_TYPES].join(", ")}`);
      }
      options.sceneObjectType = type;
      options.sceneObjectRoundTrip = true;
      options.write = true;
      continue;
    }
    if (key === "--scene" || key === "--scene-path") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity scene path`);
      }
      options.scenePath = value.trim();
      continue;
    }
    if (key === "--import" || key === "--import-asset") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a local source file path`);
      }
      options.importPath = value.trim();
      options.write = true;
      continue;
    }
    if (key === "--screen-from-material" || key === "--material-screen" || key === "--create-screen-from-material") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a planning material file path`);
      }
      options.materialScreenPath = value.trim();
      options.write = true;
      continue;
    }
    if (arg === "--screen-from-first-material" || arg === "--first-material-screen" || arg === "--auto-material-screen") {
      options.materialScreenFromMaterials = true;
      options.write = true;
      continue;
    }
    if (key === "--material-mode") {
      const value = (eq > 0 ? arg.slice(eq + 1) : argv[++i])?.trim();
      if (!["auto", "editable", "reference"].includes(value ?? "")) {
        throw new Error("[uos] --material-mode requires one of auto, editable, reference");
      }
      options.materialScreenMode = value;
      continue;
    }
    if (key === "--material-kind") {
      const value = (eq > 0 ? arg.slice(eq + 1) : argv[++i])?.trim();
      if (!["image", "pdf", "docx", "pptx", "document"].includes(value ?? "")) {
        throw new Error("[uos] --material-kind requires one of image, pdf, docx, pptx, document");
      }
      options.materialScreenKind = value;
      continue;
    }
    if (key === "--pptx-mode") {
      const value = (eq > 0 ? arg.slice(eq + 1) : argv[++i])?.trim();
      if (!["editable", "rendered"].includes(value ?? "")) {
        throw new Error("[uos] --pptx-mode requires one of editable, rendered");
      }
      options.materialScreenPptxMode = value;
      continue;
    }
    if (key === "--pptx-deck" || key === "--deck-from-pptx" || key === "--create-pptx-deck") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a PPTX file path`);
      }
      options.pptxDeckPath = value.trim();
      options.write = true;
      continue;
    }
    if (key === "--slides" || key === "--slide-numbers" || key === "--deck-slides") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.pptxDeckSlideNumbers = parseSlideNumberList(value, key);
      continue;
    }
    if (key === "--first-slide") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.pptxDeckFirstSlide = parseBoundedInt(value, key, 1, 10_000);
      continue;
    }
    if (key === "--last-slide") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.pptxDeckLastSlide = parseBoundedInt(value, key, 1, 10_000);
      continue;
    }
    if (key === "--max-slides") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.pptxDeckMaxSlides = parseBoundedInt(value, key, 1, 200);
      continue;
    }
    if (arg === "--deck-transitions") {
      options.pptxDeckCreateTransitions = true;
      continue;
    }
    if (arg === "--no-deck-transitions") {
      options.pptxDeckCreateTransitions = false;
      continue;
    }
    if (arg === "--activate-first") {
      options.pptxDeckActivateFirst = true;
      continue;
    }
    if (arg === "--no-activate-first") {
      options.pptxDeckActivateFirst = false;
      continue;
    }
    if (arg === "--include-shape-panels" || arg === "--pptx-shape-panels") {
      options.pptxDeckIncludeShapePanels = true;
      continue;
    }
    if (arg === "--no-shape-panels" || arg === "--no-pptx-shape-panels") {
      options.pptxDeckIncludeShapePanels = false;
      continue;
    }
    if (key === "--transition-prefix") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --transition-prefix requires a non-empty trigger prefix");
      }
      options.pptxDeckTransitionTriggerPrefix = value.trim();
      continue;
    }
    if (key === "--page" || key === "--page-number") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.materialScreenPageNumber = parseBoundedInt(value, key, 1, 10_000);
      continue;
    }
    if (key === "--slide" || key === "--slide-number") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.materialScreenSlideNumber = parseBoundedInt(value, key, 1, 10_000);
      continue;
    }
    if (key === "--image-number") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.materialScreenImageNumber = parseBoundedInt(value, key, 1, 10_000);
      continue;
    }
    if (key === "--asset-dir") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --asset-dir requires a Unity Assets/... directory");
      }
      options.materialScreenAssetDir = value.trim();
      continue;
    }
    if (key === "--output-dir") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --output-dir requires a local output directory");
      }
      options.materialScreenOutputDir = value.trim();
      continue;
    }
    if (key === "--materials" || key === "--materials-dir") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a material directory path`);
      }
      options.materialsDir = value.trim();
      options.write = true;
      continue;
    }
    if (key === "--material-depth") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      const n = Number.parseInt(value ?? "", 10);
      if (!Number.isInteger(n) || n < 0 || n > 20) {
        throw new Error(`[uos] ${key} requires an integer from 0 to 20`);
      }
      options.materialDepth = n;
      continue;
    }
    if (key === "--material-max-files") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      const n = Number.parseInt(value ?? "", 10);
      if (!Number.isInteger(n) || n <= 0 || n > 5000) {
        throw new Error(`[uos] ${key} requires an integer from 1 to 5000`);
      }
      options.materialMaxFiles = n;
      continue;
    }
    if (key === "--asset-path") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity Assets/... path`);
      }
      options.assetPath = value.trim();
      continue;
    }
    if (key === "--compare" || key === "--compare-reference" || key === "--reference") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a reference image path`);
      }
      options.comparePath = value.trim();
      options.write = true;
      options.preview = true;
      continue;
    }
    if (key === "--verify" || key === "--verify-reference") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a reference image path`);
      }
      options.verifyPath = value.trim();
      options.write = true;
      options.preview = true;
      continue;
    }
    if (key === "--compare-output") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a diff output path`);
      }
      options.compareOutputPath = value.trim();
      continue;
    }
    if (key === "--compare-max-width") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.compareMaxWidth = parseBoundedInt(value, key, 1, 4096);
      continue;
    }
    if (key === "--compare-max-height") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.compareMaxHeight = parseBoundedInt(value, key, 1, 4096);
      continue;
    }
    if (key === "--compare-threshold") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      const threshold = Number.parseFloat(value ?? "");
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`[uos] ${key} requires a number from 0 to 1`);
      }
      options.compareThreshold = threshold;
      continue;
    }
    if (key === "--ai-model") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --ai-model requires an opencode model id");
      }
      options.aiRunModel = value.trim();
      options.aiRun = true;
      continue;
    }
    if (key === "--ai-agent") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --ai-agent requires an opencode agent name");
      }
      if (value.trim() !== DEFAULT_UOS_AGENT) {
        throw new Error("[uos] UOS AI smoke sessions only support --ai-agent ochestrator; internal submodels are selected by the Ochestrator");
      }
      options.aiRunAgent = DEFAULT_UOS_AGENT;
      options.aiRun = true;
      continue;
    }
    if (key === "--ai-title") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --ai-title requires a run title");
      }
      options.aiRunTitle = value.trim();
      options.aiRun = true;
      continue;
    }
    if (key === "--ai-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.aiRunTimeoutMs = parseBoundedInt(value, key, 10_000, 600_000);
      options.aiRun = true;
      continue;
    }
    if (key === "--ai-feedback-iterations" || key === "--feedback-iterations" || key === "--ai-repair-iterations") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.aiFeedbackIterations = parseBoundedInt(value, key, 1, 5);
      options.aiRun = true;
      options.aiFollowUp = true;
      options.write = true;
      continue;
    }
    if (key === "--ai-object-name") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --ai-object-name requires a scene object name");
      }
      options.aiRunObjectName = value.trim();
      options.aiRun = true;
      continue;
    }
    if (key === "--ai-prompt") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error("[uos] --ai-prompt requires prompt text");
      }
      options.aiRunPrompt = value.trim();
      options.aiRun = true;
      continue;
    }

    throw new Error(`[uos] unknown smoke option: ${arg}`);
  }

  if (options.importPath !== undefined && options.materialsDir !== undefined) {
    throw new Error("[uos] use either --import or --materials, not both");
  }
  if (options.importPath !== undefined && options.materialScreenPath !== undefined) {
    throw new Error("[uos] use either --import or --screen-from-material, not both");
  }
  if (options.importPath !== undefined && options.materialScreenFromMaterials === true) {
    throw new Error("[uos] use either --import or --screen-from-first-material, not both");
  }
  if (options.importPath !== undefined && options.pptxDeckPath !== undefined) {
    throw new Error("[uos] use either --import or --pptx-deck, not both");
  }
  if (options.materialScreenPath !== undefined && options.pptxDeckPath !== undefined) {
    throw new Error("[uos] use either --screen-from-material or --pptx-deck, not both");
  }
  if (options.materialScreenFromMaterials === true && options.materialScreenPath !== undefined) {
    throw new Error("[uos] use either --screen-from-material or --screen-from-first-material, not both");
  }
  if (options.materialScreenFromMaterials === true && options.pptxDeckPath !== undefined) {
    throw new Error("[uos] use either --screen-from-first-material or --pptx-deck, not both");
  }
  if (options.materialScreenPath !== undefined && (options.revise === true || options.flow === true)) {
    throw new Error("[uos] --screen-from-material cannot be combined with --revise or --flow");
  }
  if (options.materialScreenFromMaterials === true && (options.revise === true || options.flow === true)) {
    throw new Error("[uos] --screen-from-first-material cannot be combined with --revise or --flow");
  }
  if (options.pptxDeckPath !== undefined && options.revise === true) {
    throw new Error("[uos] --pptx-deck cannot be combined with --revise");
  }
  if (options.sceneObjectRoundTrip === true) {
    if (
      options.importPath !== undefined
      || options.materialsDir !== undefined
      || options.materialScreenPath !== undefined
      || options.materialScreenFromMaterials === true
      || options.pptxDeckPath !== undefined
    ) {
      throw new Error("[uos] --scene-object cannot be combined with material, import, or deck smoke options");
    }
    if (options.revise === true || options.flow === true || options.contextFollowUp === true || options.aiFollowUp === true) {
      throw new Error("[uos] --scene-object cannot be combined with --revise, --flow, --context-follow-up, or --ai-follow-up");
    }
    if (options.comparePath !== undefined || options.verifyPath !== undefined) {
      throw new Error("[uos] --scene-object cannot be combined with --compare or --verify");
    }
  }
  if (options.comparePath !== undefined && options.verifyPath !== undefined) {
    throw new Error("[uos] use either --compare or --verify, not both");
  }
  if (options.aiOnly === true) {
    const aiOnlyFollowUpMaterialConversation = options.aiFollowUp === true && hasAiOnlyFollowUpMaterialTarget(options);
    if (
      options.save === true
      || options.revise === true
      || options.flow === true
      || options.contextFollowUp === true
    ) {
      throw new Error("[uos] --ai-only cannot be combined with save, revise, flow, or context follow-up smoke options");
    }
    if (options.aiFollowUp === true && !aiOnlyFollowUpMaterialConversation) {
      throw new Error("[uos] --ai-only --ai-follow-up requires --screen-from-material, --screen-from-first-material, or --pptx-deck");
    }
    if (
      (options.preview === true || options.comparePath !== undefined || options.verifyPath !== undefined)
      && options.materialScreenPath === undefined
      && options.materialScreenFromMaterials !== true
      && options.pptxDeckPath === undefined
    ) {
      throw new Error("[uos] --ai-only preview/compare/verify requires --screen-from-material, --screen-from-first-material, or --pptx-deck");
    }
    if (options.importPath !== undefined) {
      throw new Error("[uos] --ai-only cannot be combined with --import; attach a material with --screen-from-material instead");
    }
    if (
      options.materialsDir !== undefined
      && options.materialScreenFromMaterials !== true
      && options.materialScreenPath === undefined
      && options.pptxDeckPath === undefined
    ) {
      throw new Error("[uos] --ai-only with --materials requires --screen-from-first-material, --screen-from-material, or --pptx-deck");
    }
  }

  return options;
}

function hasAiOnlyFollowUpMaterialTarget(options = {}) {
  return options.materialScreenPath !== undefined
    || options.materialScreenFromMaterials === true
    || options.pptxDeckPath !== undefined;
}

function parseSlideNumberList(value, key) {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`[uos] ${key} requires comma-separated slide numbers`);
  }
  const numbers = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => parseBoundedInt(part, key, 1, 10_000));
  if (numbers.length === 0) {
    throw new Error(`[uos] ${key} requires at least one slide number`);
  }
  return [...new Set(numbers)];
}

export function parseDoctorOptions(argv) {
  const options = {
    cleanStale: false,
    runtime: false,
    runtimeTimeoutMs: 45_000,
    projectPath: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--clean-stale") {
      options.cleanStale = true;
      continue;
    }
    if (arg === "--runtime" || arg === "--opencode-runtime") {
      options.runtime = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (key === "--project" || key === "--unity-project" || key === "--project-path") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity project path`);
      }
      options.projectPath = value.trim();
      continue;
    }
    if (key === "--runtime-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      const n = Number.parseInt(value ?? "", 10);
      if (!Number.isInteger(n) || n < 1_000 || n > 180_000) {
        throw new Error("[uos] --runtime-timeout-ms requires an integer from 1000 to 180000");
      }
      options.runtime = true;
      options.runtimeTimeoutMs = n;
      continue;
    }
    throw new Error(`[uos] unknown doctor option: ${arg}`);
  }
  return options;
}

export function parseProjectsOptions(argv) {
  const options = { json: false };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`[uos] unknown projects option: ${arg}`);
  }
  return options;
}

export function parseContextOptions(argv) {
  const forwarded = [];
  const options = {
    json: false,
    maxChars: undefined,
    maxMaterialCandidates: undefined,
    maxMaterialDepth: undefined,
    maxMaterialScanFiles: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (key === "--json") {
      options.json = true;
      continue;
    }
    if (key === "--max-chars") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxChars = parseBoundedInt(value, "--max-chars", 500, 50_000);
      continue;
    }
    if (key === "--max-material-candidates") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxMaterialCandidates = parseBoundedInt(value, "--max-material-candidates", 0, 50);
      continue;
    }
    if (key === "--max-material-depth") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxMaterialDepth = parseBoundedInt(value, "--max-material-depth", 0, 20);
      continue;
    }
    if (key === "--max-material-scan-files") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxMaterialScanFiles = parseBoundedInt(value, "--max-material-scan-files", 1, 5000);
      continue;
    }
    forwarded.push(arg);
  }

  const parsed = parseUosArgs(forwarded);
  if (parsed.opencodeArgs.length > 0) {
    throw new Error(`[uos] unknown context option: ${parsed.opencodeArgs[0]}`);
  }
  return {
    selector: parsed.selector,
    materialsDir: parsed.materialsDir,
    files: parsed.files,
    json: options.json,
    maxChars: options.maxChars,
    maxMaterialCandidates: options.maxMaterialCandidates,
    maxMaterialDepth: options.maxMaterialDepth,
    maxMaterialScanFiles: options.maxMaterialScanFiles,
  };
}

export function parseMvpOptions(argv) {
  const forwarded = [];
  const options = {
    json: false,
    wait: false,
    waitTimeoutMs: 60_000,
    waitIntervalMs: 1_000,
    prompt: DEFAULT_MVP_VALIDATION_PROMPT,
    savePath: undefined,
    maxMaterialCandidates: undefined,
    maxMaterialDepth: undefined,
    maxMaterialScanFiles: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (key === "--json") {
      options.json = true;
      continue;
    }
    if (key === "--wait" || key === "--uos-wait") {
      options.wait = true;
      continue;
    }
    if (key === "--wait-timeout-ms" || key === "--uos-wait-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.wait = true;
      options.waitTimeoutMs = parseBoundedInt(value, key, 1_000, 600_000);
      continue;
    }
    if (key === "--wait-interval-ms" || key === "--uos-wait-interval-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.wait = true;
      options.waitIntervalMs = parseBoundedInt(value, key, 100, 30_000);
      continue;
    }
    if (key === "--prompt" || key === "--public-run-prompt") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a prompt`);
      }
      options.prompt = value.trim();
      continue;
    }
    if (key === "--save" || key === "--output" || key === "--evidence-out" || key === "--evidence-file") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires an output file path`);
      }
      options.savePath = value.trim();
      continue;
    }
    if (key === "--max-material-candidates") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxMaterialCandidates = parseBoundedInt(value, "--max-material-candidates", 0, 50);
      continue;
    }
    if (key === "--max-material-depth") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxMaterialDepth = parseBoundedInt(value, "--max-material-depth", 0, 20);
      continue;
    }
    if (key === "--max-material-scan-files") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.maxMaterialScanFiles = parseBoundedInt(value, "--max-material-scan-files", 1, 5000);
      continue;
    }
    forwarded.push(arg);
  }

  const parsed = parseUosArgs(forwarded);
  if (parsed.opencodeArgs.length > 0) {
    throw new Error(`[uos] unknown mvp option: ${parsed.opencodeArgs[0]}`);
  }
  return {
    selector: parsed.selector,
    materialsDir: parsed.materialsDir,
    files: parsed.files,
    json: options.json,
    wait: options.wait || parsed.wait,
    waitTimeoutMs: parsed.waitTimeoutMs ?? options.waitTimeoutMs,
    waitIntervalMs: parsed.waitIntervalMs ?? options.waitIntervalMs,
    prompt: options.prompt,
    savePath: options.savePath,
    maxMaterialCandidates: parsed.maxMaterialCandidates ?? options.maxMaterialCandidates,
    maxMaterialDepth: parsed.maxMaterialDepth ?? options.maxMaterialDepth,
    maxMaterialScanFiles: parsed.maxMaterialScanFiles ?? options.maxMaterialScanFiles,
  };
}

export function parseMvpProgressOptions(argv = []) {
  const options = {
    evidencePath: undefined,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (key === "--json") {
      options.json = true;
      continue;
    }
    if (key === "--file" || key === "--evidence" || key === "--input" || key === "--from") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires an evidence file path`);
      }
      if (options.evidencePath !== undefined) {
        throw new Error(`[uos] mvp-progress received multiple evidence file paths: ${options.evidencePath}, ${value.trim()}`);
      }
      options.evidencePath = value.trim();
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`[uos] unknown mvp-progress option: ${arg}`);
    }
    if (options.evidencePath !== undefined) {
      throw new Error(`[uos] mvp-progress received multiple evidence file paths: ${options.evidencePath}, ${arg}`);
    }
    options.evidencePath = arg;
  }
  return {
    evidencePath: options.evidencePath ?? path.join(".uos", "mvp-evidence.json"),
    json: options.json,
  };
}

export function parseReadyOptions(argv) {
  const options = {
    cleanStale: false,
    runtimeTimeoutMs: 45_000,
    wait: false,
    waitSelector: undefined,
    waitTimeoutMs: 60_000,
    waitIntervalMs: 1_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--clean-stale") {
      options.cleanStale = true;
      continue;
    }
    if (arg === "--wait") {
      options.wait = true;
      continue;
    }
    if (arg === "--runtime" || arg === "--opencode-runtime") {
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (SELECTOR_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a project selector`);
      }
      options.wait = true;
      options.waitSelector = value.trim();
      continue;
    }
    if (key === "--runtime-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.runtimeTimeoutMs = parseBoundedInt(value, "--runtime-timeout-ms", 1_000, 180_000);
      continue;
    }
    if (key === "--wait-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.wait = true;
      options.waitTimeoutMs = parseBoundedInt(value, "--wait-timeout-ms", 1_000, 600_000);
      continue;
    }
    if (key === "--wait-interval-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.wait = true;
      options.waitIntervalMs = parseBoundedInt(value, "--wait-interval-ms", 100, 30_000);
      continue;
    }
    throw new Error(`[uos] unknown ready option: ${arg}`);
  }
  return options;
}

export function parseInstallUnityOptions(argv) {
  const options = {
    projectPath: undefined,
    packageSpecifier: undefined,
    dryRun: false,
    embed: true,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--preview" || arg === "--print") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--embed" || arg === "--embedded") {
      options.embed = true;
      continue;
    }
    if (arg === "--manifest-link" || arg === "--dev-link" || arg === "--no-embed") {
      options.embed = false;
      continue;
    }
    if (arg === "--force" || arg === "--replace") {
      options.force = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (key === "--project" || key === "--unity-project" || key === "--uos-project") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity project path`);
      }
      options.projectPath = value.trim();
      continue;
    }
    if (key === "--package" || key === "--package-specifier") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a package path, git URL, or Unity package specifier`);
      }
      options.packageSpecifier = value.trim();
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`[uos] unknown install-unity option: ${arg}`);
    }
    if (options.projectPath !== undefined) {
      throw new Error(`[uos] install-unity received multiple Unity project paths: ${options.projectPath}, ${arg}`);
    }
    options.projectPath = arg;
  }

  if (options.projectPath === undefined) {
    throw new Error("[uos] install-unity requires a Unity project path");
  }
  return options;
}

export function parseWaitOptions(argv) {
  const options = {
    selector: undefined,
    timeoutMs: 60_000,
    intervalMs: 1_000,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (SELECTOR_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a project selector`);
      }
      options.selector = value.trim();
      continue;
    }
    if (key === "--timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.timeoutMs = parseBoundedInt(value, "--timeout-ms", 1_000, 600_000);
      continue;
    }
    if (key === "--interval-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.intervalMs = parseBoundedInt(value, "--interval-ms", 100, 30_000);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`[uos] unknown wait option: ${arg}`);
    }
    if (options.selector !== undefined) {
      throw new Error(`[uos] wait received multiple project selectors: ${options.selector}, ${arg}`);
    }
    options.selector = arg;
  }

  return options;
}

export function parseE2EOptions(argv) {
  const options = {
    projectPath: undefined,
    unityPath: undefined,
    selector: undefined,
    timeoutMs: DEFAULT_E2E_WAIT_TIMEOUT_MS,
    intervalMs: 1_000,
    stopTimeoutMs: DEFAULT_E2E_STOP_TIMEOUT_MS,
    logFile: undefined,
    keepOpen: false,
    nographics: true,
    secondaryProjectPaths: [],
    entryDryRun: false,
    postSmokeEntryDryRun: false,
    publicSmoke: false,
    publicSmokeArgs: [],
    publicMvp: false,
    publicMvpJson: false,
    publicChatDryRun: false,
    publicRunDryRun: false,
    publicRunAi: false,
    publicRunPrompt: DEFAULT_PUBLIC_RUN_DRY_RUN_PROMPT,
    entryMaterialsDir: undefined,
    entryFiles: [],
    entryMaxMaterialCandidates: undefined,
    entryMaxMaterialDepth: undefined,
    entryMaxMaterialScanFiles: undefined,
    smokeOptions: undefined,
  };
  const smokeArgs = [];
  let readOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--keep-open") {
      options.keepOpen = true;
      continue;
    }
    if (arg === "--read-only") {
      readOnly = true;
      continue;
    }
    if (arg === "--graphics" || arg === "--with-graphics" || arg === "--no-nographics") {
      options.nographics = false;
      continue;
    }
    if (arg === "--nographics" || arg === "--headless") {
      options.nographics = true;
      continue;
    }
    if (arg === "--entry-dry-run" || arg === "--chat-dry-run" || arg === "--launch-dry-run") {
      options.entryDryRun = true;
      continue;
    }
    if (
      arg === "--post-smoke-entry-dry-run"
      || arg === "--entry-dry-run-after-smoke"
      || arg === "--chat-dry-run-after-smoke"
      || arg === "--launch-dry-run-after-smoke"
    ) {
      options.postSmokeEntryDryRun = true;
      continue;
    }
    if (
      arg === "--public-smoke"
      || arg === "--entry-smoke"
      || arg === "--launcher-smoke"
      || arg === "--cli-smoke"
    ) {
      options.publicSmoke = true;
      continue;
    }
    if (
      arg === "--public-mvp"
      || arg === "--mvp-preflight"
      || arg === "--public-mvp-preflight"
      || arg === "--launcher-mvp"
      || arg === "--cli-mvp"
    ) {
      options.publicMvp = true;
      continue;
    }

    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (
      key === "--public-mvp-json"
      || key === "--mvp-preflight-json"
      || key === "--launcher-mvp-json"
      || key === "--cli-mvp-json"
    ) {
      options.publicMvp = true;
      options.publicMvpJson = true;
      continue;
    }
    if (
      key === "--public-chat-dry-run"
      || key === "--public-entry-dry-run"
      || key === "--launcher-chat-dry-run"
      || key === "--cli-chat-dry-run"
    ) {
      options.publicChatDryRun = true;
      continue;
    }
    if (
      key === "--public-run-dry-run"
      || key === "--public-run-preflight"
      || key === "--launcher-run-dry-run"
      || key === "--cli-run-dry-run"
    ) {
      options.publicRunDryRun = true;
      continue;
    }
    if (
      key === "--public-run-ai"
      || key === "--public-ai-run"
      || key === "--launcher-run-ai"
      || key === "--cli-run-ai"
    ) {
      options.publicRunAi = true;
      continue;
    }
    if (key === "--public-run-prompt") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a prompt`);
      }
      options.publicRunPrompt = value.trim();
      continue;
    }
    if (key === "--public-run-ai-prompt" || key === "--public-ai-prompt") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a prompt`);
      }
      options.publicRunAiPrompt = value.trim();
      options.publicRunAi = true;
      continue;
    }
    if (key === "--public-run-ai-model" || key === "--public-ai-model") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a model`);
      }
      options.publicRunAiModel = value.trim();
      options.publicRunAi = true;
      continue;
    }
    if (key === "--public-run-ai-title" || key === "--public-ai-title") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a title`);
      }
      options.publicRunAiTitle = value.trim();
      options.publicRunAi = true;
      continue;
    }
    if (
      key === "--public-run-ai-screen-name"
      || key === "--public-ai-screen-name"
      || key === "--public-run-screen-name"
    ) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a screen name`);
      }
      options.publicRunAiScreenName = value.trim();
      options.publicRunAi = true;
      continue;
    }
    if (
      key === "--public-run-timeout-ms"
      || key === "--public-run-ai-timeout-ms"
      || key === "--public-ai-timeout-ms"
    ) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.publicRunTimeoutMs = parseBoundedInt(value, key, 10_000, 900_000);
      continue;
    }
    if (key === "--project" || key === "--unity-project" || key === "--project-path") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity project path`);
      }
      options.projectPath = value.trim();
      continue;
    }
    if (key === "--selector" || key === "--uos-target") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a project selector`);
      }
      options.selector = value.trim();
      continue;
    }
    if (key === "--unity" || key === "--unity-exe" || key === "--unity-path") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity executable path`);
      }
      options.unityPath = value.trim();
      continue;
    }
    if (key === "--timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.timeoutMs = parseBoundedInt(value, "--timeout-ms", 1_000, 900_000);
      continue;
    }
    if (key === "--interval-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.intervalMs = parseBoundedInt(value, "--interval-ms", 100, 30_000);
      continue;
    }
    if (key === "--stop-timeout-ms") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.stopTimeoutMs = parseBoundedInt(value, "--stop-timeout-ms", 1_000, 120_000);
      continue;
    }
    if (key === "--log-file") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a log file path`);
      }
      options.logFile = value.trim();
      continue;
    }
    if (key === "--secondary-project" || key === "--extra-project" || key === "--with-project") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a Unity project path`);
      }
      options.secondaryProjectPaths.push(value.trim());
      continue;
    }
    if (MATERIAL_DIR_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a planning material directory`);
      }
      options.entryMaterialsDir = value.trim();
      continue;
    }
    if (ATTACHMENT_FLAGS.has(key)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos] ${key} requires a file path`);
      }
      options.entryFiles.push(value.trim());
      continue;
    }
    if (key === "--uos-max-material-candidates") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.entryMaxMaterialCandidates = parseBoundedInt(value, key, 0, 50);
      continue;
    }
    if (key === "--uos-max-material-depth") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.entryMaxMaterialDepth = parseBoundedInt(value, key, 0, 20);
      continue;
    }
    if (key === "--uos-max-material-scan-files") {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      options.entryMaxMaterialScanFiles = parseBoundedInt(value, key, 1, 5000);
      continue;
    }
    if (arg.startsWith("-")) {
      smokeArgs.push(arg);
      if (eq <= 0 && SMOKE_OPTION_REQUIRES_VALUE.has(arg)) {
        const value = argv[++i];
        if (value === undefined) {
          throw new Error(`[uos] ${arg} requires a value`);
        }
        smokeArgs.push(value);
      }
      continue;
    }
    if (options.projectPath !== undefined) {
      throw new Error(`[uos] e2e received multiple Unity project paths: ${options.projectPath}, ${arg}`);
    }
    options.projectPath = arg;
  }

  if (options.projectPath === undefined) {
    throw new Error("[uos] e2e requires a Unity project path");
  }

  const defaultSmokeArgs = e2eDefaultSmokeArgs(readOnly, smokeArgs, options.secondaryProjectPaths.length > 0);
  options.publicSmokeArgs = [...defaultSmokeArgs, ...smokeArgs];
  options.smokeOptions = parseSmokeOptions(options.publicSmokeArgs);
  return options;
}

function e2eDefaultSmokeArgs(readOnly, smokeArgs, multiProject = false) {
  if (readOnly) return [];
  if (multiProject && smokeArgs.length === 0) return [];
  if (hasSceneObjectSmokeArg(smokeArgs)) return ["--name", "UOSE2ESmoke"];
  if (hasMaterialRouteSmokeArg(smokeArgs)) return ["--preview", "--name", "UOSE2ESmoke"];
  return ["--write", "--revise", "--preview", "--name", "UOSE2ESmoke"];
}

function hasSceneObjectSmokeArg(smokeArgs) {
  for (const arg of smokeArgs) {
    const key = typeof arg === "string" ? arg.split("=", 1)[0] : "";
    if (
      key === "--scene-object"
      || key === "--scene-object-round-trip"
      || key === "--object-round-trip"
      || key === "--scene-object-name"
      || key === "--object-name"
      || key === "--scene-object-type"
      || key === "--object-type"
    ) {
      return true;
    }
  }
  return false;
}

function hasMaterialRouteSmokeArg(smokeArgs) {
  for (const arg of smokeArgs) {
    const key = typeof arg === "string" ? arg.split("=", 1)[0] : "";
    if (
      key === "--screen-from-material"
      || key === "--material-screen"
      || key === "--create-screen-from-material"
      || key === "--screen-from-first-material"
      || key === "--first-material-screen"
      || key === "--auto-material-screen"
      || key === "--pptx-deck"
      || key === "--deck-from-pptx"
      || key === "--create-pptx-deck"
    ) {
      return true;
    }
  }
  return false;
}

export async function selectUnityTarget(options = {}) {
  const editors = await discoverLiveEditors(options);
  if (editors.length === 0) {
    console.warn(
      "[uos] no live Unity Editor bridge found. Open a Unity project with Oh My Unity installed, then use Window > Oh My Unity > Monitor.",
    );
    return undefined;
  }

  const stdout = options.stdout ?? processStdout;
  const writeLine = options.writeLine ?? ((line) => stdout.write(`${line}\n`));
  const selector = options.selector ?? selectorFromEnv(options.env);
  if (selector !== undefined) {
    const selected = selectEditorBySelector(editors, selector);
    writeLine(`[uos] selected Unity project: ${label(selected)}`);
    return selected;
  }

  const stdin = options.stdin ?? processStdin;
  if (editors.length === 1) {
    const selected = editors[0];
    writeLine(`[uos] selected Unity project: ${label(selected)}`);
    return selected;
  }

  if (!stdin.isTTY) {
    throw multipleEditorsNonInteractive(editors);
  }

  writeLine("[uos] connected Unity projects:");
  editors.forEach((entry, index) => {
    writeLine(`  ${index + 1}. ${label(entry)}`);
  });

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const raw = await rl.question(`Select target project [1-${editors.length}, id, name, or path]: `);
      try {
        const selected = selectEditorBySelector(editors, raw);
        writeLine(`[uos] selected Unity project: ${label(selected)}`);
        return selected;
      } catch (err) {
        writeLine(errorMessage(err));
      }
    }
  } finally {
    rl.close();
  }
}

export function selectorFromEnv(env = process.env) {
  const value = env.UOS_UNITY_PROJECT ?? env.UOS_TARGET;
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

export function selectEditorBySelector(editors, selector) {
  const raw = String(selector ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] project selector is empty");

  if (/^\d+$/.test(raw)) {
    const index = Number.parseInt(raw, 10);
    if (index >= 1 && index <= editors.length) return editors[index - 1];
    throw new Error(`[uos] project index ${index} is out of range (1-${editors.length})`);
  }

  const exact = editors.filter((entry) => selectorValues(entry).some((value) => equalsSelector(value, raw)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguousSelector(raw, exact);

  const folded = raw.toLowerCase();
  const partial = editors.filter((entry) =>
    selectorValues(entry).some((value) => value.toLowerCase().includes(folded)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw ambiguousSelector(raw, partial);

  throw new Error(`[uos] no connected Unity project matches "${raw}"`);
}

export async function discoverLiveEditors(options = {}) {
  const inspected = await inspectEditorRegistry(options);
  const live = inspected.entries
    .filter((entry) => entry.status === "live")
    .map((entry) => entry.entry);
  // A project is locked to one Editor, so multiple live entries for the same
  // project path are duplicates (stale/leaked registrations). Present one each.
  return dedupeEditorsByProject(live);
}

export async function discoverUnityProjectCatalog(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const projects = Array.isArray(options.projects)
    ? options.projects
    : await discoverConfiguredUnityProjects(options);
  const discover = options.discoverLiveEditors ?? (() => discoverLiveEditors(options));
  const liveEditors = dedupeEditorsByProject(Array.isArray(options.liveEditors)
    ? options.liveEditors
    : await discover());
  const liveByProjectPath = new Map();
  for (const entry of liveEditors) {
    const key = normalizeProjectKey(entry?.projectPath);
    if (key.length === 0 || liveByProjectPath.has(key)) continue;
    liveByProjectPath.set(key, entry);
  }

  const inspectInstall = options.inspectUnityProjectInstall ?? inspectUnityProjectInstall;
  const catalogProjects = [];
  for (const project of projects) {
    const projectPath = path.resolve(project.projectPath);
    const liveEditor = liveByProjectPath.get(normalizeProjectKey(projectPath));
    const install = await inspectUnityProjectForCatalog(projectPath, repoRoot, inspectInstall);
    const status = unityProjectCatalogStatus(install, liveEditor);
    catalogProjects.push({
      index: catalogProjects.length + 1,
      projectName: stringValue(project.projectName) ?? path.basename(projectPath),
      projectPath,
      discoveryRoot: stringValue(project.discoveryRoot),
      unityVersion: stringValue(project.unityVersion),
      status,
      connected: status === "connected",
      sessionReady: status === "connected",
      uos: publicUnityProjectInstall(install, status),
      bridge: {
        live: liveEditor !== undefined,
        editor: liveEditor !== undefined ? publicEditorTarget(liveEditor) : undefined,
      },
    });
  }
  return {
    count: catalogProjects.length,
    projects: catalogProjects,
  };
}

export function formatUnityProjectCatalog(catalog = {}) {
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  if (projects.length === 0) {
    return [
      "[uos] no Unity projects found from configured roots.",
      "Run `uos setup --unity-projects <dir>` with the folder that contains your Unity projects.",
    ].join("\n");
  }
  const rows = projects.map((project, offset) => ({
    no: String(positiveInt(project.index) ?? offset + 1),
    status: projectCatalogStatusLabel(project.status),
    uos: projectCatalogUosShortLabel(project.uos),
    editor: project.bridge?.live === true ? "Open" : "Closed",
    project: project.projectName ?? "(unnamed project)",
    unity: project.unityVersion ?? "-",
    path: project.projectPath ?? "(unknown path)",
    note: project.uos?.error,
  }));
  const widths = {
    no: Math.max(2, ...rows.map((row) => row.no.length)),
    status: Math.max("Status".length, ...rows.map((row) => row.status.length)),
    uos: Math.max("UOS".length, ...rows.map((row) => row.uos.length)),
    editor: Math.max("Editor".length, ...rows.map((row) => row.editor.length)),
    project: Math.min(32, Math.max("Project".length, ...rows.map((row) => row.project.length))),
    unity: Math.max("Unity".length, ...rows.map((row) => row.unity.length)),
  };
  const header = [
    padCell("#", widths.no, "left"),
    padCell("Status", widths.status),
    padCell("UOS", widths.uos),
    padCell("Editor", widths.editor),
    padCell("Project", widths.project),
    padCell("Unity", widths.unity),
    "Path",
  ].join("  ");
  const lines = [
    "[uos] Unity projects",
    "",
    header,
    "-".repeat(Math.min(header.length + 42, 120)),
  ];
  for (const row of rows) {
    lines.push([
      padCell(row.no, widths.no, "left"),
      padCell(row.status, widths.status),
      padCell(row.uos, widths.uos),
      padCell(row.editor, widths.editor),
      padCell(row.project, widths.project),
      padCell(row.unity, widths.unity),
      fitCell(row.path, 48),
    ].join("  "));
    if (row.note !== undefined) lines.push(`    note: ${row.note}`);
  }
  lines.push(
    "",
    "Open: enter a project number. If UOS is not linked, UOS installs first.",
    "Action: c <number> link/update UOS, d <number> unlink UOS, q quit.",
  );
  return lines.join("\n");
}

export function selectUnityProjectCatalogEntry(catalog = {}, selector) {
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  const raw = String(selector ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] project selection is empty");
  if (/^\d+$/.test(raw)) {
    const index = Number.parseInt(raw, 10);
    if (index >= 1 && index <= projects.length) return projects[index - 1];
    throw new Error(`[uos] project index ${index} is out of range (1-${projects.length})`);
  }
  const exact = projects.filter((project) =>
    unityProjectCatalogSelectorValues(project).some((value) => equalsSelector(value, raw)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`[uos] project selector "${raw}" is ambiguous`);
  const folded = raw.toLowerCase();
  const partial = projects.filter((project) =>
    unityProjectCatalogSelectorValues(project).some((value) => value.toLowerCase().includes(folded)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new Error(`[uos] project selector "${raw}" is ambiguous`);
  throw new Error(`[uos] no configured Unity project matches "${raw}"`);
}

function formatProjectCatalogUos(uos = {}) {
  if (uos.installed !== true) return "not linked";
  const kind = stringValue(uos.installKind);
  const suffix = kind !== undefined ? ` (${kind})` : "";
  return uos.ok === true ? `linked${suffix}` : `needs attention${suffix}`;
}

function projectCatalogStatusLabel(status) {
  switch (status) {
    case "connected": return "Ready";
    case "installed": return "Open Unity";
    case "not-installed": return "Install UOS";
    case "needs-attention": return "Check UOS";
    case "live-needs-attention": return "Bridge Issue";
    default: return "Unknown";
  }
}

function projectCatalogUosShortLabel(uos = {}) {
  if (uos.installed !== true) return "Not linked";
  if (uos.ok === true) {
    if (stringValue(uos.installKind) === "embedded") return "Embedded";
    return "Linked";
  }
  return "Check";
}

function padCell(value, width, align = "right") {
  const text = fitCell(value, width);
  return align === "left" ? text.padStart(width) : text.padEnd(width);
}

function fitCell(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function unityProjectCatalogSelectorValues(project = {}) {
  return [
    project.projectName,
    project.projectPath,
    normalizeComparablePath(project.projectPath),
  ].filter((value) => typeof value === "string" && value.length > 0);
}

async function inspectUnityProjectForCatalog(projectPath, repoRoot, inspectInstall) {
  try {
    return await inspectInstall(projectPath, repoRoot);
  } catch (err) {
    return {
      ok: false,
      projectPath,
      installed: false,
      error: errorMessage(err),
    };
  }
}

function publicUnityProjectInstall(install = {}, status = unityProjectCatalogStatus(install)) {
  return {
    status,
    ok: install.ok === true,
    installed: install.installed === true,
    installKind: stringValue(install.installKind),
    specifier: stringValue(install.specifier),
    manifestSpecifier: stringValue(install.manifestSpecifier),
    embeddedPackagePath: stringValue(install.embeddedPackagePath),
    hasEmbeddedPackage: typeof install.hasEmbeddedPackage === "boolean" ? install.hasEmbeddedPackage : undefined,
    hasInstallConflict: typeof install.hasInstallConflict === "boolean" ? install.hasInstallConflict : undefined,
    localPackage: publicUnityLocalPackage(install.localPackage),
    error: stringValue(install.error),
  };
}

function publicUnityLocalPackage(localPackage) {
  if (localPackage === undefined || localPackage === null || typeof localPackage !== "object") return undefined;
  return {
    ok: localPackage.ok === true,
    path: stringValue(localPackage.path),
    name: stringValue(localPackage.name),
    version: stringValue(localPackage.version),
    uguiDependency: stringValue(localPackage.uguiDependency),
    error: stringValue(localPackage.error),
  };
}

function unityProjectCatalogStatus(install = {}, liveEditor) {
  if (install.ok === true && liveEditor !== undefined) return "connected";
  if (liveEditor !== undefined) return "live-needs-attention";
  if (install.ok === true) return "installed";
  if (install.installed === true) return "needs-attention";
  return "not-installed";
}

export async function waitForUnityTarget(options = {}) {
  const timeoutMs = positiveInt(options.timeoutMs) ?? 60_000;
  const intervalMs = positiveInt(options.intervalMs) ?? 1_000;
  const selector = stringValue(options.selector);
  const discover = options.discoverLiveEditors ?? (() => discoverLiveEditors(options));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const started = now();
  let lastEditors = [];
  let lastError;

  while (true) {
    lastEditors = await discover();
    if (selector === undefined) {
      if (lastEditors.length > 0) {
        return {
          timedOut: false,
          elapsedMs: Math.max(0, now() - started),
          selector,
          editors: lastEditors,
          target: lastEditors.length === 1 ? lastEditors[0] : undefined,
        };
      }
    } else if (lastEditors.length > 0) {
      try {
        return {
          timedOut: false,
          elapsedMs: Math.max(0, now() - started),
          selector,
          editors: lastEditors,
          target: selectEditorBySelector(lastEditors, selector),
        };
      } catch (err) {
        lastError = err;
      }
    }

    const elapsedMs = Math.max(0, now() - started);
    if (elapsedMs >= timeoutMs) {
      return {
        timedOut: true,
        elapsedMs,
        selector,
        editors: lastEditors,
        target: undefined,
        lastError: lastError !== undefined ? errorMessage(lastError) : undefined,
      };
    }
    await sleep(Math.max(1, Math.min(intervalMs, timeoutMs - elapsedMs)));
  }
}

export async function runUnityE2E(options = {}) {
  const projectPath = path.resolve(options.projectPath ?? "");
  const secondaryProjectPaths = normalizeFileList(options.secondaryProjectPaths).map((project) => path.resolve(project));
  if (secondaryProjectPaths.length > 0) {
    return await runUnityMultiE2E({ ...options, projectPath, secondaryProjectPaths });
  }
  await assertUnityProjectRoot(projectPath);
  const unityPath = await resolveUnityExecutable(projectPath, options);
  const logFile = await resolveUnityE2ELogFile(projectPath, options);
  const unityArgs = [
    "-batchmode",
    ...(options.nographics === false ? [] : ["-nographics"]),
    "-projectPath",
    projectPath,
    "-logFile",
    logFile,
  ];
  const launchUnity = options.launchUnity ?? defaultLaunchUnity;
  const child = await launchUnity(unityPath, unityArgs, { ...options, projectPath, logFile });
  const pid = positiveInt(child?.pid);
  let stopped;
  let cleaned;
  let result;

  try {
    const waitResult = await (options.waitForUnityTarget ?? waitForUnityTarget)({
      ...options,
      selector: stringValue(options.selector) ?? projectPath,
      timeoutMs: options.timeoutMs ?? DEFAULT_E2E_WAIT_TIMEOUT_MS,
      intervalMs: options.intervalMs ?? 1_000,
    });
    if (waitResult.timedOut) {
      throw new Error(`[uos e2e] Unity bridge did not become ready within ${waitResult.elapsedMs}ms. log: ${logFile}`);
    }

    const target = waitResult.target ?? (waitResult.editors?.length === 1 ? waitResult.editors[0] : undefined);
    if (target === undefined) {
      throw new Error("[uos e2e] wait completed without a selected Unity bridge");
    }

    const entryDryRun = options.entryDryRun === true
      ? await buildEntryDryRun(target, options)
      : undefined;
    const smoke = await (options.runUnitySmoke ?? runUnitySmoke)(target, {
      ...(options.smokeOptions ?? parseSmokeOptions(["--write", "--revise", "--preview", "--name", "UOSE2ESmoke"])),
      timeoutMs: options.toolTimeoutMs ?? TOOL_CALL_TIMEOUT_MS,
    });
    const publicSmoke = options.publicSmoke === true
      ? await runPublicSmokeCli(target, {
        ...options,
        repoRoot: options.repoRoot,
      })
      : undefined;
    const publicMvp = options.publicMvp === true
      ? await runPublicMvpCli(target, {
        ...options,
        repoRoot: options.repoRoot,
      })
      : undefined;
    const publicChatDryRun = options.publicChatDryRun === true
      ? await runPublicChatDryRunCli(target, {
        ...options,
        repoRoot: options.repoRoot,
      })
      : undefined;
    const publicRunDryRun = options.publicRunDryRun === true
      ? await runPublicRunDryRunCli(target, {
        ...options,
        repoRoot: options.repoRoot,
      })
      : undefined;
    const publicRunAi = options.publicRunAi === true
      ? await runPublicRunAiCli(target, {
        ...options,
        repoRoot: options.repoRoot,
      })
      : undefined;
    const postSmokeEntryDryRun = options.postSmokeEntryDryRun === true
      ? await buildEntryDryRun(target, options)
      : undefined;
    result = {
      ok: true,
      projectPath,
      unityPath,
      unityArgs,
      logFile,
      pid,
      wait: waitResult,
      entryDryRun,
      smoke,
      publicSmoke,
      publicMvp,
      publicChatDryRun,
      publicRunDryRun,
      publicRunAi,
      postSmokeEntryDryRun,
      keepOpen: options.keepOpen === true,
      stopped: undefined,
      cleaned: undefined,
    };
    return result;
  } finally {
    if (options.keepOpen === true) {
      stopped = { skipped: true, reason: "--keep-open" };
    } else {
      stopped = await stopUnityProcess(child, {
        timeoutMs: options.stopTimeoutMs ?? DEFAULT_E2E_STOP_TIMEOUT_MS,
      });
    }
    cleaned = await cleanE2EStaleRegistry(options);
    if (options.onCleanup !== undefined) {
      await options.onCleanup({ stopped, cleaned });
    }
    if (result !== undefined) {
      result.stopped = stopped;
      result.cleaned = cleaned;
    }
  }
}

export async function buildEntryDryRun(target, options = {}) {
  const materialsDir = stringValue(options.entryMaterialsDir);
  const files = normalizeFileList(options.entryFiles);
  const launchInputs = await validateLaunchInputs(target, {
    materialsDir,
    files,
    env: options.env ?? process.env,
  });
  const env = await buildLaunchEnv(target, options.env ?? process.env, {
    materialsDir,
    files,
    launchInputs,
    env: options.env ?? process.env,
    bridgeCapabilities: true,
    maxMaterialCandidates: options.entryMaxMaterialCandidates,
    maxMaterialDepth: options.entryMaxMaterialDepth,
    maxMaterialScanFiles: options.entryMaxMaterialScanFiles,
  });
  const opencodeArgs = buildForwardArgs([], target, {
    materialsDir,
    files,
    launchInputs,
    env,
    maxMaterialCandidates: options.entryMaxMaterialCandidates,
    maxMaterialDepth: options.entryMaxMaterialDepth,
    maxMaterialScanFiles: options.entryMaxMaterialScanFiles,
  });
  return {
    launchInputs,
    opencodeArgs,
    readiness: evaluateLaunchBridgeCapabilities(env),
    output: formatLaunchDryRun(target, opencodeArgs, env, launchInputs),
  };
}

export async function buildMvpValidationReport(target, options = {}) {
  const materialsDir = stringValue(options.materialsDir);
  const files = normalizeFileList(options.files);
  const launchInputs = await validateLaunchInputs(target, {
    materialsDir,
    files,
    env: options.env ?? process.env,
  });
  const entryDryRun = await buildEntryDryRun(target, {
    ...options,
    entryMaterialsDir: materialsDir,
    entryFiles: files,
    entryMaxMaterialCandidates: options.maxMaterialCandidates,
    entryMaxMaterialDepth: options.maxMaterialDepth,
    entryMaxMaterialScanFiles: options.maxMaterialScanFiles,
  });
  const selector = mvpValidationSelector(target, options);
  const prompt = stringValue(options.prompt) ?? DEFAULT_MVP_VALIDATION_PROMPT;
  const commands = buildMvpValidationCommands(selector, launchInputs, prompt, target);
  const acceptanceGateDefinitions = buildMvpAcceptanceGates(commands);
  const materialReady = launchInputs.materialsDir !== undefined || launchInputs.files.length > 0;
  const blockers = [
    ...(entryDryRun.readiness?.blockers ?? []),
    ...(materialReady ? [] : ["No planning material was supplied; add --uos-materials and/or --uos-file for MVP material validation."]),
  ];
  const readiness = {
    ...(entryDryRun.readiness ?? {}),
    ready: blockers.length === 0,
    blockers,
  };
  const acceptanceGates = annotateMvpAcceptanceGates(acceptanceGateDefinitions, {
    preflightReady: blockers.length === 0,
  });
  const report = {
    ok: blockers.length === 0,
    target,
    selector,
    launchInputs,
    materialReady,
    prompt,
    readiness,
    entryDryRun,
    commands,
    acceptanceGates,
  };
  return {
    ...report,
    preflightSummary: buildMvpPreflightSummary(report),
  };
}

function mvpValidationSelector(target, options = {}) {
  return stringValue(options.selector)
    ?? stringValue(target?.projectPath)
    ?? stringValue(target?.projectName)
    ?? stringValue(target?.instanceId)
    ?? "MyGame";
}

function buildMvpValidationCommands(selector, launchInputs = {}, prompt = DEFAULT_MVP_VALIDATION_PROMPT, target = undefined) {
  const selected = ["--unity-project", selector];
  const materialArgs = [];
  if (launchInputs.materialsDir !== undefined) {
    materialArgs.push("--uos-materials", launchInputs.materialsDir);
  }
  for (const file of launchInputs.files ?? []) {
    materialArgs.push("--uos-file", file);
  }
  const selectedWithMaterials = [...selected, ...materialArgs];
  const commands = {
    doctorRuntime: ["doctor", "--runtime"],
    ready: ["ready", "--wait", ...selected],
    context: ["context", ...selectedWithMaterials],
    chatDryRun: ["chat", ...selectedWithMaterials, "--uos-dry-run"],
    runDryRun: [...selectedWithMaterials, "--uos-dry-run", "run", prompt],
    runAiEdit: [...selectedWithMaterials, "run", prompt],
    chatContinue: ["chat", ...selected, "--continue"],
  };
  const projectPath = stringValue(target?.projectPath);
  if (projectPath !== undefined) {
    commands.doctorProject = ["doctor", "--project", projectPath];
    commands.publicMvpE2E = ["e2e", "--project", projectPath, "--read-only", "--public-mvp-json", ...materialArgs];
  }
  return commands;
}

function buildMvpAcceptanceGates(commands = {}) {
  const gates = [
    {
      id: "consumer-install-and-runtime",
      title: "Consumer project package and opencode runtime",
      commandKeys: ["doctorProject", "doctorRuntime"],
      optional: commands.doctorProject === undefined,
      evidence: [
        "`uos doctor --project` reports the UOS Unity package is installed in the target project.",
        "`uos doctor --runtime` reports required opencode resources and auth are usable, or names blockers to resolve.",
        "No duplicate local UOS plugin or expired auth warning remains before the real AI edit.",
      ],
    },
    {
      id: "ready-and-context",
      title: "Selected project readiness and material context",
      commandKeys: ["ready", "context"],
      evidence: [
        "The intended Unity project is selected by name/path.",
        "`uos ready` reports no AI-session blockers.",
        "`uos context` shows selected Unity metadata and the supplied planning material.",
      ],
    },
    {
      id: "public-mvp-preflight",
      title: "Public MVP preflight",
      commandKeys: ["publicMvpE2E"],
      optional: commands.publicMvpE2E === undefined,
      evidence: [
        "The public `uos mvp --json` path exits 0 and reports `ok: true`.",
        "The generated command sequence includes ready, context, dry-run, real AI edit, and follow-up chat.",
        "Bridge tokens are not present in stdout, stderr, or JSON.",
      ],
    },
    {
      id: "entry-dry-run",
      title: "Public chat/run dry-run forwarding",
      commandKeys: ["chatDryRun", "runDryRun"],
      evidence: [
        "Dry-run output names the selected Unity project.",
        "Attached material root/files are visible through UOS context guidance.",
        "Binary or visual files stay in UOS attachments instead of opencode `--file`.",
      ],
    },
    {
      id: "real-ai-edit",
      title: "Real AI material edit",
      commandKeys: ["runAiEdit"],
      evidence: [
        "The AI calls `get_uos_context` before mutating Unity.",
        "The AI reads the launch-attached material with `read_planning_material`.",
        "The AI creates or updates Unity UI through UOS tools and records the mutation in `.uos/work-journal.jsonl`.",
        "A preview is captured or can be captured immediately after the edit.",
      ],
    },
    {
      id: "follow-up-edit",
      title: "Conversational follow-up edit",
      commandKeys: ["chatContinue"],
      evidence: [
        "The AI resolves the previous screen from persisted `.uos` context.",
        "A visible user-requested change is applied without asking for raw screenId or elementId.",
        "Preview or verification output reflects the follow-up edit.",
      ],
    },
  ];
  return gates.map((gate) => ({
    ...gate,
    commands: Object.fromEntries(
      gate.commandKeys
        .filter((key) => Array.isArray(commands[key]))
        .map((key) => [key, formatPublicCommand("uos", commands[key])]),
    ),
  }));
}

function annotateMvpAcceptanceGates(gates = [], options = {}) {
  const preflightReady = options.preflightReady === true;
  return gates.map((gate) => {
    const commandKeys = Array.isArray(gate.commandKeys) ? gate.commandKeys : [];
    const commandMap = gate.commands !== undefined && typeof gate.commands === "object" && gate.commands !== null
      ? gate.commands
      : {};
    const commandKeysPresent = commandKeys.filter((key) => stringValue(commandMap[key]) !== undefined);
    const commandKeysMissing = commandKeys.filter((key) => !commandKeysPresent.includes(key));
    const optional = gate.optional === true;
    const state = optional
      ? "optional-user-evidence"
      : preflightReady
        ? "pending-user-evidence"
        : "blocked-by-preflight";
    return {
      ...gate,
      evidenceStatus: {
        state,
        userEvidenceRequired: !optional,
        automaticPreflightReady: preflightReady && commandKeysMissing.length === 0,
        commandKeysPresent,
        commandKeysMissing,
        next: state === "pending-user-evidence"
          ? "run-with-user-and-capture-evidence"
          : state === "optional-user-evidence"
            ? "run-when-project-path-is-available"
            : "resolve-preflight-blockers",
      },
    };
  });
}

export function formatMvpValidationReport(report = {}) {
  const readiness = report.readiness ?? {};
  const lines = [
    "[uos mvp] validation preflight",
    `ready: ${report.ok === true ? "yes" : "no"}`,
  ];
  if (report.target !== undefined) {
    lines.push(`project: ${label(report.target)}`);
  }
  if (report.selector !== undefined) {
    lines.push(`selector: ${report.selector}`);
  }
  if (report.launchInputs?.materialsDir !== undefined) {
    lines.push(`materials: ${report.launchInputs.materialsDir}`);
  }
  const files = Array.isArray(report.launchInputs?.files) ? report.launchInputs.files : [];
  lines.push(`attached files: ${files.length}`);
  for (const file of files.slice(0, 8)) {
    lines.push(`  - ${file}`);
  }
  if (files.length > 8) {
    lines.push(`  ... ${files.length - 8} more file(s)`);
  }
  lines.push(`material validation: ${report.materialReady === true ? "ready" : "missing"}`);

  if (Array.isArray(readiness.supportedTools)) {
    const missing = Array.isArray(readiness.missingTools) ? readiness.missingTools.length : 0;
    lines.push(`bridge required tools: ${readiness.supportedTools.length - missing}/${readiness.requiredTools?.length ?? REQUIRED_UNITY_BRIDGE_TOOLS.length}`);
  }
  if (Array.isArray(readiness.writeTools)) {
    const missingWrite = Array.isArray(readiness.missingWriteTools) ? readiness.missingWriteTools.length : 0;
    lines.push(`bridge write tools: ${readiness.writeTools.length - missingWrite}/${readiness.requiredWriteTools?.length ?? REQUIRED_UNITY_WRITE_TOOLS.length}`);
  }

  if (Array.isArray(readiness.blockers) && readiness.blockers.length > 0) {
    lines.push("", "blockers:");
    for (const blocker of readiness.blockers) lines.push(`  - ${blocker}`);
  }
  if (Array.isArray(readiness.warnings) && readiness.warnings.length > 0) {
    lines.push("", "warnings:");
    for (const warning of readiness.warnings) lines.push(`  - ${warning}`);
  }

  const preflightSummary = report.preflightSummary ?? buildMvpPreflightSummary(report);
  lines.push("", "preflight summary:");
  lines.push(`  status: ${preflightSummary.status}`);
  lines.push(`  selected project: ${preflightSummary.selectedProject === true ? "yes" : "no"}`);
  lines.push(`  material ready: ${preflightSummary.materialReady === true ? "yes" : "no"}`);
  lines.push(`  command lines: ${preflightSummary.commandLines.present.length}/${preflightSummary.commandLines.required.length}`);
  lines.push(`  acceptance gates: ${preflightSummary.acceptanceGates.count}`);

  const commands = report.commands ?? {};
  lines.push("", "user-led MVP walkthrough commands:");
  for (const [labelText, args] of [
    ["1. project install check", commands.doctorProject],
    ["2. opencode runtime check", commands.doctorRuntime],
    ["3. readiness", commands.ready],
    ["4. context", commands.context],
    ["5. public MVP E2E", commands.publicMvpE2E],
    ["6. chat dry-run", commands.chatDryRun],
    ["7. run dry-run", commands.runDryRun],
    ["8. AI edit", commands.runAiEdit],
    ["9. follow-up chat", commands.chatContinue],
  ]) {
    if (Array.isArray(args)) {
      lines.push(`  ${labelText}: ${formatPublicCommand("uos", args)}`);
    }
  }

  if (Array.isArray(report.acceptanceGates) && report.acceptanceGates.length > 0) {
    lines.push("", "acceptance gates:");
    for (const gate of report.acceptanceGates) {
      const optional = gate.optional === true ? " (optional when no project path is available)" : "";
      lines.push(`  - ${gate.title}${optional}`);
      const state = stringValue(gate.evidenceStatus?.state);
      if (state !== undefined) {
        lines.push(`    status: ${state}; user evidence: ${gate.evidenceStatus?.userEvidenceRequired === false ? "optional" : "required"}`);
      }
      for (const evidence of gate.evidence ?? []) {
        lines.push(`    evidence: ${evidence}`);
      }
    }
  }

  lines.push("", report.ok === true
    ? "Next: run the dry-run commands with the user, then run the AI edit command against the selected Unity project."
    : "Next: resolve the blockers above, then rerun this preflight.");
  return lines.join("\n");
}

export function formatMvpValidationJson(report = {}) {
  const commands = report.commands ?? {};
  const commandLines = Object.fromEntries(
    Object.entries(commands)
      .filter(([, args]) => Array.isArray(args))
      .map(([key, args]) => [key, formatPublicCommand("uos", args)]),
  );
  return JSON.stringify({
    ok: report.ok === true,
    target: report.target !== undefined ? publicEditorTarget(report.target) : undefined,
    selector: stringValue(report.selector),
    launchInputs: report.launchInputs ?? { materialsDir: undefined, files: [] },
    materialReady: report.materialReady === true,
    prompt: stringValue(report.prompt),
    readiness: {
      ready: report.readiness?.ready === true,
      blockers: Array.isArray(report.readiness?.blockers) ? report.readiness.blockers : [],
      warnings: Array.isArray(report.readiness?.warnings) ? report.readiness.warnings : [],
      supportedTools: Array.isArray(report.readiness?.supportedTools) ? report.readiness.supportedTools : undefined,
      writeTools: Array.isArray(report.readiness?.writeTools) ? report.readiness.writeTools : undefined,
      missingTools: Array.isArray(report.readiness?.missingTools) ? report.readiness.missingTools : undefined,
      missingWriteTools: Array.isArray(report.readiness?.missingWriteTools) ? report.readiness.missingWriteTools : undefined,
      requiredTools: Array.isArray(report.readiness?.requiredTools) ? report.readiness.requiredTools : REQUIRED_UNITY_BRIDGE_TOOLS,
      requiredWriteTools: Array.isArray(report.readiness?.requiredWriteTools) ? report.readiness.requiredWriteTools : REQUIRED_UNITY_WRITE_TOOLS,
    },
    commands,
    commandLines,
    preflightSummary: report.preflightSummary ?? buildMvpPreflightSummary(report),
    acceptanceGates: Array.isArray(report.acceptanceGates) ? report.acceptanceGates : [],
  }, null, 2);
}

export async function saveMvpValidationReport(report = {}, outputPath) {
  const rawPath = stringValue(outputPath);
  if (rawPath === undefined) {
    throw new Error("[uos mvp] --save requires an output file path");
  }
  const resolvedPath = path.resolve(rawPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${formatMvpValidationJson(report)}\n`, "utf8");
  return resolvedPath;
}

export async function loadMvpEvidenceBundle(inputPath) {
  const rawPath = stringValue(inputPath);
  if (rawPath === undefined) {
    throw new Error("[uos mvp-progress] evidence file path is required");
  }
  const resolvedPath = path.resolve(rawPath);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
  } catch (err) {
    throw new Error(`[uos mvp-progress] failed to read evidence bundle ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`[uos mvp-progress] evidence bundle must be a JSON object: ${resolvedPath}`);
  }
  return { path: resolvedPath, data: parsed };
}

export function buildMvpProgressSummary(bundle = {}) {
  const data = bundle.data !== undefined ? bundle.data : bundle;
  const evidencePath = stringValue(bundle.path);
  const preflightSummary = data?.preflightSummary !== undefined && typeof data.preflightSummary === "object" && data.preflightSummary !== null
    ? data.preflightSummary
    : {};
  const gates = Array.isArray(data?.acceptanceGates) ? data.acceptanceGates : [];
  const gateGroups = preflightSummary.acceptanceGates !== undefined && typeof preflightSummary.acceptanceGates === "object" && preflightSummary.acceptanceGates !== null
    ? preflightSummary.acceptanceGates
    : {};
  const gateIds = Array.isArray(gateGroups.ids)
    ? gateGroups.ids.filter((id) => stringValue(id) !== undefined)
    : gates.map((gate) => stringValue(gate?.id)).filter((id) => id !== undefined);
  const pendingUserEvidence = arrayOfStrings(gateGroups.pendingUserEvidence)
    ?? gateIdsByEvidenceStates(gates, ["pending-user-evidence"]);
  const optionalUserEvidence = arrayOfStrings(gateGroups.optionalUserEvidence)
    ?? gateIdsByEvidenceStates(gates, ["optional-user-evidence"]);
  const blockedByPreflight = arrayOfStrings(gateGroups.blockedByPreflight)
    ?? gateIdsByEvidenceStates(gates, ["blocked-by-preflight"]);
  const verifiedUserEvidence = gateIdsByEvidenceStates(gates, [
    "verified-user-evidence",
    "verified",
    "passed",
    "complete",
    "completed",
  ]);
  const requiredGateCount = Math.max(gateIds.length - optionalUserEvidence.length, 0);
  const verifiedCount = verifiedUserEvidence.length;
  const pendingCount = pendingUserEvidence.length;
  const blockedCount = blockedByPreflight.length;
  const progressPercent = requiredGateCount === 0
    ? 100
    : Math.round((verifiedCount / requiredGateCount) * 100);
  const commandLines = preflightSummary.commandLines !== undefined && typeof preflightSummary.commandLines === "object" && preflightSummary.commandLines !== null
    ? preflightSummary.commandLines
    : {};
  const nextGate = gates.find((gate) => pendingUserEvidence.includes(stringValue(gate?.id)));
  return {
    evidencePath,
    ok: data?.ok === true,
    preflight: {
      status: stringValue(preflightSummary.status) ?? (data?.ok === true ? "ready-for-user-validation" : "unknown"),
      next: stringValue(preflightSummary.next),
      selectedProject: preflightSummary.selectedProject === true,
      materialReady: preflightSummary.materialReady === true,
      aiSessionReady: preflightSummary.aiSessionReady === true,
    },
    commandLines: {
      required: arrayOfStrings(commandLines.required) ?? [],
      present: arrayOfStrings(commandLines.present) ?? [],
      missing: arrayOfStrings(commandLines.missing) ?? [],
    },
    acceptanceGates: {
      total: gateIds.length,
      required: requiredGateCount,
      verified: verifiedCount,
      pending: pendingCount,
      optional: optionalUserEvidence.length,
      blocked: blockedCount,
      progressPercent,
      ids: gateIds,
      verifiedUserEvidence,
      pendingUserEvidence,
      optionalUserEvidence,
      blockedByPreflight,
    },
    nextGate: nextGate !== undefined ? {
      id: stringValue(nextGate.id),
      title: stringValue(nextGate.title),
      commands: nextGate.commands !== undefined && typeof nextGate.commands === "object" && nextGate.commands !== null
        ? Object.fromEntries(Object.entries(nextGate.commands).filter(([, value]) => stringValue(value) !== undefined))
        : {},
      evidence: Array.isArray(nextGate.evidence) ? nextGate.evidence.filter((item) => stringValue(item) !== undefined) : [],
    } : undefined,
  };
}

export function formatMvpProgressJson(bundle = {}) {
  return JSON.stringify(buildMvpProgressSummary(bundle), null, 2);
}

export function formatMvpProgressReport(bundle = {}) {
  const summary = buildMvpProgressSummary(bundle);
  const lines = [
    "[uos mvp-progress] evidence bundle",
  ];
  if (summary.evidencePath !== undefined) {
    lines.push(`file: ${summary.evidencePath}`);
  }
  lines.push(`preflight: ${summary.preflight.status}${summary.preflight.next !== undefined ? ` next=${summary.preflight.next}` : ""}`);
  lines.push(`selected project: ${summary.preflight.selectedProject ? "yes" : "no"}`);
  lines.push(`material ready: ${summary.preflight.materialReady ? "yes" : "no"}`);
  lines.push(`AI session ready: ${summary.preflight.aiSessionReady ? "yes" : "no"}`);
  lines.push(`command lines: ${summary.commandLines.present.length}/${summary.commandLines.required.length}`);
  lines.push(`user evidence progress: ${summary.acceptanceGates.verified}/${summary.acceptanceGates.required} (${summary.acceptanceGates.progressPercent}%)`);
  lines.push(`acceptance gates: ${summary.acceptanceGates.total} total, ${summary.acceptanceGates.pending} pending, ${summary.acceptanceGates.optional} optional, ${summary.acceptanceGates.blocked} blocked`);
  if (summary.commandLines.missing.length > 0) {
    lines.push("", "missing command lines:");
    for (const key of summary.commandLines.missing) lines.push(`  - ${key}`);
  }
  if (summary.acceptanceGates.blockedByPreflight.length > 0) {
    lines.push("", "blocked by preflight:");
    for (const id of summary.acceptanceGates.blockedByPreflight) lines.push(`  - ${id}`);
  }
  if (summary.acceptanceGates.pendingUserEvidence.length > 0) {
    lines.push("", "pending user evidence:");
    for (const id of summary.acceptanceGates.pendingUserEvidence) lines.push(`  - ${id}`);
  }
  if (summary.nextGate !== undefined) {
    lines.push("", `next gate: ${summary.nextGate.title ?? summary.nextGate.id}`);
    const commands = Object.entries(summary.nextGate.commands);
    for (const [key, command] of commands) {
      lines.push(`  ${key}: ${command}`);
    }
    if (commands.length === 0) {
      lines.push("  resolve preflight blockers or rerun `uos mvp --save` with a selected project path.");
    }
  } else if (summary.acceptanceGates.blockedByPreflight.length > 0) {
    lines.push("", "next: resolve preflight blockers, then rerun `uos mvp --save`.");
  } else {
    lines.push("", "next: no pending user evidence gates in this bundle.");
  }
  return lines.join("\n");
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => stringValue(item))
    .filter((item) => item !== undefined);
}

function gateIdsByEvidenceStates(gates = [], states = []) {
  if (!Array.isArray(gates)) return [];
  return gates
    .filter((gate) => states.includes(stringValue(gate?.evidenceStatus?.state)))
    .map((gate) => stringValue(gate?.id))
    .filter((id) => id !== undefined);
}

function buildMvpPreflightSummary(report = {}) {
  const readiness = report.readiness ?? {};
  const commands = report.commands ?? {};
  const requiredCommandKeys = expectedMvpCommandLineKeys({ projectPath: report.target?.projectPath });
  const presentCommandKeys = requiredCommandKeys.filter((key) => Array.isArray(commands[key]));
  const missingCommandKeys = requiredCommandKeys.filter((key) => !presentCommandKeys.includes(key));
  const requiredTools = Array.isArray(readiness.requiredTools) ? readiness.requiredTools : REQUIRED_UNITY_BRIDGE_TOOLS;
  const requiredWriteTools = Array.isArray(readiness.requiredWriteTools) ? readiness.requiredWriteTools : REQUIRED_UNITY_WRITE_TOOLS;
  const missingTools = Array.isArray(readiness.missingTools) ? readiness.missingTools : [];
  const missingWriteTools = Array.isArray(readiness.missingWriteTools) ? readiness.missingWriteTools : [];
  const acceptanceGateIds = Array.isArray(report.acceptanceGates)
    ? report.acceptanceGates
      .map((gate) => stringValue(gate?.id))
      .filter((id) => id !== undefined)
    : [];
  const pendingUserEvidence = acceptanceGateIdsByState(report.acceptanceGates, "pending-user-evidence");
  const optionalUserEvidence = acceptanceGateIdsByState(report.acceptanceGates, "optional-user-evidence");
  const blockedByPreflight = acceptanceGateIdsByState(report.acceptanceGates, "blocked-by-preflight");
  return {
    status: report.ok === true ? "ready-for-user-validation" : "blocked",
    next: report.ok === true ? "run-user-led-mvp-gates" : "resolve-preflight-blockers",
    selectedProject: report.target !== undefined,
    materialReady: report.materialReady === true,
    aiSessionReady: readiness.ready === true,
    bridgeTools: {
      required: requiredTools.length,
      available: Math.max(requiredTools.length - missingTools.length, 0),
      missing: missingTools,
    },
    bridgeWriteTools: {
      required: requiredWriteTools.length,
      available: Math.max(requiredWriteTools.length - missingWriteTools.length, 0),
      missing: missingWriteTools,
    },
    commandLines: {
      required: requiredCommandKeys,
      present: presentCommandKeys,
      missing: missingCommandKeys,
    },
    acceptanceGates: {
      count: acceptanceGateIds.length,
      ids: acceptanceGateIds,
      pendingUserEvidence,
      optionalUserEvidence,
      blockedByPreflight,
    },
  };
}

function acceptanceGateIdsByState(gates = [], state) {
  if (!Array.isArray(gates)) return [];
  return gates
    .filter((gate) => gate?.evidenceStatus?.state === state)
    .map((gate) => stringValue(gate?.id))
    .filter((id) => id !== undefined);
}

async function runUnityMultiE2E(options = {}) {
  const projectPath = path.resolve(options.projectPath ?? "");
  const projectPaths = [
    projectPath,
    ...normalizeFileList(options.secondaryProjectPaths).map((project) => path.resolve(project)),
  ];
  const uniqueProjectPaths = new Set(projectPaths.map((project) => normalizeComparablePath(project)));
  if (uniqueProjectPaths.size !== projectPaths.length) {
    throw new Error("[uos e2e] --secondary-project must reference a different Unity project");
  }

  for (const item of projectPaths) await assertUnityProjectRoot(item);

  const launchUnity = options.launchUnity ?? defaultLaunchUnity;
  const launches = [];
  let stopped;
  let cleaned;
  let result;

  try {
    for (let index = 0; index < projectPaths.length; index++) {
      const item = projectPaths[index];
      const unityPath = await resolveUnityExecutable(item, options);
      const logFile = await resolveUnityE2EProjectLogFile(item, index, options);
      const unityArgs = [
        "-batchmode",
        ...(options.nographics === false ? [] : ["-nographics"]),
        "-projectPath",
        item,
        "-logFile",
        logFile,
      ];
      const child = await launchUnity(unityPath, unityArgs, {
        ...options,
        projectPath: item,
        projectIndex: index,
        logFile,
      });
      launches.push({
        projectPath: item,
        unityPath,
        unityArgs,
        logFile,
        pid: positiveInt(child?.pid),
        child,
      });
    }

    const waitResults = [];
    const smokeResults = [];
    const publicSmokeResults = [];
    const publicMvpResults = [];
    const publicChatDryRunResults = [];
    const publicRunDryRunResults = [];
    for (let index = 0; index < launches.length; index++) {
      const launch = launches[index];
      const selector = index === 0
        ? stringValue(options.selector) ?? launch.projectPath
        : launch.projectPath;
      const waitResult = await (options.waitForUnityTarget ?? waitForUnityTarget)({
        ...options,
        selector,
        timeoutMs: options.timeoutMs ?? DEFAULT_E2E_WAIT_TIMEOUT_MS,
        intervalMs: options.intervalMs ?? 1_000,
      });
      if (waitResult.timedOut) {
        throw new Error(`[uos e2e] Unity bridge did not become ready for ${launch.projectPath} within ${waitResult.elapsedMs}ms. log: ${launch.logFile}`);
      }

      const target = waitResult.target ?? (waitResult.editors?.length === 1 ? waitResult.editors[0] : undefined);
      if (target === undefined) {
        throw new Error(`[uos e2e] wait completed without a selected Unity bridge for ${launch.projectPath}`);
      }

      waitResults.push(waitResult);
      smokeResults.push(await (options.runUnitySmoke ?? runUnitySmoke)(target, {
        ...(options.smokeOptions ?? parseSmokeOptions([])),
        timeoutMs: options.toolTimeoutMs ?? TOOL_CALL_TIMEOUT_MS,
      }));
      const selectedOptions = { ...options, selector };
      if (options.publicSmoke === true) {
        publicSmokeResults.push(await runPublicSmokeCli(target, {
          ...selectedOptions,
          repoRoot: options.repoRoot,
        }));
      }
      if (options.publicMvp === true) {
        publicMvpResults.push(await runPublicMvpCli(target, {
          ...selectedOptions,
          repoRoot: options.repoRoot,
        }));
      }
      if (options.publicChatDryRun === true) {
        publicChatDryRunResults.push(await runPublicChatDryRunCli(target, {
          ...selectedOptions,
          repoRoot: options.repoRoot,
        }));
      }
      if (options.publicRunDryRun === true) {
        publicRunDryRunResults.push(await runPublicRunDryRunCli(target, {
          ...selectedOptions,
          repoRoot: options.repoRoot,
        }));
      }
    }

    result = {
      ok: true,
      mode: "multi-editor",
      projectPath,
      projectPaths,
      launches: launches.map(({ child, ...launch }) => launch),
      waitResults,
      smokeResults,
      publicSmokeResults: publicSmokeResults.length > 0 ? publicSmokeResults : undefined,
      publicMvpResults: publicMvpResults.length > 0 ? publicMvpResults : undefined,
      publicChatDryRunResults: publicChatDryRunResults.length > 0 ? publicChatDryRunResults : undefined,
      publicRunDryRunResults: publicRunDryRunResults.length > 0 ? publicRunDryRunResults : undefined,
      keepOpen: options.keepOpen === true,
      stopped: undefined,
      cleaned: undefined,
    };
    return result;
  } finally {
    if (options.keepOpen === true) {
      stopped = launches.map((launch) => ({
        projectPath: launch.projectPath,
        pid: launch.pid,
        skipped: true,
        reason: "--keep-open",
      }));
    } else {
      stopped = [];
      for (const launch of launches) {
        const state = await stopUnityProcess(launch.child, {
          timeoutMs: options.stopTimeoutMs ?? DEFAULT_E2E_STOP_TIMEOUT_MS,
        });
        stopped.push({ projectPath: launch.projectPath, pid: launch.pid, ...state });
      }
    }
    cleaned = await cleanE2EStaleRegistry(options);
    if (options.onCleanup !== undefined) {
      await options.onCleanup({ stopped, cleaned });
    }
    if (result !== undefined) {
      result.stopped = stopped;
      result.cleaned = cleaned;
    }
  }
}

export function formatE2EResult(result) {
  if (result.mode === "multi-editor") return formatMultiE2EResult(result);
  const lines = [
    "[uos e2e] ok",
    `project: ${result.projectPath}`,
    `unity: ${result.unityPath}`,
    `pid: ${result.pid ?? "(unknown)"}`,
    `log: ${result.logFile}`,
    "",
    formatWaitResult(result.wait),
    "",
    ...(result.entryDryRun !== undefined
      ? ["[uos e2e] entry dry-run", result.entryDryRun.output, ""]
      : []),
    formatSmokeResult(result.smoke),
    ...(result.publicSmoke !== undefined
      ? ["", "[uos e2e] public smoke", formatPublicSmokeResult(result.publicSmoke)]
      : []),
    ...(result.publicMvp !== undefined
      ? ["", "[uos e2e] public mvp preflight", formatPublicMvpResult(result.publicMvp)]
      : []),
    ...(result.publicChatDryRun !== undefined
      ? ["", "[uos e2e] public chat dry-run", formatPublicSmokeResult(result.publicChatDryRun)]
      : []),
    ...(result.publicRunDryRun !== undefined
      ? ["", "[uos e2e] public run dry-run", formatPublicSmokeResult(result.publicRunDryRun)]
      : []),
    ...(result.publicRunAi !== undefined
      ? ["", "[uos e2e] public run AI", formatPublicRunAiResult(result.publicRunAi)]
      : []),
    ...(result.postSmokeEntryDryRun !== undefined
      ? ["", "[uos e2e] post-smoke entry dry-run", result.postSmokeEntryDryRun.output]
      : []),
  ];
  if (result.keepOpen) {
    lines.push("", "[uos e2e] Unity left running because --keep-open was set.");
  } else if (result.stopped?.skipped !== true) {
    const status = result.stopped?.exited === true ? "stopped" : "stop requested";
    lines.push("", `[uos e2e] Unity ${status}.`);
  }
  if (result.cleaned?.removed !== undefined) {
    lines.push(`[uos e2e] stale registry entries removed: ${result.cleaned.removed}`);
  }
  return lines.join("\n");
}

async function runPublicSmokeCli(target, options = {}) {
  const repoRoot = stringValue(options.repoRoot) ?? fileURLToPath(new URL("..", import.meta.url));
  const selector = stringValue(options.publicSmokeSelector)
    ?? stringValue(options.selector)
    ?? stringValue(target?.projectPath)
    ?? stringValue(target?.projectName)
    ?? stringValue(target?.instanceId);
  if (selector === undefined) {
    throw new Error("[uos e2e] public smoke requires a selected Unity project selector");
  }

  const args = [
    path.join(repoRoot, "bin", "uos.js"),
    "smoke",
    "--unity-project",
    selector,
  ];
  const materialsDir = stringValue(options.entryMaterialsDir);
  if (materialsDir !== undefined) {
    args.push("--uos-materials", materialsDir);
  }
  args.push(...normalizeFileList(options.publicSmokeArgs));

  const command = stringValue(options.nodeCommand) ?? process.execPath;
  const commandEnv = options.env ?? process.env;
  const redactions = publicCommandRedactions(target, { env: commandEnv });
  const result = sanitizePublicCommandResult(runCommand(command, args, {
    cwd: repoRoot,
    env: commandEnv,
    timeoutMs: positiveInt(options.publicSmokeTimeoutMs)
      ?? positiveInt(options.aiRunTimeoutMs)
      ?? DEFAULT_OPENCODE_AI_SMOKE_TIMEOUT_MS,
    shell: false,
    commandRunner: options.publicSmokeCommandRunner ?? options.commandRunner,
  }), redactions);
  const publicSmoke = {
    command,
    args,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`[uos e2e] public smoke failed: ${result.error ?? `exit ${result.status}`}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
  }
  return publicSmoke;
}

async function runPublicMvpCli(target, options = {}) {
  const repoRoot = stringValue(options.repoRoot) ?? fileURLToPath(new URL("..", import.meta.url));
  const selector = stringValue(options.publicMvpSelector)
    ?? stringValue(options.selector)
    ?? stringValue(target?.projectPath)
    ?? stringValue(target?.projectName)
    ?? stringValue(target?.instanceId);
  if (selector === undefined) {
    throw new Error("[uos e2e] public mvp preflight requires a selected Unity project selector");
  }

  const args = [
    path.join(repoRoot, "bin", "uos.js"),
    "mvp",
    "--unity-project",
    selector,
  ];
  const materialsDir = stringValue(options.entryMaterialsDir);
  if (materialsDir !== undefined) {
    args.push("--uos-materials", materialsDir);
  }
  for (const file of normalizeFileList(options.entryFiles)) {
    args.push("--uos-file", file);
  }
  if (options.publicMvpJson === true) {
    args.push("--json");
  }

  const command = stringValue(options.nodeCommand) ?? process.execPath;
  const commandEnv = options.env ?? process.env;
  const redactions = publicCommandRedactions(target, { env: commandEnv });
  const result = sanitizePublicCommandResult(runCommand(command, args, {
    cwd: repoRoot,
    env: commandEnv,
    timeoutMs: positiveInt(options.publicMvpTimeoutMs)
      ?? positiveInt(options.publicRunTimeoutMs)
      ?? positiveInt(options.publicSmokeTimeoutMs)
      ?? 60_000,
    shell: false,
    commandRunner: options.publicMvpCommandRunner ?? options.commandRunner,
  }), redactions);
  const publicMvp = {
    command,
    args,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    json: options.publicMvpJson === true,
  };
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`[uos e2e] public mvp preflight failed: ${result.error ?? `exit ${result.status}`}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
  }
  if (options.publicMvpJson === true) {
    const parsed = parseJsonFromOutput(result.stdout);
    publicMvp.parsedOk = parsed?.ok === true;
    if (parsed?.ok !== true) {
      throw new Error(`[uos e2e] public mvp preflight JSON did not report ok=true\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
    }
    publicMvp.acceptanceGateIds = mvpAcceptanceGateIds(parsed);
    const missingGates = expectedMvpAcceptanceGateIds()
      .filter((id) => !publicMvp.acceptanceGateIds.includes(id));
    if (missingGates.length > 0) {
      throw new Error(`[uos e2e] public mvp preflight JSON missing acceptance gates: ${missingGates.join(", ")}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
    }
    publicMvp.commandLineKeys = mvpCommandLineKeys(parsed);
    const missingCommandLines = expectedMvpCommandLineKeys({ projectPath: target?.projectPath })
      .filter((key) => !publicMvp.commandLineKeys.includes(key));
    if (missingCommandLines.length > 0) {
      throw new Error(`[uos e2e] public mvp preflight JSON missing command lines: ${missingCommandLines.join(", ")}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
    }
    const commandLineProblems = validateMvpCommandLineContent(parsed, {
      selector,
      projectPath: target?.projectPath,
      materialsDir: options.entryMaterialsDir,
      files: options.entryFiles,
    });
    publicMvp.commandLineValidation = {
      ok: commandLineProblems.length === 0,
      problems: commandLineProblems,
    };
    if (commandLineProblems.length > 0) {
      throw new Error(`[uos e2e] public mvp preflight JSON command lines do not match selected project/materials: ${commandLineProblems.join("; ")}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
    }
    publicMvp.preflightSummary = mvpPreflightSummary(parsed);
    const summaryProblems = validateMvpPreflightSummary(parsed, {
      projectPath: target?.projectPath,
    });
    publicMvp.preflightSummaryValidation = {
      ok: summaryProblems.length === 0,
      problems: summaryProblems,
    };
    if (summaryProblems.length > 0) {
      throw new Error(`[uos e2e] public mvp preflight JSON summary is not ready: ${summaryProblems.join("; ")}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
    }
  }
  return publicMvp;
}

function expectedMvpAcceptanceGateIds() {
  return [
    "consumer-install-and-runtime",
    "ready-and-context",
    "public-mvp-preflight",
    "entry-dry-run",
    "real-ai-edit",
    "follow-up-edit",
  ];
}

function mvpAcceptanceGateIds(parsed = {}) {
  if (!Array.isArray(parsed.acceptanceGates)) return [];
  return parsed.acceptanceGates
    .map((gate) => stringValue(gate?.id))
    .filter((id) => id !== undefined);
}

function expectedMvpCommandLineKeys(expected = {}) {
  const keys = [
    "doctorProject",
    "doctorRuntime",
    "ready",
    "context",
    "chatDryRun",
    "runDryRun",
    "runAiEdit",
    "chatContinue",
  ];
  if (stringValue(expected.projectPath) !== undefined) {
    keys.push("publicMvpE2E");
  }
  return keys;
}

function mvpCommandLineKeys(parsed = {}) {
  if (parsed.commandLines === undefined || typeof parsed.commandLines !== "object" || parsed.commandLines === null) {
    return [];
  }
  return Object.entries(parsed.commandLines)
    .filter(([, value]) => stringValue(value) !== undefined)
    .map(([key]) => key);
}

function mvpPreflightSummary(parsed = {}) {
  return parsed.preflightSummary !== undefined && typeof parsed.preflightSummary === "object" && parsed.preflightSummary !== null
    ? parsed.preflightSummary
    : undefined;
}

function validateMvpPreflightSummary(parsed = {}, expected = {}) {
  const summary = mvpPreflightSummary(parsed);
  if (summary === undefined) {
    return ["preflightSummary missing"];
  }
  const problems = [];
  if (summary.status !== "ready-for-user-validation") {
    problems.push(`preflightSummary.status is ${stringValue(summary.status) ?? "(missing)"}`);
  }
  if (summary.next !== "run-user-led-mvp-gates") {
    problems.push(`preflightSummary.next is ${stringValue(summary.next) ?? "(missing)"}`);
  }
  if (summary.selectedProject !== true) {
    problems.push("preflightSummary.selectedProject is not true");
  }
  if (summary.materialReady !== true) {
    problems.push("preflightSummary.materialReady is not true");
  }
  if (summary.aiSessionReady !== true) {
    problems.push("preflightSummary.aiSessionReady is not true");
  }

  const commandLines = summary.commandLines !== undefined && typeof summary.commandLines === "object" && summary.commandLines !== null
    ? summary.commandLines
    : {};
  const required = Array.isArray(commandLines.required) ? commandLines.required : [];
  const present = Array.isArray(commandLines.present) ? commandLines.present : [];
  const missing = Array.isArray(commandLines.missing) ? commandLines.missing : undefined;
  for (const key of expectedMvpCommandLineKeys({ projectPath: expected.projectPath })) {
    if (!required.includes(key)) {
      problems.push(`preflightSummary.commandLines.required missing ${key}`);
    }
    if (!present.includes(key)) {
      problems.push(`preflightSummary.commandLines.present missing ${key}`);
    }
  }
  if (missing === undefined) {
    problems.push("preflightSummary.commandLines.missing is missing");
  } else if (missing.length > 0) {
    problems.push(`preflightSummary.commandLines.missing has ${missing.join(", ")}`);
  }

  const gates = summary.acceptanceGates !== undefined && typeof summary.acceptanceGates === "object" && summary.acceptanceGates !== null
    ? summary.acceptanceGates
    : {};
  const gateIds = Array.isArray(gates.ids) ? gates.ids : [];
  for (const id of expectedMvpAcceptanceGateIds()) {
    if (!gateIds.includes(id)) {
      problems.push(`preflightSummary.acceptanceGates.ids missing ${id}`);
    }
  }
  const pendingUserEvidence = Array.isArray(gates.pendingUserEvidence) ? gates.pendingUserEvidence : undefined;
  const optionalUserEvidence = Array.isArray(gates.optionalUserEvidence) ? gates.optionalUserEvidence : undefined;
  const blockedByPreflight = Array.isArray(gates.blockedByPreflight) ? gates.blockedByPreflight : undefined;
  if (pendingUserEvidence === undefined) {
    problems.push("preflightSummary.acceptanceGates.pendingUserEvidence is missing");
  }
  if (optionalUserEvidence === undefined) {
    problems.push("preflightSummary.acceptanceGates.optionalUserEvidence is missing");
  }
  if (blockedByPreflight === undefined) {
    problems.push("preflightSummary.acceptanceGates.blockedByPreflight is missing");
  } else if (blockedByPreflight.length > 0) {
    problems.push(`preflightSummary.acceptanceGates.blockedByPreflight has ${blockedByPreflight.join(", ")}`);
  }
  if (pendingUserEvidence !== undefined && optionalUserEvidence !== undefined) {
    for (const id of expectedMvpAcceptanceGateIds()) {
      if (!pendingUserEvidence.includes(id) && !optionalUserEvidence.includes(id)) {
        problems.push(`preflightSummary.acceptanceGates user evidence state missing ${id}`);
      }
    }
  }
  return problems;
}

function validateMvpCommandLineContent(parsed = {}, expected = {}) {
  const commandLines = parsed.commandLines !== undefined && typeof parsed.commandLines === "object" && parsed.commandLines !== null
    ? parsed.commandLines
    : {};
  const problems = [];
  const selector = stringValue(expected.selector);
  if (selector !== undefined) {
    for (const key of ["ready", "context", "chatDryRun", "runDryRun", "runAiEdit", "chatContinue"]) {
      const line = stringValue(commandLines[key]);
      if (line !== undefined && !commandLineContainsNeedle(line, selector)) {
        problems.push(`${key} missing selected project ${selector}`);
      }
    }
  }
  const projectPath = stringValue(expected.projectPath) ?? selector;
  const projectPathKeys = ["doctorProject"];
  if (stringValue(commandLines.publicMvpE2E) !== undefined) {
    projectPathKeys.push("publicMvpE2E");
  }
  for (const key of projectPathKeys) {
    const line = stringValue(commandLines[key]);
    if (line !== undefined && projectPath !== undefined && !commandLineContainsNeedle(line, projectPath)) {
      problems.push(`${key} missing project path ${projectPath}`);
    }
  }

  const materialNeedles = [...new Set([
    stringValue(expected.materialsDir),
    ...normalizeFileList(expected.files),
  ].filter((value) => value !== undefined))];
  if (materialNeedles.length > 0) {
    const materialKeys = ["context", "chatDryRun", "runDryRun", "runAiEdit"];
    if (stringValue(commandLines.publicMvpE2E) !== undefined) {
      materialKeys.push("publicMvpE2E");
    }
    for (const key of materialKeys) {
      const line = stringValue(commandLines[key]);
      if (line === undefined) continue;
      for (const material of materialNeedles) {
        if (!commandLineContainsNeedle(line, material)) {
          problems.push(`${key} missing planning material ${material}`);
        }
      }
    }
  }
  return problems;
}

function commandLineContainsNeedle(line, needle) {
  const haystack = stringValue(line);
  const rawNeedle = stringValue(needle);
  if (haystack === undefined || rawNeedle === undefined) return false;
  const escapedNeedle = JSON.stringify(rawNeedle).slice(1, -1);
  if (haystack.includes(rawNeedle) || haystack.includes(escapedNeedle)) return true;
  const unescapedHaystack = haystack.replace(/\\\\/g, "\\");
  if (unescapedHaystack.includes(rawNeedle)) return true;
  const slashHaystack = unescapedHaystack.replace(/\\/g, "/");
  const slashNeedle = rawNeedle.replace(/\\/g, "/");
  return slashHaystack.includes(slashNeedle);
}

async function runPublicChatDryRunCli(target, options = {}) {
  const repoRoot = stringValue(options.repoRoot) ?? fileURLToPath(new URL("..", import.meta.url));
  const selector = stringValue(options.publicChatSelector)
    ?? stringValue(options.selector)
    ?? stringValue(target?.projectPath)
    ?? stringValue(target?.projectName)
    ?? stringValue(target?.instanceId);
  if (selector === undefined) {
    throw new Error("[uos e2e] public chat dry-run requires a selected Unity project selector");
  }

  const args = [
    path.join(repoRoot, "bin", "uos.js"),
    "chat",
    "--unity-project",
    selector,
  ];
  const materialsDir = stringValue(options.entryMaterialsDir);
  if (materialsDir !== undefined) {
    args.push("--uos-materials", materialsDir);
  }
  for (const file of normalizeFileList(options.entryFiles)) {
    args.push("--uos-file", file);
  }
  args.push("--uos-dry-run");

  const command = stringValue(options.nodeCommand) ?? process.execPath;
  const commandEnv = options.env ?? process.env;
  const redactions = publicCommandRedactions(target, { env: commandEnv });
  const result = sanitizePublicCommandResult(runCommand(command, args, {
    cwd: repoRoot,
    env: commandEnv,
    timeoutMs: positiveInt(options.publicChatTimeoutMs)
      ?? positiveInt(options.publicRunTimeoutMs)
      ?? positiveInt(options.publicSmokeTimeoutMs)
      ?? 60_000,
    shell: false,
    commandRunner: options.publicChatCommandRunner ?? options.commandRunner,
  }), redactions);
  const publicChat = {
    command,
    args,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`[uos e2e] public chat dry-run failed: ${result.error ?? `exit ${result.status}`}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
  }
  return publicChat;
}

async function runPublicRunDryRunCli(target, options = {}) {
  const repoRoot = stringValue(options.repoRoot) ?? fileURLToPath(new URL("..", import.meta.url));
  const selector = stringValue(options.publicRunSelector)
    ?? stringValue(options.selector)
    ?? stringValue(target?.projectPath)
    ?? stringValue(target?.projectName)
    ?? stringValue(target?.instanceId);
  if (selector === undefined) {
    throw new Error("[uos e2e] public run dry-run requires a selected Unity project selector");
  }

  const args = [
    path.join(repoRoot, "bin", "uos.js"),
    "--unity-project",
    selector,
  ];
  const materialsDir = stringValue(options.entryMaterialsDir);
  if (materialsDir !== undefined) {
    args.push("--uos-materials", materialsDir);
  }
  for (const file of normalizeFileList(options.entryFiles)) {
    args.push("--uos-file", file);
  }
  args.push(
    "--uos-dry-run",
    "run",
    "--continue",
    stringValue(options.publicRunPrompt)
      ?? DEFAULT_PUBLIC_RUN_DRY_RUN_PROMPT,
  );

  const command = stringValue(options.nodeCommand) ?? process.execPath;
  const commandEnv = options.env ?? process.env;
  const redactions = publicCommandRedactions(target, { env: commandEnv });
  const result = sanitizePublicCommandResult(runCommand(command, args, {
    cwd: repoRoot,
    env: commandEnv,
    timeoutMs: positiveInt(options.publicRunTimeoutMs)
      ?? positiveInt(options.publicSmokeTimeoutMs)
      ?? 60_000,
    shell: false,
    commandRunner: options.publicRunCommandRunner ?? options.commandRunner,
  }), redactions);
  const publicRun = {
    command,
    args,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error(`[uos e2e] public run dry-run failed: ${result.error ?? `exit ${result.status}`}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
  }
  return publicRun;
}

async function runPublicRunAiCli(target, options = {}) {
  const repoRoot = stringValue(options.repoRoot) ?? fileURLToPath(new URL("..", import.meta.url));
  const selector = stringValue(options.publicRunSelector)
    ?? stringValue(options.selector)
    ?? stringValue(target?.projectPath)
    ?? stringValue(target?.projectName)
    ?? stringValue(target?.instanceId);
  if (selector === undefined) {
    throw new Error("[uos e2e] public run AI requires a selected Unity project selector");
  }

  const files = normalizeFileList(options.entryFiles);
  if (files.length === 0) {
    throw new Error("[uos e2e] public run AI requires at least one --uos-file attachment");
  }
  const materialsDir = stringValue(options.entryMaterialsDir);
  const commandEnv = options.env ?? process.env;
  const launchInputs = await validateLaunchInputs(target, {
    materialsDir,
    files,
    env: commandEnv,
  });

  const args = [
    path.join(repoRoot, "bin", "uos.js"),
    "--unity-project",
    selector,
  ];
  if (materialsDir !== undefined) {
    args.push("--uos-materials", materialsDir);
  }
  for (const file of files) {
    args.push("--uos-file", file);
  }

  const screenName = stringValue(options.publicRunAiScreenName) ?? DEFAULT_PUBLIC_RUN_AI_SCREEN_NAME;
  const prompt = stringValue(options.publicRunAiPrompt)
    ?? (stringValue(options.publicRunPrompt) !== DEFAULT_PUBLIC_RUN_DRY_RUN_PROMPT
      ? stringValue(options.publicRunPrompt)
      : undefined)
    ?? defaultPublicRunAiPrompt(screenName);
  const title = stringValue(options.publicRunAiTitle) ?? "UOS Public Run AI E2E";
  const model = stringValue(options.publicRunAiModel)
    ?? stringValue(options.aiRunModel)
    ?? DEFAULT_OPENCODE_AI_SMOKE_MODEL;
  args.push("run", "--title", title);
  if (model !== undefined) {
    args.push("-m", model);
  }
  args.push(prompt);

  const plan = {
    mode: "material-screen",
    materialPath: launchInputs.files[0],
    screenName,
    expectedTools: OPENCODE_AI_MATERIAL_SCREEN_SMOKE_TOOLS,
  };
  const command = stringValue(options.nodeCommand) ?? process.execPath;
  const startedAt = new Date().toISOString();
  const redactions = publicCommandRedactions(target, { env: commandEnv });
  const result = sanitizePublicCommandResult(runCommand(command, args, {
    cwd: repoRoot,
    env: commandEnv,
    timeoutMs: positiveInt(options.publicRunTimeoutMs)
      ?? positiveInt(options.publicSmokeTimeoutMs)
      ?? DEFAULT_OPENCODE_AI_SMOKE_TIMEOUT_MS,
    shell: false,
    commandRunner: options.publicRunAiCommandRunner ?? options.commandRunner,
  }), redactions);
  const journal = await inspectOpencodeAiSmokeJournal(target, plan, {
    ...options,
    startedAt,
    aiVerifyJournal: options.publicRunAiVerifyJournal ?? true,
  });
  const ok = result.status === 0
    && result.error === undefined
    && (journal.skipped === true || (journal.missingTools.length === 0 && journal.orderOk !== false));
  const publicRunAi = {
    ok,
    command,
    args,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    title,
    model,
    materialPath: launchInputs.files[0],
    screenName,
    expectedJournalTools: journal.expectedTools,
    observedJournalTools: journal.observedTools,
    missingJournalTools: journal.missingTools,
    journalScreenId: journal.screenId,
    journalOrderOk: journal.orderOk,
    journalOrderError: journal.orderError,
    journalVerified: journal.verified,
    journalSkippedReason: journal.skippedReason,
  };
  if (!ok) {
    const missing = journal.missingTools.length > 0
      ? ` missing journal evidence: ${journal.missingTools.join(", ")}`
      : "";
    const order = journal.orderError !== undefined
      ? ` journal order error: ${journal.orderError}`
      : "";
    throw new Error(`[uos e2e] public run AI failed: ${result.error ?? `exit ${result.status}`}${missing}${order}\n${trimCommandOutput(result.stdout, result.stderr, redactions)}`);
  }
  return publicRunAi;
}

function defaultPublicRunAiPrompt(screenName = DEFAULT_PUBLIC_RUN_AI_SCREEN_NAME) {
  return [
    "Use UOS tools against the selected Unity project.",
    "First call get_uos_context, then read the launch-attached planning file with read_planning_material,",
    `then create one Unity screen from that same file with create_screen_from_material using screen name ${screenName}.`,
    "Stop after reporting the created screenId; do not save the scene.",
  ].join(" ");
}

function formatPublicSmokeResult(result = {}) {
  const lines = [
    `command: ${formatPublicCommand(result.command, result.args)}`,
    `exit: ${result.status ?? "(unknown)"}`,
  ];
  const stdout = redactSensitivePublicText(result.stdout).trim();
  const stderr = redactSensitivePublicText(result.stderr).trim();
  if (stdout.length > 0) lines.push("stdout:", truncateText(stdout, 4_000));
  if (stderr.length > 0) lines.push("stderr:", truncateText(stderr, 4_000));
  if (result.error !== undefined) lines.push(`error: ${redactSensitivePublicText(result.error)}`);
  return lines.join("\n");
}

function formatPublicMvpResult(result = {}) {
  const lines = [
    `command: ${formatPublicCommand(result.command, result.args)}`,
    `exit: ${result.status ?? "(unknown)"}`,
  ];
  if (result.json === true) {
    lines.push(`parsed ok: ${result.parsedOk === true ? "true" : "false"}`);
  }
  if (result.preflightSummary !== undefined) {
    const summary = result.preflightSummary;
    const commandLines = summary.commandLines ?? {};
    const present = Array.isArray(commandLines.present) ? commandLines.present.length : 0;
    const required = Array.isArray(commandLines.required) ? commandLines.required.length : 0;
    const missing = Array.isArray(commandLines.missing) ? commandLines.missing : [];
    const gates = summary.acceptanceGates ?? {};
    const gateCount = Number.isInteger(gates.count) ? gates.count : (Array.isArray(gates.ids) ? gates.ids.length : 0);
    lines.push(`preflight: ${summary.status ?? "(missing)"} next=${summary.next ?? "(missing)"}`);
    lines.push(`preflight readiness: selected=${summary.selectedProject === true ? "yes" : "no"} material=${summary.materialReady === true ? "yes" : "no"} ai=${summary.aiSessionReady === true ? "yes" : "no"}`);
    lines.push(`preflight command lines: ${present}/${required}${missing.length > 0 ? ` missing=${missing.join(",")}` : ""}`);
    lines.push(`preflight acceptance gates: ${gateCount}`);
  }
  if (Array.isArray(result.acceptanceGateIds)) {
    lines.push(`acceptance gates: ${result.acceptanceGateIds.join(",")}`);
  }
  if (Array.isArray(result.commandLineKeys)) {
    lines.push(`command lines: ${result.commandLineKeys.join(",")}`);
  }
  if (result.commandLineValidation !== undefined) {
    lines.push(`command line validation: ${result.commandLineValidation.ok === true ? "ok" : "failed"}`);
    const problems = result.commandLineValidation.problems;
    if (Array.isArray(problems) && problems.length > 0) {
      lines.push(`command line problems: ${problems.join("; ")}`);
    }
  }
  if (result.preflightSummaryValidation !== undefined) {
    lines.push(`preflight summary validation: ${result.preflightSummaryValidation.ok === true ? "ok" : "failed"}`);
    const problems = result.preflightSummaryValidation.problems;
    if (Array.isArray(problems) && problems.length > 0) {
      lines.push(`preflight summary problems: ${problems.join("; ")}`);
    }
  }
  const stdout = redactSensitivePublicText(result.stdout).trim();
  const stderr = redactSensitivePublicText(result.stderr).trim();
  if (stdout.length > 0) lines.push("stdout:", truncateText(stdout, 4_000));
  if (stderr.length > 0) lines.push("stderr:", truncateText(stderr, 4_000));
  if (result.error !== undefined) lines.push(`error: ${redactSensitivePublicText(result.error)}`);
  return lines.join("\n");
}

function formatPublicRunAiResult(result = {}) {
  const lines = [formatPublicSmokeResult(result)];
  lines.push(`ok: ${result.ok === true ? "true" : "false"}`);
  if (result.materialPath !== undefined) lines.push(`material: ${result.materialPath}`);
  if (result.screenName !== undefined) lines.push(`screen name: ${result.screenName}`);
  if (result.journalScreenId !== undefined) lines.push(`screen: ${result.journalScreenId}`);
  if (result.journalVerified === true) {
    lines.push(`journal: ${(result.observedJournalTools ?? []).join(",") || "none"}`);
  } else if (result.journalSkippedReason !== undefined) {
    lines.push(`journal: skipped(${result.journalSkippedReason})`);
  }
  if (Array.isArray(result.missingJournalTools) && result.missingJournalTools.length > 0) {
    lines.push(`missing journal: ${result.missingJournalTools.join(",")}`);
  }
  if (result.journalOrderError !== undefined) {
    lines.push(`journal order error: ${result.journalOrderError}`);
  }
  return lines.join("\n");
}

function formatPublicCommand(command, args = []) {
  return [command, ...args].map(formatCommandPart).join(" ");
}

function formatCommandPart(value) {
  const text = String(value ?? "");
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function trimCommandOutput(stdout, stderr, redactions = []) {
  return [stdout, stderr]
    .map((value) => redactSensitivePublicText(value, redactions).trim())
    .filter((value) => value.length > 0)
    .map((value) => truncateText(value, 1_500))
    .join("\n");
}

function publicCommandRedactions(target, options = {}) {
  const env = options.env ?? {};
  const values = [
    stringValue(target?.token),
    stringValue(env.UNITY_MCP_TOKEN),
  ];
  const seen = new Set();
  const redactions = [];
  for (const value of values) {
    if (value === undefined || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    redactions.push(value);
  }
  return redactions.sort((a, b) => b.length - a.length);
}

function sanitizePublicCommandResult(result = {}, redactions = []) {
  return {
    ...result,
    stdout: redactSensitivePublicText(result.stdout, redactions),
    stderr: redactSensitivePublicText(result.stderr, redactions),
    error: result.error !== undefined
      ? redactSensitivePublicText(result.error, redactions)
      : undefined,
  };
}

function redactSensitivePublicText(value, redactions = []) {
  let text = String(value ?? "");
  for (const secret of redactions) {
    if (secret.length === 0) continue;
    text = text.split(secret).join("(redacted)");
  }
  text = text.replace(
    /\b(UNITY_MCP_TOKEN\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;\]}]+)/gi,
    "$1(set)",
  );
  text = text.replace(
    /("UNITY_MCP_TOKEN"\s*:\s*)(?:"[^"\r\n]*"|[^\s,}\]]+)/gi,
    '$1"(set)"',
  );
  return text;
}

function formatMultiE2EResult(result) {
  const lines = [
    "[uos e2e] ok",
    "mode: multi-editor",
    `projects: ${result.projectPaths?.length ?? result.launches?.length ?? 0}`,
  ];
  for (const [index, launch] of (result.launches ?? []).entries()) {
    lines.push(
      `project[${index + 1}]: ${launch.projectPath}`,
      `unity[${index + 1}]: ${launch.unityPath}`,
      `pid[${index + 1}]: ${launch.pid ?? "(unknown)"}`,
      `log[${index + 1}]: ${launch.logFile}`,
      "",
      formatWaitResult(result.waitResults?.[index] ?? {}),
      "",
      formatSmokeResult(result.smokeResults?.[index] ?? {}),
      "",
      ...(result.publicSmokeResults?.[index] !== undefined
        ? [`[uos e2e] public smoke project[${index + 1}]`, formatPublicSmokeResult(result.publicSmokeResults[index]), ""]
        : []),
      ...(result.publicMvpResults?.[index] !== undefined
        ? [`[uos e2e] public mvp preflight project[${index + 1}]`, formatPublicMvpResult(result.publicMvpResults[index]), ""]
        : []),
      ...(result.publicChatDryRunResults?.[index] !== undefined
        ? [`[uos e2e] public chat dry-run project[${index + 1}]`, formatPublicSmokeResult(result.publicChatDryRunResults[index]), ""]
        : []),
      ...(result.publicRunDryRunResults?.[index] !== undefined
        ? [`[uos e2e] public run dry-run project[${index + 1}]`, formatPublicSmokeResult(result.publicRunDryRunResults[index]), ""]
        : []),
    );
  }
  if (result.keepOpen) {
    lines.push("[uos e2e] Unity instances left running because --keep-open was set.");
  } else if (Array.isArray(result.stopped)) {
    const stopped = result.stopped.filter((state) => state.exited === true).length;
    lines.push(`[uos e2e] Unity instances stopped: ${stopped}/${result.stopped.length}`);
  }
  if (result.cleaned?.removed !== undefined) {
    lines.push(`[uos e2e] stale registry entries removed: ${result.cleaned.removed}`);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export async function resolveUnityExecutable(projectPath, options = {}) {
  const explicit = stringValue(options.unityPath)
    ?? stringValue(options.env?.UNITY_EXE)
    ?? stringValue(options.env?.UNITY_PATH);
  if (explicit !== undefined) {
    const resolved = path.resolve(explicit);
    await assertFile(resolved, "--unity");
    return resolved;
  }

  const version = await readUnityProjectVersion(projectPath);
  const candidates = unityExecutableCandidates(version, options);
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }

  const hint = version !== undefined
    ? ` for Unity ${version}`
    : "";
  const searched = candidates.length > 0 ? ` Searched: ${candidates.join(", ")}` : "";
  throw new Error(`[uos e2e] could not find Unity executable${hint}. Pass --unity <path-to-Unity.exe>.${searched}`);
}

export async function resolveUnityExecutableForGui(projectPath, options = {}) {
  const resolvedProjectPath = path.resolve(projectPath ?? "");
  await assertUnityProjectRoot(resolvedProjectPath);
  const version = await readUnityProjectVersion(resolvedProjectPath);
  const config = options.config ?? await (options.readUosConfig ?? readUosConfig)(options);
  const configuredForVersion = version !== undefined ? stringValue(config?.unityEditors?.[version]) : undefined;
  const candidates = [
    configuredForVersion,
    stringValue(config?.defaultUnityExecutable),
    stringValue(options.unityPath),
    stringValue(options.env?.UNITY_EXE),
    stringValue(options.env?.UNITY_PATH),
    ...unityExecutableCandidates(version, options),
  ].filter((item) => item !== undefined);

  const searched = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    searched.push(resolved);
    if (await fileExists(resolved)) {
      return {
        ok: true,
        unityPath: resolved,
        projectPath: resolvedProjectPath,
        unityVersion: version,
        source: candidate === configuredForVersion
          ? "configured-version"
          : candidate === config?.defaultUnityExecutable
            ? "configured-default"
            : candidate === options.unityPath
              ? "option"
              : candidate === options.env?.UNITY_EXE || candidate === options.env?.UNITY_PATH
                ? "env"
                : "unity-hub",
        searched,
      };
    }
  }

  return {
    ok: false,
    projectPath: resolvedProjectPath,
    unityVersion: version,
    searched,
    error: `[uos gui] could not find Unity executable${version !== undefined ? ` for Unity ${version}` : ""}. Configure Unity.exe in the GUI.`,
  };
}

export async function configureUnityExecutableForGui(input = {}, options = {}) {
  const unityExecutable = stringValue(input.unityExecutable ?? input.path);
  if (unityExecutable === undefined) {
    throw new Error("[uos gui] unityExecutable is required");
  }
  const resolved = path.resolve(unityExecutable);
  await assertFile(resolved, "unityExecutable");
  const projectPath = stringValue(input.projectPath);
  const version = stringValue(input.version)
    ?? (projectPath !== undefined ? await readUnityProjectVersion(path.resolve(projectPath)) : undefined);
  return await (options.saveUnityExecutableConfig ?? saveUnityExecutableConfig)({
    defaultUnityExecutable: input.default === false ? undefined : resolved,
    version,
    unityExecutable: version !== undefined ? resolved : undefined,
  }, options);
}

export async function launchUnityProject(projectPath, options = {}) {
  const resolvedProjectPath = path.resolve(projectPath ?? "");
  const resolved = await resolveUnityExecutableForGui(resolvedProjectPath, options);
  if (resolved.ok !== true) return { ...resolved, launched: false };

  const args = ["-projectPath", resolvedProjectPath];
  const launcher = options.launchUnity ?? defaultLaunchUnity;
  const child = await launcher(resolved.unityPath, args, {
    ...options,
    projectPath: resolvedProjectPath,
  });
  return {
    ok: true,
    launched: true,
    projectPath: resolvedProjectPath,
    unityPath: resolved.unityPath,
    unityVersion: resolved.unityVersion,
    args,
    pid: positiveInt(child?.pid),
    source: resolved.source,
  };
}

async function resolveUnityE2ELogFile(projectPath, options = {}) {
  const raw = stringValue(options.logFile);
  const logFile = raw !== undefined
    ? path.resolve(raw)
    : path.join(projectPath, ".uos", "e2e-unity.log");
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  return logFile;
}

async function resolveUnityE2EProjectLogFile(projectPath, index, options = {}) {
  if (index === 0) return await resolveUnityE2ELogFile(projectPath, options);
  const primaryLog = stringValue(options.logFile);
  const logFile = primaryLog !== undefined
    ? secondaryLogPath(primaryLog, index)
    : path.join(projectPath, ".uos", "e2e-unity.log");
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  return logFile;
}

function secondaryLogPath(primaryLogFile, index) {
  const resolved = path.resolve(primaryLogFile);
  const ext = path.extname(resolved);
  const stem = ext.length > 0 ? resolved.slice(0, -ext.length) : resolved;
  return `${stem}-secondary-${index}${ext}`;
}

function defaultLaunchUnity(unityPath, args, options = {}) {
  const child = spawn(unityPath, args, {
    cwd: options.projectPath,
    env: {
      ...process.env,
      ...(options.unityEnv ?? {}),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(child);
    }, 0);
  });
}

async function stopUnityProcess(child, options = {}) {
  const pid = positiveInt(child?.pid);
  if (child === undefined || child === null) {
    return { skipped: true, reason: "no process" };
  }
  if (child.exitCode !== null && child.exitCode !== undefined) {
    return { pid, exited: true, code: child.exitCode, signal: child.signalCode };
  }

  const timeoutMs = positiveInt(options.timeoutMs) ?? DEFAULT_E2E_STOP_TIMEOUT_MS;
  const firstExit = waitForChildExit(child, timeoutMs);
  try {
    child.kill();
  } catch (err) {
    return { pid, exited: false, error: errorMessage(err) };
  }

  const stopped = await firstExit;
  if (stopped.exited || process.platform !== "win32" || pid === undefined || !isProcessAlive(pid)) {
    return { pid, ...stopped };
  }

  const forced = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const forcedExit = await waitForChildExit(child, Math.min(timeoutMs, 5_000));
  return {
    pid,
    ...forcedExit,
    forced: true,
    taskkillStatus: forced.status,
    taskkillError: forced.error?.message,
  };
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ exited: false, timedOut: true });
    }, Math.max(1, timeoutMs));
    child.once("exit", (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ exited: true, code, signal });
    });
  });
}

async function cleanE2EStaleRegistry(options = {}) {
  if (options.cleanStaleRegistry === false) {
    return { removed: 0, skipped: true };
  }
  try {
    const repoRoot = options.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
    const report = await (options.collectDoctorReport ?? collectDoctorReport)({
      repoRoot,
      runtime: false,
    });
    return await (options.cleanStaleRegistryEntries ?? cleanStaleRegistryEntries)(report);
  } catch (err) {
    return { removed: 0, error: errorMessage(err) };
  }
}

export async function readUnityProjectVersion(projectPath) {
  try {
    const raw = await fs.readFile(path.join(projectPath, "ProjectSettings", "ProjectVersion.txt"), "utf8");
    const match = raw.match(/m_EditorVersion:\s*([^\s]+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function unityExecutableCandidates(version, options = {}) {
  if (version === undefined) return [];
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? os.homedir();
  if (platform === "win32") {
    return [
      `C:\\Program Files\\Unity\\Hub\\Editor\\${version}\\Editor\\Unity.exe`,
      `C:\\Program Files (x86)\\Unity\\Hub\\Editor\\${version}\\Editor\\Unity.exe`,
    ];
  }
  if (platform === "darwin") {
    return [
      `/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`,
      path.join(home, "Applications", "Unity", "Hub", "Editor", version, "Unity.app", "Contents", "MacOS", "Unity"),
    ];
  }
  return [
    path.join(home, "Unity", "Hub", "Editor", version, "Editor", "Unity"),
    path.join("/opt", "Unity", "Hub", "Editor", version, "Editor", "Unity"),
  ];
}

export function formatWaitResult(result) {
  const elapsed = `${result.elapsedMs ?? 0}ms`;
  if (result.timedOut) {
    const lines = [`[uos wait] timed out after ${elapsed}`];
    if (result.selector !== undefined) {
      lines.push(`selector: ${result.selector}`);
    }
    if (result.lastError !== undefined) {
      lines.push(`last error: ${result.lastError}`);
    }
    const editors = Array.isArray(result.editors) ? result.editors : [];
    lines.push(`live editors seen: ${editors.length}`);
    if (editors.length > 0) {
      lines.push(formatEditorList(editors));
    }
    return lines.join("\n");
  }

  const editors = Array.isArray(result.editors) ? result.editors : [];
  if (result.target !== undefined) {
    return [
      `[uos wait] ready after ${elapsed}`,
      `selected: ${label(result.target)}`,
    ].join("\n");
  }
  return [
    `[uos wait] ${editors.length} live Unity Editor bridge(s) after ${elapsed}`,
    formatEditorList(editors),
  ].join("\n");
}

export async function inspectEditorRegistry(options = {}) {
  const dir = options.registryDir ?? registryDir(options.env);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return { dir, missing: true, entries: [] };
  }

  const entries = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const raw = await fs.readFile(file, "utf8");
      const entry = JSON.parse(raw);
      if (!isRegistryEntry(entry)) {
        entries.push({ file, fileName: name, status: "invalid", reason: "schema", entry });
        continue;
      }
      entries.push({ file, fileName: name, status: "pending", entry });
    } catch (err) {
      entries.push({
        file,
        fileName: name,
        status: "invalid",
        reason: err instanceof Error ? err.message : String(err),
        entry: undefined,
      });
    }
  }

  entries.sort((a, b) =>
    String(b.entry?.updatedAtUtc ?? "").localeCompare(String(a.entry?.updatedAtUtc ?? ""))
    || String(a.fileName).localeCompare(String(b.fileName)));
  const processAlive = options.processAlive ?? isProcessAlive;
  const handshake = options.handshake ?? ((entry) => canHandshake(entry, options));
  await Promise.all(entries.map(async (record) => {
    if (record.status !== "pending") return;
    const pid = positiveInt(record.entry?.processId);
    if (pid !== undefined && !processAlive(pid)) {
      record.status = "stale";
      record.reason = `process ${pid} is not running`;
      return;
    }
    const live = await handshake(record.entry);
    record.status = live ? "live" : "unreachable";
    record.reason = live ? undefined : "handshake failed";
  }));
  return { dir, missing: false, entries };
}

export async function inspectBridgeCapabilities(registry, options = {}) {
  const targets = bridgeCapabilityProbeTargets(registry, options.env ?? process.env);
  const callTool = options.callUnityTool ?? callUnityTool;
  const timeoutMs = positiveInt(options.bridgeCapabilityTimeoutMs)
    ?? DEFAULT_BRIDGE_CAPABILITY_TIMEOUT_MS;
  const entries = await Promise.all(targets.map(async (targetRecord) => {
    const target = targetRecord.target;
    const base = {
      source: targetRecord.source,
      fileName: targetRecord.fileName,
      target: publicEditorTarget(target),
      ok: false,
    };
    try {
      const projectInfo = await callTool(
        target,
        "get_project_info",
        {},
        { ...options, timeoutMs },
      );
      const supportedTools = normalizeToolNames(projectInfo?.supportedTools);
      const writeTools = normalizeToolNames(projectInfo?.writeTools);
      return {
        ...base,
        ok: true,
        projectInfo: publicBridgeProjectInfo(projectInfo),
        supportedTools,
        writeTools,
        missingTools: supportedTools !== undefined
          ? missingTools(REQUIRED_UNITY_BRIDGE_TOOLS, supportedTools)
          : undefined,
        missingWriteTools: writeTools !== undefined
          ? missingTools(REQUIRED_UNITY_WRITE_TOOLS, writeTools)
          : undefined,
      };
    } catch (err) {
      return {
        ...base,
        error: errorMessage(err),
      };
    }
  }));
  return {
    required: REQUIRED_UNITY_BRIDGE_TOOLS,
    requiredWriteTools: REQUIRED_UNITY_WRITE_TOOLS,
    entries,
  };
}

export async function collectDoctorReport(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const registry = await inspectEditorRegistry(options);
  const bridgeCapabilities = options.bridgeCapabilities === true
    ? await inspectBridgeCapabilities(registry, options)
    : undefined;
  const unityProject = options.projectPath !== undefined
    ? await inspectUnityProjectInstall(options.projectPath, repoRoot)
    : undefined;
  const opencodeResources = await inspectOpencodeResources(repoRoot);
  const opencodeRuntime = options.runtime === true
    ? inspectOpencodeRuntime(repoRoot, options)
    : undefined;
  const opencodeCli = inspectOpencodeCliCapabilities(options);
  const requiredPaths = [
    ["package.json", path.join(repoRoot, "package.json")],
    ["ochestrator agent", path.join(repoRoot, ".opencode", "agents", "ochestrator.md")],
    ["opencode tools", path.join(repoRoot, ".opencode", "tools", "_bridge.ts")],
    ["Unity package", path.join(repoRoot, "Packages", "com.lyx.oh-my-unity", "package.json")],
  ];
  const files = [];
  for (const [name, file] of requiredPaths) {
    files.push({ name, path: file, ok: await fileExists(file) });
  }

  const commands = [
    { name: "node", required: true, result: commandVersion("node", ["--version"], options) },
    { name: "bun", required: true, result: commandVersion("bun", ["--version"], options) },
    { name: "opencode", required: true, result: commandVersion("opencode", ["--version"], options) },
    { name: "soffice", required: false, result: commandVersion("soffice", ["--version"], options) },
  ];
  if ((options.platform ?? process.platform) === "win32") {
    commands.push({ name: "PowerPoint", required: false, result: detectPowerPoint(options) });
  }

  return {
    repoRoot,
    registry,
    bridgeCapabilities,
    unityProject,
    opencodeResources,
    opencodeRuntime,
    opencodeCli,
    files,
    commands,
    env: {
      UNITY_MCP_HOST: env.UNITY_MCP_HOST,
      UNITY_MCP_PORT: env.UNITY_MCP_PORT,
      UNITY_MCP_TOKEN: env.UNITY_MCP_TOKEN,
      UOS_PROJECT_DIR: env.UOS_PROJECT_DIR,
      UNITY_MCP_MATERIALS_DIR: env.UNITY_MCP_MATERIALS_DIR,
      UOS_EDITOR_REGISTRY_DIR: env.UOS_EDITOR_REGISTRY_DIR,
      UOS_UNITY_PROJECT: env.UOS_UNITY_PROJECT,
      UOS_TARGET: env.UOS_TARGET,
    },
  };
}

export function formatDoctorReport(report) {
  const live = report.registry.entries.filter((entry) => entry.status === "live").length;
  const stale = report.registry.entries.filter((entry) => entry.status === "stale").length;
  const unreachable = report.registry.entries.filter((entry) => entry.status === "unreachable").length;
  const invalid = report.registry.entries.filter((entry) => entry.status === "invalid").length;
  const lines = [
    `[uos doctor] repo: ${report.repoRoot}`,
    "",
    "Required files:",
    ...report.files.map((item) => `  [${item.ok ? "ok" : "missing"}] ${item.name}: ${item.path}`),
    "",
    "Commands:",
    ...report.commands.map((item) => {
      const status = item.result.ok ? "ok" : (item.required ? "missing" : "optional-missing");
      const detail = item.result.version ?? item.result.error ?? "";
      return `  [${status}] ${item.name}${detail ? `: ${detail}` : ""}`;
    }),
    "",
    "Material capabilities:",
    ...formatMaterialCapabilityLines(report.commands),
    "",
    `Editor registry: ${report.registry.dir}`,
  ];

  if (report.registry.missing === true) {
    lines.push("  [missing] registry directory does not exist yet");
  } else {
    lines.push(`  live=${live} stale=${stale} unreachable=${unreachable} invalid=${invalid}`);
    for (const record of report.registry.entries) {
      if (record.entry !== undefined) {
        lines.push(`  [${record.status}] ${label(record.entry)} file=${record.fileName}`);
      } else {
        lines.push(`  [${record.status}] ${record.fileName}: ${record.reason ?? "invalid"}`);
      }
    }
  }

  if (report.bridgeCapabilities !== undefined) {
    lines.push("");
    lines.push("Unity bridge capabilities:");
    lines.push(...formatBridgeCapabilityLines(report.bridgeCapabilities));
  }

  if (report.unityProject !== undefined) {
    lines.push("");
    lines.push("Unity project install:");
    const project = report.unityProject;
    lines.push(`  [${project.ok ? "ok" : "problem"}] project: ${project.projectPath}`);
    if (project.error !== undefined) {
      lines.push(`    ${project.error}`);
    } else {
      lines.push(`  manifest: ${project.manifestPath}`);
      const installKind = project.installKind !== undefined ? ` (${project.installKind})` : "";
      lines.push(`  [${project.installed ? "ok" : "missing"}] ${UNITY_PACKAGE_NAME}${installKind}${project.specifier ? `: ${project.specifier}` : ""}`);
      if (project.hasInstallConflict === true) {
        lines.push(`  [warn] embedded package also exists: ${project.embeddedPackagePath}`);
        lines.push("    Unity gives embedded packages precedence; run `uos install-unity --force <UnityProjectPath>` to normalize.");
      }
      if (project.localPackage !== undefined) {
        const local = project.localPackage;
        lines.push(`  [${local.ok ? "ok" : "problem"}] local package: ${local.path}`);
        if (local.error !== undefined) {
          lines.push(`    ${local.error}`);
        } else {
          lines.push(`    displayName: ${local.displayName ?? "(unset)"}`);
          lines.push(`    version: ${local.version ?? "(unset)"}`);
          const uguiStatus = local.uguiDependency === UNITY_UGUI_PACKAGE_VERSION ? "ok" : "warn";
          lines.push(`    [${uguiStatus}] ${UNITY_UGUI_PACKAGE_NAME}: ${local.uguiDependency ?? "(missing)"}`);
        }
      } else if (project.installed) {
        lines.push("  [info] package specifier is not a local file path; inspect it in Unity Package Manager after resolve");
      }
    }
  }

  lines.push("");
  lines.push("opencode resources:");
  const resources = report.opencodeResources;
  if (resources.config.ok) {
    lines.push(`  [ok] config: ${resources.config.path}`);
  } else {
    lines.push(`  [missing] config: ${resources.config.path}${resources.config.error ? ` (${resources.config.error})` : ""}`);
  }
  lines.push(`  [${resources.defaultAgent.ok ? "ok" : "missing"}] default agent: ${resources.defaultAgent.name ?? "(unset)"}`);
  lines.push(`  [${resources.tools.missing.length === 0 ? "ok" : "missing"}] tools: ${resources.tools.count} entrypoint(s)`);
  if (resources.tools.missing.length > 0) {
    lines.push(`    missing: ${resources.tools.missing.join(", ")}`);
  }
  for (const plugin of resources.plugins) {
    const status = plugin.ok ? "ok" : (plugin.local ? "missing" : "external");
    const detail = plugin.path !== undefined ? ` -> ${plugin.path}` : "";
    lines.push(`  [${status}] plugin: ${plugin.value}${detail}`);
  }
  if ((resources.localPlugins ?? []).length > 0) {
    for (const plugin of resources.localPlugins) {
      const status = plugin.ok ? "ok" : "missing";
      lines.push(`  [${status}] local plugin: ${plugin.path}`);
    }
  } else {
    const autoPluginStatus = resources.autoPlugin.ok ? "ok" : "missing";
    lines.push(`  [${autoPluginStatus}] local plugin: ${resources.autoPlugin.path}`);
  }
  if (resources.duplicateLocalPlugins.length > 0) {
    lines.push("  [warn] duplicate local plugin entries in opencode.json:");
    for (const duplicate of resources.duplicateLocalPlugins) {
      lines.push(`    ${duplicate.value} -> ${duplicate.path}`);
    }
  }

  lines.push("");
  lines.push("opencode runtime:");
  if (report.opencodeRuntime === undefined) {
    lines.push("  [skipped] run `uos doctor --runtime` to verify resolved opencode config and auth plugins");
  } else {
    const runtime = report.opencodeRuntime;
    if (runtime.ok) {
      lines.push("  [ok] `opencode debug config` completed");
    } else {
      const detail = (runtime.pluginErrors ?? []).length > 0
        ? "plugin hook error(s)"
        : runtime.error ?? `exit ${runtime.status ?? "unknown"}`;
      lines.push(`  [warn] \`opencode debug config\` did not complete cleanly: ${detail}`);
    }
    if (runtime.authExpired === true) {
      lines.push("  [auth-expired] Claude credentials are expired; run `claude` to re-authenticate before AI sessions");
    }
    if ((runtime.pluginErrors ?? []).length > 0) {
      lines.push("  [problem] opencode plugin hook error(s):");
      for (const error of runtime.pluginErrors) {
        lines.push(`    ${error}`);
      }
    }
    if (runtime.defaultAgent !== undefined) {
      const status = runtime.defaultAgent === resources.defaultAgent.name ? "ok" : "warn";
      lines.push(`  [${status}] resolved default agent: ${runtime.defaultAgent}`);
    }
    if (runtime.duplicatePlugins.length === 0) {
      lines.push("  [ok] resolved plugin list has no duplicate local UOS plugin");
    } else {
      lines.push("  [warn] resolved plugin duplicates:");
      for (const duplicate of runtime.duplicatePlugins) {
        lines.push(`    ${duplicate.key}: ${duplicate.values.join(", ")}`);
      }
    }
  }

  lines.push("");
  lines.push("opencode CLI capabilities:");
  lines.push(...formatOpencodeCliCapabilityLines(report.opencodeCli));

  lines.push("");
  lines.push("Environment:");
  for (const [key, value] of Object.entries(report.env)) {
    lines.push(`  ${key}: ${formatEnvValue(key, value)}`);
  }

  lines.push("");
  lines.push("Next steps:");
  if (live === 0) {
    if (report.unityProject !== undefined && report.unityProject.installed === false) {
      lines.push("  - Run `uos install-unity <UnityProjectPath>`; this project does not include the embedded UOS package yet.");
    } else if (report.unityProject !== undefined && report.unityProject.installed === true) {
      lines.push("  - Open this Unity project; the UOS package is installed but no live bridge is registered.");
    } else {
      lines.push("  - Run `uos install-unity <UnityProjectPath>` if the target project does not have the UOS package yet.");
    }
    if (report.unityProject === undefined || report.unityProject.installed !== true) {
      lines.push("  - Open the Unity project with the UOS package installed.");
    }
    lines.push("  - In Unity, open Window > Oh My Unity > Monitor and start the bridge.");
    lines.push("  - Run `uos projects`, then `uos smoke --unity-project <selector>`.");
  } else {
    lines.push("  - Run `uos smoke --unity-project <selector> --write --preview` against the intended project.");
  }
  if (report.commands.some((item) => item.required && !item.result.ok)) {
    lines.push("  - Install or add missing required commands to PATH before launching UOS.");
  }
  if (report.opencodeRuntime?.authExpired === true) {
    lines.push("  - Run `claude` to refresh Claude auth, then rerun `uos doctor --runtime`.");
  }
  if ((report.opencodeRuntime?.pluginErrors ?? []).length > 0) {
    lines.push("  - Fix or remove the failing opencode plugin, then rerun `uos doctor --runtime`.");
  }
  return lines.join("\n");
}

export function evaluateReadiness(report) {
  const blockers = [];
  const warnings = [];
  const live = report.registry.entries.filter((entry) => entry.status === "live").length;
  const selector = selectorFromEnv(report.env);
  const inheritedExplicitBridge = hasExplicitBridgeEnv(report.env);
  const explicitBridge = inheritedExplicitBridge && selector === undefined;

  for (const item of report.files ?? []) {
    if (!item.ok) blockers.push(`missing required file: ${item.name} (${item.path})`);
  }
  for (const item of report.commands ?? []) {
    if (item.required && !item.result.ok) blockers.push(`missing required command: ${item.name}`);
    if (!item.required && !item.result.ok && !isPptxRendererCommand(item.name)) {
      warnings.push(`optional command unavailable: ${item.name}`);
    }
  }
  if (!hasPptxRenderer(report.commands ?? [])) {
    warnings.push("optional PPTX renderer unavailable: LibreOffice/PowerPoint; PPTX text/layout fallback will still work");
  }

  const resources = report.opencodeResources ?? {};
  if (!resources.config?.ok) blockers.push("opencode config is missing or invalid");
  if (!resources.defaultAgent?.ok) blockers.push(`default agent is missing: ${resources.defaultAgent?.name ?? "(unset)"}`);
  if ((resources.tools?.missing ?? []).length > 0) {
    blockers.push(`missing opencode tool entrypoints: ${resources.tools.missing.join(", ")}`);
  }
  if (!resources.autoPlugin?.ok) blockers.push("local UOS opencode plugin is missing");
  if ((resources.duplicateLocalPlugins ?? []).length > 0) {
    blockers.push("local UOS plugin is explicitly configured and may be loaded twice");
  }
  const cli = report.opencodeCli;
  if (cli !== undefined) {
    if (cli.runHelpOk !== true) blockers.push("opencode run help is unavailable; cannot verify run handoff support");
    if (cli.topHelpOk !== true) blockers.push("opencode top-level help is unavailable; cannot verify interactive handoff support");
    if (cli.runFile !== true) blockers.push("opencode run does not advertise --file attachments required for UOS material handoff");
    if (cli.runAgent !== true) blockers.push("opencode run does not advertise --agent required for UOS agent selection");
    if (cli.tuiAgent !== true) blockers.push("opencode TUI does not advertise --agent required for interactive UOS entry");
    if (cli.tuiPrompt !== true) blockers.push("opencode TUI does not advertise --prompt required for interactive UOS startup context");
  }
  if (report.unityProject?.hasInstallConflict === true) {
    blockers.push("Unity project has both manifest and embedded UOS package installs; normalize with `uos install-unity --force <UnityProjectPath>`");
  }

  if (report.opencodeRuntime === undefined) {
    blockers.push("runtime opencode config was not checked");
  } else {
    const runtime = report.opencodeRuntime;
    if (!runtime.ok) blockers.push("opencode runtime config did not load cleanly");
    if (runtime.authExpired === true) blockers.push("Claude credentials are expired");
    if ((runtime.pluginErrors ?? []).length > 0) {
      blockers.push(`opencode plugin hook failed: ${runtime.pluginErrors[0]}`);
    }
    if (runtime.defaultAgent !== undefined && runtime.defaultAgent !== resources.defaultAgent?.name) {
      blockers.push(`resolved default agent mismatch: ${runtime.defaultAgent}`);
    }
    if ((runtime.duplicatePlugins ?? []).length > 0) {
      blockers.push("resolved opencode plugin list contains duplicates");
    }
  }

  if (!explicitBridge && live === 0) {
    blockers.push("no live Unity Editor bridge found");
  }
  if (inheritedExplicitBridge && selector !== undefined) {
    warnings.push("selector env is set; inherited explicit bridge env will be ignored by UOS launch selection");
  }
  if (explicitBridge && !report.env?.UOS_PROJECT_DIR) {
    warnings.push("explicit bridge env is set without UOS_PROJECT_DIR; relative planning paths may not resolve against the Unity project");
  }
  const bridgeCapabilityIssues = evaluateBridgeCapabilityIssues(report, { live, explicitBridge, selector });
  blockers.push(...bridgeCapabilityIssues.blockers);
  warnings.push(...bridgeCapabilityIssues.warnings);
  for (const status of ["stale", "unreachable", "invalid"]) {
    const count = report.registry.entries.filter((entry) => entry.status === status).length;
    if (count > 0) warnings.push(`${count} ${status} Unity registry entr${count === 1 ? "y" : "ies"} found`);
  }

  return { ready: blockers.length === 0, blockers, warnings };
}

export function formatReadyReport(report, readiness = evaluateReadiness(report)) {
  const selector = selectorFromEnv(report.env);
  const explicitBridge = hasExplicitBridgeEnv(report.env) && selector === undefined;
  const liveRecords = report.registry.entries.filter((entry) => entry.status === "live");
  const liveEntries = liveRecords
    .map((record) => record.entry)
    .filter((entry) => typeof entry === "object" && entry !== null);
  const live = liveRecords.length;
  const lines = [
    `[uos ready] ${readiness.ready ? "ready" : "not ready"}`,
    `repo: ${report.repoRoot}`,
    `Unity bridge: ${explicitBridge ? "explicit env" : `${live} live registry entr${live === 1 ? "y" : "ies"}`}`,
    `opencode runtime: ${report.opencodeRuntime === undefined ? "not checked" : (report.opencodeRuntime.ok ? "loaded" : "failed")}`,
  ];
  if (!explicitBridge && liveEntries.length > 0) {
    lines.push("");
    lines.push("Live Unity projects:");
    for (const [index, entry] of liveEntries.slice(0, 5).entries()) {
      const capability = bridgeCapabilityStatusHint(entry, report.bridgeCapabilities);
      lines.push(
        `  ${index + 1}. ${label(entry)} select: --unity-project ${formatSelectorArgument(readyProjectSelector(entry, index))}${capability}`,
      );
    }
    if (liveEntries.length > 5) {
      lines.push(`  ... ${liveEntries.length - 5} more live project${liveEntries.length - 5 === 1 ? "" : "s"}; run \`uos projects\`.`);
    }
  }
  if (readiness.blockers.length > 0) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of readiness.blockers) lines.push(`  - ${blocker}`);
  }
  if (readiness.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of readiness.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push("Next:");
  if (readiness.ready) {
    const selector = !explicitBridge && liveEntries.length === 1
      ? formatSelectorArgument(readyProjectSelector(liveEntries[0], 0))
      : "<selector>";
    lines.push(`  - Run \`uos --unity-project ${selector} --uos-dry-run ...\` to inspect launch forwarding.`);
    lines.push(`  - Run \`uos --unity-project ${selector} --uos-materials <dir> --uos-file <file> run "..."\`.`);
  } else {
    if (readiness.blockers.some((item) => item.includes("Claude credentials"))) {
      lines.push("  - Run `claude` to refresh auth, then rerun `uos ready`.");
    }
    if (readiness.blockers.some((item) => item.includes("Unity Editor bridge"))) {
      lines.push("  - Open a Unity project with the UOS package installed and start the bridge.");
      lines.push("  - Use `uos ready --wait --unity-project <selector>` to wait for a specific project bridge.");
    }
    lines.push("  - Run `uos doctor --runtime` for the full diagnostic report.");
  }
  return lines.join("\n");
}

function evaluateBridgeCapabilityIssues(report, context) {
  const blockers = [];
  const warnings = [];
  const capabilities = report.bridgeCapabilities;
  if (capabilities === undefined) return { blockers, warnings };

  const entries = capabilities.entries ?? [];
  if (entries.length === 0) return { blockers, warnings };

  const relevant = relevantBridgeCapabilityEntries(entries, context);
  const defaultBlock = context.explicitBridge || context.selector !== undefined || context.live <= 1;
  for (const entry of entries) {
    const block = relevant.length > 0 ? relevant.includes(entry) : defaultBlock;
    const messages = bridgeCapabilityMessages(entry);
    if (block) {
      blockers.push(...messages.blockers);
    } else {
      warnings.push(...messages.blockers);
    }
    warnings.push(...messages.warnings);
  }

  if (!context.explicitBridge && context.selector === undefined && context.live > 1) {
    const hasConfirmedCapable = entries.some((entry) => bridgeCapabilityConfirmed(entry));
    const allKnownUnable = entries.length > 0 && entries.every((entry) => bridgeCapabilityKnownUnable(entry));
    if (!hasConfirmedCapable && allKnownUnable) {
      blockers.push("no live Unity Editor bridge reports all required UOS editing tools");
    }
  }

  return { blockers, warnings };
}

function relevantBridgeCapabilityEntries(entries, context) {
  if (context.explicitBridge) {
    return entries.filter((entry) => entry.source === "explicit-env");
  }
  if (context.selector !== undefined) {
    return entries.filter((entry) => bridgeCapabilityMatchesSelector(entry, context.selector));
  }
  return entries.length === 1 ? entries : [];
}

function bridgeCapabilityMessages(entry) {
  const name = bridgeCapabilityLabel(entry);
  const blockers = [];
  const warnings = [];
  if (entry.ok !== true) {
    blockers.push(`Unity bridge capability probe failed for ${name}: ${entry.error ?? "unknown error"}`);
    return { blockers, warnings };
  }

  if (entry.supportedTools === undefined) {
    warnings.push(`Unity bridge did not report supportedTools for ${name}; update ${UNITY_PACKAGE_NAME} for capability-aware readiness`);
  } else if ((entry.missingTools ?? []).length > 0) {
    blockers.push(`Unity bridge missing required tool(s) for ${name}: ${entry.missingTools.join(", ")}`);
  }

  if (entry.writeTools === undefined) {
    warnings.push(`Unity bridge did not report writeTools for ${name}; update ${UNITY_PACKAGE_NAME} for write-safety metadata`);
  } else if ((entry.missingWriteTools ?? []).length > 0) {
    blockers.push(`Unity bridge missing required write tool(s) for ${name}: ${entry.missingWriteTools.join(", ")}`);
  }
  return { blockers, warnings };
}

function bridgeCapabilityConfirmed(entry) {
  return entry.ok === true
    && Array.isArray(entry.supportedTools)
    && (entry.missingTools ?? []).length === 0
    && (!Array.isArray(entry.writeTools) || (entry.missingWriteTools ?? []).length === 0);
}

function bridgeCapabilityKnownUnable(entry) {
  return entry.ok !== true
    || (Array.isArray(entry.supportedTools) && (entry.missingTools ?? []).length > 0)
    || (Array.isArray(entry.writeTools) && (entry.missingWriteTools ?? []).length > 0);
}

function bridgeCapabilityMatchesSelector(entry, selector) {
  const target = entry.target ?? {};
  return selectorValues(target).some((value) => equalsSelector(value, selector));
}

function bridgeCapabilityStatusHint(target, capabilities) {
  const entries = capabilities?.entries ?? [];
  const entry = entries.find((candidate) =>
    candidate?.source === "registry" && samePublicEditorTarget(candidate.target, target));
  if (entry === undefined) return "";
  if (entry.ok !== true) return " capability=problem";
  if (entry.supportedTools === undefined || entry.writeTools === undefined) return " capability=unknown";
  if ((entry.missingTools ?? []).length > 0 || (entry.missingWriteTools ?? []).length > 0) return " capability=missing";
  return " capability=ready";
}

function samePublicEditorTarget(a, b) {
  const aInstance = stringValue(a?.instanceId);
  const bInstance = stringValue(b?.instanceId);
  if (aInstance !== undefined && bInstance !== undefined) return aInstance === bInstance;

  const aPath = normalizeComparablePath(a?.projectPath);
  const bPath = normalizeComparablePath(b?.projectPath);
  if (aPath.length > 0 && bPath.length > 0) return aPath === bPath;

  const aHost = stringValue(a?.host);
  const bHost = stringValue(b?.host);
  const aPort = numberValue(a?.port);
  const bPort = numberValue(b?.port);
  return aHost !== undefined && bHost !== undefined && aPort !== undefined && bPort !== undefined
    && aHost === bHost && aPort === bPort;
}

function bridgeCapabilityLabel(entry) {
  const target = entry?.target;
  const source = entry?.source === "explicit-env" ? "explicit env" : "registry";
  return target !== undefined ? `${label(target)} [${source}]` : `[${source}]`;
}

function readyProjectSelector(entry, index) {
  return stableProjectSelector(entry)
    ?? String(index + 1);
}

function stableProjectSelector(entry) {
  return stringValue(entry?.instanceId)
    ?? stringValue(entry?.projectName)
    ?? stringValue(entry?.projectPath);
}

function selectionCommandHint(entry, index = undefined) {
  const selector = stableProjectSelector(entry)
    ?? (index !== undefined ? String(index + 1) : undefined);
  return selector !== undefined
    ? ` select: --unity-project ${formatSelectorArgument(selector)}`
    : "";
}

function formatSelectorArgument(selector) {
  if (/^[A-Za-z0-9._:/\\-]+$/.test(selector)) return selector;
  return `'${selector.replace(/'/g, "''")}'`;
}

export async function cleanStaleRegistryEntries(report) {
  const removed = [];
  for (const record of report.registry.entries) {
    if (record.status !== "stale" || typeof record.file !== "string") continue;
    try {
      await fs.unlink(record.file);
      removed.push(record.file);
    } catch {
      // Best effort; a Unity process may have already removed it during shutdown.
    }
  }
  return { removed: removed.length, files: removed };
}

export async function inspectOpencodeResources(repoRoot) {
  const configPath = path.join(repoRoot, "opencode.json");
  const config = { path: configPath, ok: false, error: undefined };
  let parsed = {};
  try {
    parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    config.ok = true;
  } catch (err) {
    config.error = errorMessage(err);
  }

  const defaultAgentName = stringValue(parsed.default_agent);
  const agentPath = defaultAgentName !== undefined
    ? path.join(repoRoot, ".opencode", "agents", `${defaultAgentName}.md`)
    : undefined;
  const defaultAgent = {
    name: defaultAgentName,
    path: agentPath,
    ok: agentPath !== undefined ? await fileExists(agentPath) : false,
  };

  const toolDir = path.join(repoRoot, ".opencode", "tools");
  const toolNames = await listToolEntrypoints(toolDir);
  const toolSet = new Set(toolNames);
  const missingTools = REQUIRED_UOS_TOOLS.filter((name) => !toolSet.has(name));

  const plugins = [];
  const duplicateLocalPlugins = [];
  const localPluginDir = path.join(repoRoot, ".opencode", "plugins");
  const localPlugins = await listLocalPluginEntrypoints(localPluginDir);
  const autoPluginPath = path.join(localPluginDir, "uos.ts");
  for (const value of Array.isArray(parsed.plugin) ? parsed.plugin : []) {
    if (typeof value !== "string") continue;
    const resolved = resolvePluginPath(value, repoRoot);
    if (resolved !== undefined && samePath(resolved, autoPluginPath)) {
      duplicateLocalPlugins.push({ value, path: resolved });
    }
    plugins.push({
      value,
      local: resolved !== undefined,
      path: resolved,
      ok: resolved === undefined ? true : await fileExists(resolved),
    });
  }

  return {
    config,
    defaultAgent,
    tools: {
      dir: toolDir,
      count: toolNames.length,
      names: toolNames,
      required: REQUIRED_UOS_TOOLS,
      missing: missingTools,
    },
    plugins,
    localPlugins,
    autoPlugin: {
      path: autoPluginPath,
      ok: await fileExists(autoPluginPath),
    },
    duplicateLocalPlugins,
  };
}

export function inspectOpencodeRuntime(repoRoot, options = {}) {
  const timeoutMs = positiveInt(options.runtimeTimeoutMs) ?? 45_000;
  const result = runCommand("opencode", ["--print-logs", "--log-level", "ERROR", "debug", "config"], {
    ...options,
    timeoutMs,
    cwd: repoRoot,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const combined = `${stdout}\n${stderr}`;
  const parsed = parseJsonFromOutput(stdout) ?? parseJsonFromOutput(combined);
  const plugins = Array.isArray(parsed?.plugin) ? parsed.plugin.filter((item) => typeof item === "string") : [];
  const pluginErrors = extractOpencodePluginErrors(combined);
  return {
    ok: result.status === 0 && result.error === undefined && parsed !== undefined && pluginErrors.length === 0,
    status: result.status,
    error: result.error,
    stdout,
    stderr,
    authExpired: /credentials are expired|could not be refreshed|re-authenticate/i.test(combined),
    defaultAgent: stringValue(parsed?.default_agent),
    plugins,
    pluginErrors,
    duplicatePlugins: duplicatePluginEntries(plugins, repoRoot),
  };
}

function extractOpencodePluginErrors(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /ERROR\b/.test(line) && /service=plugin\b/.test(line))
    .map((line) => {
      const match = line.match(/service=plugin\s+(.*)$/);
      return truncateText(match?.[1] ?? line, 240);
    });
}

export function inspectOpencodeCliCapabilities(options = {}) {
  const timeoutMs = positiveInt(options.opencodeHelpTimeoutMs) ?? 10_000;
  const runHelp = runCommand("opencode", ["run", "--help"], { ...options, timeoutMs });
  const topHelp = runCommand("opencode", ["--help"], { ...options, timeoutMs });
  const runText = `${runHelp.stdout ?? ""}\n${runHelp.stderr ?? ""}`;
  const topText = `${topHelp.stdout ?? ""}\n${topHelp.stderr ?? ""}`;
  const runHelpOk = runHelp.status === 0 && runHelp.error === undefined;
  const topHelpOk = topHelp.status === 0 && topHelp.error === undefined;
  const runFile = runHelpOk && /(?:^|\s)--file(?:\s|,|$)/.test(runText);
  const runAgent = runHelpOk && /(?:^|\s)--agent(?:\s|,|$)/.test(runText);
  const tuiAgent = topHelpOk && /(?:^|\s)--agent(?:\s|,|$)/.test(topText);
  const tuiPrompt = topHelpOk && /(?:^|\s)--prompt(?:\s|,|$)/.test(topText);
  return {
    ok: runHelpOk && topHelpOk && runFile && runAgent && tuiAgent && tuiPrompt,
    runHelpOk,
    topHelpOk,
    runFile,
    runAgent,
    tuiAgent,
    tuiPrompt,
    errors: [
      runHelpOk ? undefined : runHelp.error ?? `opencode run --help exited ${runHelp.status ?? "unknown"}`,
      topHelpOk ? undefined : topHelp.error ?? `opencode --help exited ${topHelp.status ?? "unknown"}`,
    ].filter((item) => item !== undefined),
  };
}

export function buildTargetEnv(target, baseEnv = process.env, options = {}) {
  const launchInputs = options.launchInputs ?? resolveLaunchInputs(target, {
    ...options,
    env: options.env ?? baseEnv,
  });
  const env = {
    ...baseEnv,
  };
  delete env.UOS_CONTEXT_SUMMARY;
  delete env.UOS_ATTACHED_FILES;
  delete env.UOS_BRIDGE_SUPPORTED_TOOLS;
  delete env.UOS_BRIDGE_WRITE_TOOLS;
  delete env.UOS_BRIDGE_CAPABILITY_ERROR;
  if (target !== undefined && launchInputs.materialsDir === undefined) {
    delete env.UNITY_MCP_MATERIALS_DIR;
  }
  if (target !== undefined && !shouldInheritLaunchMaterialLimits({
    ...options,
    env: options.env ?? baseEnv,
  })) {
    delete env.UOS_MAX_MATERIAL_CANDIDATES;
    delete env.UOS_MAX_MATERIAL_DEPTH;
    delete env.UOS_MAX_MATERIAL_SCAN_FILES;
  }
  if (launchInputs.materialsDir !== undefined) {
    env.UNITY_MCP_MATERIALS_DIR = launchInputs.materialsDir;
  }
  if (launchInputs.files.length > 0) {
    env.UOS_ATTACHED_FILES = JSON.stringify(launchInputs.files);
  }
  if (options.maxMaterialCandidates !== undefined) {
    env.UOS_MAX_MATERIAL_CANDIDATES = String(options.maxMaterialCandidates);
  }
  if (options.maxMaterialDepth !== undefined) {
    env.UOS_MAX_MATERIAL_DEPTH = String(options.maxMaterialDepth);
  }
  if (options.maxMaterialScanFiles !== undefined) {
    env.UOS_MAX_MATERIAL_SCAN_FILES = String(options.maxMaterialScanFiles);
  }
  if (target === undefined) {
    const explicitProjectDir = stringValue(env.UOS_PROJECT_DIR);
    if (explicitProjectDir !== undefined && stringValue(env.UOS_CONTEXT_DIR) === undefined) {
      env.UOS_CONTEXT_DIR = path.join(explicitProjectDir, ".uos");
    }
    return env;
  }
  Object.assign(env, {
    UNITY_MCP_HOST: target.host,
    UNITY_MCP_PORT: String(target.port),
    UNITY_MCP_TOKEN: target.token ?? "",
    UOS_PROJECT_DIR: target.projectPath ?? "",
    UOS_PROJECT_NAME: target.projectName ?? "",
    UOS_CONTEXT_DIR: target.projectPath ? path.join(target.projectPath, ".uos") : "",
    UOS_EDITOR_INSTANCE_ID: target.instanceId ?? "",
  });
  if (!env.UNITY_MCP_MATERIALS_DIR && target.projectPath) {
    env.UNITY_MCP_MATERIALS_DIR = target.projectPath;
  }
  return env;
}

export function buildForwardArgs(opencodeArgs, target, options = {}) {
  const files = (options.launchInputs ?? resolveLaunchInputs(target, options)).files;
  const contextFiles = normalizeFileList(options.contextFiles ?? options.contextFile);
  const attachedFiles = [...contextFiles, ...files.filter(shouldAttachFileToOpencodeRun)];
  const forwarded = injectDefaultUosPrompt(injectDefaultUosAgent(opencodeArgs, options), target, {
    ...options,
    launchInputs: options.launchInputs ?? resolveLaunchInputs(target, options),
  });
  if (isOpencodeCommandInfoRequest(forwarded)) return forwarded;
  if (attachedFiles.length === 0) return forwarded;
  const runIndex = opencodeCommandInfo(forwarded).command === "run"
    ? opencodeCommandInfo(forwarded).index
    : -1;
  if (runIndex < 0) return forwarded;
  return [
    ...forwarded.slice(0, runIndex + 1),
    ...attachedFiles.flatMap((file) => ["--file", file]),
    ...forwarded.slice(runIndex + 1),
  ];
}

function shouldAttachFileToOpencodeRun(file) {
  const ext = path.extname(String(file ?? "")).toLowerCase();
  return OPENCODE_RUN_TEXT_ATTACHMENT_EXTENSIONS.has(ext);
}

function injectDefaultUosAgent(opencodeArgs, options = {}) {
  if (options.injectAgent === false) return opencodeArgs;
  if (isOpencodeCommandInfoRequest(opencodeArgs)) return opencodeArgs;
  if (!isOpencodeRunArgs(opencodeArgs) && !isOpencodeTuiLaunchArgs(opencodeArgs)) return opencodeArgs;
  const normalizedArgs = stripOpencodeAgentArgs(opencodeArgs);
  if (isOpencodeRunArgs(normalizedArgs)) {
    const runIndex = opencodeCommandInfo(normalizedArgs).index;
    return [
      ...normalizedArgs.slice(0, runIndex + 1),
      "--agent",
      DEFAULT_UOS_AGENT,
      ...normalizedArgs.slice(runIndex + 1),
    ];
  }
  return ["--agent", DEFAULT_UOS_AGENT, ...normalizedArgs];
}

function stripOpencodeAgentArgs(args) {
  const stripped = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      stripped.push(...args.slice(i));
      break;
    }
    if (arg === "--agent") {
      i++;
      continue;
    }
    if (String(arg).startsWith("--agent=")) continue;
    stripped.push(arg);
  }
  return stripped;
}

function injectDefaultUosPrompt(opencodeArgs, target, options = {}) {
  if (options.injectPrompt === false) return opencodeArgs;
  if (isOpencodeCommandInfoRequest(opencodeArgs)) return opencodeArgs;
  if (!isOpencodeTuiLaunchArgs(opencodeArgs)) return opencodeArgs;
  if (hasPromptArg(opencodeArgs)) return opencodeArgs;
  const prompt = stringValue(options.prompt)
    ?? stringValue(options.env?.UOS_OPENCODE_PROMPT)
    ?? formatDefaultTuiPrompt(target, options);
  if (prompt.length === 0) return opencodeArgs;
  return ["--prompt", prompt, ...opencodeArgs];
}

function hasPromptArg(args) {
  return args.some((arg) => arg === "--prompt" || String(arg).startsWith("--prompt="));
}

function isOpencodeRunArgs(args) {
  return opencodeCommandInfo(args).command === "run";
}

export function shouldPrepareRunContextAttachment(opencodeArgs) {
  return isOpencodeRunArgs(opencodeArgs) && !isOpencodeCommandInfoRequest(opencodeArgs);
}

export function shouldPrepareLaunchContext(opencodeArgs) {
  return !isOpencodeTargetlessCommandArgs(opencodeArgs);
}

export function shouldPrintLaunchSummary(opencodeArgs) {
  return shouldPrepareLaunchContext(opencodeArgs);
}

function isOpencodeTuiLaunchArgs(args) {
  if (hasOpencodeTargetlessGlobalFlag(args)) return false;
  if (isOpencodeCommandInfoRequest(args)) return false;
  const command = opencodeCommandInfo(args).command;
  if (command === undefined) return true;
  if (OPENCODE_NON_TUI_COMMANDS.has(command)) return false;
  return true;
}

function isOpencodeTargetlessCommandArgs(args) {
  if (hasOpencodeTargetlessGlobalFlag(args)) return true;
  if (isOpencodeCommandInfoRequest(args)) return true;
  const command = opencodeCommandInfo(args).command;
  return command !== undefined && command !== "run" && OPENCODE_NON_TUI_COMMANDS.has(command);
}

function isOpencodeCommandInfoRequest(args) {
  const info = opencodeCommandInfo(args);
  if (info.command === undefined) return false;
  for (let i = info.index + 1; i < args.length; i++) {
    const arg = String(args[i] ?? "");
    if (arg === "--") return false;
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (OPENCODE_TARGETLESS_GLOBAL_FLAGS.has(key)) return true;
  }
  return false;
}

function hasOpencodeTargetlessGlobalFlag(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] ?? "");
    if (arg.length === 0) continue;
    if (arg === "--") return false;
    if (!arg.startsWith("-")) return false;
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (OPENCODE_TARGETLESS_GLOBAL_FLAGS.has(key)) return true;
    if (OPENCODE_GLOBAL_VALUE_FLAGS.has(key) && eq < 0) i++;
  }
  return false;
}

function opencodeCommandInfo(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] ?? "");
    if (arg.length === 0) continue;
    if (arg === "--") return { index: i + 1, command: stringValue(args[i + 1]) };
    if (!arg.startsWith("-")) return { index: i, command: arg };
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (OPENCODE_GLOBAL_VALUE_FLAGS.has(key) && eq < 0) i++;
  }
  return { index: -1, command: undefined };
}

function formatDefaultTuiPrompt(target, options = {}) {
  const launchInputs = options.launchInputs ?? {};
  const projectName = stringValue(target?.projectName) ?? stringValue(options.env?.UOS_PROJECT_NAME);
  const projectPath = stringValue(target?.projectPath) ?? stringValue(options.env?.UOS_PROJECT_DIR);
  const materialDir = stringValue(launchInputs.materialsDir) ?? stringValue(options.env?.UNITY_MCP_MATERIALS_DIR);
  const files = Array.isArray(launchInputs.files) ? launchInputs.files : [];
  const contextSummary = stringValue(options.env?.UOS_CONTEXT_SUMMARY);
  const responseLanguage = stringValue(options.env?.UOS_RESPONSE_LANGUAGE);
  const lines = [
    "# UOS Startup",
    "",
    DEFAULT_UOS_TUI_PROMPT,
    "",
    "## Selected Target",
  ];
  if (responseLanguage !== undefined) {
    lines.splice(4, 0,
      "## Response Language",
      `Use ${responseLanguage} as the default response language unless the user explicitly asks for another language. Keep code, file paths, tool names, and API identifiers unchanged.`,
      "",
    );
  }
  if (projectName !== undefined || projectPath !== undefined) {
    lines.push(`- Unity project: ${projectName ?? "(unnamed)"}${projectPath !== undefined ? ` at ${projectPath}` : ""}`);
  } else {
    lines.push("- Unity project: explicit bridge env / no registry metadata");
  }
  lines.push(...formatRunContextBridgeCapabilityLines(options.env));
  if (materialDir !== undefined) lines.push(`- Planning material directory: ${materialDir}`);
  if (files.length > 0) {
    lines.push("- Launch-attached material files:");
    for (const file of files.slice(0, 12)) {
      lines.push(`  - ${file} (${materialStartupHint(file)})`);
    }
    if (files.length > 12) lines.push(`  - ... ${files.length - 12} more file(s) omitted`);
  }

  lines.push("", "## Recommended Starter Tasks");
  lines.push("- Create a screen from an image, playable video, PPTX, PDF, or DOCX planning material.");
  lines.push("- Review the current project state, screens, recent work, and available materials.");
  lines.push("- Revise an existing screen, button, image, text, or transition.");
  lines.push("- Compare a preview with a reference image and fix visible differences.");
  lines.push("- Fix a script, component, package, or project-setting issue after diagnostics.");

  lines.push("", "## Example Prompts");
  lines.push('- "이 PPTX를 기준으로 첫 화면을 만들어줘."');
  lines.push('- "현재 프로젝트에 어떤 화면과 자료가 있는지 보여줘."');
  lines.push('- "이 이미지 시안처럼 홈 화면을 만들어줘."');
  lines.push('- "방금 만든 버튼 문구를 시작하기로 바꿔줘."');
  lines.push('- "미리보기와 레퍼런스를 비교해서 어긋난 곳만 고쳐줘."');

  lines.push("", "## Planner-Friendly UX");
  lines.push("- When no clear edit request exists, show 3-5 recommended starter tasks and 3-5 example prompts before asking what to change.");
  lines.push("- Explain work using planner-facing terms first: screen, button, image, text, transition, preview, save.");
  lines.push("- Mention Unity-specific terms only when they help identify a real target or risk.");
  lines.push("- Ask clarification questions with 2-3 concrete choices plus optional free-form input.");
  lines.push("- Before save/delete/broad changes, summarize impact and ask for explicit approval.");
  lines.push("- After work, summarize what changed, preview/verification status, save state, and next options.");

  lines.push("", "## First Actions");
  lines.push("1. Call `get_uos_context` first; it is authoritative and can attach previous previews, diffs, source materials, and launch files.");
  lines.push("2. Call `select_uos_mode` with the user's request or a concise task brief before following the internal submodel handoff.");
  if (files.length > 0) {
    lines.push("3. Read each launch-attached file with `read_planning_material` before broad folder scans when the selected mode needs material understanding.");
  } else {
    lines.push("3. If the user names a material file, read it with `read_planning_material` before creating screens from it when the selected mode needs material understanding.");
  }
  if (materialDir !== undefined) {
    lines.push("4. If the user's request depends on folder materials, call `analyze_planning_materials` or a mode-specific planner for the planning material directory.");
  } else {
    lines.push("4. If a planning material directory becomes available, call `analyze_planning_materials` or a mode-specific planner before broad edits.");
  }
  lines.push("5. For material-to-screen work, prefer `create_screen_from_material`; use draft/validate tools when review or targeted control over the PlanningIntent is needed.");
  lines.push("6. After creating or editing, inspect with `capture_preview_from_context`, `get_scene_hierarchy_from_context`, and verification tools before claiming completion.");

  if (contextSummary !== undefined) {
    lines.push("", "## Launch Context Summary Excerpt", "");
    lines.push(truncateText(contextSummary, 3_000));
  }
  return lines.join("\n");
}

export function formatRunContextAttachment(summary, target, options = {}) {
  const env = options.env ?? {};
  const launchInputs = options.launchInputs ?? {};
  const contextSummary = stringValue(summary);
  const projectName = stringValue(target?.projectName) ?? stringValue(env.UOS_PROJECT_NAME);
  const projectPath = stringValue(target?.projectPath) ?? stringValue(env.UOS_PROJECT_DIR);
  const contextDir = stringValue(env.UOS_CONTEXT_DIR)
    ?? (projectPath !== undefined ? path.join(projectPath, ".uos") : undefined);
  const materialsDir = stringValue(launchInputs.materialsDir)
    ?? stringValue(env.UNITY_MCP_MATERIALS_DIR);
  const files = Array.isArray(launchInputs.files) ? launchInputs.files : [];
  const hasBridgeEnv = stringValue(env.UNITY_MCP_HOST) !== undefined
    && stringValue(env.UNITY_MCP_PORT) !== undefined;
  const hasLaunchContext = contextSummary !== undefined
    || target !== undefined
    || hasBridgeEnv
    || projectName !== undefined
    || projectPath !== undefined
    || contextDir !== undefined
    || materialsDir !== undefined
    || files.length > 0;
  if (!hasLaunchContext) return undefined;

  const lines = [
    "# UOS Launch Context",
    "",
    "This file was generated by `uos` for the current `opencode run` request.",
    "Use it as session context for the selected Unity Editor project. Call `get_uos_context` before mutating Unity when screen IDs, source materials, previews, or diffs matter.",
    "",
    "## Selected Project",
  ];
  if (target !== undefined) {
    lines.push(`- Target: ${label(target)}`);
  } else if (hasBridgeEnv) {
    lines.push(`- Bridge: ${env.UNITY_MCP_HOST}:${env.UNITY_MCP_PORT}`);
  } else {
    lines.push("- Target: explicit bridge env / no registry selection");
  }
  if (projectName !== undefined) lines.push(`- Project name: ${projectName}`);
  if (projectPath !== undefined) lines.push(`- Project path: ${projectPath}`);
  if (contextDir !== undefined) lines.push(`- UOS context dir: ${contextDir}`);
  if (materialsDir !== undefined) lines.push(`- Planning materials dir: ${materialsDir}`);
  lines.push(...formatRunContextBridgeCapabilityLines(env));
  if (stringValue(env.UOS_MAX_MATERIAL_CANDIDATES) !== undefined) {
    lines.push(`- Material candidate limit: ${env.UOS_MAX_MATERIAL_CANDIDATES}`);
  }
  if (stringValue(env.UOS_MAX_MATERIAL_DEPTH) !== undefined) {
    lines.push(`- Material scan depth: ${env.UOS_MAX_MATERIAL_DEPTH}`);
  }
  if (stringValue(env.UOS_MAX_MATERIAL_SCAN_FILES) !== undefined) {
    lines.push(`- Material scan file limit: ${env.UOS_MAX_MATERIAL_SCAN_FILES}`);
  }
  if (files.length > 0) {
    lines.push("- Attached user files:");
    for (const file of files.slice(0, 20)) lines.push(`  - ${file}`);
    if (files.length > 20) lines.push(`  - ... ${files.length - 20} more file(s) omitted`);
  }
  lines.push("", "## Startup Checklist");
  lines.push("");
  lines.push("1. Call `get_uos_context` first; it is the authoritative selected-project context and may attach source, preview, and diff images.");
  if (files.length > 0) {
    lines.push("2. Read each attached user file before broad folder scans:");
    for (const file of files.slice(0, 12)) {
      lines.push(`   - \`read_planning_material({ path: ${JSON.stringify(file)} })\` - ${materialStartupHint(file)}`);
    }
    if (files.length > 12) lines.push(`   - ... ${files.length - 12} more file(s) omitted`);
  } else {
    lines.push("2. If the user names a material file, call `read_planning_material` before creating or editing screens from it.");
  }
  if (materialsDir !== undefined) {
    lines.push(`3. For the planning material directory, start with \`analyze_planning_materials({ dir: ${JSON.stringify(materialsDir)}, recursive: true })\`.`);
  } else {
    lines.push("3. Use `analyze_planning_materials` when a planning material directory is available.");
  }
  lines.push("4. Use `create_screen_from_material` for the broad material-to-Unity-screen path, or draft/validate a `PlanningIntent` when the user needs review before mutation.");
  lines.push("5. For follow-up edit requests, resolve persisted screens/elements with `resolve_uos_context_target`, `update_ui_element_from_context`, `add_ui_element_from_context`, `move_ui_element_from_context`, `delete_ui_element_from_context`, or `set_active_screen_from_context` instead of asking the user for screenId/elementId again.");
  lines.push("6. After material-derived creation or meaningful edits, use `capture_preview_from_context`, `verify_screen_against_reference_from_context`, `verify_screens_against_references_from_context` for multi-screen sources, or `inspect_screen_feedback_from_context` before deciding the result is correct.");
  lines.push("", "## Context Summary", "");
  if (contextSummary !== undefined) {
    lines.push(contextSummary);
  } else {
    lines.push("No persisted UOS context summary was available at launch. Call `get_uos_context` for authoritative selected-project context before mutating Unity.");
  }
  lines.push("");
  return lines.join("\n");
}

function formatRunContextBridgeCapabilityLines(env = {}) {
  const supportedTools = parseEnvToolArray(env.UOS_BRIDGE_SUPPORTED_TOOLS);
  const writeTools = parseEnvToolArray(env.UOS_BRIDGE_WRITE_TOOLS);
  const error = stringValue(env.UOS_BRIDGE_CAPABILITY_ERROR);
  const catalogStatus = stringValue(env.UOS_PROJECT_CATALOG_STATUS);
  const bridgeLive = stringValue(env.UOS_PROJECT_BRIDGE_LIVE);
  const uosInstalled = stringValue(env.UOS_PROJECT_UOS_INSTALLED);
  const readiness = evaluateLaunchBridgeCapabilities(env);
  const lines = [];
  if (catalogStatus !== undefined) {
    lines.push(`- UOS launcher project status: ${catalogStatus}`);
  }
  if (uosInstalled !== undefined) {
    lines.push(`- UOS package installed: ${uosInstalled === "1" ? "yes" : "no"}`);
  }
  if (bridgeLive !== undefined) {
    lines.push(`- Unity Editor bridge live: ${bridgeLive === "1" ? "yes" : "no"}`);
  }
  if (supportedTools !== undefined) {
    lines.push(`- Bridge required tools: ${REQUIRED_UNITY_BRIDGE_TOOLS.length - (readiness.missingTools?.length ?? 0)}/${REQUIRED_UNITY_BRIDGE_TOOLS.length}`);
    lines.push(`- Bridge supported tools: ${supportedTools.length}`);
    if ((readiness.missingTools?.length ?? 0) > 0) {
      lines.push(`- Bridge missing required tools: ${readiness.missingTools.join(", ")}`);
    }
  }
  if (writeTools !== undefined) {
    lines.push(`- Bridge required write tools: ${REQUIRED_UNITY_WRITE_TOOLS.length - (readiness.missingWriteTools?.length ?? 0)}/${REQUIRED_UNITY_WRITE_TOOLS.length}`);
    lines.push(`- Bridge write tools: ${writeTools.length > 0 ? writeTools.join(", ") : "0 write tools"}`);
    if ((readiness.missingWriteTools?.length ?? 0) > 0) {
      lines.push(`- Bridge missing required write tools: ${readiness.missingWriteTools.join(", ")}`);
    }
  }
  if (error !== undefined) {
    lines.push(`- Bridge capability probe error: ${error}`);
  }
  return lines;
}

function materialStartupHint(file) {
  const ext = path.extname(String(file)).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
    return "image/mockup path; use `create_reference_screen_from_material` or `prepare_image_ui_draft` when it should drive UI.";
  }
  if (ext === ".pptx") {
    return "PPTX deck; use `extract_pptx_layout`, `create_pptx_slide_screen`, or `create_pptx_deck_screens` depending on the requested scope.";
  }
  if (ext === ".pdf") {
    return "PDF material; use document drafting for text-forward pages or `pdf_to_images` / `create_pdf_page_reference_screen` for visual pages.";
  }
  if (ext === ".docx") {
    return "DOCX material; use `draft_planning_intent_from_docx` for body text or `extract_embedded_images` for screenshots/mockups.";
  }
  if ([".txt", ".md", ".csv", ".json"].includes(ext)) {
    return "text-forward document; use `draft_planning_intent_from_document` or `create_document_screen`.";
  }
  return "supported planning material if `read_planning_material` reports useful metadata.";
}

export async function prepareRunContextAttachment(summary, target, options = {}) {
  const content = formatRunContextAttachment(summary, target, options);
  if (content === undefined) return undefined;

  const tempRoot = stringValue(options.tempDir)
    ?? path.join(stringValue(options.repoRoot) ?? process.cwd(), ".omx", "tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const file = path.join(
    tempRoot,
    `uos-run-context-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`,
  );
  await fs.writeFile(file, content, "utf8");
  return { file };
}

export async function cleanupRunContextAttachment(attachment) {
  const file = stringValue(attachment?.file);
  if (file === undefined) return;
  await fs.rm(file, { force: true });
}

export function resolveLaunchInputs(target, options = {}) {
  const inheritMaterialsEnv = shouldInheritLaunchMaterialsEnv(target, options);
  const materialsDir = options.materialsDir !== undefined
    ? resolveLaunchMaterialsDir(options.materialsDir, target, options)
    : (inheritMaterialsEnv ? stringValue(options.env?.UNITY_MCP_MATERIALS_DIR) : undefined);
  const fileOptions = {
    ...options,
    materialsDir,
  };
  if (!inheritMaterialsEnv && options.env?.UNITY_MCP_MATERIALS_DIR !== undefined) {
    fileOptions.env = { ...options.env };
    delete fileOptions.env.UNITY_MCP_MATERIALS_DIR;
  }
  const files = resolveLaunchFiles(options.files, target, {
    ...fileOptions,
  });
  return { materialsDir, files };
}

function shouldInheritLaunchMaterialsEnv(target, options = {}) {
  if (target === undefined) return true;
  if (options.inheritMaterialsEnv === true) return true;
  return options.env?.UOS_INHERIT_MATERIALS_DIR === "1";
}

function shouldInheritLaunchMaterialLimits(options = {}) {
  if (options.inheritMaterialLimits === true) return true;
  return options.env?.UOS_INHERIT_MATERIAL_LIMITS === "1";
}

export async function validateLaunchInputs(target, options = {}) {
  const launchInputs = options.launchInputs ?? resolveLaunchInputs(target, options);
  if (launchInputs.materialsDir !== undefined) {
    await assertDirectory(launchInputs.materialsDir, "--uos-materials");
  }
  for (const file of launchInputs.files) {
    await assertFile(file, "--uos-file");
  }
  return launchInputs;
}

export function formatLaunchSummary(target, opencodeArgs, launchInputs = {}, readiness = undefined, env = undefined) {
  const lines = ["[uos] launch summary"];
  if (target !== undefined) {
    lines.push(`  project: ${label(target)}`);
  } else if (stringValue(env?.UOS_PROJECT_DIR) !== undefined) {
    const name = stringValue(env?.UOS_PROJECT_NAME) ?? path.basename(env.UOS_PROJECT_DIR);
    lines.push(`  project: ${name} - ${env.UOS_PROJECT_DIR} (no live bridge selected)`);
  } else {
    lines.push("  project: explicit bridge env / no selection");
  }
  const command = formatLaunchCommandSummary(opencodeArgs);
  lines.push(`  opencode: ${command}`);
  const responseLanguage = stringValue(env?.UOS_RESPONSE_LANGUAGE);
  if (responseLanguage !== undefined) {
    lines.push(`  response language: ${responseLanguage}`);
  }
  if (launchInputs.materialsDir !== undefined) {
    lines.push(`  materials: ${launchInputs.materialsDir}`);
  }
  const files = Array.isArray(launchInputs.files) ? launchInputs.files : [];
  if (files.length > 0) {
    lines.push(`  attached files: ${files.length}`);
    for (const file of files.slice(0, 10)) {
      lines.push(`    - ${file}`);
    }
    if (files.length > 10) {
      lines.push(`    ... ${files.length - 10} more file(s)`);
    }
    const routingLines = formatLaunchAttachmentRoutingLines(opencodeArgs, files);
    if (routingLines.length > 0) {
      lines.push("  attachment routing:");
      for (const line of routingLines) lines.push(`    - ${line}`);
    }
    if (opencodeCommandInfo(opencodeArgs).command !== "run") {
      lines.push("  note: TUI launches expose attached files through UOS_ATTACHED_FILES/get_uos_context; use `uos run` for opencode --file attachments in the first model turn.");
    }
  }
  const capabilityLines = formatLaunchBridgeReadinessLines(readiness);
  if (capabilityLines.length > 0) {
    lines.push("  bridge capabilities:");
    for (const line of capabilityLines) lines.push(`    - ${line}`);
  }
  const contextLines = formatLaunchContextStatusLines(env);
  if (contextLines.length > 0) {
    lines.push("  context:");
    for (const line of contextLines) lines.push(`    - ${line}`);
  }
  const warnings = Array.isArray(readiness?.warnings) ? readiness.warnings : [];
  if (warnings.length > 0) {
    lines.push("  warnings:");
    for (const warning of warnings) lines.push(`    - ${warning}`);
  }
  return lines.join("\n");
}

function formatLaunchAttachmentRoutingLines(opencodeArgs, files) {
  const allFiles = Array.isArray(files) ? files : [];
  if (allFiles.length === 0) return [];
  const textFiles = allFiles.filter(shouldAttachFileToOpencodeRun);
  const toolOnlyFiles = allFiles.filter((file) => !shouldAttachFileToOpencodeRun(file));
  const lines = [
    `UOS tools: ${allFiles.length} file(s) via UOS_ATTACHED_FILES/read_planning_material`,
  ];
  if (opencodeCommandInfo(opencodeArgs).command === "run") {
    lines.push(`opencode run --file: ${textFiles.length} text-like file(s)`);
    if (toolOnlyFiles.length > 0) {
      lines.push(`not passed to opencode --file: ${toolOnlyFiles.length} binary/visual file(s)`);
    }
  } else {
    lines.push("opencode run --file: not used for TUI/non-run launches");
  }
  return lines;
}

function formatLaunchContextStatusLines(env = {}) {
  const summary = stringValue(env?.UOS_CONTEXT_SUMMARY);
  if (summary === undefined) return [];
  const lines = summary.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const findContextValue = (prefix) => {
    const line = lines.find((item) => item.startsWith(`[uos context] ${prefix}`));
    return line?.slice(`[uos context] ${prefix}`.length).trim();
  };
  const result = [];
  const screens = findContextValue("screens:");
  if (screens !== undefined) result.push(`screens: ${screens}`);
  const activeScreen = findContextValue("activeScreen:");
  if (activeScreen !== undefined) result.push(`active screen: ${activeScreen}`);
  const latestVerification = findContextValue("latestVerification:");
  if (latestVerification !== undefined) {
    result.push(`latest verification: ${truncateText(latestVerification, 220)}`);
  } else {
    const latestPreview = findContextValue("latestPreview:");
    if (latestPreview !== undefined) result.push(`latest preview: ${truncateText(latestPreview, 220)}`);
  }
  const materialCandidates = findContextValue("planningMaterialCandidates:");
  if (materialCandidates !== undefined) result.push(`material candidates: ${materialCandidates}`);
  if (result.length === 0 && summary.includes("no persisted UOS screen context yet")) {
    result.push("no persisted UOS screen context yet");
  }
  return result.slice(0, 5);
}

function formatLaunchCommandSummary(opencodeArgs) {
  if (!Array.isArray(opencodeArgs) || opencodeArgs.length === 0) return "(interactive tui)";
  return opencodeArgs.map(formatLaunchCommandArg).join(" ");
}

function formatLaunchCommandArg(arg) {
  const value = String(arg ?? "");
  if (value.includes("\n") || value.includes("\r")) {
    const firstTextLine = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return `<${truncateText(firstTextLine ?? "multiline prompt", 80)} ...>`;
  }
  if (value.length > 120) return `${value.slice(0, 117)}...`;
  return value;
}

export function formatLaunchDryRun(target, opencodeArgs, env, launchInputs = {}) {
  const lines = [
    formatLaunchSummary(target, opencodeArgs, launchInputs, evaluateLaunchBridgeCapabilities(env), env),
    "",
    "[uos] forwarded opencode argv:",
    `  ${JSON.stringify(opencodeArgs)}`,
    "",
    "[uos] injected environment:",
  ];
  for (const key of [
    "UNITY_MCP_HOST",
    "UNITY_MCP_PORT",
    "UNITY_MCP_TOKEN",
    "UOS_PROJECT_DIR",
    "UOS_PROJECT_NAME",
    "UOS_EDITOR_INSTANCE_ID",
    "UOS_CONTEXT_DIR",
    "UNITY_MCP_MATERIALS_DIR",
    "UOS_ATTACHED_FILES",
    "UOS_MAX_MATERIAL_CANDIDATES",
    "UOS_MAX_MATERIAL_DEPTH",
    "UOS_MAX_MATERIAL_SCAN_FILES",
    "UOS_RESPONSE_LANGUAGE",
    "UOS_BRIDGE_SUPPORTED_TOOLS",
    "UOS_BRIDGE_WRITE_TOOLS",
    "UOS_BRIDGE_CAPABILITY_ERROR",
    "UOS_CONTEXT_SUMMARY",
  ]) {
    lines.push(`  ${key}: ${formatEnvValue(key, env?.[key])}`);
  }
  return lines.join("\n");
}

export async function buildContextReport(target, options = {}) {
  const launchInputs = options.launchInputs ?? resolveLaunchInputs(target, options);
  const env = await buildLaunchEnv(target, options.env ?? process.env, {
    ...options,
    launchInputs,
    maxChars: options.maxChars,
  });
  const projectDir = target?.projectPath ?? stringValue(env.UOS_PROJECT_DIR);
  const contextDir = stringValue(env.UOS_CONTEXT_DIR)
    ?? (projectDir !== undefined ? path.join(projectDir, ".uos") : undefined);
  const hasLaunchInputs = launchInputs.materialsDir !== undefined || launchInputs.files.length > 0;
  const materialSummary = projectDir !== undefined && hasLaunchInputs
    ? await summarizeLaunchMaterials(launchInputs, projectDir, options)
    : undefined;
  return {
    target: target !== undefined ? publicEditorTarget(target) : undefined,
    explicitBridge: target === undefined && hasExplicitBridgeEnv(env),
    projectDir,
    contextDir,
    launchInputs,
    materialCandidates: materialSummary?.items ?? [],
    env: {
      UNITY_MCP_HOST: stringValue(env.UNITY_MCP_HOST),
      UNITY_MCP_PORT: stringValue(env.UNITY_MCP_PORT),
      UOS_PROJECT_DIR: stringValue(env.UOS_PROJECT_DIR),
      UOS_PROJECT_NAME: stringValue(env.UOS_PROJECT_NAME),
      UOS_EDITOR_INSTANCE_ID: stringValue(env.UOS_EDITOR_INSTANCE_ID),
      UOS_CONTEXT_DIR: stringValue(env.UOS_CONTEXT_DIR),
      UNITY_MCP_MATERIALS_DIR: stringValue(env.UNITY_MCP_MATERIALS_DIR),
      UOS_ATTACHED_FILES: stringValue(env.UOS_ATTACHED_FILES),
      UOS_MAX_MATERIAL_CANDIDATES: stringValue(env.UOS_MAX_MATERIAL_CANDIDATES),
      UOS_MAX_MATERIAL_DEPTH: stringValue(env.UOS_MAX_MATERIAL_DEPTH),
      UOS_MAX_MATERIAL_SCAN_FILES: stringValue(env.UOS_MAX_MATERIAL_SCAN_FILES),
      UOS_RESPONSE_LANGUAGE: stringValue(env.UOS_RESPONSE_LANGUAGE),
      UOS_BRIDGE_SUPPORTED_TOOLS: stringValue(env.UOS_BRIDGE_SUPPORTED_TOOLS),
      UOS_BRIDGE_WRITE_TOOLS: stringValue(env.UOS_BRIDGE_WRITE_TOOLS),
      UOS_BRIDGE_CAPABILITY_ERROR: stringValue(env.UOS_BRIDGE_CAPABILITY_ERROR),
      UOS_CONTEXT_SUMMARY: stringValue(env.UOS_CONTEXT_SUMMARY),
    },
    summary: stringValue(env.UOS_CONTEXT_SUMMARY),
  };
}

export function formatContextReport(report) {
  const lines = ["[uos context] selected launch context"];
  if (report.target !== undefined) {
    lines.push(`project: ${label(report.target)}`);
  } else if (report.explicitBridge) {
    lines.push("project: explicit bridge env / no registry selection");
  } else {
    lines.push("project: no selected Unity project");
  }
  if (report.projectDir !== undefined) lines.push(`projectDir: ${report.projectDir}`);
  if (report.contextDir !== undefined) lines.push(`contextDir: ${report.contextDir}`);
  const capabilityCache = formatLaunchBridgeCapabilityCache(report.env);
  if (capabilityCache !== undefined) lines.push(capabilityCache);
  if (report.launchInputs?.materialsDir !== undefined) {
    lines.push(`materials: ${report.launchInputs.materialsDir}`);
  }
  const files = Array.isArray(report.launchInputs?.files) ? report.launchInputs.files : [];
  if (files.length > 0) {
    lines.push(`attached files: ${files.length}`);
    for (const file of files.slice(0, 20)) lines.push(`  - ${file}`);
    if (files.length > 20) lines.push(`  ... ${files.length - 20} more file(s) omitted`);
  }
  lines.push("");
  if (report.summary !== undefined) {
    lines.push(report.summary);
  } else {
    lines.push("[uos context] no persisted context or launch material inputs found");
  }
  lines.push("");
  lines.push("Next:");
  lines.push("  - Start a real AI session with the same selector, e.g. `uos --unity-project <selector> run \"...\"`.");
  lines.push("  - In the session, call `get_uos_context` first for authoritative persisted context and file attachments.");
  return lines.join("\n");
}

function formatLaunchBridgeCapabilityCache(env = {}) {
  const supportedTools = parseEnvToolArray(env.UOS_BRIDGE_SUPPORTED_TOOLS);
  const writeTools = parseEnvToolArray(env.UOS_BRIDGE_WRITE_TOOLS);
  const error = stringValue(env.UOS_BRIDGE_CAPABILITY_ERROR);
  if (supportedTools === undefined && writeTools === undefined && error === undefined) {
    return undefined;
  }
  const readiness = evaluateLaunchBridgeCapabilities(env);
  const parts = ["bridgeCapabilities:"];
  if (supportedTools !== undefined) {
    parts.push(`supportedTools=${supportedTools.length}`);
    parts.push(`requiredTools=${REQUIRED_UNITY_BRIDGE_TOOLS.length - (readiness.missingTools?.length ?? 0)}/${REQUIRED_UNITY_BRIDGE_TOOLS.length}`);
    if ((readiness.missingTools?.length ?? 0) > 0) parts.push(`missingTools=${readiness.missingTools.join(",")}`);
  }
  if (writeTools !== undefined) {
    parts.push(`writeTools=${writeTools.length}`);
    parts.push(`requiredWriteTools=${REQUIRED_UNITY_WRITE_TOOLS.length - (readiness.missingWriteTools?.length ?? 0)}/${REQUIRED_UNITY_WRITE_TOOLS.length}`);
    if ((readiness.missingWriteTools?.length ?? 0) > 0) parts.push(`missingWriteTools=${readiness.missingWriteTools.join(",")}`);
  }
  if (error !== undefined) parts.push(`error=${error}`);
  return parts.join(" ");
}

function parseEnvToolArray(value) {
  const raw = stringValue(value);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const tools = normalizeToolNames(parsed);
    return tools !== undefined ? tools : undefined;
  } catch {
    return undefined;
  }
}

export function evaluateLaunchBridgeCapabilities(env = {}) {
  const blockers = [];
  const warnings = [];
  const capabilityError = stringValue(env.UOS_BRIDGE_CAPABILITY_ERROR);
  if (capabilityError !== undefined) {
    blockers.push(`Unity bridge capability probe failed: ${capabilityError}`);
  }

  const supportedTools = parseEnvToolArray(env.UOS_BRIDGE_SUPPORTED_TOOLS);
  let missingRequiredTools;
  if (supportedTools !== undefined) {
    const missing = missingTools(REQUIRED_UNITY_BRIDGE_TOOLS, supportedTools);
    missingRequiredTools = missing;
    if (missing.length > 0) {
      blockers.push(`Unity bridge missing required tool(s): ${missing.join(", ")}`);
    }
  }

  const writeTools = parseEnvToolArray(env.UOS_BRIDGE_WRITE_TOOLS);
  let missingRequiredWriteTools;
  if (writeTools !== undefined) {
    const missingWrite = missingTools(REQUIRED_UNITY_WRITE_TOOLS, writeTools);
    missingRequiredWriteTools = missingWrite;
    if (missingWrite.length > 0) {
      blockers.push(`Unity bridge missing required write tool(s): ${missingWrite.join(", ")}`);
    }
  }

  if (capabilityError === undefined && hasExplicitBridgeEnv(env)) {
    if (supportedTools === undefined) {
      warnings.push(`Unity bridge did not report supportedTools; update ${UNITY_PACKAGE_NAME} for capability-aware AI launch checks`);
    }
    if (writeTools === undefined) {
      warnings.push(`Unity bridge did not report writeTools; update ${UNITY_PACKAGE_NAME} for write-safety AI launch checks`);
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    supportedTools,
    writeTools,
    requiredTools: REQUIRED_UNITY_BRIDGE_TOOLS,
    requiredWriteTools: REQUIRED_UNITY_WRITE_TOOLS,
    missingTools: missingRequiredTools,
    missingWriteTools: missingRequiredWriteTools,
  };
}

function formatLaunchBridgeReadinessLines(readiness) {
  const lines = [];
  if (Array.isArray(readiness?.missingTools)) {
    const ok = REQUIRED_UNITY_BRIDGE_TOOLS.length - readiness.missingTools.length;
    lines.push(`required tools ${ok}/${REQUIRED_UNITY_BRIDGE_TOOLS.length}`);
    if (readiness.missingTools.length > 0) {
      lines.push(`missing required tools: ${readiness.missingTools.join(", ")}`);
    }
  }
  if (Array.isArray(readiness?.missingWriteTools)) {
    const ok = REQUIRED_UNITY_WRITE_TOOLS.length - readiness.missingWriteTools.length;
    lines.push(`required write tools ${ok}/${REQUIRED_UNITY_WRITE_TOOLS.length}`);
    if (readiness.missingWriteTools.length > 0) {
      lines.push(`missing required write tools: ${readiness.missingWriteTools.join(", ")}`);
    }
  }
  return lines;
}

export function formatLaunchBridgeCapabilityFailure(readiness) {
  const blockers = Array.isArray(readiness?.blockers) ? readiness.blockers : [];
  const warnings = Array.isArray(readiness?.warnings) ? readiness.warnings : [];
  const lines = [
    "[uos] selected Unity bridge is not ready for an AI editing session.",
  ];
  if (blockers.length > 0) {
    lines.push("");
    lines.push("Blockers:");
    for (const blocker of blockers) lines.push(`  - ${blocker}`);
  }
  if (warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push("Next:");
  lines.push("  - Run `uos doctor --runtime` to inspect the selected bridge and opencode runtime.");
  lines.push("  - Update/reinstall the UOS Unity package if the bridge is missing required editing tools.");
  return lines.join("\n");
}

export function formatContextJson(report) {
  return JSON.stringify({
    target: report.target,
    explicitBridge: report.explicitBridge,
    projectDir: report.projectDir,
    contextDir: report.contextDir,
    launchInputs: report.launchInputs,
    materialCandidates: Array.isArray(report.materialCandidates) ? report.materialCandidates : [],
    env: {
      ...report.env,
      UOS_CONTEXT_SUMMARY: report.summary !== undefined ? "(set)" : undefined,
    },
    summary: report.summary,
  }, null, 2);
}

export async function installUnityPackage(options = {}) {
  const projectPath = resolveUnityProjectPath(options.projectPath);
  await assertUnityProjectRoot(projectPath);
  const packagesDir = path.join(projectPath, "Packages");
  const manifestPath = path.join(packagesDir, "manifest.json");
  const packagesLockPath = path.join(packagesDir, "packages-lock.json");
  const defaultPackageSpecifier = resolveUnityPackageSpecifier(
    options.packageSpecifier,
    options.repoRoot ?? process.cwd(),
  );
  const embed = options.embed !== false;
  const embeddedPath = path.join(packagesDir, UNITY_PACKAGE_NAME);
  const packageSourcePath = embed
    ? resolveEmbeddableUnityPackageSource(options.packageSpecifier, options.repoRoot ?? process.cwd())
    : undefined;
  const packageSpecifier = embed ? `embedded:${embeddedPath}` : defaultPackageSpecifier;
  const sourcePackage = embed ? await inspectLocalUnityPackage(packageSourcePath) : undefined;
  if (embed && sourcePackage?.ok !== true) {
    throw new Error(`[uos] cannot embed invalid Unity package: ${sourcePackage?.error ?? packageSourcePath}`);
  }
  const manifest = await readUnityManifest(manifestPath);
  const dependencies = manifest.dependencies !== undefined && manifest.dependencies !== null
    && typeof manifest.dependencies === "object" && !Array.isArray(manifest.dependencies)
    ? manifest.dependencies
    : {};
  const previousSpecifier = typeof dependencies[UNITY_PACKAGE_NAME] === "string"
    ? dependencies[UNITY_PACKAGE_NAME]
    : undefined;
  const nextDependencies = { ...dependencies };
  if (embed) delete nextDependencies[UNITY_PACKAGE_NAME];
  else nextDependencies[UNITY_PACKAGE_NAME] = packageSpecifier;
  const nextManifest = {
    ...manifest,
    dependencies: nextDependencies,
  };
  const embeddedExists = embed ? await directoryExists(embeddedPath) : false;
  const sameEmbeddedSource = embed && sameInstallPath(packageSourcePath, embeddedPath);
  const manifestChanged = embed
    ? previousSpecifier !== undefined
    : previousSpecifier !== packageSpecifier;
  const embeddedCopyNeeded = embed && !sameEmbeddedSource && (!embeddedExists || options.force === true);
  const packagesLock = await normalizeUnityPackagesLock({
    lockPath: packagesLockPath,
    mode: embed ? "embedded" : "manifest",
    packageSpecifier,
    packageInfo: sourcePackage,
    dryRun: options.dryRun === true,
  });
  const changed = manifestChanged || embeddedCopyNeeded || packagesLock.changed;
  if (options.dryRun !== true && manifestChanged) {
    await fs.mkdir(packagesDir, { recursive: true });
    await writeJsonFile(manifestPath, nextManifest);
  }
  if (options.dryRun !== true && embeddedCopyNeeded) {
    await embedUnityPackage({
      sourcePath: packageSourcePath,
      targetPath: embeddedPath,
      packagesDir,
      replace: embeddedExists && options.force === true,
    });
  }
  const installCheck = options.dryRun === true
    ? undefined
    : await inspectUnityProjectInstall(projectPath, options.repoRoot ?? process.cwd());
  return {
    projectPath,
    manifestPath,
    packageName: UNITY_PACKAGE_NAME,
    packageSpecifier,
    installMode: embed ? "embedded" : "manifest",
    embeddedPath: embed ? embeddedPath : undefined,
    packageSourcePath,
    embeddedExists,
    force: options.force === true,
    previousSpecifier,
    packagesLock,
    changed,
    dryRun: options.dryRun === true,
    manifest: nextManifest,
    installCheck,
  };
}

export async function uninstallUnityPackage(options = {}) {
  const projectPath = resolveUnityProjectPath(options.projectPath);
  await assertUnityProjectRoot(projectPath);
  const packagesDir = path.join(projectPath, "Packages");
  const manifestPath = path.join(packagesDir, "manifest.json");
  const packagesLockPath = path.join(packagesDir, "packages-lock.json");
  const embeddedPath = path.join(packagesDir, UNITY_PACKAGE_NAME);
  const manifest = await readUnityManifest(manifestPath);
  const dependencies = dependencyMap(manifest);
  const previousSpecifier = typeof dependencies[UNITY_PACKAGE_NAME] === "string"
    ? dependencies[UNITY_PACKAGE_NAME]
    : undefined;
  const nextDependencies = { ...dependencies };
  delete nextDependencies[UNITY_PACKAGE_NAME];
  const nextManifest = {
    ...manifest,
    dependencies: nextDependencies,
  };
  const embeddedExists = await directoryExists(embeddedPath);
  const removeEmbedded = options.removeEmbedded !== false;
  const manifestChanged = previousSpecifier !== undefined;
  const embeddedRemovalNeeded = embeddedExists && removeEmbedded;
  const packagesLock = await normalizeUnityPackagesLock({
    lockPath: packagesLockPath,
    mode: "remove",
    dryRun: options.dryRun === true,
  });
  const changed = manifestChanged || embeddedRemovalNeeded || packagesLock.changed;

  if (options.dryRun !== true && manifestChanged) {
    await fs.mkdir(packagesDir, { recursive: true });
    await writeJsonFile(manifestPath, nextManifest);
  }
  if (options.dryRun !== true && embeddedRemovalNeeded) {
    await removeEmbeddedUnityPackage(embeddedPath, packagesDir);
  }
  const installCheck = options.dryRun === true
    ? undefined
    : await inspectUnityProjectInstall(projectPath, options.repoRoot ?? process.cwd());
  return {
    projectPath,
    manifestPath,
    packageName: UNITY_PACKAGE_NAME,
    previousSpecifier,
    embeddedPath,
    embeddedExists,
    removeEmbedded,
    packagesLock,
    changed,
    dryRun: options.dryRun === true,
    manifest: nextManifest,
    installCheck,
  };
}

export async function inspectUnityProjectInstall(projectPathValue, repoRoot = process.cwd()) {
  const projectPath = resolveUnityProjectPath(projectPathValue);
  try {
    await assertUnityProjectRoot(projectPath);
  } catch (err) {
    return {
      ok: false,
      projectPath,
      installed: false,
      error: errorMessage(err),
    };
  }

  const manifestPath = path.join(projectPath, "Packages", "manifest.json");
  let manifest;
  try {
    manifest = await readUnityManifest(manifestPath);
  } catch (err) {
    return {
      ok: false,
      projectPath,
      manifestPath,
      installed: false,
      error: errorMessage(err),
    };
  }

  const dependencies = dependencyMap(manifest);
  const manifestSpecifier = typeof dependencies[UNITY_PACKAGE_NAME] === "string"
    ? dependencies[UNITY_PACKAGE_NAME]
    : undefined;
  const embeddedPackagePath = path.join(projectPath, "Packages", UNITY_PACKAGE_NAME);
  const hasEmbeddedPackage = await directoryExists(embeddedPackagePath);
  const embedded = manifestSpecifier === undefined && hasEmbeddedPackage;
  const hasInstallConflict = manifestSpecifier !== undefined && hasEmbeddedPackage;
  const specifier = manifestSpecifier ?? (embedded ? `embedded:${embeddedPackagePath}` : undefined);
  const installKind = manifestSpecifier !== undefined ? "manifest" : (embedded ? "embedded" : undefined);
  const localPath = manifestSpecifier !== undefined
    ? localPackagePathFromSpecifier(manifestSpecifier, projectPath)
    : (embedded ? embeddedPackagePath : undefined);
  const localPackage = localPath !== undefined
    ? await inspectLocalUnityPackage(localPath)
    : undefined;

  const installed = specifier !== undefined;
  const localOk = localPackage === undefined || localPackage.ok === true;
  return {
    ok: installed && localOk && !hasInstallConflict,
    projectPath,
    manifestPath,
    installed,
    installKind,
    specifier,
    manifestSpecifier,
    embeddedPackagePath,
    hasEmbeddedPackage,
    hasInstallConflict,
    expectedDefaultSpecifier: resolveUnityPackageSpecifier(undefined, repoRoot),
    localPackage,
  };
}

export function formatInstallUnityPackageResult(result) {
  const status = result.dryRun
    ? (result.changed ? "would update" : "already configured")
    : (result.changed ? "updated" : "already configured");
  const lines = [
    `[uos install-unity] ${status}`,
    `project: ${result.projectPath}`,
    `manifest: ${result.manifestPath}`,
    `package: ${result.packageName}`,
    `mode: ${result.installMode ?? "manifest"}`,
    `specifier: ${result.packageSpecifier}`,
  ];
  if (result.packageSourcePath !== undefined) {
    lines.push(`source: ${result.packageSourcePath}`);
  }
  if (result.embeddedPath !== undefined) {
    lines.push(`embeddedPath: ${result.embeddedPath}`);
  }
  if (result.previousSpecifier !== undefined && result.previousSpecifier !== result.packageSpecifier) {
    lines.push(`previous: ${result.previousSpecifier}`);
  }
  if (result.installMode === "embedded" && result.embeddedExists === true && result.changed === false) {
    lines.push("embedded: already present (pass --force to replace it from source)");
  }
  if (result.installMode === "embedded" && result.force === true) {
    lines.push("force: enabled");
  }
  if (result.packagesLock?.exists === true) {
    const lockStatus = result.packagesLock.changed
      ? (result.dryRun ? "would update" : "updated")
      : "already normalized";
    lines.push(`packagesLock: ${lockStatus} ${result.packagesLock.path}`);
  }
  if (result.packagesLock?.error !== undefined) {
    lines.push(`packagesLockError: ${result.packagesLock.error}`);
  }
  if (result.installCheck !== undefined) {
    lines.push(`check: ${result.installCheck.ok ? "ok" : "needs attention"}`);
    if (result.installCheck.installKind !== undefined) {
      lines.push(`installKind: ${result.installCheck.installKind}`);
    }
    if (result.installCheck.localPackage !== undefined) {
      const pkg = result.installCheck.localPackage;
      lines.push(`localPackage: ${pkg.ok ? "ok" : "needs attention"} ${pkg.path}`);
      if (pkg.version !== undefined) lines.push(`localPackageVersion: ${pkg.version}`);
      if (pkg.uguiDependency !== undefined) lines.push(`${UNITY_UGUI_PACKAGE_NAME}: ${pkg.uguiDependency}`);
      if (pkg.error !== undefined) lines.push(`localPackageError: ${pkg.error}`);
    }
    if (result.installCheck.error !== undefined) {
      lines.push(`checkError: ${result.installCheck.error}`);
    }
  }
  if (result.dryRun) {
    lines.push("dry-run: manifest was not written; package files and lockfile were not changed");
  } else if (result.changed) {
    lines.push("Next: reopen or refresh the Unity project, then run `uos projects`.");
  } else {
    lines.push("Next: ensure the Unity project is open and the bridge is running, then run `uos projects`.");
  }
  return lines.join("\n");
}

export async function buildLaunchEnv(target, baseEnv = process.env, options = {}) {
  const env = buildTargetEnv(target, baseEnv, options);
  await injectConfiguredResponseLanguage(env, options);
  if (options.bridgeCapabilities === true) {
    await injectLaunchBridgeCapabilities(env, target, options);
  }

  const projectDir = target?.projectPath ?? stringValue(env.UOS_PROJECT_DIR);
  if (projectDir === undefined) return env;

  const summary = await loadUosContextSummary(projectDir, options);
  if (summary !== undefined) {
    env.UOS_CONTEXT_SUMMARY = summary;
  }
  return env;
}

async function injectConfiguredResponseLanguage(env, options = {}) {
  if (stringValue(env.UOS_RESPONSE_LANGUAGE) !== undefined) return;
  const readConfig = options.readUosConfig ?? readUosConfig;
  try {
    const config = await readConfig(options);
    const responseLanguage = stringValue(config?.responseLanguage);
    if (responseLanguage !== undefined) {
      env.UOS_RESPONSE_LANGUAGE = responseLanguage;
    }
  } catch {
    // A broken optional UOS config should not block entering a Unity session.
  }
}

async function injectLaunchBridgeCapabilities(env, target, options = {}) {
  const probeTarget = target ?? explicitBridgeTargetFromEnv(env);
  if (probeTarget === undefined) return;
  const callTool = options.callUnityTool ?? callUnityTool;
  const timeoutMs = positiveInt(options.bridgeCapabilityTimeoutMs)
    ?? DEFAULT_BRIDGE_CAPABILITY_TIMEOUT_MS;
  try {
    const projectInfo = await callTool(
      probeTarget,
      "get_project_info",
      {},
      { ...options, timeoutMs },
    );
    const supportedTools = normalizeToolNames(projectInfo?.supportedTools);
    const writeTools = normalizeToolNames(projectInfo?.writeTools);
    if (supportedTools !== undefined) {
      env.UOS_BRIDGE_SUPPORTED_TOOLS = JSON.stringify(supportedTools);
    }
    if (writeTools !== undefined) {
      env.UOS_BRIDGE_WRITE_TOOLS = JSON.stringify(writeTools);
    }
  } catch (err) {
    env.UOS_BRIDGE_CAPABILITY_ERROR = errorMessage(err);
  }
}

export async function loadUosContextSummary(projectDir, options = {}) {
  const root = stringValue(projectDir);
  if (root === undefined) return undefined;
  const contextDir = stringValue(options.contextDir) ?? path.join(root, ".uos");
  const project = await readJsonFile(path.join(contextDir, "project.json"), undefined);
  const index = await readJsonFile(path.join(contextDir, "screens.json"), undefined);
  const hasContext = project !== undefined || index !== undefined;
  const launchInputs = normalizeSummaryLaunchInputs(options.launchInputs);
  const hasLaunchInputs = launchInputs.materialsDir !== undefined || launchInputs.files.length > 0;
  if (!hasContext && !hasLaunchInputs) return undefined;

  const maxScreens = positiveInt(options.maxScreens) ?? 8;
  const maxElements = positiveInt(options.maxElements) ?? 8;
  const maxAssets = positiveInt(options.maxAssets) ?? 8;
  const maxChars = positiveInt(options.maxChars) ?? 8_000;
  const screens = summarizeContextScreens(index, maxScreens, maxElements);
  const assets = summarizeContextAssets(index, maxAssets);
  const materialSummary = hasLaunchInputs
    ? await summarizeLaunchMaterials(launchInputs, root, options)
    : undefined;
  const lines = [
    `[uos context] projectName: ${project?.projectName ?? path.basename(root)}`,
    `[uos context] projectPath: ${project?.projectPath ?? root}`,
  ];
  if (launchInputs.materialsDir !== undefined) {
    lines.push(`[uos context] planningMaterialsDir: ${launchInputs.materialsDir}`);
  }
  if (launchInputs.files.length > 0) {
    lines.push(`[uos context] attachedFiles: ${launchInputs.files.length}`);
    for (const file of launchInputs.files.slice(0, 8)) {
      lines.push(`  - ${file}`);
    }
    if (launchInputs.files.length > 8) {
      lines.push(`  ... ${launchInputs.files.length - 8} more attached file(s) omitted`);
    }
  }
  if (hasLaunchInputs) {
    lines.push("[uos context] launch workflow:");
    if (launchInputs.files.length > 0) {
      lines.push("  - Read attached files first with read_planning_material.");
      for (const file of launchInputs.files.slice(0, 8)) {
        lines.push(`    * read_planning_material({ path: ${quoteContextValue(file)} }) - ${materialStartupHint(file)}`);
      }
      if (launchInputs.files.length > 8) {
        lines.push(`    * ... ${launchInputs.files.length - 8} more attached file(s) omitted`);
      }
    }
    if (launchInputs.materialsDir !== undefined) {
      lines.push("  - Use list_planning_materials or analyze_planning_materials on the planning material directory.");
    }
    lines.push("  - Use create_screen_from_material as the broad material-to-Unity-screen fast path.");
    lines.push("  - Use draft_planning_intent_from_document/draft_planning_intent_from_docx or draft_planning_intent_from_pptx when a document/deck should become editable UI.");
    lines.push("  - Use create_document_screen when a text-forward document should create an editable Unity screen immediately.");
    lines.push("  - Pass draft metadata.source as create_ui_screen.source so .uos context can trace generated screens back to their materials.");
    lines.push("  - Use create_reference_screen_from_material when an image/PDF/DOCX/PPTX should become a Unity reference screen immediately.");
    lines.push("  - After creating or editing a screen from visual material, use verify_screen_against_reference with the screenId and available reference image path.");
  }
  if (materialSummary !== undefined) {
    lines.push(...materialSummary.lines);
  }
  if (typeof index?.lastSavedScenePath === "string") {
    lines.push(`[uos context] lastSavedScene: ${index.lastSavedScenePath}`);
  }
  if (hasContext) {
    lines.push(`[uos context] screens: ${screens.count}`);
    if (typeof index?.activeScreenId === "string" && index.activeScreenId.length > 0) {
      lines.push(`[uos context] activeScreen: ${index.activeScreenId}`);
    }
    const latestVerification = summarizeContextLatestVerification(index);
    if (latestVerification !== undefined) {
      lines.push(`[uos context] latestVerification: ${latestVerification}`);
    } else {
      const latestPreview = summarizeContextLatestPreview(index);
      if (latestPreview !== undefined) lines.push(`[uos context] latestPreview: ${latestPreview}`);
    }
    lines.push(...screens.lines);
    lines.push(`[uos context] importedAssets: ${assets.count}`);
    lines.push(...assets.lines);
  } else {
    lines.push("[uos context] no persisted UOS screen context yet");
  }
  return truncateText(lines.join("\n"), maxChars);
}

async function summarizeLaunchMaterials(launchInputs, root, options = {}) {
  const maxDepth = clampInt(options.maxMaterialDepth, 4, 0, 20);
  const maxFiles = clampInt(options.maxMaterialScanFiles ?? options.maxMaterialFiles, 500, 1, 5000);
  const maxCandidates = clampInt(options.maxMaterialCandidates, 12, 0, 50);
  const byPath = new Map();
  let inspected = 0;
  let truncated = false;

  const materialsDir = stringValue(launchInputs.materialsDir);
  if (materialsDir !== undefined) {
    const scan = await scanLaunchMaterialDir(materialsDir, {
      root,
      maxDepth,
      maxFiles,
      addCandidate: (filePath) => addLaunchMaterialCandidate(byPath, filePath, {
        root,
        baseDir: materialsDir,
        source: "directory",
      }),
    });
    inspected += scan.inspected;
    truncated = truncated || scan.truncated;
  }

  for (const raw of launchInputs.files ?? []) {
    const filePath = stringValue(raw);
    if (filePath === undefined) continue;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const added = addLaunchMaterialCandidate(byPath, filePath, {
      root,
      baseDir: materialsDir,
      source: "file",
    });
    if (added) inspected += 1;
  }

  const allItems = [...byPath.values()]
    .sort((a, b) => b.priority - a.priority || a.relativePath.localeCompare(b.relativePath));
  const lines = [];
  if (allItems.length === 0) {
    lines.push("[uos context] planningMaterialCandidates: 0 supported file(s) found");
    return { items: [], lines, truncated, inspected };
  }
  if (maxCandidates === 0) {
    return { items: [], lines, truncated, inspected };
  }
  const items = allItems.slice(0, maxCandidates);

  const counts = countMaterialKinds(items);
  lines.push(`[uos context] planningMaterialCandidates: ${items.length} (${counts})`);
  if (truncated) {
    lines.push("  - listing was truncated; narrow --uos-materials or raise material scan limits before broad edits.");
  }
  for (const item of items) {
    lines.push(
      `  - ${item.relativePath} [${item.kind}, ${item.source}] ` +
        `tools=${item.recommendedTools.join(", ")}`,
    );
  }
  if (allItems.length > maxCandidates) {
    lines.push(`  ... ${allItems.length - maxCandidates} more material candidate(s) omitted`);
  }
  return { items, lines, truncated, inspected };
}

async function scanLaunchMaterialDir(dir, options) {
  let inspected = 0;
  let truncated = false;

  async function walk(current, depth) {
    if (inspected >= options.maxFiles) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (inspected >= options.maxFiles) {
        truncated = true;
        return;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < options.maxDepth && !SMOKE_MATERIAL_IGNORE_DIRS.has(entry.name)) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      inspected += 1;
      options.addCandidate(full);
    }
  }

  await walk(dir, 0);
  return { inspected, truncated };
}

function addLaunchMaterialCandidate(byPath, filePath, options) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SMOKE_SCREEN_MATERIAL_EXTENSIONS.has(ext)) return false;
  const full = path.resolve(filePath);
  const existing = byPath.get(full);
  const nextSource = mergeLaunchMaterialSource(existing?.source, options.source);
  const item = {
    path: full,
    relativePath: launchMaterialRelativePath(full, options.baseDir, options.root),
    kind: materialKindForExtension(ext),
    source: nextSource,
    mime: mimeForAttachmentPath(full),
    priority: launchMaterialPriority(ext),
    recommendedTools: recommendedLaunchMaterialTools(materialKindForExtension(ext)),
  };
  byPath.set(full, existing !== undefined ? { ...existing, source: nextSource } : item);
  return existing === undefined;
}

function mergeLaunchMaterialSource(existing, next) {
  if (existing === undefined) return next;
  if (existing === next) return existing;
  return "both";
}

function launchMaterialRelativePath(filePath, baseDir, root) {
  const base = stringValue(baseDir);
  if (base !== undefined) {
    const rel = path.relative(base, filePath);
    if (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.replace(/\\/g, "/");
    }
  }
  const rootRel = path.relative(root, filePath);
  return rootRel.length > 0 && !rootRel.startsWith("..") && !path.isAbsolute(rootRel)
    ? rootRel.replace(/\\/g, "/")
    : filePath.replace(/\\/g, "/");
}

function launchMaterialPriority(ext) {
  if (ext === ".pptx") return 100;
  if (ext === ".pdf") return 90;
  if (ext === ".docx") return 84;
  if (SMOKE_IMAGE_EXTENSIONS.has(ext)) return 80;
  if (SMOKE_VIDEO_EXTENSIONS.has(ext)) return 76;
  return 68;
}

function countMaterialKinds(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
}

function recommendedLaunchMaterialTools(kind) {
  switch (kind) {
    case "pptx":
      return ["read_planning_material", "create_screen_from_material", "create_pptx_deck_screens"];
    case "pdf":
      return ["read_planning_material", "create_screen_from_material", "create_pdf_page_reference_screen"];
    case "docx":
      return ["read_planning_material", "create_screen_from_material", "create_document_screen"];
    case "image":
      return ["read_planning_material", "create_screen_from_material", "verify_screen_against_reference"];
    case "video":
      return ["read_planning_material", "create_screen_from_material", "import_asset"];
    default:
      return ["read_planning_material", "create_screen_from_material", "create_document_screen"];
  }
}

function normalizeSummaryLaunchInputs(value) {
  const raw = value !== undefined && value !== null && typeof value === "object" ? value : {};
  const materialsDir = stringValue(raw.materialsDir);
  const files = Array.isArray(raw.files)
    ? raw.files
      .map((file) => stringValue(file))
      .filter((file) => file !== undefined)
    : [];
  return { materialsDir, files };
}

export function registryDir(env = process.env) {
  if (env.UOS_EDITOR_REGISTRY_DIR) return env.UOS_EDITOR_REGISTRY_DIR;
  const local = env.LOCALAPPDATA
    || (process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".local", "share"));
  return path.join(local, "oh-my-unity", "editors");
}

export function isRegistryEntry(entry) {
  return entry !== null
    && typeof entry === "object"
    && typeof entry.host === "string"
    && typeof entry.port === "number"
    && Number.isFinite(entry.port)
    && entry.port > 0;
}

export function canHandshake(entry, options = {}) {
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    let ws;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* best effort */ }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      ws = new WebSocketImpl(`ws://${entry.host}:${entry.port}`);
      ws.on("open", () => {
        ws.send(JSON.stringify({ kind: "hello", v: PROTOCOL_VERSION, token: entry.token ?? "" }));
      });
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
          finish(msg?.kind === "welcome");
        } catch {
          finish(false);
        }
      });
      ws.on("error", () => finish(false));
      ws.on("close", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

export function callUnityTool(target, tool, args = {}, options = {}) {
  const WebSocketImpl = options.WebSocketImpl ?? WebSocket;
  const timeoutMs = options.timeoutMs ?? TOOL_CALL_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let done = false;
    let welcomed = false;
    let ws;
    const callId = 1;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* best effort */ }
      if (err !== undefined) reject(err);
      else resolve(data);
    };
    const timer = setTimeout(
      () => finish(new Error(`[uos] Unity tool "${tool}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      ws = new WebSocketImpl(`ws://${target.host}:${target.port}`);
      ws.on("open", () => {
        ws.send(JSON.stringify({ kind: "hello", v: PROTOCOL_VERSION, token: target.token ?? "" }));
      });
      ws.on("message", (raw) => {
        let msg;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
        } catch (err) {
          finish(new Error(`[uos] malformed Unity bridge message: ${err instanceof Error ? err.message : String(err)}`));
          return;
        }

        if (!welcomed) {
          if (msg?.kind === "reject") {
            finish(new Error(`[uos] Unity rejected handshake: ${msg.reason ?? "no reason"}`));
            return;
          }
          if (msg?.kind !== "welcome") {
            finish(new Error(`[uos] expected welcome, got ${JSON.stringify(msg?.kind)}`));
            return;
          }
          if (majorOf(msg.v ?? "") !== majorOf(PROTOCOL_VERSION)) {
            finish(new Error(`[uos] Unity bridge protocol mismatch: ${msg.v ?? "(missing)"} vs ${PROTOCOL_VERSION}`));
            return;
          }
          welcomed = true;
          ws.send(JSON.stringify({ kind: "call", id: callId, tool, args }));
          return;
        }

        if (msg?.kind !== "result" || msg.id !== callId) return;
        if (msg.ok === true) finish(undefined, msg.data);
        else finish(new Error(`[uos] Unity tool "${tool}" failed: ${msg.error ?? "unknown error"}`));
      });
      ws.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
      ws.on("close", () => {
        if (!done) finish(new Error(`[uos] Unity bridge closed before "${tool}" completed`));
      });
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function runUnitySmoke(target, options = {}) {
  const projectInfo = await callUnityTool(target, "get_project_info", {}, options);
  const screensBefore = await callUnityTool(target, "list_screens", {}, options);
  const directSmoke = options.aiOnly !== true;
  let contextRecordedBeforeAi = false;
  const result = {
    ok: true,
    target,
    projectInfo,
    screensBefore,
    imported: undefined,
    selectedMaterial: undefined,
    materialScreenArgs: undefined,
    materialScreen: undefined,
    pptxDeckArgs: undefined,
    pptxDeck: undefined,
    sceneObject: undefined,
    intent: undefined,
    created: undefined,
    flowIntent: undefined,
    flowScreen: undefined,
    transitionArgs: undefined,
    transition: undefined,
    contextFollowUp: undefined,
    preview: undefined,
    comparison: undefined,
    verification: undefined,
    revision: undefined,
    saved: undefined,
    context: undefined,
    aiRun: undefined,
    aiRuns: undefined,
  };

  if (options.materialScreenPath !== undefined) {
    const sourcePath = resolveSmokeImportPath(options.materialScreenPath, target, options);
    result.selectedMaterial = {
      sourcePath,
      relativePath: path.basename(sourcePath),
      mode: "screen-from-material",
    };
    result.materialScreenArgs = smokeMaterialScreenArgs(sourcePath, options);
    if (directSmoke) {
      const runner = options.materialScreenRunner ?? runMaterialScreenTool;
      result.materialScreen = await runner(target, result.materialScreenArgs, options);
      result.intent = result.materialScreen?.intent;
      result.created = result.materialScreen?.created;
    }
  } else if (options.materialScreenFromMaterials === true) {
    const material = await selectSmokeMaterial(target, options);
    result.selectedMaterial = material;
    result.materialScreenArgs = smokeMaterialScreenArgs(material.sourcePath, options);
    if (directSmoke) {
      const runner = options.materialScreenRunner ?? runMaterialScreenTool;
      result.materialScreen = await runner(target, result.materialScreenArgs, options);
      result.intent = result.materialScreen?.intent;
      result.created = result.materialScreen?.created;
    }
  } else if (options.pptxDeckPath !== undefined) {
    const sourcePath = resolveSmokeImportPath(options.pptxDeckPath, target, options);
    result.selectedMaterial = {
      sourcePath,
      relativePath: path.basename(sourcePath),
      mode: "pptx-deck",
    };
    result.pptxDeckArgs = smokePptxDeckScreenArgs(sourcePath, options);
    if (directSmoke) {
      const runner = options.pptxDeckRunner ?? runPptxDeckScreenTool;
      result.pptxDeck = await runner(target, result.pptxDeckArgs, options);
      result.created = result.pptxDeck?.screens?.[0]?.created;
      result.intent = result.pptxDeck?.screens?.[0]?.draft?.intent;
    }
  } else if (directSmoke && options.importPath !== undefined) {
    const sourcePath = resolveSmokeImportPath(options.importPath, target, options);
    result.selectedMaterial = { sourcePath, mode: "explicit-import" };
    result.imported = await callUnityTool(
      target,
      "import_asset",
      {
        sourcePath,
        assetPath: options.assetPath,
        importAsSprite: options.importAsSprite !== false,
      },
      options,
    );
  } else if (directSmoke && options.materialsDir !== undefined) {
    const material = await selectSmokeMaterialImage(target, options);
    result.selectedMaterial = material;
    result.imported = await callUnityTool(
      target,
      "import_asset",
      {
        sourcePath: material.sourcePath,
        assetPath: options.assetPath ?? smokeAssetPathForMaterial(material.sourcePath),
        importAsSprite: options.importAsSprite !== false,
      },
      options,
    );
  }

  if (directSmoke && options.sceneObjectRoundTrip === true) {
    result.sceneObject = await runSmokeSceneObjectRoundTrip(target, options);
  }

  if (
    directSmoke
    && options.write === true
    && options.materialScreenPath === undefined
    && options.materialScreenFromMaterials !== true
    && options.pptxDeckPath === undefined
    && options.sceneObjectRoundTrip !== true
  ) {
    result.intent = smokePlanningIntent(options.screenName ?? "UOSSmokeScreen", { spriteAssetPath: result.imported?.assetPath });
    result.created = await callUnityTool(
      target,
      "create_ui_screen",
      { intent: result.intent },
      options,
    );
    if (options.revise === true && result.created?.screenId !== undefined) {
      result.revision = await runSmokeRevision(target, result.created, options);
    }
    if (options.flow === true && result.created?.screenId !== undefined) {
      const fromId = stringValue(result.created.screenId);
      const trigger = elementIdByHint(result.created, "smokeButton");
      if (fromId === undefined || trigger === undefined) {
        throw new Error("[uos] smoke flow requires a created smoke screen and smokeButton element id");
      }
      result.flowIntent = smokePlanningIntent(smokeFlowScreenName(options.screenName ?? "UOSSmokeScreen"));
      result.flowScreen = await callUnityTool(
        target,
        "create_ui_screen",
        { intent: result.flowIntent },
        options,
      );
      const toId = stringValue(result.flowScreen?.screenId);
      if (toId === undefined) {
        throw new Error("[uos] smoke flow requires the destination screen id");
      }
      result.transitionArgs = { fromId, toId, trigger };
      result.transition = await callUnityTool(target, "create_screen_transition", result.transitionArgs, options);
    }
  }

  if (options.contextFollowUp === true) {
    result.contextFollowUp = await runSmokeContextFollowUp(target, result, options);
  }

  const needsPreview = options.preview === true
    || options.comparePath !== undefined
    || options.verifyPath !== undefined;
  const previewScreenId = stringValue(result.created?.screenId)
    ?? stringValue(result.pptxDeck?.activeScreenId)
    ?? stringValue(result.pptxDeck?.screens?.[0]?.screenId);
  if (needsPreview && previewScreenId !== undefined && shouldCaptureSmokePreviewBeforeAi(options)) {
    result.preview = await callUnityTool(target, "capture_preview", { screenId: previewScreenId }, options);
  }

  if (options.save === true && options.aiFollowUp !== true) {
    result.saved = await callUnityTool(
      target,
      "save_scene",
      options.scenePath !== undefined ? { path: options.scenePath } : {},
      options,
    );
  }

  const aiOnlyFollowUpConversation = isAiOnlyFollowUpConversation(options);
  if (
    options.aiRun === true
    && options.aiFollowUp === true
    && aiOnlyFollowUpConversation !== true
    && options.recordContext !== false
    && result.context === undefined
  ) {
    result.context = await recordSmokeContext(target, result, options);
    contextRecordedBeforeAi = result.context !== undefined;
  }

  if (options.aiRun === true) {
    if (aiOnlyFollowUpConversation) {
      result.aiRuns = await runOpencodeAiConversationSmoke(target, options, result);
      result.aiRun = result.aiRuns.at(-1);
    } else {
      result.aiRun = await runOpencodeAiSmoke(target, options, result);
      if (result.aiRun.ok !== true) {
        throw new Error(formatOpencodeAiSmokeFailure(result.aiRun));
      }
      const feedbackRuns = await runOpencodeAiFeedbackRepairSmoke(target, options, result, result.aiRun);
      if (feedbackRuns.length > 1) {
        result.aiRuns = feedbackRuns;
        result.aiRun = feedbackRuns.at(-1);
      }
    }
    if (needsPreview && result.preview === undefined) {
      const aiPreviewScreenId = stringValue(result.aiRun.journalScreenId);
      if (aiPreviewScreenId === undefined) {
        throw new Error("[uos] AI smoke preview requires journal evidence of the AI-created screenId");
      }
      const preview = await callUnityTool(target, "capture_preview", { screenId: aiPreviewScreenId }, options);
      result.preview = {
        ...preview,
        screenId: stringValue(preview?.screenId) ?? aiPreviewScreenId,
      };
    }
  }

  if (options.save === true && options.aiFollowUp === true) {
    result.saved = await callUnityTool(
      target,
      "save_scene",
      options.scenePath !== undefined ? { path: options.scenePath } : {},
      options,
    );
  }

  if (options.recordContext !== false) {
    const recordResult = contextRecordedBeforeAi && options.aiFollowUp === true
      ? smokePostAiContextRecordResult(result, options)
      : result;
    result.context = await recordSmokeContext(target, recordResult, options);
    if (recordResult !== result) {
      if (recordResult.preview !== undefined) result.preview = recordResult.preview;
      if (recordResult.comparison !== undefined) result.comparison = recordResult.comparison;
      if (recordResult.verification !== undefined) result.verification = recordResult.verification;
    }
  }

  return result;
}

function smokePostAiContextRecordResult(result, options = {}) {
  const visualFeedbackAlreadyRecorded = shouldCaptureSmokePreviewBeforeAi(options)
    && (options.comparePath !== undefined || options.verifyPath !== undefined);
  return {
    ...result,
    imported: undefined,
    selectedMaterial: undefined,
    materialScreenArgs: undefined,
    materialScreen: undefined,
    pptxDeckArgs: undefined,
    pptxDeck: undefined,
    sceneObject: undefined,
    intent: undefined,
    created: undefined,
    flowIntent: undefined,
    flowScreen: undefined,
    transitionArgs: undefined,
    transition: undefined,
    contextFollowUp: undefined,
    revision: undefined,
    preview: visualFeedbackAlreadyRecorded ? undefined : result.preview,
    comparison: visualFeedbackAlreadyRecorded ? undefined : result.comparison,
    verification: visualFeedbackAlreadyRecorded ? undefined : result.verification,
  };
}

function isAiOnlyFollowUpConversation(options = {}) {
  return options.aiRun === true
    && options.aiOnly === true
    && options.aiFollowUp === true
    && hasAiOnlyFollowUpMaterialTarget(options);
}

function shouldCaptureSmokePreviewBeforeAi(options = {}) {
  return options.aiFollowUp !== true
    || options.comparePath !== undefined
    || options.verifyPath !== undefined;
}

async function runOpencodeAiConversationSmoke(target, options = {}, smokeResult = {}) {
  const firstRun = await runOpencodeAiSmoke(target, {
    ...options,
    aiFollowUp: false,
    aiRunPrompt: undefined,
  }, smokeResult);
  if (firstRun.ok !== true) {
    throw new Error(formatOpencodeAiSmokeFailure(firstRun));
  }
  const firstScreenId = stringValue(firstRun.journalScreenId);
  if (firstScreenId === undefined) {
    throw new Error("[uos] opencode AI conversation smoke requires journal evidence of the first AI-created screenId");
  }

  const followUpSeed = {
    ...smokeResult,
    aiRun: firstRun,
    aiRuns: [firstRun],
  };
  const followUpRun = await runOpencodeAiSmoke(target, {
    ...options,
    aiOnly: false,
    aiFollowUp: true,
    aiContinue: true,
    aiRunPrompt: undefined,
  }, followUpSeed);
  if (followUpRun.ok !== true) {
    throw new Error(formatOpencodeAiSmokeFailure(followUpRun));
  }
  return [firstRun, followUpRun];
}

async function runOpencodeAiFeedbackRepairSmoke(target, options = {}, smokeResult = {}, firstRun) {
  const maxIterations = positiveInt(options.aiFeedbackIterations) ?? 1;
  if (maxIterations <= 1 || options.aiFollowUp !== true || isAiOnlyFollowUpConversation(options)) {
    return firstRun !== undefined ? [firstRun] : [];
  }
  const runs = firstRun !== undefined ? [firstRun] : [];
  for (let iteration = runs.length + 1; iteration <= maxIterations; iteration++) {
    const seed = {
      ...smokeResult,
      aiRun: runs.at(-1),
      aiRuns: [...runs],
    };
    if (!smokeShouldRunAdditionalFeedbackRepair(seed, options)) break;
    const run = await runOpencodeAiSmoke(target, {
      ...options,
      aiContinue: true,
      aiRunPrompt: undefined,
      aiFeedbackIteration: iteration,
    }, seed);
    if (run.ok !== true) {
      throw new Error(formatOpencodeAiSmokeFailure(run));
    }
    runs.push(run);
  }
  return runs;
}

function smokeShouldRunAdditionalFeedbackRepair(result = {}, options = {}) {
  const lastRun = Array.isArray(result.aiRuns) && result.aiRuns.length > 0
    ? result.aiRuns.at(-1)
    : result.aiRun;
  if (lastRun?.ok !== true || lastRun.mode !== "context-follow-up") return false;
  if (lastRun.followUpAction !== "move") return false;
  if (!smokeHasVisualFeedback(result, smokeContextSnapshot(result, options), smokeFollowUpScreenId(result))) return false;
  const idx = smokeContextSnapshot(result, options);
  const screenId = smokeFollowUpScreenId(result);
  if (smokeVisualFeedbackReferencePath({}, idx, screenId) === undefined) return false;
  return smokeNeedsFeedbackLayoutMove({}, idx, screenId);
}

async function runOpencodeAiSmoke(target, options = {}, smokeResult = {}) {
  const repoRoot = options.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
  const title = stringValue(options.aiRunTitle) ?? "UOS AI Smoke";
  const model = stringValue(options.aiRunModel)
    ?? stringValue(options.env?.UOS_SMOKE_AI_MODEL)
    ?? DEFAULT_OPENCODE_AI_SMOKE_MODEL;
  const objectName = stringValue(options.aiRunObjectName)
    ?? stringValue(options.sceneObjectName)
    ?? `UOS_AI_SMOKE_${Date.now().toString(36)}`;
  const plan = opencodeAiSmokePlan(target, { ...options, objectName }, smokeResult);
  const prompt = stringValue(options.aiRunPrompt)
    ?? plan.prompt;
  const launchInputs = { files: plan.files };
  const launchEnv = await buildLaunchEnv(target, options.env ?? process.env, {
    ...options,
    bridgeCapabilities: true,
    launchInputs,
  });
  const opencodeArgs = ["run"];
  if (options.aiContinue === true) {
    opencodeArgs.push("--continue");
  }
  opencodeArgs.push("--title", title);
  if (model !== undefined) {
    opencodeArgs.push("-m", model);
  }
  opencodeArgs.push(prompt);
  const startedAt = new Date().toISOString();
  const forwardedArgs = buildForwardArgs(opencodeArgs, target, {
    ...options,
    env: launchEnv,
    launchInputs,
  });
  const command = stringValue(options.opencodeCommand) ?? "opencode";
  const commandResult = runCommand(command, forwardedArgs, {
    cwd: repoRoot,
    env: launchEnv,
    timeoutMs: positiveInt(options.aiRunTimeoutMs) ?? DEFAULT_OPENCODE_AI_SMOKE_TIMEOUT_MS,
    commandRunner: options.commandRunner,
  });
  const output = `${commandResult.stdout ?? ""}\n${commandResult.stderr ?? ""}`;
  const observedTools = observedOpencodeAiSmokeTools(output, plan.expectedTools);
  const missingTools = plan.expectedTools.filter((tool) => !observedTools.includes(tool));
  const journal = await inspectOpencodeAiSmokeJournal(target, plan, {
    ...options,
    startedAt,
  });
  const markerSeen = output.includes(OPENCODE_AI_SMOKE_MARKER);
  const ok = commandResult.status === 0
    && missingTools.length === 0
    && (journal.skipped === true || (journal.missingTools.length === 0 && journal.orderOk !== false));
  return {
    ok,
    command,
    args: forwardedArgs,
    status: commandResult.status,
    error: commandResult.error,
    stdout: commandResult.stdout,
    stderr: commandResult.stderr,
    title,
    model,
    agent: DEFAULT_UOS_AGENT,
    mode: plan.mode,
    objectName,
    objectType: plan.objectType,
    materialPath: plan.materialPath,
    screenId: plan.screenId,
    screenName: plan.screenName,
    followUpAction: plan.followUpAction,
    feedbackIteration: positiveInt(options.aiFeedbackIteration),
    expectedTools: [...plan.expectedTools],
    observedTools,
    missingTools,
    expectedJournalTools: journal.expectedTools,
    observedJournalTools: journal.observedTools,
    missingJournalTools: journal.missingTools,
    journalScreenId: journal.screenId,
    journalVerification: journal.verification,
    journalOrderOk: journal.orderOk,
    journalOrderError: journal.orderError,
    journalVerified: journal.verified,
    journalSkippedReason: journal.skippedReason,
    continued: options.aiContinue === true,
    markerSeen,
  };
}

function opencodeAiSmokePlan(target, options = {}, smokeResult = {}) {
  if (options.aiFollowUp === true) {
    return opencodeAiContextFollowUpSmokePlan(target, options, smokeResult);
  }

  const materialPath = opencodeAiSmokeMaterialPath(target, options, smokeResult);
  if (materialPath !== undefined) {
    const screenName = stringValue(options.screenName) ?? "UOSAISmokeMaterial";
    return {
      mode: "material-screen",
      materialPath,
      screenName,
      files: [materialPath],
      expectedTools: OPENCODE_AI_MATERIAL_SCREEN_SMOKE_TOOLS,
      prompt: formatOpencodeAiMaterialSmokePrompt(target, materialPath, options),
    };
  }

  const pptxDeckPath = opencodeAiSmokePptxDeckPath(target, options, smokeResult);
  if (pptxDeckPath !== undefined) {
    const screenName = stringValue(options.screenName) ?? "UOSAISmokeDeck";
    return {
      mode: "pptx-deck",
      materialPath: pptxDeckPath,
      screenName,
      files: [pptxDeckPath],
      expectedTools: OPENCODE_AI_PPTX_DECK_SMOKE_TOOLS,
      prompt: formatOpencodeAiPptxDeckSmokePrompt(target, pptxDeckPath, options),
    };
  }

  return {
    mode: "scene-object",
    materialPath: undefined,
    files: [],
    objectType: stringValue(options.sceneObjectType) ?? "Empty",
    expectedTools: OPENCODE_AI_SCENE_OBJECT_SMOKE_TOOLS,
    prompt: formatOpencodeAiSceneObjectSmokePrompt(target, options),
  };
}

function opencodeAiContextFollowUpSmokePlan(target, options = {}, smokeResult = {}) {
  const idx = smokeContextSnapshot(smokeResult, options);
  const screenId = smokeFollowUpScreenId(smokeResult);
  if (screenId === undefined) {
    throw new Error("[uos] --ai-follow-up requires a direct UI screen from --write, --screen-from-material, --screen-from-first-material, or --pptx-deck");
  }
  const ts = smokeTimestamp(options);
  smokeApplyToIndex(idx, "set_active_screen", { screenId }, { screenId, active: true }, ts);
  const activeScreen = smokeResolveActiveScreen(idx);
  const followUpPlan = smokeContextFollowUpPlan(idx);
  const screenCriteria = compactObject({
    screenId,
    screenName: stringValue(activeScreen?.screenName),
  });
  const inspectFeedback = smokeHasVisualFeedback(smokeResult, idx, screenId);
  const feedbackReferencePath = smokeVisualFeedbackReferencePath(smokeResult, idx, screenId);
  if (inspectFeedback && smokeNeedsFeedbackLayoutMove(smokeResult, idx, screenId) && followUpPlan.moveTarget !== undefined) {
    const reverifyAfterMove = feedbackReferencePath !== undefined;
    if (reverifyAfterMove && smokeShouldEscalateFeedbackRepair(options)) {
      return {
        mode: "context-follow-up",
        followUpAction: "replace",
        materialPath: undefined,
        files: [],
        screenId,
        screenName: stringValue(activeScreen?.screenName),
        deleteCriteria: followUpPlan.moveCriteria,
        addCriteria: followUpPlan.addCriteria,
        expectedTools: OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_REPLACE_SMOKE_TOOLS,
        prompt: formatOpencodeAiContextFollowUpReplacePrompt(target, {
          screenCriteria,
          deleteCriteria: followUpPlan.moveCriteria,
          addCriteria: followUpPlan.addCriteria,
          referencePath: feedbackReferencePath,
          compareMaxWidth: options.compareMaxWidth,
          compareMaxHeight: options.compareMaxHeight,
          compareThreshold: options.compareThreshold,
        }),
      };
    }
    return {
      mode: "context-follow-up",
      followUpAction: "move",
      materialPath: undefined,
      files: [],
      screenId,
      screenName: stringValue(activeScreen?.screenName),
      moveCriteria: followUpPlan.moveCriteria,
      expectedTools: reverifyAfterMove
        ? OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_REVERIFY_MOVE_SMOKE_TOOLS
        : OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_MOVE_SMOKE_TOOLS,
      prompt: formatOpencodeAiContextFollowUpMovePrompt(target, {
        screenCriteria,
        moveCriteria: followUpPlan.moveCriteria,
        moveRect: followUpPlan.moveRect,
        referencePath: feedbackReferencePath,
        compareMaxWidth: options.compareMaxWidth,
        compareMaxHeight: options.compareMaxHeight,
        compareThreshold: options.compareThreshold,
      }),
    };
  }
  if (followUpPlan.updateTarget === undefined) {
    return {
      mode: "context-follow-up",
      followUpAction: "add",
      materialPath: undefined,
      files: [],
      screenId,
      screenName: stringValue(activeScreen?.screenName),
      addCriteria: followUpPlan.addCriteria,
      expectedTools: inspectFeedback
        ? OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_ADD_SMOKE_TOOLS
        : OPENCODE_AI_CONTEXT_FOLLOW_UP_ADD_SMOKE_TOOLS,
      prompt: formatOpencodeAiContextFollowUpAddPrompt(target, {
        screenCriteria,
        addCriteria: followUpPlan.addCriteria,
        addText: "UOS AI Context Follow-up",
        inspectFeedback,
      }),
    };
  }
  return {
    mode: "context-follow-up",
    followUpAction: "update",
    materialPath: undefined,
    files: [],
    screenId,
    screenName: stringValue(activeScreen?.screenName),
    updateCriteria: followUpPlan.updateCriteria,
    expectedTools: inspectFeedback
      ? OPENCODE_AI_CONTEXT_FOLLOW_UP_FEEDBACK_UPDATE_SMOKE_TOOLS
      : OPENCODE_AI_CONTEXT_FOLLOW_UP_UPDATE_SMOKE_TOOLS,
    prompt: formatOpencodeAiContextFollowUpUpdatePrompt(target, {
      screenCriteria,
      updateCriteria: followUpPlan.updateCriteria,
      updateText: "UOS AI Context Follow-up",
      inspectFeedback,
    }),
  };
}

function smokeShouldEscalateFeedbackRepair(options = {}) {
  const iteration = positiveInt(options.aiFeedbackIteration) ?? 1;
  return iteration >= 3;
}

function smokeFollowUpScreenId(smokeResult = {}) {
  return stringValue(smokeResult.created?.screenId)
    ?? stringValue(smokeResult.pptxDeck?.activeScreenId)
    ?? stringValue(smokeResult.pptxDeck?.screens?.[0]?.screenId)
    ?? stringValue(smokeResult.pptxDeck?.screens?.[0]?.created?.screenId)
    ?? stringValue(smokeResult.aiRun?.journalScreenId)
    ?? stringValue(smokeResult.aiRuns?.[0]?.journalScreenId);
}

function smokeHasVisualFeedback(result = {}, idx = {}, screenId) {
  if (result.verification !== undefined || result.comparison !== undefined) return true;
  const screen = screenId !== undefined ? idx.screens?.[screenId] : smokeResolveActiveScreen(idx);
  return Array.isArray(screen?.comparisons) && screen.comparisons.length > 0;
}

function smokeNeedsFeedbackLayoutMove(result = {}, idx = {}, screenId) {
  const comparison = smokeCurrentVisualComparison(result, idx, screenId);
  if (comparison === undefined) return false;
  if (sameFolded(stringValue(comparison.verdict), "different")) return true;
  const mismatchRatio = numberValue(comparison.mismatchRatio);
  if (mismatchRatio !== undefined && mismatchRatio >= 0.35) return true;
  const meanAbsoluteError = numberValue(comparison.meanAbsoluteError);
  if (meanAbsoluteError !== undefined && meanAbsoluteError >= 0.12) return true;
  const aspectRatioDelta = numberValue(comparison.aspectRatioDelta);
  return aspectRatioDelta !== undefined && aspectRatioDelta >= 0.02;
}

function smokeCurrentVisualComparison(result = {}, idx = {}, screenId) {
  return smokeLatestComparison(idx, screenId)
    ?? result.verification?.comparison
    ?? result.comparison;
}

function smokeLatestComparison(idx = {}, screenId) {
  const screen = screenId !== undefined ? idx.screens?.[screenId] : smokeResolveActiveScreen(idx);
  const comparisons = Array.isArray(screen?.comparisons)
    ? screen.comparisons.filter((item) => item !== null && typeof item === "object")
    : [];
  if (comparisons.length === 0) return undefined;
  return [...comparisons].sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")))[0];
}

function smokeVisualFeedbackReferencePath(result = {}, idx = {}, screenId) {
  const latest = smokeLatestComparison(idx, screenId);
  return stringValue(latest?.referencePath)
    ?? stringValue(result.verification?.comparison?.referencePath)
    ?? stringValue(result.comparison?.referencePath);
}

function opencodeAiSmokeMaterialPath(target, options = {}, smokeResult = {}) {
  return stringValue(smokeResult.materialScreenArgs?.path)
    ?? (stringValue(options.materialScreenPath) !== undefined
      ? resolveSmokeImportPath(options.materialScreenPath, target, options, options.env ?? process.env)
      : undefined)
    ?? (options.materialScreenFromMaterials === true ? stringValue(smokeResult.selectedMaterial?.sourcePath) : undefined);
}

function opencodeAiSmokePptxDeckPath(target, options = {}, smokeResult = {}) {
  return stringValue(smokeResult.pptxDeckArgs?.path)
    ?? (stringValue(options.pptxDeckPath) !== undefined
      ? resolveSmokeImportPath(options.pptxDeckPath, target, options, options.env ?? process.env)
      : undefined);
}

function formatOpencodeAiMaterialSmokePrompt(target, materialPath, options = {}) {
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  const screenName = stringValue(options.screenName) ?? "UOSAISmokeMaterial";
  const mode = stringValue(options.materialScreenMode) ?? "auto";
  return [
    "Run a UOS AI planning-material smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    `Use this exact planning material path: ${JSON.stringify(materialPath)}.`,
    "Call get_uos_context exactly once first, inspect selectedUnity and recommendedLaunchWorkflow, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
    "Call read_planning_material exactly once for that material path before mutating Unity.",
    `Then call create_screen_from_material exactly once for that material path with mode ${JSON.stringify(mode)} and screenName ${JSON.stringify(screenName)}.`,
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the created screenId.`,
    "Do not save the scene or edit unrelated objects.",
  ].join(" ");
}

function formatOpencodeAiPptxDeckSmokePrompt(target, pptxPath, options = {}) {
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  const screenName = stringValue(options.screenName) ?? "UOSAISmokeDeck";
  const slideText = Array.isArray(options.pptxDeckSlideNumbers) && options.pptxDeckSlideNumbers.length > 0
    ? `Use slideNumbers ${JSON.stringify(options.pptxDeckSlideNumbers)}.`
    : "Use the first available slide if no slide range is needed.";
  const shapePanelsText = typeof options.pptxDeckIncludeShapePanels === "boolean"
    ? `Set includeShapePanels to ${options.pptxDeckIncludeShapePanels ? "true" : "false"}.`
    : "";
  return [
    "Run a UOS AI PPTX deck smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    `Use this exact PPTX path: ${JSON.stringify(pptxPath)}.`,
    "Call get_uos_context exactly once first, inspect selectedUnity and recommendedLaunchWorkflow, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
    "Call read_planning_material exactly once for that PPTX path before mutating Unity.",
    `Then call create_pptx_deck_screens exactly once for that PPTX path with screenNamePrefix ${JSON.stringify(screenName)}. ${slideText} ${shapePanelsText}`.trim(),
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the first created screenId.`,
    "Do not save the scene or edit unrelated objects.",
  ].join(" ");
}

function formatOpencodeAiContextFollowUpUpdatePrompt(target, options = {}) {
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  const screenCriteria = options.screenCriteria ?? {};
  const updateCriteria = options.updateCriteria ?? {};
  const updateText = stringValue(options.updateText) ?? "UOS AI Context Follow-up";
  const updateArgs = compactObject({
    ...screenCriteria,
    ...updateCriteria,
    props: {
      text: updateText,
      color: "#22c55e",
    },
  });
  const feedbackArgs = compactObject({
    ...screenCriteria,
    maxAttachments: 3,
  });
  const previewArgs = compactObject({
    ...screenCriteria,
  });
  const lines = [
    "Run a UOS AI conversational follow-up smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    "Use only the existing persisted .uos context for the target screen; do not create a new screen, material screen, deck, asset, or scene object.",
    "Call get_uos_context exactly once first, inspect selectedUnity and the persisted screens, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
  ];
  if (options.inspectFeedback === true) {
    lines.push(`Then call inspect_screen_feedback_from_context exactly once with args ${JSON.stringify(feedbackArgs)} and use its diagnostics, latest comparison, and recommendedTools before editing.`);
  }
  lines.push(
    `Then call update_ui_element_from_context exactly once with args ${JSON.stringify(updateArgs)}.`,
    `After that call capture_preview_from_context exactly once with args ${JSON.stringify(previewArgs)}.`,
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the updated screenId and elementId.`,
    "Do not save the scene or edit unrelated objects.",
  );
  return lines.join(" ");
}

function formatOpencodeAiContextFollowUpMovePrompt(target, options = {}) {
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  const screenCriteria = options.screenCriteria ?? {};
  const moveCriteria = options.moveCriteria ?? {};
  const moveRect = options.moveRect ?? { x: 0.06, y: 0.06, w: 0.88, h: 0.12 };
  const referencePath = stringValue(options.referencePath);
  const feedbackArgs = compactObject({
    ...screenCriteria,
    maxAttachments: 3,
  });
  const hierarchyArgs = compactObject({
    ...screenCriteria,
  });
  const moveArgs = compactObject({
    ...screenCriteria,
    ...moveCriteria,
    rect: moveRect,
    anchor: "TopLeft",
  });
  const previewArgs = compactObject({
    ...screenCriteria,
  });
  const verifyArgs = compactObject({
    ...screenCriteria,
    referencePath,
    maxWidth: options.compareMaxWidth,
    maxHeight: options.compareMaxHeight,
    threshold: options.compareThreshold,
  });
  const finalVerification = referencePath !== undefined
    ? `After that call verify_screen_against_reference_from_context exactly once with args ${JSON.stringify(verifyArgs)} to capture a fresh preview and compare it against the reference after the move.`
    : `After that call capture_preview_from_context exactly once with args ${JSON.stringify(previewArgs)}.`;
  return [
    "Run a UOS AI visual-feedback layout follow-up smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    "Use only the existing persisted .uos context for the target screen; do not create a new screen, material screen, deck, asset, or scene object.",
    "Call get_uos_context exactly once first, inspect selectedUnity and the persisted screens, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
    `Then call inspect_screen_feedback_from_context exactly once with args ${JSON.stringify(feedbackArgs)} and use its diagnostics, latest comparison, and recommendedTools before editing.`,
    `Then call get_scene_hierarchy_from_context exactly once with args ${JSON.stringify(hierarchyArgs)} to inspect current live layout before moving anything.`,
    `Then call move_ui_element_from_context exactly once with args ${JSON.stringify(moveArgs)}.`,
    finalVerification,
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the moved screenId and elementId.`,
    "Do not save the scene or edit unrelated objects.",
  ].join(" ");
}

function formatOpencodeAiContextFollowUpReplacePrompt(target, options = {}) {
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  const screenCriteria = options.screenCriteria ?? {};
  const deleteCriteria = options.deleteCriteria ?? {};
  const addCriteria = options.addCriteria ?? {};
  const referencePath = stringValue(options.referencePath);
  const feedbackArgs = compactObject({
    ...screenCriteria,
    maxAttachments: 3,
  });
  const hierarchyArgs = compactObject({
    ...screenCriteria,
  });
  const deleteArgs = compactObject({
    ...screenCriteria,
    ...deleteCriteria,
  });
  const addArgs = compactObject({
    ...screenCriteria,
    ...addCriteria,
    element: {
      clientHintId: "uosAiFeedbackReplacement",
      type: "Text",
      rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.12 },
      anchor: "TopCenter",
      props: {
        text: "UOS AI visual repair",
        color: "#22c55e",
        fontSize: 28,
        align: "MiddleCenter",
      },
    },
  });
  const verifyArgs = compactObject({
    ...screenCriteria,
    referencePath,
    maxWidth: options.compareMaxWidth,
    maxHeight: options.compareMaxHeight,
    threshold: options.compareThreshold,
  });
  return [
    "Run a UOS AI visual-feedback replacement follow-up smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    "Use only the existing persisted .uos context for the target screen; do not create a new screen, material screen, deck, asset, or scene object.",
    "Call get_uos_context exactly once first, inspect selectedUnity and the persisted screens, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
    `Then call inspect_screen_feedback_from_context exactly once with args ${JSON.stringify(feedbackArgs)} and use its diagnostics, latest comparison, and recommendedTools before editing.`,
    `Then call get_scene_hierarchy_from_context exactly once with args ${JSON.stringify(hierarchyArgs)} to inspect current live layout before replacing anything.`,
    `Then call delete_ui_element_from_context exactly once with args ${JSON.stringify(deleteArgs)} to remove the still-mismatched target element.`,
    `Then call add_ui_element_from_context exactly once with args ${JSON.stringify(addArgs)} to add a replacement element on the same screen.`,
    `After that call verify_screen_against_reference_from_context exactly once with args ${JSON.stringify(verifyArgs)} to capture a fresh preview and compare it against the reference after the replacement.`,
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the repaired screenId plus deleted and added element ids.`,
    "Do not save the scene or edit unrelated objects.",
  ].join(" ");
}

function formatOpencodeAiContextFollowUpAddPrompt(target, options = {}) {
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  const screenCriteria = options.screenCriteria ?? {};
  const addCriteria = options.addCriteria ?? {};
  const addText = stringValue(options.addText) ?? "UOS AI Context Follow-up";
  const addArgs = compactObject({
    ...screenCriteria,
    ...addCriteria,
    element: {
      clientHintId: "uosAiFollowUpLabel",
      type: "Text",
      rect: { x: 0.28, y: 0.08, w: 0.44, h: 0.08 },
      anchor: "TopCenter",
      props: {
        text: addText,
        color: "#22c55e",
        fontSize: 28,
        align: "MiddleCenter",
      },
    },
  });
  const feedbackArgs = compactObject({
    ...screenCriteria,
    maxAttachments: 3,
  });
  const previewArgs = compactObject({
    ...screenCriteria,
  });
  const lines = [
    "Run a UOS AI conversational follow-up smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    "Use only the existing persisted .uos context for the target screen; do not create a new screen, material screen, deck, asset, or scene object.",
    "Call get_uos_context exactly once first, inspect selectedUnity and the persisted screens, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
  ];
  if (options.inspectFeedback === true) {
    lines.push(`Then call inspect_screen_feedback_from_context exactly once with args ${JSON.stringify(feedbackArgs)} and use its diagnostics, latest comparison, and recommendedTools before editing.`);
  }
  lines.push(
    `Then call add_ui_element_from_context exactly once with args ${JSON.stringify(addArgs)}.`,
    `After that call capture_preview_from_context exactly once with args ${JSON.stringify(previewArgs)}.`,
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the updated screenId and added elementId.`,
    "Do not save the scene or edit unrelated objects.",
  );
  return lines.join(" ");
}

function formatOpencodeAiSmokePrompt(target, options = {}) {
  return formatOpencodeAiSceneObjectSmokePrompt(target, options);
}

function formatOpencodeAiSceneObjectSmokePrompt(target, options = {}) {
  const objectName = stringValue(options.objectName) ?? "UOS_AI_SMOKE";
  const objectType = stringValue(options.sceneObjectType) ?? "Empty";
  const projectName = stringValue(target?.projectName) ?? "(selected Unity project)";
  const projectPath = stringValue(target?.projectPath) ?? "(selected Unity project path)";
  return [
    "Run a UOS AI smoke test against the selected Unity Editor only.",
    `Project: ${projectName} at ${projectPath}.`,
    "Call get_uos_context exactly once first, inspect selectedUnity, and do not mutate Unity before this context call finishes.",
    "Call get_project_info exactly once and summarize the returned projectName and unityVersion.",
    `Call create_scene_object exactly once with type ${JSON.stringify(objectType)}, name ${JSON.stringify(objectName)}, active true, and position {x:0,y:0,z:0}.`,
    "Then call delete_scene_object exactly once using the objectId returned by create_scene_object.",
    `Finish with one line starting with ${OPENCODE_AI_SMOKE_MARKER} and include the deleted objectId.`,
    "Do not create UI screens, import assets, save the scene, or edit any other object.",
  ].join(" ");
}

function observedOpencodeAiSmokeTools(output, expectedTools) {
  const text = String(output ?? "");
  return expectedTools.filter((tool) => text.includes(tool));
}

async function inspectOpencodeAiSmokeJournal(target, plan, options = {}) {
  const expectedTools = plan.expectedTools.filter((tool) => OPENCODE_AI_SMOKE_JOURNAL_TOOLS.has(tool));
  if (expectedTools.length === 0) {
    return { expectedTools, observedTools: [], missingTools: [], orderOk: true, orderError: undefined, verified: false, skipped: true, skippedReason: "no journaled tools expected" };
  }
  const shouldVerify = options.aiVerifyJournal === true
    || (options.aiVerifyJournal !== false && options.commandRunner === undefined);
  if (!shouldVerify) {
    return { expectedTools, observedTools: [], missingTools: expectedTools, orderOk: undefined, orderError: undefined, verified: false, skipped: true, skippedReason: "custom command runner" };
  }

  const projectDir = stringValue(options.contextProjectDir)
    ?? stringValue(target?.projectPath)
    ?? stringValue(options.env?.UOS_PROJECT_DIR);
  if (projectDir === undefined) {
    return { expectedTools, observedTools: [], missingTools: expectedTools, orderOk: undefined, orderError: undefined, verified: false, skipped: true, skippedReason: "missing project dir" };
  }

  const journalFile = path.join(projectDir, ".uos", "work-journal.jsonl");
  let raw;
  try {
    raw = await fs.readFile(journalFile, "utf8");
  } catch {
    return { expectedTools, observedTools: [], missingTools: expectedTools, orderOk: false, orderError: `missing journal file for ${expectedTools.join(", ")}`, verified: true, skipped: false, skippedReason: undefined };
  }

  const startedMs = Date.parse(String(options.startedAt ?? ""));
  const floorMs = Number.isFinite(startedMs) ? startedMs - 1_000 : undefined;
  const records = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter((record) => record !== undefined && record !== null && typeof record === "object")
    .filter((record) => record.sessionID !== "uos-smoke")
    .filter((record) => {
      if (floorMs === undefined) return true;
      const ts = Date.parse(String(record.ts ?? ""));
      return Number.isFinite(ts) && ts >= floorMs;
    });
  const observedTools = expectedTools.filter((tool) => records.some((record) => record.tool === tool));
  const missingTools = expectedTools.filter((tool) => !observedTools.includes(tool));
  const order = journalToolOrder(expectedTools, records);
  return {
    expectedTools,
    observedTools,
    missingTools,
    screenId: opencodeAiSmokeJournalScreenId(plan, records),
    verification: opencodeAiSmokeJournalVerification(plan, records),
    orderOk: missingTools.length === 0 ? order.ok : false,
    orderError: missingTools.length === 0 ? order.error : undefined,
    verified: true,
    skipped: false,
    skippedReason: undefined,
  };
}

function opencodeAiSmokeJournalScreenId(plan, records) {
  if (plan.mode === "material-screen") {
    const record = records.find((item) => item?.tool === "create_screen_from_material");
    return stringValue(record?.result?.created?.screenId ?? record?.result?.screenId);
  }
  if (plan.mode === "pptx-deck") {
    const record = records.find((item) => item?.tool === "create_pptx_deck_screens");
    const firstScreen = Array.isArray(record?.result?.screens) ? record.result.screens[0] : undefined;
    return stringValue(
      record?.result?.activeScreenId
      ?? firstScreen?.screenId
      ?? firstScreen?.created?.screenId,
    );
  }
  if (plan.mode === "context-follow-up") {
    const preview = records.find((item) => item?.tool === "capture_preview_from_context");
    const update = records.find((item) => item?.tool === "update_ui_element_from_context");
    const move = records.find((item) => item?.tool === "move_ui_element_from_context");
    const verify = records.find((item) => item?.tool === "verify_screen_against_reference_from_context");
    return stringValue(
      verify?.result?.verified?.screenId
      ?? verify?.result?.screenId
      ?? verify?.result?.matched?.screenId
      ?? verify?.result?.verifyArgs?.screenId
      ?? preview?.result?.captured?.screenId
      ?? preview?.result?.screenId
      ?? preview?.result?.matched?.screenId
      ?? preview?.result?.previewArgs?.screenId
      ?? update?.result?.matched?.screenId
      ?? move?.result?.matched?.screenId,
    );
  }
  return undefined;
}

function opencodeAiSmokeJournalVerification(plan, records) {
  if (plan.mode !== "context-follow-up") return undefined;
  const expected = Array.isArray(plan.expectedTools) ? plan.expectedTools : [];
  if (!expected.includes("verify_screen_against_reference_from_context")) return undefined;
  const verify = records
    .filter((item) => item?.tool === "verify_screen_against_reference_from_context")
    .at(-1);
  const verified = verify?.result?.verified ?? verify?.result;
  const comparison = verified?.comparison ?? verify?.result?.comparison;
  const preview = verified?.preview ?? verify?.result?.preview;
  const verdict = stringValue(verified?.verdict ?? comparison?.verdict);
  const screenId = stringValue(
    verified?.screenId
    ?? verify?.result?.screenId
    ?? verify?.result?.matched?.screenId
    ?? verify?.result?.verifyArgs?.screenId
    ?? comparison?.screenId
    ?? preview?.screenId,
  );
  if (verdict === undefined && screenId === undefined && comparison === undefined && preview === undefined) {
    return undefined;
  }
  return compactObject({
    screenId,
    verdict,
    previewPath: stringValue(preview?.savedPath ?? preview?.path),
    diffPath: stringValue(comparison?.diffPath),
    referencePath: stringValue(comparison?.referencePath ?? verify?.result?.verifyArgs?.referencePath),
    candidatePath: stringValue(comparison?.candidatePath),
    meanAbsoluteError: numberValue(comparison?.meanAbsoluteError),
    rootMeanSquareError: numberValue(comparison?.rootMeanSquareError),
    mismatchRatio: numberValue(comparison?.mismatchRatio),
  });
}

function journalToolOrder(expectedTools, records) {
  let previousIndex = -1;
  let previousTool = "start";
  for (const tool of expectedTools) {
    const index = records.findIndex((record, recordIndex) => recordIndex > previousIndex && record.tool === tool);
    if (index < 0) {
      return {
        ok: false,
        error: `expected ${tool} after ${previousTool}`,
      };
    }
    if (index <= previousIndex) {
      return {
        ok: false,
        error: `expected first ${tool} after first ${previousTool}`,
      };
    }
    previousIndex = index;
    previousTool = tool;
  }
  return { ok: true, error: undefined };
}

function formatOpencodeAiSmokeFailure(result) {
  const detail = firstLine(result.stderr ?? "")
    ?? firstLine(result.stdout ?? "")
    ?? result.error
    ?? `exit ${result.status ?? "unknown"}`;
  const missing = Array.isArray(result.missingTools) && result.missingTools.length > 0
    ? ` missing tool evidence: ${result.missingTools.join(", ")}`
    : "";
  const missingJournal = Array.isArray(result.missingJournalTools) && result.missingJournalTools.length > 0
    ? ` missing journal evidence: ${result.missingJournalTools.join(", ")}`
    : "";
  const journalOrder = result.journalOrderError !== undefined
    ? ` journal order error: ${result.journalOrderError}`
    : "";
  return `[uos] opencode AI smoke failed: ${detail}${missing}${missingJournal}${journalOrder}`;
}

async function runSmokeSceneObjectRoundTrip(target, options = {}) {
  const objectName = stringValue(options.sceneObjectName)
    ?? `${stringValue(options.screenName) ?? "UOSSmoke"}Object`;
  const objectType = stringValue(options.sceneObjectType) ?? "Cube";
  const createArgs = {
    type: objectType,
    name: objectName,
    active: true,
    transform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 15, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  };
  const created = await callUnityTool(target, "create_scene_object", createArgs, options);
  const objectId = stringValue(created?.objectId);
  if (objectId === undefined) {
    throw new Error("[uos] scene object smoke requires create_scene_object to return objectId");
  }

  const listedAfterCreate = await callUnityTool(target, "list_scene_objects", {}, options);
  const updateArgs = {
    objectId,
    name: `${objectName} Updated`,
    active: true,
    transform: {
      position: { x: 2, y: 3, z: 4 },
      rotation: { x: 0, y: 45, z: 0 },
      scale: { x: 1.25, y: 1.25, z: 1.25 },
    },
  };
  const updated = await callUnityTool(target, "update_scene_object", updateArgs, options);
  const listedAfterUpdate = await callUnityTool(target, "list_scene_objects", {}, options);
  const deleteArgs = { objectId };
  const deleted = await callUnityTool(target, "delete_scene_object", deleteArgs, options);
  const listedAfterDelete = await callUnityTool(target, "list_scene_objects", {}, options);

  return {
    ok: true,
    objectId,
    createArgs,
    created,
    listedAfterCreate,
    updateArgs,
    updated,
    listedAfterUpdate,
    deleteArgs,
    deleted,
    listedAfterDelete,
  };
}

async function runSmokeContextFollowUp(target, result, options = {}) {
  const idx = smokeContextSnapshot(result, options);
  const screenId = stringValue(result.created?.screenId);
  if (screenId === undefined) {
    throw new Error("[uos] context follow-up smoke requires a created screen");
  }

  const activateArgs = { screenId };
  const activated = await callUnityTool(target, "set_active_screen", activateArgs, options);
  const ts = smokeTimestamp(options);
  smokeApplyToIndex(idx, "set_active_screen", activateArgs, activated, ts);

  const activeScreen = smokeResolveActiveScreen(idx);
  if (activeScreen === undefined) {
    throw new Error("[uos] context follow-up smoke could not resolve an active screen from context");
  }

  const followUpPlan = smokeContextFollowUpPlan(idx);
  if (followUpPlan.updateTarget === undefined) {
    throw new Error("[uos] context follow-up smoke could not resolve an editable text element from active context");
  }
  const updateCriteria = followUpPlan.updateCriteria;
  const title = followUpPlan.updateTarget;
  const updateArgs = {
    elementId: title.elementId,
    props: {
      text: "UOS Smoke Context Follow-up",
      color: "#f97316",
    },
  };
  const updated = await callUnityTool(target, "update_ui_element", updateArgs, options);
  smokeApplyToIndex(idx, "update_ui_element", updateArgs, updated, ts);

  const addCriteria = followUpPlan.addCriteria;
  const panel = followUpPlan.parentTarget;
  const addArgs = {
    screenId: activeScreen.screenId,
    element: {
      clientHintId: "smokeContextBadge",
      type: "Text",
      rect: { x: 0.28, y: 0.2, w: 0.44, h: 0.07 },
      anchor: "TopCenter",
      props: {
        text: "Context follow-up",
        fontSize: 22,
        color: "#38bdf8",
        align: "MiddleCenter",
      },
    },
  };
  if (panel?.elementId !== undefined) {
    addArgs.element.parentElementId = panel.elementId;
  }
  const added = await callUnityTool(target, "add_ui_element", addArgs, options);
  smokeApplyToIndex(idx, "add_ui_element", addArgs, added, ts);

  const hierarchyArgs = { screenId: activeScreen.screenId };
  const hierarchy = await callUnityTool(target, "get_scene_hierarchy", hierarchyArgs, options);

  return {
    ok: true,
    activeScreenId: activeScreen.screenId,
    activateCriteria: { screenName: activeScreen.screenName ?? activeScreen.screenId },
    activateArgs,
    activated,
    updateCriteria,
    matchedUpdate: smokeContextCandidateSummary(title),
    updateArgs,
    updated,
    addCriteria,
    matchedParent: smokeContextCandidateSummary(panel),
    addArgs,
    added,
    hierarchyArgs,
    hierarchy,
  };
}

function smokeContextSnapshot(result, options = {}) {
  const idx = smokeExistingIndex(result, options) ?? smokeEmptyIndex();
  const ts = smokeTimestamp(options);
  if (result.imported !== undefined) {
    smokeApplyToIndex(idx, "import_asset", {
      sourcePath: result.imported.sourcePath,
      assetPath: options.assetPath,
      importAsSprite: options.importAsSprite !== false,
    }, result.imported, ts);
  }
  if (result.materialScreen !== undefined) {
    smokeApplyToIndex(idx, "create_screen_from_material", result.materialScreenArgs ?? {}, result.materialScreen, ts);
  } else if (result.pptxDeck !== undefined) {
    smokeApplyToIndex(idx, "create_pptx_deck_screens", result.pptxDeckArgs ?? {}, result.pptxDeck, ts);
  } else if (result.created !== undefined) {
    smokeApplyToIndex(idx, "create_ui_screen", {
      intent: result.intent ?? smokePlanningIntent(options.screenName ?? "UOSSmokeScreen"),
    }, result.created, ts);
  }
  if (result.revision?.updated !== undefined) {
    smokeApplyToIndex(idx, "update_ui_element", result.revision.updateArgs, result.revision.updated, ts);
  }
  if (result.revision?.added !== undefined) {
    smokeApplyToIndex(idx, "add_ui_element", result.revision.addArgs, result.revision.added, ts);
  }
  if (result.revision?.tempAdded !== undefined) {
    smokeApplyToIndex(idx, "add_ui_element", result.revision.tempAddArgs, result.revision.tempAdded, ts);
  }
  if (result.revision?.moved !== undefined) {
    smokeApplyToIndex(idx, "move_ui_element", result.revision.moveArgs, result.revision.moved, ts);
  }
  if (result.revision?.deleted !== undefined) {
    smokeApplyToIndex(idx, "delete_ui_element", result.revision.deleteArgs, result.revision.deleted, ts);
  }
  if (result.flowScreen !== undefined) {
    smokeApplyToIndex(idx, "create_ui_screen", {
      intent: result.flowIntent ?? smokePlanningIntent(smokeFlowScreenName(options.screenName ?? "UOSSmokeScreen")),
    }, result.flowScreen, ts);
  }
  if (result.transition !== undefined) {
    smokeApplyToIndex(idx, "create_screen_transition", result.transitionArgs, result.transition, ts);
  }
  return idx;
}

function smokeExistingIndex(result, options = {}) {
  const projectDir = stringValue(options.contextProjectDir)
    ?? stringValue(result.target?.projectPath)
    ?? stringValue(result.projectInfo?.projectPath)
    ?? stringValue(options.env?.UOS_PROJECT_DIR);
  if (projectDir === undefined) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path.join(projectDir, ".uos", "screens.json"), "utf8"));
    if (parsed !== null && typeof parsed === "object") return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

function smokeContextFollowUpPlan(idx) {
  const activeScreen = smokeResolveActiveScreen(idx);
  const elements = smokeScreenElementCandidates(activeScreen);
  const preferredUpdates = [
    { clientHintId: "smokeTitle", query: "smoke title" },
    ...elements
      .filter((element) => element.type === "Text" && /(^|[_-])title$/i.test(element.clientHintId ?? ""))
      .map((element) => ({ elementId: element.elementId, query: element.clientHintId ?? "title" })),
    ...elements
      .filter((element) => element.type === "Text" && containsFolded(element.clientHintId, "title"))
      .map((element) => ({ elementId: element.elementId, query: element.clientHintId ?? "title" })),
    ...elements
      .filter((element) => element.type === "Text" && stringValue(element.text) !== undefined)
      .map((element) => ({ elementId: element.elementId, query: element.clientHintId ?? element.text ?? "text" })),
    ...elements
      .filter((element) => element.type === "Text")
      .map((element) => ({ elementId: element.elementId, query: element.clientHintId ?? "text" })),
  ];
  const update = firstResolvedContextElement(idx, preferredUpdates);
  const move = update ?? firstResolvedContextElement(idx, elements
    .filter((element) => element.type !== "Panel")
    .map((element) => ({ elementId: element.elementId, query: element.clientHintId ?? element.type })));

  const preferredParents = [
    { parentClientHintId: "smokePanel", parentQuery: "smoke panel", criteria: { clientHintId: "smokePanel", query: "smoke panel" } },
    ...elements
      .filter((element) => /(^|[_-])background$/i.test(element.clientHintId ?? ""))
      .map((element) => ({
        parentClientHintId: element.clientHintId,
        parentQuery: element.clientHintId,
        criteria: { elementId: element.elementId, query: element.clientHintId ?? "background" },
      })),
    ...elements
      .filter((element) => element.type === "Panel")
      .map((element) => ({
        parentClientHintId: element.clientHintId,
        parentQuery: element.clientHintId ?? "panel",
        criteria: { elementId: element.elementId, query: element.clientHintId ?? "panel" },
      })),
  ];
  const parentResolved = firstResolvedContextElement(idx, preferredParents.map((entry) => entry.criteria));
  const parent = parentResolved?.target;
  const parentPlan = parentResolved === undefined
    ? {}
    : preferredParents.find((entry) => JSON.stringify(entry.criteria) === JSON.stringify(parentResolved.criteria)) ?? {
      parentClientHintId: parent.clientHintId,
      parentQuery: parent.clientHintId ?? parent.type,
    };

  return {
    updateCriteria: update?.criteria ?? {},
    updateTarget: update?.target,
    moveCriteria: move?.criteria ?? {},
    moveTarget: move?.target,
    moveRect: smokeFeedbackMoveRect(move?.target),
    addCriteria: compactObject({
      parentClientHintId: parentPlan.parentClientHintId,
      parentQuery: parentPlan.parentQuery,
    }),
    parentTarget: parent,
  };
}

function smokeFeedbackMoveRect(target) {
  if (sameFolded(target?.type, "Button")) {
    return { x: 0.18, y: 0.64, w: 0.64, h: 0.14 };
  }
  if (sameFolded(target?.type, "Text")) {
    return { x: 0.06, y: 0.06, w: 0.88, h: 0.12 };
  }
  if (sameFolded(target?.type, "Image")) {
    return { x: 0.05, y: 0.05, w: 0.9, h: 0.9 };
  }
  return { x: 0.08, y: 0.08, w: 0.84, h: 0.16 };
}

function firstResolvedContextElement(idx, criteriaList) {
  const seen = new Set();
  for (const criteria of criteriaList) {
    const key = JSON.stringify(criteria);
    if (seen.has(key)) continue;
    seen.add(key);
    const target = smokeResolveContextElement(idx, criteria);
    if (target !== undefined) return { criteria, target };
  }
  return undefined;
}

function smokeScreenElementCandidates(screen) {
  if (screen === undefined) return [];
  return Object.values(screen.elements ?? {})
    .filter((element) => element !== null && typeof element === "object" && element.deleted !== true)
    .map((element) => ({
      screenId: screen.screenId,
      screenName: screen.screenName,
      elementId: element.elementId,
      clientHintId: element.clientHintId,
      type: element.type,
      text: element.props?.text,
    }));
}

function smokeTimestamp(options = {}) {
  return typeof options.now === "function" ? String(options.now()) : new Date().toISOString();
}

function smokeResolveActiveScreen(idx) {
  const screens = Object.values(idx.screens ?? {}).filter((screen) => screen !== null && typeof screen === "object");
  const explicit = stringValue(idx.activeScreenId);
  if (explicit !== undefined) {
    const screen = screens.find((candidate) => candidate.screenId === explicit);
    if (screen !== undefined) return screen;
  }
  const active = screens.filter((screen) => screen.active === true);
  return active.length === 1 ? active[0] : undefined;
}

function smokeResolveContextElement(idx, criteria = {}) {
  const screens = Object.values(idx.screens ?? {}).filter((screen) => screen !== null && typeof screen === "object");
  const candidates = [];
  for (const screen of screens) {
    for (const element of Object.values(screen.elements ?? {})) {
      if (element === null || typeof element !== "object") continue;
      if (criteria.includeDeleted !== true && element.deleted === true) continue;
      candidates.push({
        screenId: screen.screenId,
        screenName: screen.screenName,
        elementId: element.elementId,
        clientHintId: element.clientHintId,
        type: element.type,
        text: element.props?.text,
      });
    }
  }
  const matched = candidates.filter((candidate) => smokeContextCandidateMatches(candidate, criteria));
  if (matched.length === 1) return matched[0];
  if (matched.length === 0) return undefined;
  const active = smokeResolveActiveScreen(idx);
  if (active === undefined) return undefined;
  const activeMatched = matched.filter((candidate) => candidate.screenId === active.screenId);
  return activeMatched.length === 1 ? activeMatched[0] : undefined;
}

function smokeContextCandidateMatches(candidate, criteria) {
  if (criteria.screenId !== undefined && candidate.screenId !== criteria.screenId) return false;
  if (criteria.screenName !== undefined && !sameFolded(candidate.screenName, criteria.screenName)) return false;
  if (criteria.elementId !== undefined && candidate.elementId !== criteria.elementId) return false;
  if (criteria.clientHintId !== undefined && candidate.clientHintId !== criteria.clientHintId) return false;
  if (criteria.type !== undefined && !sameFolded(candidate.type, criteria.type)) return false;
  if (criteria.text !== undefined && !sameFolded(candidate.text, criteria.text)) return false;
  if (criteria.textContains !== undefined && !containsFolded(candidate.text, criteria.textContains)) return false;
  if (criteria.query !== undefined && !smokeElementQueryMatches(candidate, criteria.query)) return false;
  return true;
}

function sameFolded(left, right) {
  return foldText(left) === foldText(right);
}

function containsFolded(value, query) {
  const haystack = foldText(value);
  const needle = foldText(query);
  return haystack.length > 0 && needle.length > 0 && haystack.includes(needle);
}

function foldText(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function smokeElementQueryMatches(candidate, query) {
  const tokens = smokeQueryTokens(query);
  if (tokens.length === 0) return true;
  const corpus = smokeSearchText([
    candidate.screenName,
    candidate.elementId,
    candidate.clientHintId,
    candidate.type,
    candidate.text,
    smokeTypeAliases(candidate.type),
  ]);
  return tokens.every((token) => corpus.includes(token));
}

function smokeQueryTokens(query) {
  const stopwords = new Set([
    "the",
    "a",
    "an",
    "this",
    "that",
    "please",
    "ui",
    "element",
    "control",
    "object",
    "thing",
    "이",
    "그",
    "저",
    "요소",
    "컨트롤",
    "오브젝트",
  ]);
  return smokeSearchText([query])
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !stopwords.has(token));
}

function smokeSearchText(values) {
  return values
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^0-9a-zA-Z\uAC00-\uD7AF]+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function smokeTypeAliases(type) {
  switch (foldText(type)) {
    case "button":
      return "button cta action 버튼 단추 액션";
    case "text":
      return "text label title copy heading 텍스트 라벨 제목 문구";
    case "panel":
      return "panel container background box card 패널 컨테이너 배경 박스 카드";
    case "image":
      return "image picture sprite mockup reference 이미지 그림 스프라이트 목업 참고";
    case "inputfield":
      return "input field text field entry 입력 입력창 텍스트필드";
    case "toggle":
      return "toggle checkbox switch 토글 체크박스 스위치";
    case "slider":
      return "slider range volume 슬라이더 범위 볼륨";
    case "scrollview":
      return "scroll view list 스크롤 목록 리스트";
    case "dropdown":
      return "dropdown drop down select menu 드롭다운 선택 메뉴";
    default:
      return undefined;
  }
}

function smokeContextCandidateSummary(candidate) {
  return {
    screenId: candidate.screenId,
    screenName: candidate.screenName,
    elementId: candidate.elementId,
    clientHintId: candidate.clientHintId,
    type: candidate.type,
    text: candidate.text,
  };
}

export function smokeMaterialScreenArgs(sourcePath, options = {}) {
  return compactObject({
    path: sourcePath,
    kind: options.materialScreenKind,
    mode: options.materialScreenMode,
    screenName: options.screenName,
    assetPath: options.assetPath,
    assetDir: options.materialScreenAssetDir,
    outputDir: options.materialScreenOutputDir,
    pageNumber: options.materialScreenPageNumber,
    imageNumber: options.materialScreenImageNumber,
    slideNumber: options.materialScreenSlideNumber,
    pptxMode: options.materialScreenPptxMode,
  });
}

export function smokePptxDeckScreenArgs(sourcePath, options = {}) {
  return compactObject({
    path: sourcePath,
    slideNumbers: options.pptxDeckSlideNumbers,
    firstSlide: options.pptxDeckFirstSlide,
    lastSlide: options.pptxDeckLastSlide,
    maxSlides: options.pptxDeckMaxSlides,
    screenNamePrefix: options.screenName,
    assetDir: options.materialScreenAssetDir,
    embeddedOutputDir: options.materialScreenOutputDir,
    includeShapePanels: options.pptxDeckIncludeShapePanels,
    createTransitions: options.pptxDeckCreateTransitions !== false,
    transitionTriggerPrefix: options.pptxDeckTransitionTriggerPrefix,
    activateFirst: options.pptxDeckActivateFirst !== false,
  });
}

export async function runMaterialScreenTool(target, args, options = {}) {
  const repoRoot = options.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
  const request = {
    args,
  };
  const env = {
    ...buildTargetEnv(target, options.env ?? process.env, {
      ...options,
      cwd: repoRoot,
      env: options.env ?? process.env,
    }),
    UOS_SMOKE_MATERIAL_REQUEST: JSON.stringify(request),
  };
  const script = `
const request = JSON.parse(process.env.UOS_SMOKE_MATERIAL_REQUEST ?? "{}");
const { createScreenFromMaterial } = await import("./.opencode/tools/_material_screen.ts");
const { call, bridge } = await import("./.opencode/tools/_bridge.ts");
const { path: materialPath, ...routeOptions } = request.args ?? {};
try {
  const created = await createScreenFromMaterial(
    materialPath,
    routeOptions,
    async (asset) => call("import_asset", {
      sourcePath: asset.sourcePath,
      assetPath: asset.assetPath,
      importAsSprite: true,
    }),
    async (asset) => call("import_asset", {
      sourcePath: asset.sourcePath,
      assetPath: asset.assetPath,
      importAsSprite: true,
    }),
    async (intent) => call("create_ui_screen", { intent }),
  );
  process.stdout.write(JSON.stringify(created));
} finally {
  bridge().close();
}
`;
  const command = options.bunCommand ?? "bun";
  const result = runCommand(command, ["--eval", script], {
    cwd: repoRoot,
    env,
    shell: false,
    timeoutMs: positiveInt(options.materialScreenTimeoutMs) ?? 120_000,
    commandRunner: options.materialScreenCommandRunner,
  });
  if (result.status !== 0) {
    const detail = firstLine(result.stderr) ?? firstLine(result.stdout) ?? result.error ?? `exit ${result.status ?? "unknown"}`;
    throw new Error(`[uos] create_screen_from_material smoke failed: ${detail}`);
  }
  const parsed = parseJsonFromCommandOutput(result.stdout);
  if (parsed === undefined) {
    throw new Error("[uos] create_screen_from_material smoke did not return JSON metadata");
  }
  return parsed;
}

export async function runPptxDeckScreenTool(target, args, options = {}) {
  const repoRoot = options.repoRoot ?? fileURLToPath(new URL("..", import.meta.url));
  const request = { args };
  const env = {
    ...buildTargetEnv(target, options.env ?? process.env, {
      ...options,
      cwd: repoRoot,
      env: options.env ?? process.env,
    }),
    UOS_SMOKE_PPTX_DECK_REQUEST: JSON.stringify(request),
  };
  const script = `
const request = JSON.parse(process.env.UOS_SMOKE_PPTX_DECK_REQUEST ?? "{}");
const { createPptxDeckScreensWithAssets } = await import("./.opencode/tools/_pptx_intent_assets.ts");
const { call, bridge } = await import("./.opencode/tools/_bridge.ts");
const { path: deckPath, ...deckOptions } = request.args ?? {};
try {
  const created = await createPptxDeckScreensWithAssets(
    deckPath,
    deckOptions,
    async (asset) => call("import_asset", {
      sourcePath: asset.sourcePath,
      assetPath: asset.assetPath,
      importAsSprite: true,
    }),
    async (intent) => call("create_ui_screen", { intent }),
    async (transition) => call("create_screen_transition", transition),
    async (screenId) => call("set_active_screen", { screenId }),
  );
  process.stdout.write(JSON.stringify(created));
} finally {
  bridge().close();
}
`;
  const command = options.bunCommand ?? "bun";
  const result = runCommand(command, ["--eval", script], {
    cwd: repoRoot,
    env,
    shell: false,
    timeoutMs: positiveInt(options.pptxDeckTimeoutMs) ?? 120_000,
    commandRunner: options.pptxDeckCommandRunner,
  });
  if (result.status !== 0) {
    const detail = firstLine(result.stderr) ?? firstLine(result.stdout) ?? result.error ?? `exit ${result.status ?? "unknown"}`;
    throw new Error(`[uos] create_pptx_deck_screens smoke failed: ${detail}`);
  }
  const parsed = parseJsonFromCommandOutput(result.stdout);
  if (parsed === undefined) {
    throw new Error("[uos] create_pptx_deck_screens smoke did not return JSON metadata");
  }
  return parsed;
}

export async function recordSmokeContext(target, result, options = {}) {
  if (
    result.imported === undefined
    && result.materialScreen === undefined
    && result.pptxDeck === undefined
    && result.sceneObject === undefined
    && result.created === undefined
    && result.flowScreen === undefined
    && result.transition === undefined
    && result.contextFollowUp === undefined
    && result.revision === undefined
    && result.preview === undefined
    && result.comparison === undefined
    && result.verification === undefined
    && result.saved === undefined
  ) {
    return undefined;
  }

  const projectDir = stringValue(options.contextProjectDir)
    ?? stringValue(target.projectPath)
    ?? stringValue(result.projectInfo?.projectPath);
  if (projectDir === undefined) return undefined;

  const contextDir = path.join(projectDir, ".uos");
  const ts = typeof options.now === "function" ? String(options.now()) : new Date().toISOString();
  await fs.mkdir(contextDir, { recursive: true });

  const idxFile = path.join(contextDir, "screens.json");
  const idx = await readJsonFile(idxFile, smokeEmptyIndex());
  const records = [];

  if (result.imported !== undefined) {
    const args = {
      sourcePath: result.imported.sourcePath,
      assetPath: options.assetPath,
      importAsSprite: options.importAsSprite !== false,
    };
    records.push(smokeJournalRecord(ts, "import_asset", args, result.imported, "uos smoke import_asset"));
    smokeApplyToIndex(idx, "import_asset", args, result.imported, ts);
  }

  if (result.materialScreen !== undefined) {
    const args = result.materialScreenArgs ?? smokeMaterialScreenArgs(
      result.selectedMaterial?.sourcePath ?? options.materialScreenPath,
      options,
    );
    records.push(smokeJournalRecord(
      ts,
      "create_screen_from_material",
      args,
      result.materialScreen,
      "uos smoke create_screen_from_material",
    ));
    smokeApplyToIndex(idx, "create_screen_from_material", args, result.materialScreen, ts);
  } else if (result.pptxDeck !== undefined) {
    const args = result.pptxDeckArgs ?? smokePptxDeckScreenArgs(
      result.selectedMaterial?.sourcePath ?? options.pptxDeckPath,
      options,
    );
    records.push(smokeJournalRecord(
      ts,
      "create_pptx_deck_screens",
      args,
      result.pptxDeck,
      "uos smoke create_pptx_deck_screens",
    ));
    smokeApplyToIndex(idx, "create_pptx_deck_screens", args, result.pptxDeck, ts);
  } else if (result.created !== undefined) {
    const args = { intent: result.intent ?? smokePlanningIntent(options.screenName ?? "UOSSmokeScreen") };
    records.push(smokeJournalRecord(ts, "create_ui_screen", args, result.created, "uos smoke create_ui_screen"));
    smokeApplyToIndex(idx, "create_ui_screen", args, result.created, ts);
  }

  if (result.revision?.updated !== undefined) {
    records.push(smokeJournalRecord(
      ts,
      "update_ui_element",
      result.revision.updateArgs,
      result.revision.updated,
      "uos smoke update_ui_element",
    ));
    smokeApplyToIndex(idx, "update_ui_element", result.revision.updateArgs, result.revision.updated, ts);
  }

  if (result.revision?.added !== undefined) {
    records.push(smokeJournalRecord(
      ts,
      "add_ui_element",
      result.revision.addArgs,
      result.revision.added,
      "uos smoke add_ui_element",
    ));
    smokeApplyToIndex(idx, "add_ui_element", result.revision.addArgs, result.revision.added, ts);
  }

  if (result.revision?.tempAdded !== undefined) {
    records.push(smokeJournalRecord(
      ts,
      "add_ui_element",
      result.revision.tempAddArgs,
      result.revision.tempAdded,
      "uos smoke add disposable element",
    ));
    smokeApplyToIndex(idx, "add_ui_element", result.revision.tempAddArgs, result.revision.tempAdded, ts);
  }

  if (result.revision?.moved !== undefined) {
    records.push(smokeJournalRecord(
      ts,
      "move_ui_element",
      result.revision.moveArgs,
      result.revision.moved,
      "uos smoke move_ui_element",
    ));
    smokeApplyToIndex(idx, "move_ui_element", result.revision.moveArgs, result.revision.moved, ts);
  }

  if (result.revision?.deleted !== undefined) {
    records.push(smokeJournalRecord(
      ts,
      "delete_ui_element",
      result.revision.deleteArgs,
      result.revision.deleted,
      "uos smoke delete_ui_element",
    ));
    smokeApplyToIndex(idx, "delete_ui_element", result.revision.deleteArgs, result.revision.deleted, ts);
  }

  if (result.flowScreen !== undefined) {
    const args = { intent: result.flowIntent ?? smokePlanningIntent(smokeFlowScreenName(options.screenName ?? "UOSSmokeScreen")) };
    records.push(smokeJournalRecord(ts, "create_ui_screen", args, result.flowScreen, "uos smoke create flow screen"));
    smokeApplyToIndex(idx, "create_ui_screen", args, result.flowScreen, ts);
  }

  if (result.transition !== undefined) {
    const args = result.transitionArgs ?? {
      fromId: result.created?.screenId,
      toId: result.flowScreen?.screenId,
      trigger: elementIdByHint(result.created, "smokeButton"),
    };
    records.push(smokeJournalRecord(ts, "create_screen_transition", args, result.transition, "uos smoke create_screen_transition"));
    smokeApplyToIndex(idx, "create_screen_transition", args, result.transition, ts);
  }

  if (result.sceneObject !== undefined) {
    const steps = [
      ["create_scene_object", result.sceneObject.createArgs, result.sceneObject.created, "uos smoke create_scene_object"],
      ["list_scene_objects", {}, result.sceneObject.listedAfterCreate, "uos smoke list_scene_objects after create"],
      ["update_scene_object", result.sceneObject.updateArgs, result.sceneObject.updated, "uos smoke update_scene_object"],
      ["list_scene_objects", {}, result.sceneObject.listedAfterUpdate, "uos smoke list_scene_objects after update"],
      ["delete_scene_object", result.sceneObject.deleteArgs, result.sceneObject.deleted, "uos smoke delete_scene_object"],
      ["list_scene_objects", {}, result.sceneObject.listedAfterDelete, "uos smoke list_scene_objects after delete"],
    ];
    for (const [tool, args, meta, title] of steps) {
      records.push(smokeJournalRecord(ts, tool, args, meta, title));
      smokeApplyToIndex(idx, tool, args, meta, ts);
    }
  }

  if (result.contextFollowUp?.activated !== undefined) {
    const meta = {
      ok: true,
      matched: { screenId: result.contextFollowUp.activeScreenId },
      activateArgs: result.contextFollowUp.activateArgs,
      activated: result.contextFollowUp.activated,
    };
    records.push(smokeJournalRecord(
      ts,
      "set_active_screen_from_context",
      result.contextFollowUp.activateCriteria,
      meta,
      "uos smoke context follow-up set_active_screen_from_context",
    ));
    smokeApplyToIndex(idx, "set_active_screen_from_context", result.contextFollowUp.activateCriteria, meta, ts);
  }

  if (result.contextFollowUp?.updated !== undefined) {
    const meta = {
      ok: true,
      matched: result.contextFollowUp.matchedUpdate,
      updateArgs: result.contextFollowUp.updateArgs,
      updated: result.contextFollowUp.updated,
    };
    records.push(smokeJournalRecord(
      ts,
      "update_ui_element_from_context",
      result.contextFollowUp.updateCriteria,
      meta,
      "uos smoke context follow-up update_ui_element_from_context",
    ));
    smokeApplyToIndex(idx, "update_ui_element_from_context", result.contextFollowUp.updateCriteria, meta, ts);
  }

  if (result.contextFollowUp?.added !== undefined) {
    const meta = {
      ok: true,
      matched: {
        ok: true,
        screenId: result.contextFollowUp.activeScreenId,
        parent: result.contextFollowUp.matchedParent,
      },
      addArgs: result.contextFollowUp.addArgs,
      added: result.contextFollowUp.added,
    };
    records.push(smokeJournalRecord(
      ts,
      "add_ui_element_from_context",
      result.contextFollowUp.addCriteria,
      meta,
      "uos smoke context follow-up add_ui_element_from_context",
    ));
    smokeApplyToIndex(idx, "add_ui_element_from_context", result.contextFollowUp.addCriteria, meta, ts);
  }

  if (result.preview !== undefined) {
    const args = {
      screenId: result.created?.screenId ?? result.preview.screenId,
    };
    const preview = await materializeSmokePreview(contextDir, args.screenId, result.preview, ts);
    result.preview = preview;
    const recordStandalonePreview = options.verifyPath === undefined;
    if (recordStandalonePreview) {
      records.push(smokeJournalRecord(ts, "capture_preview", args, preview, "uos smoke capture_preview"));
      smokeApplyToIndex(idx, "capture_preview", args, preview, ts);
    }

    if (options.comparePath !== undefined) {
      const candidatePath = stringValue(preview.savedPath ?? preview.path) ?? filePathFromUri(preview.uri);
      if (candidatePath === undefined) {
        throw new Error("[uos] smoke compare requires a materialized preview file path");
      }
      const referencePath = resolveSmokeComparePath(options.comparePath, target, options);
      const outputPath = resolveSmokeCompareOutputPath(
        options.compareOutputPath,
        contextDir,
        referencePath,
        candidatePath,
        ts,
      );
      const compareArgs = {
        screenId: args.screenId,
        referencePath,
        candidatePath,
        maxWidth: options.compareMaxWidth,
        maxHeight: options.compareMaxHeight,
        threshold: options.compareThreshold,
        outputPath,
      };
      const compareImpl = options.compareImageFiles ?? compareSmokeImages;
      const comparison = await compareImpl(referencePath, candidatePath, {
        maxWidth: options.compareMaxWidth,
        maxHeight: options.compareMaxHeight,
        threshold: options.compareThreshold,
        outputPath,
      });
      result.comparison = smokeComparisonResult(comparison, args.screenId);
      records.push(smokeJournalRecord(ts, "compare_images", compareArgs, result.comparison, "uos smoke compare_images"));
      smokeApplyToIndex(idx, "compare_images", compareArgs, result.comparison, ts);
    }

    if (options.verifyPath !== undefined) {
      const candidatePath = stringValue(preview.savedPath ?? preview.path) ?? filePathFromUri(preview.uri);
      if (candidatePath === undefined) {
        throw new Error("[uos] smoke verify requires a materialized preview file path");
      }
      const referencePath = resolveSmokeComparePath(options.verifyPath, target, options);
      const outputPath = resolveSmokeCompareOutputPath(
        options.compareOutputPath,
        contextDir,
        referencePath,
        candidatePath,
        ts,
      );
      const verifyArgs = {
        screenId: args.screenId,
        referencePath,
        maxWidth: options.compareMaxWidth,
        maxHeight: options.compareMaxHeight,
        threshold: options.compareThreshold,
        outputPath,
      };
      const compareImpl = options.compareImageFiles ?? compareSmokeImages;
      const comparison = await compareImpl(referencePath, candidatePath, {
        maxWidth: options.compareMaxWidth,
        maxHeight: options.compareMaxHeight,
        threshold: options.compareThreshold,
        outputPath,
      });
      result.verification = smokeVerificationResult(comparison, args.screenId, preview);
      result.comparison = result.verification.comparison;
      records.push(smokeJournalRecord(
        ts,
        "verify_screen_against_reference",
        verifyArgs,
        result.verification,
        "uos smoke verify_screen_against_reference",
      ));
      smokeApplyToIndex(idx, "verify_screen_against_reference", verifyArgs, result.verification, ts);
    }
  }

  if (result.saved !== undefined) {
    const args = options.scenePath !== undefined ? { path: options.scenePath } : {};
    records.push(smokeJournalRecord(ts, "save_scene", args, result.saved, "uos smoke save_scene"));
    smokeApplyToIndex(idx, "save_scene", args, result.saved, ts);
  }

  if (records.length > 0) {
    await fs.appendFile(
      path.join(contextDir, "work-journal.jsonl"),
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      "utf8",
    );
  }

  idx.version = "1.0.0";
  idx.updatedAt = ts;
  await writeJsonFile(idxFile, idx);

  const projFile = path.join(contextDir, "project.json");
  const prev = await readJsonFile(projFile, {});
  await writeJsonFile(projFile, {
    projectPath: projectDir,
    projectName: result.projectInfo?.projectName ?? target.projectName ?? path.basename(projectDir),
    unityVersion: result.projectInfo?.unityVersion,
    createdAt: prev.createdAt ?? ts,
    updatedAt: ts,
    lastSessionID: "uos-smoke",
    lastTool: records.at(-1)?.tool ?? "smoke",
  });

  return { projectDir, contextDir, records: records.length };
}

export function smokePlanningIntent(screenName = "UOSSmokeScreen", options = {}) {
  const spriteAssetPath = typeof options.spriteAssetPath === "string" && options.spriteAssetPath.length > 0
    ? options.spriteAssetPath
    : undefined;
  return {
    version: "1.0.0",
    screenName,
    referenceCanvas: { width: 1920, height: 1080 },
    elements: [
      {
        clientHintId: "smokePanel",
        type: "Panel",
        rect: { x: 0.28, y: 0.28, w: 0.44, h: 0.44 },
        anchor: "TopLeft",
        props: spriteAssetPath !== undefined
          ? { color: "#1F2937", sprite: spriteAssetPath }
          : { color: "#1F2937" },
      },
      {
        clientHintId: "smokeTitle",
        parentClientHintId: "smokePanel",
        type: "Text",
        rect: { x: 0.05, y: 0.12, w: 0.9, h: 0.22 },
        anchor: "TopLeft",
        props: {
          text: "UOS Smoke Test",
          fontSize: 42,
          color: "#FFFFFF",
          align: "MiddleCenter",
        },
      },
      {
        clientHintId: "smokeButton",
        parentClientHintId: "smokePanel",
        type: "Button",
        rect: { x: 0.25, y: 0.58, w: 0.5, h: 0.18 },
        anchor: "TopLeft",
        props: {
          text: "Bridge OK",
          fontSize: 28,
          color: "#2563EB",
          align: "MiddleCenter",
        },
      },
      {
        clientHintId: "smokeInput",
        parentClientHintId: "smokePanel",
        type: "InputField",
        rect: { x: 0.32, y: 0.78, w: 0.36, h: 0.06 },
        anchor: "TopLeft",
        props: {
          text: "Player name",
          placeholder: "Player name",
          inputText: "Codex",
          fontSize: 20,
          color: "#F8FAFC",
          align: "MiddleLeft",
        },
      },
      {
        clientHintId: "smokeToggle",
        parentClientHintId: "smokePanel",
        type: "Toggle",
        rect: { x: 0.32, y: 0.86, w: 0.22, h: 0.06 },
        anchor: "TopLeft",
        props: {
          text: "Remember",
          fontSize: 18,
          color: "#16A34A",
          align: "MiddleLeft",
          isOn: true,
          hasIsOn: true,
        },
      },
      {
        clientHintId: "smokeSlider",
        parentClientHintId: "smokePanel",
        type: "Slider",
        rect: { x: 0.32, y: 0.93, w: 0.28, h: 0.05 },
        anchor: "TopLeft",
        props: {
          color: "#334155",
          minValue: 0,
          hasMinValue: true,
          maxValue: 10,
          hasMaxValue: true,
          value: 6,
          hasValue: true,
        },
      },
      {
        clientHintId: "smokeDropdown",
        parentClientHintId: "smokePanel",
        type: "Dropdown",
        rect: { x: 0.62, y: 0.93, w: 0.28, h: 0.05 },
        anchor: "TopLeft",
        props: {
          text: "Normal",
          fontSize: 18,
          color: "#E0F2FE",
          align: "MiddleLeft",
          options: ["Easy", "Normal", "Hard"],
          value: 1,
          hasValue: true,
        },
      },
    ],
  };
}

function smokeFlowScreenName(screenName) {
  const base = typeof screenName === "string" && screenName.trim().length > 0
    ? screenName.trim()
    : "UOSSmokeScreen";
  return `${base}Next`;
}

async function runSmokeRevision(target, created, options = {}) {
  const screenId = stringValue(created.screenId);
  const panelId = elementIdByHint(created, "smokePanel");
  const titleId = elementIdByHint(created, "smokeTitle");
  const buttonId = elementIdByHint(created, "smokeButton");
  if (screenId === undefined || panelId === undefined || titleId === undefined || buttonId === undefined) {
    throw new Error("[uos] smoke revise requires smokePanel, smokeTitle, and smokeButton element ids");
  }

  const hierarchyBefore = await callUnityTool(target, "get_scene_hierarchy", { screenId }, options);
  const updateArgs = {
    elementId: titleId,
    props: {
      text: "UOS Smoke Revised",
      fontSize: 44,
      color: "#FACC15",
      align: "MiddleCenter",
    },
  };
  const updated = await callUnityTool(target, "update_ui_element", updateArgs, options);
  const addArgs = {
    screenId,
    element: {
      clientHintId: "smokeRevisionBadge",
      parentElementId: panelId,
      type: "Text",
      rect: { x: 0.2, y: 0.38, w: 0.6, h: 0.1 },
      anchor: "TopLeft",
      props: {
        text: "Revision OK",
        fontSize: 24,
        color: "#A7F3D0",
        align: "MiddleCenter",
      },
    },
  };
  const added = await callUnityTool(target, "add_ui_element", addArgs, options);
  const tempAddArgs = {
    screenId,
    element: {
      clientHintId: "smokeDisposable",
      parentElementId: panelId,
      type: "Text",
      rect: { x: 0.22, y: 0.5, w: 0.56, h: 0.08 },
      anchor: "TopLeft",
      props: {
        text: "Temporary",
        fontSize: 18,
        color: "#FCA5A5",
        align: "MiddleCenter",
      },
    },
  };
  const tempAdded = await callUnityTool(target, "add_ui_element", tempAddArgs, options);
  const moveArgs = {
    elementId: buttonId,
    rect: { x: 0.18, y: 0.62, w: 0.64, h: 0.16 },
    anchor: "TopLeft",
  };
  const moved = await callUnityTool(target, "move_ui_element", moveArgs, options);
  const tempElementId = stringValue(tempAdded?.elementId);
  if (tempElementId === undefined) {
    throw new Error("[uos] smoke revise delete step requires the disposable element id");
  }
  const deleteArgs = { elementId: tempElementId };
  const deleted = await callUnityTool(target, "delete_ui_element", deleteArgs, options);
  const hierarchyAfter = await callUnityTool(target, "get_scene_hierarchy", { screenId }, options);
  return {
    screenId,
    hierarchyBefore,
    updateArgs,
    updated,
    addArgs,
    added,
    tempAddArgs,
    tempAdded,
    moveArgs,
    moved,
    deleteArgs,
    deleted,
    hierarchyAfter,
  };
}

function elementIdByHint(created, hint) {
  const pair = Array.isArray(created?.elements)
    ? created.elements.find((element) => element?.clientHintId === hint)
    : undefined;
  return stringValue(pair?.elementId);
}

export function resolveSmokeImportPath(inputPath, target = {}, options = {}, env = process.env) {
  const raw = String(inputPath ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] smoke import path is empty");
  if (path.isAbsolute(raw)) return path.normalize(raw);

  const base = options.materialsDir !== undefined
    ? resolveSmokeMaterialsDir(options.materialsDir, target, env)
    : stringValue(env.UNITY_MCP_MATERIALS_DIR)
    ?? stringValue(target.projectPath)
    ?? process.cwd();
  return path.resolve(base, raw);
}

export function resolveSmokeMaterialsDir(inputPath, target = {}, env = process.env) {
  const raw = String(inputPath ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] smoke material directory is empty");
  if (path.isAbsolute(raw)) return path.normalize(raw);

  const base = stringValue(env.UNITY_MCP_MATERIALS_DIR)
    ?? stringValue(target.projectPath)
    ?? process.cwd();
  return path.resolve(base, raw);
}

export function resolveLaunchMaterialsDir(inputPath, target = {}, options = {}) {
  const raw = String(inputPath ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] planning material directory is empty");
  if (path.isAbsolute(raw)) return path.normalize(raw);

  const base = stringValue(target?.projectPath)
    ?? stringValue(options.env?.UOS_PROJECT_DIR)
    ?? stringValue(options.cwd)
    ?? process.cwd();
  return path.resolve(base, raw);
}

export function resolveLaunchFilePath(inputPath, target = {}, options = {}) {
  const raw = String(inputPath ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] attached file path is empty");
  if (path.isAbsolute(raw)) return path.normalize(raw);

  const base = stringValue(options.materialsDir)
    ?? stringValue(options.env?.UNITY_MCP_MATERIALS_DIR)
    ?? stringValue(target?.projectPath)
    ?? stringValue(options.env?.UOS_PROJECT_DIR)
    ?? stringValue(options.cwd)
    ?? process.cwd();
  return path.resolve(base, raw);
}

function resolveLaunchFiles(files, target = {}, options = {}) {
  if (!Array.isArray(files) || files.length === 0) return [];
  return files.map((file) => resolveLaunchFilePath(file, target, options));
}

export async function selectSmokeMaterialImage(target = {}, options = {}, env = process.env) {
  return await selectSmokeMaterial(target, {
    ...options,
    materialExtensions: SMOKE_IMAGE_EXTENSIONS,
    materialErrorLabel: "image material",
  }, env);
}

export async function selectSmokeMaterial(target = {}, options = {}, env = process.env) {
  const root = resolveSmokeMaterialsDir(options.materialsDir, target, env);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch (err) {
    throw new Error(`[uos] smoke materials directory not found: ${root} (${errorMessage(err)})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`[uos] smoke materials path is not a directory: ${root}`);
  }

  const maxDepth = clampInt(options.materialDepth, 4, 0, 20);
  const maxFiles = clampInt(options.materialMaxFiles, 500, 1, 5000);
  const extensions = options.materialExtensions ?? materialExtensionsForKind(options.materialScreenKind);
  const errorLabel = stringValue(options.materialErrorLabel) ?? materialErrorLabelForKind(options.materialScreenKind);
  const matches = [];
  let inspected = 0;

  async function walk(dir, depth) {
    if (inspected >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (inspected >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SMOKE_MATERIAL_IGNORE_DIRS.has(entry.name)) {
          await walk(full, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      inspected++;
      const ext = path.extname(entry.name).toLowerCase();
      if (!extensions.has(ext)) continue;
      matches.push({
        sourcePath: full,
        relativePath: path.relative(root, full).replace(/\\/g, "/"),
        root,
        mode: "materials-dir",
        kind: materialKindForExtension(ext),
      });
    }
  }

  await walk(root, 0);
  matches.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const selected = matches[0];
  if (selected === undefined) {
    throw new Error(`[uos] no ${errorLabel} found under ${root}`);
  }
  return selected;
}

function materialExtensionsForKind(kind) {
  switch (kind) {
    case "image": return SMOKE_IMAGE_EXTENSIONS;
    case "video": return SMOKE_VIDEO_EXTENSIONS;
    case "pdf": return new Set([".pdf"]);
    case "docx": return new Set([".docx"]);
    case "pptx": return new Set([".pptx"]);
    case "document": return new Set([".txt", ".md", ".markdown", ".csv", ".json"]);
    default: return SMOKE_SCREEN_MATERIAL_EXTENSIONS;
  }
}

function materialErrorLabelForKind(kind) {
  switch (kind) {
    case "image": return "image material";
    case "video": return "video material";
    case "pdf": return "PDF material";
    case "docx": return "DOCX material";
    case "pptx": return "PPTX material";
    case "document": return "document material";
    default: return "supported planning material";
  }
}

function materialKindForExtension(ext) {
  if (SMOKE_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (SMOKE_VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  if (ext === ".pptx") return "pptx";
  return "document";
}

export function formatSmokeResult(result) {
  const project = result.projectInfo?.projectName ?? result.target.projectName ?? "(unknown project)";
  const pathText = result.projectInfo?.projectPath ?? result.target.projectPath ?? "(unknown path)";
  const lines = [
    `[uos smoke] connected: ${project}`,
    `[uos smoke] projectPath: ${pathText}`,
    `[uos smoke] list_screens: ok`,
  ];

  if (result.selectedMaterial !== undefined && result.imported === undefined) {
    lines.push(`[uos smoke] selected material: ${result.selectedMaterial.relativePath ?? result.selectedMaterial.sourcePath ?? "(unknown)"}`);
  }

  if (result.imported !== undefined) {
    const sprite = result.imported.importedAsSprite === true ? " as Sprite" : "";
    if (result.selectedMaterial?.relativePath !== undefined) {
      lines.push(`[uos smoke] selected material: ${result.selectedMaterial.relativePath}`);
    }
    lines.push(`[uos smoke] imported asset: ${result.imported.assetPath ?? "(unknown)"}${sprite}`);
  }

  if (result.materialScreen !== undefined) {
    const count = Array.isArray(result.materialScreen.created?.elements) ? result.materialScreen.created.elements.length : 0;
    lines.push(
      `[uos smoke] material screen: ${result.materialScreen.kind ?? "(unknown)"}/${result.materialScreen.mode ?? "(unknown)"} ` +
        `${result.materialScreen.created?.screenId ?? "(unknown)"} (${count} element(s))`,
    );
    for (const warning of result.materialScreen.warnings ?? []) {
      lines.push(`[uos smoke] material warning: ${warning}`);
    }
  }

  if (result.pptxDeck !== undefined) {
    const screenCount = Array.isArray(result.pptxDeck.screens) ? result.pptxDeck.screens.length : 0;
    const transitionCount = Array.isArray(result.pptxDeck.transitions) ? result.pptxDeck.transitions.length : 0;
    const active = result.pptxDeck.activeScreenId !== undefined ? ` active=${result.pptxDeck.activeScreenId}` : "";
    lines.push(`[uos smoke] pptx deck: ${screenCount} screen(s), ${transitionCount} transition(s)${active}`);
    for (const screen of result.pptxDeck.screens ?? []) {
      lines.push(`[uos smoke] deck screen: slide ${screen.slideNumber ?? "?"} ${screen.screenId ?? "(unknown)"}`);
    }
    for (const warning of result.pptxDeck.warnings ?? []) {
      lines.push(`[uos smoke] deck warning: ${warning}`);
    }
  }

  if (result.sceneObject !== undefined) {
    lines.push(
      `[uos smoke] scene object: created ${result.sceneObject.created?.objectId ?? "(unknown)"} ` +
        `${result.sceneObject.created?.type ?? "(unknown)"} "${result.sceneObject.created?.name ?? "(unnamed)"}"`,
    );
    lines.push(
      `[uos smoke] scene object update: ${result.sceneObject.updated?.name ?? "(unknown)"} ` +
        `pos=${vecText(result.sceneObject.updated?.transform?.position) ?? "(unknown)"}`,
    );
    lines.push(`[uos smoke] scene object delete: ${result.sceneObject.deleted?.ok === true ? "ok" : "unknown"}`);
  }

  if (result.created !== undefined) {
    const count = Array.isArray(result.created.elements) ? result.created.elements.length : 0;
    lines.push(`[uos smoke] created screen: ${result.created.screenId ?? "(unknown)"} (${count} element(s))`);
  } else if (
    result.materialScreen === undefined
    && result.pptxDeck === undefined
    && result.sceneObject === undefined
    && result.aiRun === undefined
  ) {
    lines.push("[uos smoke] write: skipped (pass --write to create a smoke-test UI screen)");
  }

  const aiRuns = Array.isArray(result.aiRuns) && result.aiRuns.length > 0
    ? result.aiRuns
    : (result.aiRun !== undefined ? [result.aiRun] : []);
  for (const aiRun of aiRuns) {
    const observed = Array.isArray(aiRun.observedTools) && aiRun.observedTools.length > 0
      ? ` tools=${aiRun.observedTools.join(",")}`
      : "";
    const journal = aiRun.journalVerified === true
      ? ` journal=${(aiRun.observedJournalTools ?? []).join(",") || "none"}`
      : aiRun.journalSkippedReason !== undefined
        ? ` journal=skipped(${aiRun.journalSkippedReason})`
        : "";
    const mode = aiRun.mode !== undefined ? ` mode=${aiRun.mode}` : "";
    const action = aiRun.mode === "context-follow-up" && aiRun.followUpAction !== undefined
      ? ` action=${aiRun.followUpAction}`
      : "";
    const continued = aiRun.continued === true ? " continued" : "";
    const feedback = aiRun.feedbackIteration !== undefined ? ` feedbackIteration=${aiRun.feedbackIteration}` : "";
    const targetText = aiRun.mode === "context-follow-up"
      ? ` screen=${aiRun.screenId ?? aiRun.screenName ?? "(unknown)"}`
      : aiRun.materialPath !== undefined
        ? ` material=${path.basename(aiRun.materialPath)}`
        : ` object=${aiRun.objectName ?? "(unknown)"}${aiRun.objectType !== undefined ? ` type=${aiRun.objectType}` : ""}`;
    lines.push(
      `[uos smoke] opencode AI run: ${aiRun.ok === true ? "ok" : "failed"} ` +
        `model=${aiRun.model ?? "(default)"}${targetText}${mode}${action}${continued}${feedback}${observed}${journal}`,
    );
    const journalVerification = smokeJournalVerificationText(aiRun.journalVerification);
    if (journalVerification !== undefined) {
      lines.push(`[uos smoke] opencode AI verification: ${journalVerification}`);
    }
  }

  if (result.revision !== undefined) {
    lines.push(
      `[uos smoke] revised screen: updated title, added ${result.revision.added?.elementId ?? "(unknown element)"}, ` +
        `moved ${result.revision.moveArgs?.elementId ?? "(unknown element)"}, ` +
        `deleted ${result.revision.deleteArgs?.elementId ?? "(unknown element)"}`,
    );
  }

  if (result.flowScreen !== undefined) {
    lines.push(`[uos smoke] flow screen: ${result.flowScreen.screenId ?? "(unknown)"}`);
  }

  if (result.transition !== undefined) {
    const fromId = result.transitionArgs?.fromId ?? result.created?.screenId ?? "(unknown)";
    const toId = result.transitionArgs?.toId ?? result.flowScreen?.screenId ?? "(unknown)";
    const trigger = result.transitionArgs?.trigger ?? "(unknown trigger)";
    lines.push(`[uos smoke] transition: ${fromId} -> ${toId} (trigger: ${trigger})`);
  }

  if (result.contextFollowUp !== undefined) {
    lines.push(
      `[uos smoke] context follow-up: active ${result.contextFollowUp.activeScreenId ?? "(unknown)"}, ` +
        `updated ${result.contextFollowUp.updateArgs?.elementId ?? "(unknown element)"}, ` +
        `added ${result.contextFollowUp.added?.elementId ?? "(unknown element)"}`,
    );
  }

  if (result.preview !== undefined) {
    lines.push(`[uos smoke] preview: ${result.preview.path ?? result.preview.uri ?? "captured"}`);
  }

  if (result.comparison !== undefined && result.verification === undefined) {
    const metrics = [
      result.comparison.verdict !== undefined ? `verdict=${result.comparison.verdict}` : undefined,
      metricText("mae", result.comparison.meanAbsoluteError),
      metricText("rmse", result.comparison.rootMeanSquareError),
      metricText("mismatch", result.comparison.mismatchRatio),
      result.comparison.diffPath !== undefined ? `diff=${result.comparison.diffPath}` : undefined,
    ].filter((item) => item !== undefined).join(" ");
    lines.push(`[uos smoke] comparison: ${metrics || "completed"}`);
  }

  if (result.verification !== undefined) {
    const metrics = [
      result.verification.verdict !== undefined ? `verdict=${result.verification.verdict}` : undefined,
      result.verification.preview?.savedPath !== undefined ? `preview=${result.verification.preview.savedPath}` : undefined,
      metricText("mae", result.verification.comparison?.meanAbsoluteError),
      metricText("mismatch", result.verification.comparison?.mismatchRatio),
      result.verification.comparison?.diffPath !== undefined ? `diff=${result.verification.comparison.diffPath}` : undefined,
    ].filter((item) => item !== undefined).join(" ");
    lines.push(`[uos smoke] verification: ${metrics || "completed"}`);
  }

  if (result.saved !== undefined) {
    lines.push(`[uos smoke] saved scene: ${result.saved.path ?? "(unknown)"}`);
  }

  if (result.context !== undefined) {
    lines.push(`[uos smoke] context: ${result.context.contextDir} (${result.context.records} record(s))`);
  }

  return lines.join("\n");
}

function smokeJournalVerificationText(verification) {
  if (verification === undefined || verification === null || typeof verification !== "object") return undefined;
  const metrics = [
    verification.screenId !== undefined ? `screen=${verification.screenId}` : undefined,
    verification.verdict !== undefined ? `verdict=${verification.verdict}` : undefined,
    verification.previewPath !== undefined ? `preview=${verification.previewPath}` : undefined,
    metricText("mae", verification.meanAbsoluteError),
    metricText("mismatch", verification.mismatchRatio),
    verification.diffPath !== undefined ? `diff=${verification.diffPath}` : undefined,
  ].filter((item) => item !== undefined).join(" ");
  return metrics.length > 0 ? metrics : undefined;
}

function smokeEmptyIndex() {
  return { version: "1.0.0", updatedAt: "", screens: {}, sceneObjects: {}, transitions: [] };
}

function smokeApplyToIndex(idx, tool, args, meta, ts) {
  switch (tool) {
    case "verify_screen_against_reference": {
      const screenId = stringValue(args?.screenId ?? meta?.screenId);
      if (screenId === undefined) return;
      smokeApplyToIndex(idx, "capture_preview", { screenId }, meta?.preview, ts);
      smokeApplyToIndex(
        idx,
        "compare_images",
        {
          screenId,
          referencePath: args?.referencePath ?? meta?.comparison?.referencePath,
          candidatePath: meta?.preview?.savedPath ?? meta?.preview?.path,
          threshold: args?.threshold,
        },
        { screenId, ...meta?.comparison },
        ts,
      );
      return;
    }
    case "verify_screen_against_reference_from_context": {
      smokeApplyToIndex(idx, "verify_screen_against_reference", meta?.verifyArgs ?? args, meta?.verified ?? meta, ts);
      return;
    }
    case "create_screen_from_material": {
      if (meta?.importedAsset !== undefined) {
        smokeApplyToIndex(idx, "import_asset", args, meta.importedAsset, ts);
      }
      for (const imported of meta?.importedAssets ?? []) {
        smokeApplyToIndex(idx, "import_asset", args, imported, ts);
      }
      smokeApplyToIndex(
        idx,
        "create_ui_screen",
        { intent: meta?.intent ?? meta?.specific?.draft?.intent, source: meta?.source },
        { ...(meta?.created ?? meta), source: meta?.source },
        ts,
      );
      return;
    }
    case "create_pptx_deck_screens": {
      for (const screen of meta?.screens ?? []) {
        for (const imported of screen?.importedAssets ?? []) {
          smokeApplyToIndex(idx, "import_asset", args, imported, ts);
        }
        const source = screen?.source ?? {
          tool: "create_pptx_deck_screens",
          kind: "pptx",
          mode: "editable",
          path: stringValue(meta?.path ?? args?.path),
          slideNumber: numberValue(screen?.slideNumber ?? screen?.draft?.source?.slideNumber),
          assetPaths: smokeReferenceAssetPaths(screen),
        };
        smokeApplyToIndex(
          idx,
          "create_ui_screen",
          { intent: screen?.intent ?? screen?.draft?.intent, source },
          { ...(screen?.created ?? screen), source },
          ts,
        );
      }
      for (const transition of meta?.transitions ?? []) {
        smokeApplyToIndex(idx, "create_screen_transition", transition, transition, ts);
      }
      const activeScreenId = stringValue(meta?.activeScreenId);
      if (activeScreenId !== undefined) {
        smokeApplyToIndex(idx, "set_active_screen", { screenId: activeScreenId }, { screenId: activeScreenId, active: true }, ts);
      }
      return;
    }
    case "create_ui_screen": {
      const screenId = stringValue(meta?.screenId);
      if (screenId === undefined) return;
      const intent = args?.intent ?? {};
      const screen = idx.screens[screenId] ?? { screenId, createdAt: ts, updatedAt: ts, elements: {} };
      screen.screenName = stringValue(intent.screenName) ?? screen.screenName;
      screen.referenceCanvas = intent.referenceCanvas ?? screen.referenceCanvas;
      const source = smokeScreenSource(args?.source ?? meta?.source);
      if (source !== undefined) screen.source = source;
      screen.updatedAt = ts;

      const byHint = new Map();
      for (const element of intent.elements ?? []) {
        if (typeof element?.clientHintId === "string") byHint.set(element.clientHintId, element);
      }
      const hintToElementId = new Map();
      for (const pair of meta?.elements ?? []) {
        if (typeof pair?.clientHintId === "string" && typeof pair?.elementId === "string") {
          hintToElementId.set(pair.clientHintId, pair.elementId);
        }
      }
      for (const pair of meta?.elements ?? []) {
        const elementId = stringValue(pair?.elementId);
        if (elementId === undefined) continue;
        const src = typeof pair?.clientHintId === "string" ? byHint.get(pair.clientHintId) : undefined;
        const rec = screen.elements[elementId] ?? { elementId, createdAt: ts, updatedAt: ts };
        rec.elementId = elementId;
        rec.clientHintId = stringValue(pair?.clientHintId) ?? rec.clientHintId;
        rec.parentClientHintId = stringValue(src?.parentClientHintId) ?? rec.parentClientHintId;
        rec.parentElementId = rec.parentClientHintId !== undefined ? hintToElementId.get(rec.parentClientHintId) : rec.parentElementId;
        rec.type = stringValue(src?.type) ?? rec.type;
        rec.rect = smokeRect(src?.rect) ?? rec.rect;
        rec.anchor = stringValue(src?.anchor) ?? rec.anchor;
        rec.props = smokeProps(src?.props) ?? rec.props;
        rec.deleted = false;
        rec.updatedAt = ts;
        screen.elements[elementId] = rec;
      }
      idx.screens[screenId] = screen;
      return;
    }
    case "import_asset": {
      const assetPath = stringValue(meta?.assetPath);
      if (assetPath === undefined) return;
      idx.importedAssets ??= [];
      idx.importedAssets.push({
        sourcePath: stringValue(meta?.sourcePath ?? args?.sourcePath),
        assetPath,
        importedAsSprite: typeof meta?.importedAsSprite === "boolean" ? meta.importedAsSprite : undefined,
        assetType: stringValue(meta?.assetType),
        ts,
      });
      return;
    }
    case "create_scene_object": {
      smokeApplySceneObject(idx, args, meta, ts, { deleted: false });
      return;
    }
    case "list_scene_objects": {
      idx.sceneObjects ??= {};
      const objects = Array.isArray(meta?.objects) ? meta.objects : [];
      const seen = new Set();
      for (const object of objects) {
        const objectId = stringValue(object?.objectId);
        if (objectId === undefined) continue;
        seen.add(objectId);
        smokeApplySceneObject(idx, {}, object, ts, { deleted: false });
      }
      for (const [objectId, rec] of Object.entries(idx.sceneObjects)) {
        if (!seen.has(objectId)) {
          rec.deleted = true;
          rec.updatedAt = ts;
        }
      }
      return;
    }
    case "update_scene_object": {
      smokeApplySceneObject(idx, args, meta, ts, { deleted: false });
      return;
    }
    case "update_scene_object_from_context": {
      smokeApplyToIndex(idx, "update_scene_object", meta?.updateArgs ?? args, meta?.updated ?? meta, ts);
      return;
    }
    case "delete_scene_object": {
      const objectId = stringValue(args?.objectId ?? meta?.objectId);
      if (objectId === undefined) return;
      idx.sceneObjects ??= {};
      const rec = idx.sceneObjects[objectId] ?? {
        objectId,
        createdAt: ts,
        updatedAt: ts,
      };
      rec.deleted = true;
      rec.updatedAt = ts;
      idx.sceneObjects[objectId] = rec;
      return;
    }
    case "delete_scene_object_from_context": {
      smokeApplyToIndex(idx, "delete_scene_object", meta?.deleteArgs ?? args, meta?.deleted ?? meta, ts);
      return;
    }
    case "add_ui_element": {
      const screenId = stringValue(args?.screenId);
      const elementId = stringValue(meta?.elementId);
      if (screenId === undefined || elementId === undefined) return;
      const screen = idx.screens[screenId] ?? { screenId, createdAt: ts, updatedAt: ts, elements: {} };
      const rec = screen.elements[elementId] ?? { elementId, createdAt: ts, updatedAt: ts };
      rec.elementId = elementId;
      smokeApplyElementInput(rec, args?.element, ts, undefined, screen);
      rec.deleted = false;
      screen.elements[elementId] = rec;
      screen.updatedAt = ts;
      idx.screens[screenId] = screen;
      return;
    }
    case "add_ui_element_from_context": {
      smokeApplyToIndex(idx, "add_ui_element", meta?.addArgs ?? args, meta?.added ?? meta, ts);
      return;
    }
    case "update_ui_element": {
      const elementId = stringValue(args?.elementId);
      if (elementId === undefined) return;
      const screen = smokeFindScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      const rec = screen.elements[elementId];
      const rect = smokeRect(args?.rect);
      if (rect !== undefined) rec.rect = rect;
      rec.anchor = stringValue(args?.anchor) ?? rec.anchor;
      const props = smokeProps(args?.props);
      if (props !== undefined) rec.props = { ...(rec.props ?? {}), ...props };
      rec.updatedAt = ts;
      screen.updatedAt = ts;
      return;
    }
    case "update_ui_element_from_context": {
      smokeApplyToIndex(idx, "update_ui_element", meta?.updateArgs ?? args, meta?.updated ?? meta, ts);
      return;
    }
    case "move_ui_element": {
      const elementId = stringValue(args?.elementId);
      if (elementId === undefined) return;
      const screen = smokeFindScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      const rec = screen.elements[elementId];
      const rect = smokeRect(args?.rect);
      if (rect !== undefined) rec.rect = rect;
      rec.anchor = stringValue(args?.anchor) ?? rec.anchor;
      rec.updatedAt = ts;
      screen.updatedAt = ts;
      return;
    }
    case "move_ui_element_from_context": {
      smokeApplyToIndex(idx, "move_ui_element", meta?.moveArgs ?? args, meta?.moved ?? meta, ts);
      return;
    }
    case "delete_ui_element": {
      const elementId = stringValue(args?.elementId);
      if (elementId === undefined) return;
      const screen = smokeFindScreenOfElement(idx, elementId);
      if (screen === undefined) return;
      screen.elements[elementId].deleted = true;
      screen.elements[elementId].updatedAt = ts;
      screen.updatedAt = ts;
      return;
    }
    case "delete_ui_element_from_context": {
      smokeApplyToIndex(idx, "delete_ui_element", meta?.deleteArgs ?? args, meta?.deleted ?? meta, ts);
      return;
    }
    case "create_screen_transition": {
      const fromId = stringValue(args?.fromId ?? meta?.fromId);
      const toId = stringValue(args?.toId ?? meta?.toId);
      if (fromId === undefined || toId === undefined) return;
      idx.transitions ??= [];
      idx.transitions.push({
        fromId,
        toId,
        trigger: stringValue(args?.trigger ?? meta?.trigger),
        ok: typeof meta?.ok === "boolean" ? meta.ok : undefined,
        ts,
      });
      idx.transitions = idx.transitions.slice(-100);
      return;
    }
    case "create_screen_transition_from_context": {
      smokeApplyToIndex(idx, "create_screen_transition", meta?.transitionArgs ?? args, meta?.created ?? meta, ts);
      return;
    }
    case "set_active_screen": {
      const screenId = stringValue(args?.screenId ?? meta?.screenId);
      if (screenId === undefined) return;
      for (const screen of Object.values(idx.screens ?? {})) {
        if (screen !== null && typeof screen === "object") {
          screen.active = screen.screenId === screenId ? true : undefined;
        }
      }
      const screen = idx.screens[screenId] ?? { screenId, createdAt: ts, updatedAt: ts, elements: {} };
      screen.active = true;
      screen.updatedAt = ts;
      idx.screens[screenId] = screen;
      idx.activeScreenId = screenId;
      return;
    }
    case "set_active_screen_from_context": {
      smokeApplyToIndex(idx, "set_active_screen", meta?.activateArgs ?? args, meta?.activated ?? meta, ts);
      return;
    }
    case "capture_preview": {
      const screenId = stringValue(meta?.screenId ?? args?.screenId);
      if (screenId === undefined) return;
      const screen = idx.screens[screenId] ?? { screenId, createdAt: ts, updatedAt: ts, elements: {} };
      screen.previews ??= [];
      screen.previews.push({
        savedPath: stringValue(meta?.savedPath ?? meta?.path),
        uri: stringValue(meta?.uri),
        mimeType: stringValue(meta?.mimeType),
        width: numberValue(meta?.width),
        height: numberValue(meta?.height),
        size: numberValue(meta?.size),
        ts,
      });
      screen.previews = screen.previews.slice(-20);
      idx.screens[screenId] = screen;
      return;
    }
    case "capture_preview_from_context": {
      smokeApplyToIndex(idx, "capture_preview", meta?.previewArgs ?? args, meta?.captured ?? meta, ts);
      return;
    }
    case "compare_images": {
      const screenId = stringValue(meta?.screenId ?? args?.screenId);
      const screen = screenId !== undefined
        ? (idx.screens[screenId] ?? { screenId, createdAt: ts, updatedAt: ts, elements: {} })
        : smokeFindScreenByPreviewLocation(idx, meta?.candidatePath ?? args?.candidatePath);
      if (screen === undefined) return;
      screen.comparisons ??= [];
      screen.comparisons.push({
        referencePath: stringValue(meta?.referencePath ?? args?.referencePath),
        candidatePath: stringValue(meta?.candidatePath ?? args?.candidatePath),
        diffPath: stringValue(meta?.diffPath),
        diffUri: stringValue(meta?.diffUri ?? meta?.uri),
        diffMimeType: stringValue(meta?.diffMimeType),
        verdict: stringValue(meta?.verdict),
        referenceWidth: numberValue(meta?.referenceWidth),
        referenceHeight: numberValue(meta?.referenceHeight),
        candidateWidth: numberValue(meta?.candidateWidth),
        candidateHeight: numberValue(meta?.candidateHeight),
        compareWidth: numberValue(meta?.compareWidth),
        compareHeight: numberValue(meta?.compareHeight),
        meanAbsoluteError: numberValue(meta?.meanAbsoluteError),
        rootMeanSquareError: numberValue(meta?.rootMeanSquareError),
        mismatchRatio: numberValue(meta?.mismatchRatio),
        maxChannelDelta: numberValue(meta?.maxChannelDelta),
        aspectRatioDelta: numberValue(meta?.aspectRatioDelta),
        threshold: numberValue(meta?.threshold),
        size: numberValue(meta?.size),
        ts,
      });
      screen.comparisons = screen.comparisons.slice(-20);
      screen.updatedAt = ts;
      if (screen.screenId !== undefined) idx.screens[screen.screenId] = screen;
      return;
    }
    case "save_scene": {
      const scenePath = stringValue(meta?.path ?? args?.path);
      if (scenePath === undefined) return;
      idx.lastSavedScenePath = scenePath;
      idx.lastSavedAt = ts;
      return;
    }
  }
}

function smokeApplySceneObject(idx, args, meta, ts, options = {}) {
  const objectId = stringValue(meta?.objectId ?? args?.objectId);
  if (objectId === undefined) return;
  idx.sceneObjects ??= {};
  const rec = idx.sceneObjects[objectId] ?? { objectId, createdAt: ts, updatedAt: ts };
  rec.objectId = objectId;
  rec.name = stringValue(meta?.name ?? args?.name) ?? rec.name;
  rec.type = stringValue(meta?.type ?? args?.type) ?? rec.type;
  rec.path = stringValue(meta?.path) ?? rec.path;
  rec.parentObjectId = stringValue(meta?.parentObjectId ?? args?.parentId) ?? rec.parentObjectId;
  if (typeof meta?.active === "boolean") rec.active = meta.active;
  else if (typeof args?.active === "boolean") rec.active = args.active;
  const transform = smokeSceneTransform(meta?.transform ?? args?.transform);
  if (transform !== undefined) rec.transform = transform;
  if (Array.isArray(meta?.components)) {
    rec.components = meta.components.filter((component) => typeof component === "string");
  }
  rec.deleted = options.deleted === true ? true : false;
  rec.updatedAt = ts;
  idx.sceneObjects[objectId] = rec;
}

function smokeSceneTransform(value) {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const transform = compactObject({
    position: smokeVec3(value.position),
    rotation: smokeVec3(value.rotation),
    scale: smokeVec3(value.scale),
  });
  return Object.keys(transform).length > 0 ? transform : undefined;
}

function smokeVec3(value) {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const z = numberValue(value.z);
  return x !== undefined && y !== undefined && z !== undefined ? { x, y, z } : undefined;
}

function smokeApplyElementInput(rec, input, ts, hintToElementId, screen) {
  if (input === undefined || input === null || typeof input !== "object") {
    rec.updatedAt = ts;
    return;
  }
  rec.type = stringValue(input.type) ?? rec.type;
  rec.clientHintId = stringValue(input.clientHintId) ?? rec.clientHintId;
  rec.parentClientHintId = stringValue(input.parentClientHintId) ?? rec.parentClientHintId;
  rec.parentElementId = smokeParentElementId(input, hintToElementId, screen) ?? rec.parentElementId;
  rec.rect = smokeRect(input.rect) ?? rec.rect;
  rec.anchor = stringValue(input.anchor) ?? rec.anchor;
  rec.props = smokeProps(input.props) ?? rec.props;
  rec.updatedAt = ts;
}

function smokeParentElementId(input, hintToElementId, screen) {
  const parentElementId = stringValue(input?.parentElementId);
  if (parentElementId !== undefined) return parentElementId;
  const parentHint = stringValue(input?.parentClientHintId);
  if (parentHint === undefined) return undefined;
  const mapped = hintToElementId?.get(parentHint);
  if (mapped !== undefined) return mapped;
  if (screen === undefined) return undefined;
  return Object.values(screen.elements ?? {}).find((element) => element?.clientHintId === parentHint)?.elementId;
}

function smokeFindScreenOfElement(idx, elementId) {
  const screens = idx?.screens !== undefined && typeof idx.screens === "object"
    ? Object.values(idx.screens)
    : [];
  return screens.find((screen) =>
    screen !== null
    && typeof screen === "object"
    && screen.elements !== undefined
    && typeof screen.elements === "object"
    && screen.elements[elementId] !== undefined);
}

function smokeFindScreenByPreviewLocation(idx, candidatePath) {
  const candidate = stringValue(candidatePath);
  if (candidate === undefined) return undefined;
  const screens = idx?.screens !== undefined && typeof idx.screens === "object"
    ? Object.values(idx.screens)
    : [];
  return screens.find((screen) => {
    const previews = Array.isArray(screen?.previews) ? screen.previews : [];
    return previews.some((preview) =>
      sameSmokeLocation(candidate, preview?.savedPath)
      || sameSmokeLocation(candidate, preview?.path)
      || sameSmokeLocation(candidate, preview?.uri));
  });
}

function sameSmokeLocation(a, b) {
  const left = smokeLocationPath(a);
  const right = smokeLocationPath(b);
  if (left === undefined || right === undefined) return false;
  return samePath(left, right);
}

function smokeLocationPath(value) {
  const raw = stringValue(value);
  if (raw === undefined) return undefined;
  return raw.startsWith("file:") ? filePathFromUri(raw) : raw;
}

function smokeAssetPathForMaterial(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase() || ".png";
  const stem = path.basename(sourcePath, ext).replace(/[^a-zA-Z0-9._-]+/g, "_") || "material";
  return `Assets/UOS/Imported/${stem}${ext}`;
}

async function materializeSmokePreview(contextDir, screenId, preview, ts) {
  const base64Data = typeof preview?.base64Data === "string" && preview.base64Data.length > 0
    ? preview.base64Data
    : undefined;
  if (base64Data === undefined) {
    return sanitizeSmokeJournalValue(preview);
  }

  const mimeType = stringValue(preview.mimeType) ?? "image/png";
  const ext = extensionForMimeType(mimeType);
  const safeScreenId = safeFileStem(screenId ?? preview.screenId ?? "preview");
  const safeTs = safeFileStem(ts);
  const previewDir = path.join(contextDir, "previews");
  await fs.mkdir(previewDir, { recursive: true });
  const savedPath = path.join(previewDir, `${safeScreenId}-${safeTs}${ext}`);
  await fs.writeFile(savedPath, Buffer.from(base64Data, "base64"));
  const stat = await fs.stat(savedPath);
  return sanitizeSmokeJournalValue({
    ...preview,
    path: savedPath,
    savedPath,
    uri: pathToFileURL(savedPath).toString(),
    size: typeof preview?.size === "number" ? preview.size : stat.size,
  });
}

export function resolveSmokeComparePath(inputPath, target = {}, options = {}, env = process.env) {
  const raw = String(inputPath ?? "").trim();
  if (raw.length === 0) throw new Error("[uos] smoke reference path is empty");
  if (path.isAbsolute(raw)) return path.normalize(raw);

  const base = stringValue(options.materialsDir)
    ?? stringValue(env.UNITY_MCP_MATERIALS_DIR)
    ?? stringValue(target.projectPath)
    ?? process.cwd();
  return path.resolve(base, raw);
}

function resolveSmokeCompareOutputPath(inputPath, contextDir, referencePath, candidatePath, ts) {
  const raw = stringValue(inputPath);
  if (raw !== undefined) {
    return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(contextDir, raw);
  }
  const diffDir = path.join(contextDir, "comparisons");
  const refStem = safeFileStem(path.basename(referencePath, path.extname(referencePath)));
  const candidateStem = safeFileStem(path.basename(candidatePath, path.extname(candidatePath)));
  return path.join(diffDir, `diff-${refStem}-vs-${candidateStem}-${safeFileStem(ts)}.png`);
}

export async function compareSmokeImages(referencePath, candidatePath, options = {}) {
  const sharp = (await import("sharp")).default;
  const referenceMeta = await sharp(referencePath).metadata();
  const candidateMeta = await sharp(candidatePath).metadata();
  if (referenceMeta.width === undefined || referenceMeta.height === undefined) {
    throw new Error(`[uos] smoke compare cannot read reference dimensions: ${referencePath}`);
  }
  if (candidateMeta.width === undefined || candidateMeta.height === undefined) {
    throw new Error(`[uos] smoke compare cannot read candidate dimensions: ${candidatePath}`);
  }

  const compareSize = boundedSmokeCompareSize(
    referenceMeta.width,
    referenceMeta.height,
    options.maxWidth,
    options.maxHeight,
  );
  const reference = await normalizedSmokeImageRaw(sharp, referencePath, compareSize.width, compareSize.height);
  const candidate = await normalizedSmokeImageRaw(sharp, candidatePath, compareSize.width, compareSize.height);
  const threshold = clampNumber(options.threshold, 0.05, 0, 1);

  let absoluteSum = 0;
  let squareSum = 0;
  let mismatchPixels = 0;
  let maxChannelDelta = 0;
  const pixelCount = compareSize.width * compareSize.height;
  const diff = Buffer.alloc(pixelCount * 4);

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const dr = Math.abs(reference[offset] - candidate[offset]);
    const dg = Math.abs(reference[offset + 1] - candidate[offset + 1]);
    const db = Math.abs(reference[offset + 2] - candidate[offset + 2]);
    absoluteSum += dr + dg + db;
    squareSum += dr * dr + dg * dg + db * db;
    maxChannelDelta = Math.max(maxChannelDelta, dr, dg, db);

    const pixelDelta = (dr + dg + db) / (3 * 255);
    if (pixelDelta > threshold) mismatchPixels++;
    const heat = Math.round(pixelDelta * 255);
    diff[offset] = heat;
    diff[offset + 1] = Math.max(0, 48 - Math.round(heat * 0.15));
    diff[offset + 2] = Math.max(0, 255 - heat);
    diff[offset + 3] = 255;
  }

  const outputPath = options.outputPath ?? resolveSmokeCompareOutputPath(undefined, process.cwd(), referencePath, candidatePath, new Date().toISOString());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const info = await sharp(diff, {
    raw: { width: compareSize.width, height: compareSize.height, channels: 4 },
  }).png().toFile(outputPath);

  return {
    referencePath,
    candidatePath,
    diffPath: outputPath,
    diffMimeType: "image/png",
    referenceWidth: referenceMeta.width,
    referenceHeight: referenceMeta.height,
    candidateWidth: candidateMeta.width,
    candidateHeight: candidateMeta.height,
    compareWidth: compareSize.width,
    compareHeight: compareSize.height,
    meanAbsoluteError: roundSmokeMetric(absoluteSum / (pixelCount * 3 * 255)),
    rootMeanSquareError: roundSmokeMetric(Math.sqrt(squareSum / (pixelCount * 3)) / 255),
    mismatchRatio: roundSmokeMetric(mismatchPixels / pixelCount),
    maxChannelDelta,
    aspectRatioDelta: roundSmokeMetric(Math.abs((referenceMeta.width / referenceMeta.height) - (candidateMeta.width / candidateMeta.height))),
    threshold,
    size: info.size,
  };
}

async function normalizedSmokeImageRaw(sharp, filePath, width, height) {
  return await sharp(filePath, { failOn: "warning" })
    .rotate()
    .ensureAlpha()
    .resize({ width, height, fit: "fill" })
    .raw()
    .toBuffer();
}

function boundedSmokeCompareSize(width, height, maxWidth, maxHeight) {
  const boundedMaxWidth = clampInt(maxWidth, 1024, 1, 4096);
  const boundedMaxHeight = clampInt(maxHeight, 1024, 1, 4096);
  const scale = Math.min(1, boundedMaxWidth / width, boundedMaxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function smokeComparisonResult(comparison, screenId) {
  const diffPath = stringValue(comparison?.diffPath);
  const verdict = stringValue(comparison?.verdict) ?? smokeComparisonVerdict(comparison);
  return {
    ok: true,
    ...comparison,
    screenId,
    verdict,
    uri: diffPath !== undefined ? pathToFileURL(diffPath).toString() : stringValue(comparison?.uri),
  };
}

function smokeVerificationResult(comparison, screenId, preview) {
  const normalizedComparison = smokeComparisonResult(comparison, screenId);
  const savedPath = stringValue(preview?.savedPath ?? preview?.path);
  return {
    ok: true,
    screenId,
    verdict: normalizedComparison.verdict,
    preview: {
      ok: true,
      screenId,
      savedPath,
      uri: stringValue(preview?.uri),
      mimeType: stringValue(preview?.mimeType),
      width: numberValue(preview?.width),
      height: numberValue(preview?.height),
      size: numberValue(preview?.size),
    },
    comparison: normalizedComparison,
  };
}

function smokeComparisonVerdict(comparison) {
  const meanAbsoluteError = numberValue(comparison?.meanAbsoluteError) ?? 1;
  const mismatchRatio = numberValue(comparison?.mismatchRatio) ?? 1;
  if (meanAbsoluteError <= 0.03 && mismatchRatio <= 0.1) return "close";
  if (meanAbsoluteError <= 0.12 && mismatchRatio <= 0.35) return "needs review";
  return "different";
}

function roundSmokeMetric(value) {
  return Number.parseFloat(value.toFixed(6));
}

function clampNumber(value, fallback, min, max) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function filePathFromUri(uri) {
  const raw = stringValue(uri);
  if (raw === undefined || !raw.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(raw);
  } catch {
    return undefined;
  }
}

function smokeJournalRecord(ts, tool, args, result, title) {
  return {
    ts,
    tool,
    sessionID: "uos-smoke",
    callID: `${tool}-${ts}`,
    args: sanitizeSmokeJournalValue(args),
    result: sanitizeSmokeJournalValue(result),
    title,
  };
}

export function sanitizeSmokeJournalValue(value, depth = 0) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") {
    if (/^data:[^;]+;base64,/i.test(value)) {
      return `[redacted dataUrl, ${value.length} chars]`;
    }
    if (value.length > 8_192) {
      return `[redacted long string, ${value.length} chars]`;
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (depth >= 8) return "[redacted nested value]";
  if (Array.isArray(value)) {
    const max = 200;
    const items = value.slice(0, max).map((item) => sanitizeSmokeJournalValue(item, depth + 1));
    if (value.length > max) items.push(`[truncated ${value.length - max} item(s)]`);
    return items;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (shouldRedactSmokeJournalField(key, item)) {
      const chars = typeof item === "string" ? `, ${item.length} chars` : "";
      result[key] = `[redacted ${key}${chars}]`;
      continue;
    }
    result[key] = sanitizeSmokeJournalValue(item, depth + 1);
  }
  return result;
}

function shouldRedactSmokeJournalField(key, value) {
  if (typeof value === "string" && value.startsWith("[redacted ")) return false;
  const folded = key.toLowerCase();
  return folded === "base64data"
    || folded === "base64"
    || folded.endsWith("base64")
    || folded === "dataurl"
    || folded.endsWith("dataurl")
    || folded === "bytes"
    || folded.endsWith("bytes")
    || (typeof value === "string" && /^data:[^;]+;base64,/i.test(value));
}

function extensionForMimeType(mimeType) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg": return ".jpg";
    case "image/webp": return ".webp";
    case "image/gif": return ".gif";
    case "image/bmp": return ".bmp";
    case "image/png":
    default:
      return ".png";
  }
}

function mimeForAttachmentPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".pdf": return "application/pdf";
    case ".pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt": return "text/plain";
    case ".md":
    case ".markdown": return "text/markdown";
    case ".csv": return "text/csv";
    case ".json": return "application/json";
    default: return "application/octet-stream";
  }
}

function safeFileStem(value) {
  const stem = String(value ?? "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return stem.length > 0 ? stem : "preview";
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function fileExists(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

async function directoryExists(dir) {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function assertDirectory(targetPath, flagName) {
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (err) {
    throw new Error(`[uos] ${flagName} directory not found: ${targetPath} (${errorMessage(err)})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`[uos] ${flagName} is not a directory: ${targetPath}`);
  }
}

async function assertFile(targetPath, flagName) {
  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (err) {
    throw new Error(`[uos] ${flagName} file not found: ${targetPath} (${errorMessage(err)})`);
  }
  if (!stat.isFile()) {
    throw new Error(`[uos] ${flagName} is not a regular file: ${targetPath}`);
  }
}

function resolveUnityProjectPath(value) {
  const trimmed = stringValue(value);
  if (trimmed === undefined) throw new Error("[uos] Unity project path is required");
  return path.resolve(trimmed);
}

async function assertUnityProjectRoot(projectPath) {
  let stat;
  try {
    stat = await fs.stat(projectPath);
  } catch (err) {
    throw new Error(`[uos] Unity project directory not found: ${projectPath} (${errorMessage(err)})`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`[uos] Unity project path is not a directory: ${projectPath}`);
  }
  const projectSettings = path.join(projectPath, "ProjectSettings");
  try {
    const settingsStat = await fs.stat(projectSettings);
    if (!settingsStat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`[uos] not a Unity project root: ${projectPath} (missing ProjectSettings/)`);
  }
}

function dependencyMap(manifest) {
  return manifest?.dependencies !== undefined
    && manifest.dependencies !== null
    && typeof manifest.dependencies === "object"
    && !Array.isArray(manifest.dependencies)
    ? manifest.dependencies
    : {};
}

function resolveUnityPackageSpecifier(value, repoRoot) {
  const trimmed = stringValue(value);
  if (trimmed === undefined) {
    return unityLocalPackageSpecifier(path.resolve(repoRoot, "Packages", UNITY_PACKAGE_NAME));
  }
  if (/^file:/i.test(trimmed)) return trimmed;
  if (isUnityPackageSpecifier(trimmed)) return trimmed;
  return unityLocalPackageSpecifier(path.resolve(trimmed));
}

function unityLocalPackageSpecifier(packagePath) {
  return `file:${path.resolve(packagePath).replace(/\\/g, "/")}`;
}

async function normalizeUnityPackagesLock({ lockPath, mode, packageSpecifier, packageInfo, dryRun }) {
  const exists = await fileExists(lockPath);
  if (!exists) {
    return { path: lockPath, exists: false, changed: false };
  }

  const current = await readJsonFile(lockPath, undefined);
  if (current === undefined || current === null || typeof current !== "object" || Array.isArray(current)) {
    return { path: lockPath, exists: true, changed: false, error: "packages-lock.json root is not a JSON object" };
  }

  const previousDependencies = dependencyMap(current);
  const nextDependencies = { ...previousDependencies };
  const previousEntry = nextDependencies[UNITY_PACKAGE_NAME];

  if (mode === "remove") {
    delete nextDependencies[UNITY_PACKAGE_NAME];
  } else if (mode === "embedded") {
    nextDependencies[UNITY_PACKAGE_NAME] = {
      version: `file:${UNITY_PACKAGE_NAME}`,
      depth: 0,
      source: "embedded",
      dependencies: packageInfo?.dependencies ?? {},
    };
  } else {
    nextDependencies[UNITY_PACKAGE_NAME] = {
      version: packageSpecifier,
      depth: 0,
      source: packageSpecifier !== undefined && /^file:/i.test(packageSpecifier) ? "local" : "registry",
      dependencies: {},
    };
  }

  const next = {
    ...current,
    dependencies: nextDependencies,
  };
  const changed = JSON.stringify(previousEntry ?? null) !== JSON.stringify(nextDependencies[UNITY_PACKAGE_NAME] ?? null);
  if (changed && dryRun !== true) {
    await writeJsonFile(lockPath, next);
  }
  return {
    path: lockPath,
    exists: true,
    changed,
    previousEntry,
    nextEntry: nextDependencies[UNITY_PACKAGE_NAME],
  };
}

function resolveEmbeddableUnityPackageSource(value, repoRoot) {
  const trimmed = stringValue(value);
  if (trimmed === undefined) {
    return path.resolve(repoRoot, "Packages", UNITY_PACKAGE_NAME);
  }
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return fileURLToPath(trimmed);
    } catch (err) {
      throw new Error(`[uos] --embed cannot parse local package file URL: ${trimmed} (${errorMessage(err)})`);
    }
  }
  if (/^file:/i.test(trimmed)) {
    return path.resolve(trimmed.slice("file:".length));
  }
  if (isUnityPackageSpecifier(trimmed)) {
    throw new Error("[uos] --embed requires a local package path or file:// URL; use --package without --embed for git/registry specifiers");
  }
  return path.resolve(trimmed);
}

async function embedUnityPackage({ sourcePath, targetPath, packagesDir, replace }) {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  const expectedTarget = path.resolve(packagesDir, UNITY_PACKAGE_NAME);
  if (target !== expectedTarget) {
    throw new Error(`[uos] refusing to embed package outside ${expectedTarget}: ${target}`);
  }
  const rel = path.relative(path.resolve(packagesDir), target);
  if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`[uos] refusing to embed package outside Packages/: ${target}`);
  }
  const sourceCheck = await inspectLocalUnityPackage(source);
  if (!sourceCheck.ok) {
    throw new Error(`[uos] cannot embed invalid Unity package: ${sourceCheck.error ?? source}`);
  }
  if (sameInstallPath(source, target)) return;
  if (replace) {
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true, force: true });
}

async function removeEmbeddedUnityPackage(targetPath, packagesDir) {
  const target = path.resolve(targetPath);
  const expectedTarget = path.resolve(packagesDir, UNITY_PACKAGE_NAME);
  if (target !== expectedTarget) {
    throw new Error(`[uos] refusing to remove package outside ${expectedTarget}: ${target}`);
  }
  const rel = path.relative(path.resolve(packagesDir), target);
  if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`[uos] refusing to remove package outside Packages/: ${target}`);
  }
  await fs.rm(target, { recursive: true, force: true });
}

function sameInstallPath(left, right) {
  if (left === undefined || right === undefined) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function localPackagePathFromSpecifier(specifier, projectPath) {
  const value = stringValue(specifier);
  if (value === undefined) return undefined;
  if (/^file:\/\//i.test(value)) {
    try {
      return fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  if (/^file:/i.test(value)) {
    return path.resolve(projectPath, value.slice("file:".length));
  }
  if (path.isAbsolute(value)) return value;
  if (
    value.startsWith(".")
    || value.includes("/")
    || value.includes("\\")
  ) {
    return path.resolve(projectPath, value);
  }
  return undefined;
}

async function inspectLocalUnityPackage(packagePath) {
  const resolved = path.resolve(packagePath);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return { ok: false, path: resolved, error: "local package path is not a directory" };
    }
  } catch (err) {
    return { ok: false, path: resolved, error: `local package directory not found (${errorMessage(err)})` };
  }

  const packageJsonPath = path.join(resolved, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  } catch (err) {
    return { ok: false, path: resolved, packageJsonPath, error: `cannot read package.json (${errorMessage(err)})` };
  }
  if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) {
    return { ok: false, path: resolved, packageJsonPath, error: "package.json root must be an object" };
  }

  const dependencies = dependencyMap(pkg);
  const uguiDependency = typeof dependencies[UNITY_UGUI_PACKAGE_NAME] === "string"
    ? dependencies[UNITY_UGUI_PACKAGE_NAME]
    : undefined;
  const name = stringValue(pkg.name);
  const problems = [];
  if (name !== UNITY_PACKAGE_NAME) {
    problems.push(`package name is ${name ?? "(missing)"}, expected ${UNITY_PACKAGE_NAME}`);
  }
  if (uguiDependency === undefined) {
    problems.push(`${UNITY_UGUI_PACKAGE_NAME} dependency is missing`);
  }

  return {
    ok: problems.length === 0,
    path: resolved,
    packageJsonPath,
    name,
    displayName: stringValue(pkg.displayName),
    version: stringValue(pkg.version),
    dependencies,
    uguiDependency,
    error: problems.length > 0 ? problems.join("; ") : undefined,
  };
}

function isUnityPackageSpecifier(value) {
  return /^file:/i.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    || value.startsWith("git+")
    || /^[a-z0-9][a-z0-9._-]+\.[a-z0-9][a-z0-9._-]+/.test(value);
}

async function readUnityManifest(manifestPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("manifest root must be a JSON object");
    }
    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { dependencies: {} };
    }
    throw new Error(`[uos] cannot read Unity package manifest: ${manifestPath} (${errorMessage(err)})`);
  }
}

function commandVersion(command, args, options = {}) {
  const result = runCommand(command, args, options);
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const version = firstLine(stdout) ?? firstLine(stderr);
  if (result.status === 0 && result.error === undefined) return { ok: true, version };
  return { ok: false, error: result.error ?? `exit ${result.status ?? "unknown"}` };
}

function detectPowerPoint(options = {}) {
  if ((options.platform ?? process.platform) !== "win32") {
    return { ok: false, error: "PowerPoint renderer is Windows-only" };
  }
  const registryPath = detectPowerPointFromRegistry(options);
  if (registryPath !== undefined) return { ok: true, version: registryPath };

  const env = options.env ?? process.env;
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
  ].filter((value) => typeof value === "string" && value.length > 0);
  const suffixes = [
    ["Microsoft Office", "root", "Office16", "POWERPNT.EXE"],
    ["Microsoft Office", "Office16", "POWERPNT.EXE"],
    ["Microsoft Office", "Office15", "POWERPNT.EXE"],
    ["Microsoft Office", "Office14", "POWERPNT.EXE"],
  ];
  for (const root of roots) {
    for (const suffix of suffixes) {
      const candidate = path.join(root, ...suffix);
      if (existsSync(candidate)) return { ok: true, version: candidate };
    }
  }
  return { ok: false, error: "POWERPNT.EXE not found" };
}

function detectPowerPointFromRegistry(options = {}) {
  const keys = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\POWERPNT.EXE",
  ];
  for (const key of keys) {
    const result = runCommand(
      "reg.exe",
      ["query", key, "/ve"],
      { ...options, timeoutMs: positiveInt(options.powerPointTimeoutMs) ?? 5_000 },
    );
    if (result.status !== 0 || result.error !== undefined) continue;
    const found = parseRegDefaultString(result.stdout);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseRegDefaultString(output) {
  const lines = String(output ?? "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/\s+(?:\(Default\)|\(기본값\)|\(기본\)|\(默认\))\s+REG_\w+\s+(.+)\s*$/i)
      ?? line.match(/\s+REG_\w+\s+(.+POWERPNT\.EXE)\s*$/i);
    const value = match?.[1]?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

function isPptxRendererCommand(name) {
  return name === "soffice" || name === "PowerPoint";
}

function hasPptxRenderer(commands) {
  return commands.some((item) => isPptxRendererCommand(item.name) && item.result?.ok === true);
}

function formatMaterialCapabilityLines(commands = []) {
  const pptxRenderers = commands
    .filter((item) => isPptxRendererCommand(item.name) && item.result?.ok === true)
    .map((item) => item.name);
  const lines = [
    "  [ok] images: attached directly for model vision; large images are downscaled",
    "  [ok] PDF pages: built-in pdf-parse renderer",
    "  [ok] documents: built-in text extraction for TXT/MD/CSV/JSON/PDF/DOCX/PPTX",
    "  [ok] DOCX/PPTX embedded images: built-in Open XML extractor",
    "  [ok] PPTX editable layout: built-in Open XML extractor",
  ];
  if (pptxRenderers.length > 0) {
    lines.push(`  [ok] PPTX rendered slides: ${pptxRenderers.join(", ")}`);
  } else {
    lines.push("  [fallback] PPTX rendered slides: no LibreOffice/PowerPoint; text/layout extraction still works");
  }
  return lines;
}

function formatBridgeCapabilityLines(capabilities) {
  const entries = capabilities?.entries ?? [];
  if (entries.length === 0) {
    return ["  [skipped] no live or explicit Unity bridge target to probe"];
  }

  const requiredCount = capabilities.required?.length ?? REQUIRED_UNITY_BRIDGE_TOOLS.length;
  const requiredWriteCount = capabilities.requiredWriteTools?.length ?? REQUIRED_UNITY_WRITE_TOOLS.length;
  const lines = [];
  for (const entry of entries) {
    const name = bridgeCapabilityLabel(entry);
    if (entry.ok !== true) {
      lines.push(`  [problem] ${name}: ${entry.error ?? "capability probe failed"}`);
      continue;
    }

    if (entry.supportedTools === undefined) {
      lines.push(`  [unknown] ${name}: supportedTools not reported`);
    } else {
      const missing = entry.missingTools ?? [];
      lines.push(`  [${missing.length === 0 ? "ok" : "missing"}] ${name}: ${entry.supportedTools.length}/${requiredCount} required bridge tool(s) reported`);
      if (missing.length > 0) lines.push(`    missing: ${missing.join(", ")}`);
    }

    if (entry.writeTools === undefined) {
      lines.push("    [unknown] writeTools not reported");
    } else {
      const missingWrite = entry.missingWriteTools ?? [];
      lines.push(`    [${missingWrite.length === 0 ? "ok" : "missing"}] writeTools: ${entry.writeTools.length}/${requiredWriteCount} required write tool(s) reported`);
      if (missingWrite.length > 0) lines.push(`      missing: ${missingWrite.join(", ")}`);
    }
  }
  return lines;
}

function formatOpencodeCliCapabilityLines(cli) {
  if (cli === undefined) {
    return ["  [skipped] opencode CLI capability probe was not run"];
  }
  const lines = [
    `  [${cli.runHelpOk ? "ok" : "missing"}] opencode run --help`,
    `  [${cli.runFile ? "ok" : "missing"}] opencode run --file attachment handoff`,
    `  [${cli.runAgent ? "ok" : "missing"}] opencode run --agent selection`,
    `  [${cli.topHelpOk ? "ok" : "missing"}] opencode --help`,
    `  [${cli.tuiAgent ? "ok" : "missing"}] opencode TUI --agent selection`,
    `  [${cli.tuiPrompt ? "ok" : "missing"}] opencode TUI --prompt startup context`,
  ];
  for (const error of cli.errors ?? []) {
    lines.push(`    ${error}`);
  }
  return lines;
}

function runCommand(command, args, options = {}) {
  const runner = options.commandRunner ?? defaultCommandRunner;
  try {
    const result = runner(command, args, options);
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error !== undefined ? errorMessage(result.error) : undefined,
    };
  } catch (err) {
    return { status: undefined, stdout: "", stderr: "", error: errorMessage(err) };
  }
}

function defaultCommandRunner(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: options.shell ?? (process.platform === "win32"),
    windowsHide: true,
    timeout: positiveInt(options.timeoutMs) ?? 5_000,
    cwd: options.cwd,
    env: options.env,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

function firstLine(text) {
  const line = text.split(/\r?\n/).map((part) => part.trim()).find((part) => part.length > 0);
  return line === undefined || line.length === 0 ? undefined : line;
}

function parseJsonFromCommandOutput(output) {
  const raw = String(output ?? "").trim();
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // Keep scanning in case a tool printed progress before JSON metadata.
      }
    }
    return undefined;
  }
}

function compactObject(value) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = item;
  }
  return result;
}

async function listToolEntrypoints(toolDir) {
  let names;
  try {
    names = await fs.readdir(toolDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".ts") && !name.startsWith("_"))
    .map((name) => path.basename(name, ".ts"))
    .sort((a, b) => a.localeCompare(b));
}

async function listLocalPluginEntrypoints(pluginDir) {
  let names;
  try {
    names = await fs.readdir(pluginDir);
  } catch {
    return [];
  }
  return await Promise.all(names
    .filter((name) => /\.(?:ts|js|mjs)$/.test(name) && !name.startsWith("_"))
    .sort((a, b) => a.localeCompare(b))
    .map(async (name) => {
      const file = path.join(pluginDir, name);
      return {
        name: path.basename(name, path.extname(name)),
        path: file,
        ok: await fileExists(file),
      };
    }));
}

function resolvePluginPath(value, repoRoot) {
  if (value.startsWith("file://./")) {
    return path.resolve(repoRoot, value.slice("file://./".length));
  }
  if (value.startsWith("file:./")) {
    return path.resolve(repoRoot, value.slice("file:./".length));
  }
  if (value.startsWith("file:///")) {
    try {
      return fileURLToPath(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function samePath(a, b) {
  return normalizeComparablePath(a) === normalizeComparablePath(b);
}

function parseJsonFromOutput(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function duplicatePluginEntries(plugins, repoRoot) {
  const groups = new Map();
  for (const value of plugins) {
    const key = canonicalPluginKey(value, repoRoot);
    const list = groups.get(key) ?? [];
    list.push(value);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([key, values]) => ({ key, values }));
}

function canonicalPluginKey(value, repoRoot) {
  const resolved = resolvePluginPath(value, repoRoot);
  if (resolved !== undefined) return normalizeComparablePath(resolved);
  return String(value).trim().toLowerCase();
}

function formatEnvValue(key, value) {
  if (value === undefined || value === "") return "(unset)";
  if (key.toUpperCase().includes("TOKEN")) return "(set)";
  return value;
}

function hasExplicitBridgeEnv(env = {}) {
  return Boolean(env.UNITY_MCP_HOST && env.UNITY_MCP_PORT && env.UNITY_MCP_TOKEN);
}

async function writeJsonFile(file, value) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

function smokeRect(value) {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return { x, y, w, h };
}

function smokeProps(value) {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const props = {};
  for (const key of ["text", "placeholder", "inputText", "color", "fontStyle", "sprite", "align"]) {
    if (typeof value[key] === "string") props[key] = value[key];
  }
  for (const key of ["fontSize", "value", "minValue", "maxValue"]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) props[key] = value[key];
  }
  for (const key of ["isOn", "interactable"]) {
    if (typeof value[key] === "boolean") props[key] = value[key];
  }
  if (Array.isArray(value.options)) {
    const options = value.options.filter((item) => typeof item === "string");
    if (options.length > 0) props.options = options;
  }
  return Object.keys(props).length > 0 ? props : undefined;
}

function smokeReferenceAssetPaths(meta) {
  const paths = [
    stringValue(meta?.importedAsset?.assetPath),
    ...(Array.isArray(meta?.importedAssets)
      ? meta.importedAssets.map((asset) => stringValue(asset?.assetPath))
      : []),
  ].filter((item) => item !== undefined);
  const unique = [...new Set(paths)];
  return unique.length > 0 ? unique : undefined;
}

function smokeScreenSource(value) {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const source = {
    tool: stringValue(value.tool),
    kind: stringValue(value.kind),
    mode: stringValue(value.mode),
    path: stringValue(value.path),
    pageNumber: numberValue(value.pageNumber),
    slideNumber: numberValue(value.slideNumber),
    imageNumber: numberValue(value.imageNumber),
    packagePath: stringValue(value.packagePath),
    renderedPath: stringValue(value.renderedPath),
    extractedPath: stringValue(value.extractedPath),
    assetPaths: Array.isArray(value.assetPaths)
      ? value.assetPaths.filter((item) => typeof item === "string" && item.length > 0)
      : undefined,
    ts: stringValue(value.ts),
  };
  if (
    source.tool === undefined
    && source.kind === undefined
    && source.path === undefined
    && source.pageNumber === undefined
    && source.slideNumber === undefined
    && source.imageNumber === undefined
    && source.packagePath === undefined
    && source.renderedPath === undefined
    && source.extractedPath === undefined
    && source.assetPaths === undefined
  ) {
    return undefined;
  }
  return source;
}

function summarizeContextScreens(index, maxScreens, maxElements) {
  const raw = index?.screens;
  if (raw === undefined || raw === null || typeof raw !== "object") {
    return { count: 0, lines: [] };
  }
  const screens = Object.values(raw)
    .filter((screen) => screen !== null && typeof screen === "object")
    .sort((a, b) => latestContextScreenTime(b).localeCompare(latestContextScreenTime(a)));
  const lines = [];
  for (const screen of screens.slice(0, maxScreens)) {
    const elements = screen.elements !== undefined && typeof screen.elements === "object"
      ? Object.values(screen.elements)
      : [];
    const active = elements.filter((element) => element?.deleted !== true);
    const previews = sortedContextArray(screen.previews);
    const comparisons = sortedContextArray(screen.comparisons);
    const screenName = typeof screen.screenName === "string" ? ` (${screen.screenName})` : "";
    const activeText = screen.active === true || screen.screenId === index?.activeScreenId ? ", active" : "";
    const previewText = previews.length > 0 ? `, previews=${previews.length}` : "";
    const comparisonText = comparisons.length > 0 ? `, comparisons=${comparisons.length}` : "";
    lines.push(`  - ${screen.screenId ?? "(unknown)"}${screenName}: elements=${active.length}${activeText}${previewText}${comparisonText}`);
    const source = formatContextSource(screen.source);
    if (source !== undefined) {
      lines.push(`      source: ${source}`);
      lines.push(`      selector: ${formatContextSourceSelectorHint(screen)}`);
    }
    const preview = formatContextPreview(previews[0]);
    if (preview !== undefined) lines.push(`      preview: ${preview}`);
    const comparison = formatContextComparison(comparisons[0]);
    if (comparison !== undefined) lines.push(`      comparison: ${comparison}`);
    for (const element of active.slice(0, maxElements)) {
      lines.push(`      * ${formatContextElement(element)}`);
    }
    if (active.length > maxElements) {
      lines.push(`      ... ${active.length - maxElements} more element(s)`);
    }
  }
  if (screens.length > maxScreens) {
    lines.push(`  ... ${screens.length - maxScreens} more screen(s)`);
  }
  return { count: screens.length, lines };
}

function sortedContextArray(value) {
  if (!Array.isArray(value)) return [];
  return [...value]
    .filter((item) => item !== null && typeof item === "object")
    .sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? "")));
}

function latestContextScreenTime(screen) {
  return [
    stringValue(screen?.updatedAt),
    sortedContextArray(screen?.previews)[0]?.ts,
    sortedContextArray(screen?.comparisons)[0]?.ts,
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.localeCompare(a))[0] ?? "";
}

function summarizeContextLatestVerification(index) {
  const item = latestContextScreenRecord(index, "comparisons");
  if (item === undefined) return undefined;
  const comparison = formatContextComparison(item.record);
  const screenText = contextScreenLabel(item.screen);
  return [
    screenText !== undefined ? `screen=${screenText}` : undefined,
    comparison,
  ].filter((part) => part !== undefined && String(part).length > 0).join(" ");
}

function summarizeContextLatestPreview(index) {
  const item = latestContextScreenRecord(index, "previews");
  if (item === undefined) return undefined;
  const preview = formatContextPreview(item.record);
  const screenText = contextScreenLabel(item.screen);
  return [
    screenText !== undefined ? `screen=${screenText}` : undefined,
    preview,
  ].filter((part) => part !== undefined && String(part).length > 0).join(" ");
}

function latestContextScreenRecord(index, key) {
  const raw = index?.screens;
  if (raw === undefined || raw === null || typeof raw !== "object") return undefined;
  const candidates = [];
  for (const screen of Object.values(raw)) {
    if (screen === null || typeof screen !== "object") continue;
    for (const record of sortedContextArray(screen[key])) {
      candidates.push({ screen, record, ts: stringValue(record.ts) ?? "" });
    }
  }
  candidates.sort((a, b) => b.ts.localeCompare(a.ts));
  return candidates[0];
}

function contextScreenLabel(screen) {
  const screenId = stringValue(screen?.screenId);
  if (screenId === undefined) return undefined;
  const name = stringValue(screen?.screenName);
  return name !== undefined ? `${screenId} (${name})` : screenId;
}

function formatContextSource(source) {
  if (source === undefined || source === null || typeof source !== "object") return undefined;
  const assetPaths = Array.isArray(source.assetPaths)
    ? source.assetPaths.filter((item) => typeof item === "string" && item.length > 0).slice(0, 6)
    : [];
  const parts = [
    stringValue(source.kind) ?? stringValue(source.tool),
    stringValue(source.path),
    typeof source.pageNumber === "number" ? `page=${source.pageNumber}` : undefined,
    typeof source.slideNumber === "number" ? `slide=${source.slideNumber}` : undefined,
    typeof source.imageNumber === "number" ? `image=${source.imageNumber}` : undefined,
    stringValue(source.packagePath) !== undefined ? `package=${source.packagePath}` : undefined,
    stringValue(source.renderedPath) !== undefined ? `rendered=${source.renderedPath}` : undefined,
    stringValue(source.extractedPath) !== undefined ? `extracted=${source.extractedPath}` : undefined,
    assetPaths.length > 0 ? `assets=${assetPaths.join(",")}` : undefined,
  ].filter((part) => part !== undefined && String(part).length > 0);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function formatContextSourceSelectorHint(screen) {
  const source = screen?.source;
  if (source === undefined || source === null || typeof source !== "object") {
    return `screenId=${quoteContextValue(String(screen?.screenId ?? ""))}`;
  }
  const sourcePath = stringValue(source.path);
  const sourceFile = sourcePath !== undefined ? path.basename(sourcePath) : undefined;
  const queryParts = [
    sourceFile !== undefined ? sourceFile.replace(/\.[^.]+$/, "") : undefined,
    typeof source.pageNumber === "number" ? `page ${source.pageNumber}` : undefined,
    typeof source.slideNumber === "number" ? `slide ${source.slideNumber}` : undefined,
    typeof source.imageNumber === "number" ? `image ${source.imageNumber}` : undefined,
    sourceFile === undefined ? stringValue(screen?.screenName) : undefined,
  ].filter((part) => typeof part === "string" && part.length > 0);
  const screenQuery = queryParts.length > 0
    ? queryParts.join(" ")
    : (stringValue(screen?.screenName) ?? stringValue(screen?.screenId) ?? "");
  const parts = [
    `screenQuery=${quoteContextValue(screenQuery)}`,
    stringValue(source.kind) !== undefined ? `sourceKind=${quoteContextValue(stringValue(source.kind))}` : undefined,
    sourceFile !== undefined ? `sourcePathContains=${quoteContextValue(sourceFile)}` : undefined,
    typeof source.pageNumber === "number" ? `pageNumber=${source.pageNumber}` : undefined,
    typeof source.slideNumber === "number" ? `slideNumber=${source.slideNumber}` : undefined,
    typeof source.imageNumber === "number" ? `imageNumber=${source.imageNumber}` : undefined,
    "latest=true",
  ].filter((part) => part !== undefined);
  return parts.join(" ");
}

function formatContextPreview(preview) {
  if (preview === undefined || preview === null || typeof preview !== "object") return undefined;
  const location = stringValue(preview.savedPath) ?? stringValue(preview.uri);
  if (location === undefined) return undefined;
  const width = numberValue(preview.width);
  const height = numberValue(preview.height);
  const dims = width !== undefined && height !== undefined ? `${width}x${height}` : undefined;
  const parts = [
    location,
    stringValue(preview.mimeType),
    dims,
    stringValue(preview.ts) !== undefined ? `ts=${preview.ts}` : undefined,
  ].filter((part) => part !== undefined && String(part).length > 0);
  return parts.join(" ");
}

function formatContextComparison(comparison) {
  if (comparison === undefined || comparison === null || typeof comparison !== "object") return undefined;
  const parts = [
    stringValue(comparison.verdict) !== undefined ? `verdict=${comparison.verdict}` : undefined,
    metricText("mae", comparison.meanAbsoluteError),
    metricText("rmse", comparison.rootMeanSquareError),
    metricText("mismatch", comparison.mismatchRatio),
    numberValue(comparison.maxChannelDelta) !== undefined ? `maxDelta=${comparison.maxChannelDelta}` : undefined,
    metricText("aspectDelta", comparison.aspectRatioDelta),
    metricText("threshold", comparison.threshold),
    stringValue(comparison.referencePath) !== undefined ? `reference=${comparison.referencePath}` : undefined,
    stringValue(comparison.candidatePath) !== undefined ? `candidate=${comparison.candidatePath}` : undefined,
    stringValue(comparison.diffPath) !== undefined ? `diff=${comparison.diffPath}` : undefined,
    stringValue(comparison.diffPath) === undefined && stringValue(comparison.diffUri) !== undefined
      ? `diff=${comparison.diffUri}`
      : undefined,
    stringValue(comparison.ts) !== undefined ? `ts=${comparison.ts}` : undefined,
  ].filter((part) => part !== undefined && String(part).length > 0);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function metricText(label, value) {
  const n = numberValue(value);
  return n !== undefined ? `${label}=${n}` : undefined;
}

function vecText(value) {
  const x = numberValue(value?.x);
  const y = numberValue(value?.y);
  const z = numberValue(value?.z);
  return x !== undefined && y !== undefined && z !== undefined ? `(${x},${y},${z})` : undefined;
}

function summarizeContextAssets(index, maxAssets) {
  const assets = Array.isArray(index?.importedAssets) ? index.importedAssets : [];
  const lines = assets.slice(-maxAssets).map((asset) => {
    const sprite = asset?.importedAsSprite === true ? " sprite" : "";
    return `  - ${asset?.assetPath ?? "(unknown)"}${sprite}`;
  });
  if (assets.length > maxAssets) {
    lines.unshift(`  ... ${assets.length - maxAssets} older asset(s)`);
  }
  return { count: assets.length, lines };
}

function formatContextElement(element) {
  const parts = [
    element?.elementId ?? "(unknown)",
    typeof element?.type === "string" ? `type=${element.type}` : undefined,
    typeof element?.clientHintId === "string" ? `hint=${element.clientHintId}` : undefined,
    typeof element?.parentElementId === "string" ? `parent=${element.parentElementId}` : undefined,
    formatContextRect(element?.rect),
    formatContextProps(element?.props),
  ].filter((part) => part !== undefined);
  return parts.join(" ");
}

function formatContextRect(rect) {
  if (rect === undefined || rect === null || typeof rect !== "object") return undefined;
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return `rect=${x},${y},${w},${h}`;
}

function formatContextProps(props) {
  if (props === undefined || props === null || typeof props !== "object") return undefined;
  const parts = [
    typeof props.text === "string" ? `text="${truncateText(props.text, 48)}"` : undefined,
    typeof props.placeholder === "string" ? `placeholder="${truncateText(props.placeholder, 48)}"` : undefined,
    typeof props.inputText === "string" ? `inputText="${truncateText(props.inputText, 48)}"` : undefined,
    typeof props.sprite === "string" ? `sprite=${props.sprite}` : undefined,
    typeof props.color === "string" ? `color=${props.color}` : undefined,
    typeof props.fontSize === "number" ? `fontSize=${props.fontSize}` : undefined,
    typeof props.fontStyle === "string" ? `fontStyle=${props.fontStyle}` : undefined,
    typeof props.value === "number" ? `value=${props.value}` : undefined,
    typeof props.minValue === "number" ? `min=${props.minValue}` : undefined,
    typeof props.maxValue === "number" ? `max=${props.maxValue}` : undefined,
    typeof props.isOn === "boolean" ? `isOn=${props.isOn}` : undefined,
    typeof props.interactable === "boolean" ? `interactable=${props.interactable}` : undefined,
    Array.isArray(props.options) && props.options.length > 0
      ? `options=${props.options.slice(0, 5).map((option) => quoteContextValue(truncateText(option, 24))).join("|")}${props.options.length > 5 ? `+${props.options.length - 5}` : ""}`
      : undefined,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? `props(${parts.join(", ")})` : undefined;
}

function quoteContextValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function truncateText(value, maxChars) {
  const text = String(value);
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function positiveInt(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function parseBoundedInt(value, name, min, max) {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`[uos] ${name} requires an integer from ${min} to ${max}`);
  }
  return n;
}

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  const chosen = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(max, Math.max(min, chosen));
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

export function label(entry) {
  const project = entry.projectName || path.basename(entry.projectPath ?? "") || "(unknown project)";
  const location = entry.projectPath ? ` - ${entry.projectPath}` : "";
  const unity = entry.unityVersion ? `, Unity ${entry.unityVersion}` : "";
  const uos = entry.uosPackageVersion ? `, UOS ${entry.uosPackageVersion}` : "";
  const protocol = entry.protocolVersion ? `, protocol ${entry.protocolVersion}` : "";
  return `${project}${location} (${entry.host}:${entry.port}${unity}${uos}${protocol})`;
}

export function formatEditorList(editors) {
  if (editors.length === 0) {
    return "[uos] no live Unity Editor bridge found.";
  }
  return [
    "[uos] connected Unity projects:",
    ...editors.map((entry, index) => {
      const id = entry.instanceId ? ` id=${entry.instanceId}` : "";
      return `  ${index + 1}. ${label(entry)}${id}`;
    }),
  ].join("\n");
}

export function formatEditorJson(editors) {
  return JSON.stringify({
    count: editors.length,
    editors: editors.map((entry, index) => ({
      index: index + 1,
      instanceId: stringValue(entry.instanceId),
      projectName: stringValue(entry.projectName),
      projectPath: stringValue(entry.projectPath),
      host: stringValue(entry.host),
      port: numberValue(entry.port),
      unityVersion: stringValue(entry.unityVersion),
      uosPackageName: stringValue(entry.uosPackageName),
      uosPackageVersion: stringValue(entry.uosPackageVersion),
      protocolVersion: stringValue(entry.protocolVersion),
      autoStartBridge: typeof entry.autoStartBridge === "boolean" ? entry.autoStartBridge : undefined,
      uosGuiSessionId: stringValue(entry.uosGuiSessionId),
      selectors: selectorValues(entry),
    })),
  }, null, 2);
}

function selectorValues(entry) {
  return [
    entry.instanceId,
    entry.projectName,
    entry.projectPath,
    normalizeComparablePath(entry.projectPath),
  ].filter((value) => typeof value === "string" && value.length > 0);
}

function publicEditorTarget(entry) {
  return {
    instanceId: stringValue(entry.instanceId),
    projectName: stringValue(entry.projectName),
    projectPath: stringValue(entry.projectPath),
    host: stringValue(entry.host),
    port: numberValue(entry.port),
    unityVersion: stringValue(entry.unityVersion),
    uosPackageName: stringValue(entry.uosPackageName),
    uosPackageVersion: stringValue(entry.uosPackageVersion),
    protocolVersion: stringValue(entry.protocolVersion),
    autoStartBridge: typeof entry.autoStartBridge === "boolean" ? entry.autoStartBridge : undefined,
    uosGuiSessionId: stringValue(entry.uosGuiSessionId),
  };
}

function bridgeCapabilityProbeTargets(registry, env) {
  const targets = [];
  const seen = new Set();
  for (const record of registry?.entries ?? []) {
    if (record?.status !== "live" || record.entry === undefined) continue;
    addBridgeCapabilityTarget(targets, seen, {
      source: "registry",
      fileName: record.fileName,
      target: record.entry,
    });
  }

  if (hasExplicitBridgeEnv(env) && selectorFromEnv(env) === undefined) {
    const explicit = explicitBridgeTargetFromEnv(env);
    if (explicit !== undefined) {
      addBridgeCapabilityTarget(targets, seen, {
        source: "explicit-env",
        target: explicit,
      });
    }
  }
  return targets;
}

function addBridgeCapabilityTarget(targets, seen, record) {
  const key = bridgeTargetKey(record.target);
  if (key === undefined || seen.has(key)) return;
  seen.add(key);
  targets.push(record);
}

function bridgeTargetKey(target) {
  const host = stringValue(target?.host);
  const port = numberValue(target?.port);
  const token = typeof target?.token === "string" ? target.token : "";
  return host !== undefined && port !== undefined ? `${host}:${port}:${token}` : undefined;
}

function explicitBridgeTargetFromEnv(env = {}) {
  const host = stringValue(env.UNITY_MCP_HOST);
  const token = stringValue(env.UNITY_MCP_TOKEN);
  const port = Number.parseInt(env.UNITY_MCP_PORT ?? "", 10);
  if (host === undefined || token === undefined || !Number.isInteger(port) || port <= 0) {
    return undefined;
  }
  return {
    host,
    port,
    token,
    projectName: stringValue(env.UOS_PROJECT_NAME),
    projectPath: stringValue(env.UOS_PROJECT_DIR),
    instanceId: stringValue(env.UOS_EDITOR_INSTANCE_ID),
  };
}

function publicBridgeProjectInfo(info) {
  if (info === undefined || info === null || typeof info !== "object") return undefined;
  return {
    projectName: stringValue(info.projectName),
    projectPath: stringValue(info.projectPath),
    unityVersion: stringValue(info.unityVersion),
    uosPackageName: stringValue(info.uosPackageName),
    uosPackageVersion: stringValue(info.uosPackageVersion),
    protocolVersion: stringValue(info.protocolVersion),
    bridgeHost: stringValue(info.bridgeHost),
    bridgePort: numberValue(info.bridgePort),
    autoStartBridge: typeof info.autoStartBridge === "boolean" ? info.autoStartBridge : undefined,
    editorInstanceId: stringValue(info.editorInstanceId),
  };
}

function normalizeToolNames(value) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value
    .map((item) => stringValue(item))
    .filter((item) => item !== undefined))]
    .sort((a, b) => a.localeCompare(b));
}

function missingTools(required, available) {
  const availableSet = new Set(available);
  return required.filter((name) => !availableSet.has(name));
}

function equalsSelector(value, selector) {
  return value.toLowerCase() === selector.toLowerCase()
    || normalizeComparablePath(value) === normalizeComparablePath(selector);
}

function majorOf(version) {
  return String(version).split(".")[0] || String(version);
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeFileList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => stringValue(item))
      .filter((item) => item !== undefined);
  }
  const file = stringValue(value);
  return file !== undefined ? [file] : [];
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeComparablePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) return "";
  return path.normalize(value.trim()).replace(/[\\/]+$/, "").toLowerCase();
}

function ambiguousSelector(selector, entries) {
  const choices = entries
    .map((entry) => `\n  - ${label(entry)}${selectionCommandHint(entry)}`)
    .join("");
  return new Error(`[uos] project selector "${selector}" is ambiguous:${choices}`);
}

function multipleEditorsNonInteractive(editors) {
  const choices = editors
    .map((entry, index) => {
      const id = entry.instanceId ? ` id=${entry.instanceId}` : "";
      return `\n  ${index + 1}. ${label(entry)}${id}${selectionCommandHint(entry, index)}`;
    })
    .join("");
  return new Error(
    `[uos] multiple Unity Editor bridges are live, but stdin is not interactive.${choices}\n` +
      "[uos] pass --unity-project <index|id|name|path> for non-interactive runs.",
  );
}
