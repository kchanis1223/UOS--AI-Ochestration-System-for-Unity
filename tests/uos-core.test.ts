import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { summarizeHierarchy } from "../.opencode/tools/get_scene_hierarchy.ts";
import { normalizeScreens } from "../.opencode/tools/list_screens.ts";
import {
  buildEntryDryRun,
  buildLaunchEnv,
  buildContextReport,
  buildForwardArgs,
  buildTargetEnv,
  cleanupRunContextAttachment,
  evaluateLaunchBridgeCapabilities,
  evaluateReadiness,
  formatLaunchBridgeCapabilityFailure,
  formatLaunchDryRun,
  formatLaunchSummary,
  formatE2EResult,
  formatMvpValidationJson,
  formatMvpValidationReport,
  formatMvpProgressJson,
  formatMvpProgressReport,
  formatReadyReport,
  callUnityTool,
  cleanStaleRegistryEntries,
  collectDoctorReport,
  discoverLiveEditors,
  discoverUnityProjectCatalog,
  formatDoctorReport,
  formatEditorJson,
  formatEditorList,
  formatUnityProjectCatalog,
  formatInstallUnityPackageResult,
  formatContextJson,
  formatContextReport,
  formatRunContextAttachment,
  inspectUnityProjectInstall,
  inspectEditorRegistry,
  inspectOpencodeCliCapabilities,
  inspectOpencodeResources,
  formatSmokeResult,
  formatUosHelp,
  formatWaitResult,
  installUnityPackage,
  loadUosContextSummary,
  inspectOpencodeRuntime,
  parseDoctorOptions,
  parseE2EOptions,
  parseInstallUnityOptions,
  parseMvpOptions,
  parseMvpProgressOptions,
  normalizeUosEntryArgs,
  parseContextOptions,
  parseProjectsOptions,
  parseReadyOptions,
  parseUosArgs,
  parseSmokeOptions,
  parseUosHelpTopic,
  parseWaitOptions,
  prepareRunContextAttachment,
  registryDir,
  readUnityProjectVersion,
  resolveUnityExecutable,
  runMaterialScreenTool,
  runUnityE2E,
  buildMvpValidationReport,
  runUnitySmoke,
  saveMvpValidationReport,
  resolveLaunchMaterialsDir,
  resolveLaunchFilePath,
  resolveLaunchInputs,
  resolveSmokeImportPath,
  resolveSmokeComparePath,
  resolveSmokeMaterialsDir,
  compareSmokeImages,
  runPptxDeckScreenTool,
  sanitizeSmokeJournalValue,
  selectUnityTarget,
  selectSmokeMaterial,
  selectSmokeMaterialImage,
  selectUnityProjectCatalogEntry,
  selectEditorBySelector,
  selectorFromEnv,
  shouldSelectUnityContextTarget,
  shouldPrepareLaunchContext,
  shouldPrepareRunContextAttachment,
  shouldPrintLaunchSummary,
  shouldSelectUnityTarget,
  smokePptxDeckScreenArgs,
  smokePlanningIntent,
  TOOL_CALL_TIMEOUT_MS,
  uninstallUnityPackage,
  validateLaunchInputs,
  waitForUnityTarget,
} from "../bin/uos-core.js";

function unityFileSpecifier(packagePath: string): string {
  return `file:${resolve(packagePath).replace(/\\/g, "/")}`;
}

function csharpStringArray(source: string, name: string): string[] {
  const pattern = new RegExp(`(?:string\\[\\]\\s+${name}|HashSet<string>\\s+${name})[^{]*\\{([\\s\\S]*?)\\};`);
  const match = source.match(pattern);
  if (match === null) throw new Error(`missing C# array ${name}`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g), (item) => item[1]);
}

let server: ReturnType<typeof Bun.serve> | undefined;
let port = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response("upgrade required", { status: 426 });
    },
    websocket: {
      message(ws, raw) {
        try {
          const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
          if (msg.kind === "hello" && msg.token === "good-token") {
            ws.send(JSON.stringify({ kind: "welcome", v: "1.0.0" }));
          } else if (msg.kind === "hello") {
            ws.send(JSON.stringify({ kind: "reject", reason: "invalid token" }));
          } else if (msg.kind === "call") {
            ws.send(JSON.stringify(toolResult(msg)));
          }
        } catch {
          ws.close();
        }
      },
    },
  });
  port = server.port;
});

afterAll(() => {
  server?.stop(true);
});

describe("uos-core target selection helpers", () => {
  test("bridge capability contract matches Unity Editor bridge advertisements", () => {
    const contract = JSON.parse(readFileSync(join(import.meta.dir, "..", "bridge-capabilities.json"), "utf8"));
    const serverSource = readFileSync(
      join(import.meta.dir, "..", "Packages", "com.lyx.oh-my-unity", "Editor", "Bridge", "EditorBridgeServer.cs"),
      "utf8",
    );
    const supportedTools = csharpStringArray(serverSource, "SupportedTools");
    const writeTools = csharpStringArray(serverSource, "WriteTools");

    expect([...contract.requiredTools].sort()).toEqual([...supportedTools].sort());
    expect([...contract.requiredWriteTools].sort()).toEqual([...writeTools].sort());
    expect(contract.requiredTools).toContain("get_project_info");
    expect(contract.requiredTools).toContain("create_ui_screen");
    expect(contract.requiredTools).toContain("list_scene_objects");
    expect(contract.requiredWriteTools).toContain("save_scene");
  });

  test("parseUosArgs strips UOS-only Unity project selector flags", () => {
    expect(parseUosArgs(["--unity-project", "GameA", "run", "make a menu"]))
      .toEqual({ selector: "GameA", materialsDir: undefined, files: [], dryRun: false, opencodeArgs: ["run", "make a menu"] });
    expect(parseUosArgs(["run", "--uos-target=abc123", "hello"]))
      .toEqual({ selector: "abc123", materialsDir: undefined, files: [], dryRun: false, opencodeArgs: ["run", "hello"] });
    expect(parseUosArgs(["--uos-materials", "D:/Plans", "run", "make a menu"]))
      .toEqual({ selector: undefined, materialsDir: "D:/Plans", files: [], dryRun: false, opencodeArgs: ["run", "make a menu"] });
    expect(parseUosArgs(["--uos-materials-dir=Assets/Planning", "run", "make a menu"]))
      .toEqual({ selector: undefined, materialsDir: "Assets/Planning", files: [], dryRun: false, opencodeArgs: ["run", "make a menu"] });
    expect(parseUosArgs(["--uos-file", "brief.pdf", "--uos-attach=mockup.png", "run", "make a menu"]))
      .toEqual({
        selector: undefined,
        materialsDir: undefined,
        files: ["brief.pdf", "mockup.png"],
        dryRun: false,
        opencodeArgs: ["run", "make a menu"],
      });
    expect(parseUosArgs([
      "--uos-max-material-candidates=2",
      "--uos-max-material-depth",
      "3",
      "--uos-max-material-scan-files=40",
      "run",
      "make a menu",
    ])).toEqual({
      selector: undefined,
      materialsDir: undefined,
      files: [],
      dryRun: false,
      maxMaterialCandidates: 2,
      maxMaterialDepth: 3,
      maxMaterialScanFiles: 40,
      opencodeArgs: ["run", "make a menu"],
    });
    expect(parseUosArgs(["--uos-dry-run", "run", "make a menu"]))
      .toMatchObject({ dryRun: true, opencodeArgs: ["run", "make a menu"] });
    expect(parseUosArgs(["--uos-preflight", "run", "make a menu"]))
      .toMatchObject({ dryRun: true, opencodeArgs: ["run", "make a menu"] });
    expect(parseUosArgs(["--uos-wait", "--uos-wait-timeout-ms=5000", "--uos-wait-interval-ms", "250", "run", "make a menu"]))
      .toEqual({
        selector: undefined,
        materialsDir: undefined,
        files: [],
        dryRun: false,
        wait: true,
        waitTimeoutMs: 5000,
        waitIntervalMs: 250,
        opencodeArgs: ["run", "make a menu"],
      });
    expect(() => parseUosArgs(["--unity-project"])).toThrow("requires a project selector");
    expect(() => parseUosArgs(["--uos-materials"])).toThrow("planning material directory");
    expect(() => parseUosArgs(["--uos-file"])).toThrow("requires a file path");
    expect(() => parseUosArgs(["--uos-max-material-candidates", "51"])).toThrow("uos-max-material-candidates");
    expect(() => parseUosArgs(["--uos-max-material-depth", "21"])).toThrow("uos-max-material-depth");
    expect(() => parseUosArgs(["--uos-max-material-scan-files", "0"])).toThrow("uos-max-material-scan-files");
    expect(() => parseUosArgs(["--uos-wait-timeout-ms", "20"])).toThrow("uos-wait-timeout-ms");
    expect(() => parseUosArgs(["--uos-wait-interval-ms", "20"])).toThrow("uos-wait-interval-ms");
  });

  test("UOS help requests are handled before opencode passthrough", () => {
    expect(parseUosHelpTopic(["--help"])).toBe("main");
    expect(parseUosHelpTopic(["help"])).toBe("main");
    expect(parseUosHelpTopic(["help", "chat"])).toBe("entry");
    expect(parseUosHelpTopic(["chat", "--help"])).toBe("entry");
    expect(parseUosHelpTopic(["enter", "-h"])).toBe("entry");
    expect(parseUosHelpTopic(["help", "mvp"])).toBe("mvp");
    expect(parseUosHelpTopic(["validate-mvp", "--help"])).toBe("mvp");
    expect(parseUosHelpTopic(["help", "mvp-status"])).toBe("mvp-progress");
    expect(parseUosHelpTopic(["mvp-progress", "--help"])).toBe("mvp-progress");
    expect(parseUosHelpTopic(["help", "ctx"])).toBe("context");
    expect(parseUosHelpTopic(["ready", "--help"])).toBe("ready");
    expect(parseUosHelpTopic(["install-package", "-h"])).toBe("install-unity");
    expect(parseUosHelpTopic(["run", "--help"])).toBeUndefined();
    expect(parseUosHelpTopic(["models", "--help"])).toBeUndefined();

    const mainHelp = formatUosHelp();
    expect(mainHelp).toContain("UOS (Unity Orchestration System)");
    expect(mainHelp).toContain("uos chat");
    expect(mainHelp).toContain("uos mvp");
    expect(mainHelp).toContain("uos mvp-progress");
    expect(mainHelp).toContain("uos --unity-project MyGame");
    expect(mainHelp).toContain("uos run --help");
    expect(mainHelp).toContain("Binary/visual files stay available through UOS tools");

    const entryHelp = formatUosHelp("chat");
    expect(entryHelp).toContain("Usage: uos chat");
    expect(entryHelp).toContain("Start an interactive opencode TUI session");
    expect(entryHelp).toContain("--uos-wait");
    expect(entryHelp).toContain("--uos-materials <dir>");
    expect(entryHelp).toContain("text also attaches to `uos run --file`");
    expect(entryHelp).toContain("--continue");
    expect(entryHelp).toContain("--session <id>");
    expect(entryHelp).toContain("UOS context re-grounding");

    const mvpHelp = formatUosHelp("mvp");
    expect(mvpHelp).toContain("Usage: uos mvp");
    expect(mvpHelp).toContain("read-only MVP validation preflight");
    expect(mvpHelp).toContain("acceptance evidence gates");
    expect(mvpHelp).toContain("--uos-file <file>");
    expect(mvpHelp).toContain("--prompt <text>");
    expect(mvpHelp).toContain("--json");
    expect(mvpHelp).toContain("--save <file>");

    const mvpProgressHelp = formatUosHelp("mvp-status");
    expect(mvpProgressHelp).toContain("Usage: uos mvp-progress");
    expect(mvpProgressHelp).toContain("pending user-led MVP evidence gates");
    expect(mvpProgressHelp).toContain("--file <file>");
    expect(mvpProgressHelp).toContain("--json");

    const smokeHelp = formatUosHelp("smoke");
    expect(smokeHelp).toContain("--ai-only --ai-follow-up");
    expect(smokeHelp).toContain("--ai-feedback-iterations <N>");
    expect(smokeHelp).toContain("opencode run --continue follow-up");

    const e2eHelp = formatUosHelp("e2e");
    expect(e2eHelp).toContain("--public-mvp");
    expect(e2eHelp).toContain("--public-mvp-json");

    const readyHelp = formatUosHelp("ready");
    expect(readyHelp).toContain("Usage: uos ready");
    expect(readyHelp).toContain("--wait");
    expect(readyHelp).toContain("--unity-project <selector>");

    const unknownHelp = formatUosHelp("unknown-topic");
    expect(unknownHelp).toContain("unknown help topic");
    expect(unknownHelp).toContain("UOS commands:");
  });

  test("normalizeUosEntryArgs strips explicit UOS chat entry aliases", () => {
    expect(normalizeUosEntryArgs(["chat"])).toEqual([]);
    expect(normalizeUosEntryArgs(["enter", "--unity-project", "MyGame", "--model", "anthropic/claude-haiku-4-5"]))
      .toEqual(["--unity-project", "MyGame", "--model", "anthropic/claude-haiku-4-5"]);
    expect(normalizeUosEntryArgs(["run", "make a menu"])).toEqual(["run", "make a menu"]);
    expect(normalizeUosEntryArgs(["models"])).toEqual(["models"]);
  });

  test("parseSmokeOptions handles read-only and write smoke options", () => {
    expect(parseSmokeOptions([])).toEqual({
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
      aiRunTimeoutMs: 180000,
      aiFeedbackIterations: 1,
      aiRunObjectName: undefined,
      aiRunPrompt: undefined,
    });
    expect(parseSmokeOptions(["--write", "--preview", "--save", "--name", "BridgeCheck"])).toEqual({
      write: true,
      preview: true,
      save: true,
      revise: false,
      flow: false,
      contextFollowUp: false,
      sceneObjectRoundTrip: false,
      sceneObjectName: undefined,
      sceneObjectType: undefined,
      screenName: "BridgeCheck",
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
      aiRunTimeoutMs: 180000,
      aiFeedbackIterations: 1,
      aiRunObjectName: undefined,
      aiRunPrompt: undefined,
    });
    expect(parseSmokeOptions(["--screen-name=InlineName"]).screenName).toBe("InlineName");
    expect(parseSmokeOptions(["--scene", "Assets/Smoke.unity"]).scenePath).toBe("Assets/Smoke.unity");
    expect(parseSmokeOptions(["--import", "logo.png", "--asset-path", "Assets/UOS/logo.png", "--no-sprite"]))
      .toEqual({
        write: true,
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
        importPath: "logo.png",
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
        assetPath: "Assets/UOS/logo.png",
        importAsSprite: false,
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
        aiRunTimeoutMs: 180000,
        aiFeedbackIterations: 1,
        aiRunObjectName: undefined,
        aiRunPrompt: undefined,
      });
    expect(parseSmokeOptions([
      "--ai-run",
      "--ai-model",
      "anthropic/claude-haiku-4-5",
      "--ai-agent=ochestrator",
      "--ai-title",
      "UOS AI Smoke Custom",
      "--ai-timeout-ms",
      "120000",
      "--ai-object-name",
      "AI Smoke Object",
    ])).toMatchObject({
      aiRun: true,
      aiOnly: false,
      aiRunModel: "anthropic/claude-haiku-4-5",
      aiRunAgent: "ochestrator",
      aiRunTitle: "UOS AI Smoke Custom",
      aiRunTimeoutMs: 120000,
      aiRunObjectName: "AI Smoke Object",
    });
    expect(() => parseSmokeOptions(["--ai-run", "--ai-agent=build"]))
      .toThrow("only support --ai-agent ochestrator");
    expect(parseSmokeOptions(["--ai-feedback-iterations", "3"]))
      .toMatchObject({
        write: true,
        aiRun: true,
        aiFollowUp: true,
        aiFeedbackIterations: 3,
      });
    expect(parseSmokeOptions(["--ai-follow-up"]))
      .toMatchObject({
        write: true,
        aiRun: true,
        aiOnly: false,
        aiFollowUp: true,
      });
    expect(parseSmokeOptions(["--ai-only", "--screen-from-material", "brief.md"]))
      .toMatchObject({
        aiRun: true,
        aiOnly: true,
        materialScreenPath: "brief.md",
      });
    expect(parseSmokeOptions(["--ai-only", "--screen-from-material", "brief.md", "--preview"]))
      .toMatchObject({
        aiRun: true,
        aiOnly: true,
        preview: true,
        materialScreenPath: "brief.md",
      });
    expect(parseSmokeOptions(["--ai-only", "--screen-from-material", "brief.md", "--verify", "reference.png"]))
      .toMatchObject({
        aiRun: true,
        aiOnly: true,
        preview: true,
        materialScreenPath: "brief.md",
        verifyPath: "reference.png",
      });
    expect(parseSmokeOptions(["--ai-only", "--pptx-deck", "deck.pptx", "--slides", "1,2", "--preview"]))
      .toMatchObject({
        aiRun: true,
        aiOnly: true,
        preview: true,
        pptxDeckPath: "deck.pptx",
        pptxDeckSlideNumbers: [1, 2],
      });
    expect(parseSmokeOptions(["--ai-only", "--scene-object", "--object-name", "AIOnlyCube", "--object-type", "Cube"]))
      .toMatchObject({
        aiRun: true,
        aiOnly: true,
        sceneObjectRoundTrip: true,
        sceneObjectName: "AIOnlyCube",
        sceneObjectType: "Cube",
      });
    expect(parseSmokeOptions(["--materials", "Plans", "--material-depth", "2", "--material-max-files", "20"]))
      .toMatchObject({
        write: true,
        revise: false,
        materialsDir: "Plans",
        materialDepth: 2,
        materialMaxFiles: 20,
      });
    expect(parseSmokeOptions(["--materials", "Plans", "--screen-from-first-material", "--material-kind", "pptx"]))
      .toMatchObject({
        write: true,
        materialsDir: "Plans",
        materialScreenFromMaterials: true,
        materialScreenKind: "pptx",
      });
    expect(parseSmokeOptions([
      "--screen-from-material",
      "brief.docx",
      "--material-mode",
      "reference",
      "--material-kind=docx",
      "--image-number",
      "2",
      "--asset-dir",
      "Assets/UOS/Docs",
      "--output-dir",
      ".uos/materials",
    ])).toMatchObject({
      write: true,
      materialScreenPath: "brief.docx",
      materialScreenMode: "reference",
      materialScreenKind: "docx",
      materialScreenImageNumber: 2,
      materialScreenAssetDir: "Assets/UOS/Docs",
      materialScreenOutputDir: ".uos/materials",
    });
    expect(parseSmokeOptions(["--material-screen=deck.pptx", "--pptx-mode", "rendered", "--slide", "3"]))
      .toMatchObject({
        write: true,
        materialScreenPath: "deck.pptx",
        materialScreenPptxMode: "rendered",
        materialScreenSlideNumber: 3,
      });
    expect(parseSmokeOptions([
      "--pptx-deck",
      "deck.pptx",
      "--slides",
      "1,2,4",
      "--max-slides",
      "3",
      "--transition-prefix",
      "next",
      "--include-shape-panels",
      "--no-activate-first",
    ])).toMatchObject({
      write: true,
      pptxDeckPath: "deck.pptx",
      pptxDeckSlideNumbers: [1, 2, 4],
      pptxDeckMaxSlides: 3,
      pptxDeckCreateTransitions: true,
      pptxDeckActivateFirst: false,
      pptxDeckTransitionTriggerPrefix: "next",
      pptxDeckIncludeShapePanels: true,
    });
    expect(parseSmokeOptions(["--revise"])).toMatchObject({ write: true, revise: true });
    expect(parseSmokeOptions(["--edit"])).toMatchObject({ write: true, revise: true });
    expect(parseSmokeOptions(["--flow"])).toMatchObject({ write: true, flow: true });
    expect(parseSmokeOptions(["--transition"])).toMatchObject({ write: true, flow: true });
    expect(parseSmokeOptions(["--context-follow-up"])).toMatchObject({ write: true, contextFollowUp: true });
    expect(parseSmokeOptions(["--follow-up"])).toMatchObject({ write: true, contextFollowUp: true });
    expect(parseSmokeOptions(["--screen-from-material", "brief.pdf", "--context-follow-up"]))
      .toMatchObject({ write: true, materialScreenPath: "brief.pdf", contextFollowUp: true });
    expect(parseSmokeOptions(["--screen-from-first-material", "--context-follow-up"]))
      .toMatchObject({ write: true, materialScreenFromMaterials: true, contextFollowUp: true });
    expect(parseSmokeOptions(["--pptx-deck", "deck.pptx", "--context-follow-up"]))
      .toMatchObject({ write: true, pptxDeckPath: "deck.pptx", contextFollowUp: true });
    expect(parseSmokeOptions(["--scene-object", "--object-name", "Smoke Cube", "--object-type", "Sphere"]))
      .toMatchObject({
        write: true,
        sceneObjectRoundTrip: true,
        sceneObjectName: "Smoke Cube",
        sceneObjectType: "Sphere",
      });
    expect(parseSmokeOptions([
      "--compare",
      "reference.png",
      "--compare-output=diff.png",
      "--compare-max-width",
      "512",
      "--compare-max-height",
      "256",
      "--compare-threshold",
      "0.2",
    ])).toMatchObject({
      write: true,
      preview: true,
      comparePath: "reference.png",
      compareOutputPath: "diff.png",
      compareMaxWidth: 512,
      compareMaxHeight: 256,
      compareThreshold: 0.2,
    });
    expect(parseSmokeOptions(["--verify", "reference.png"])).toMatchObject({
      write: true,
      preview: true,
      verifyPath: "reference.png",
    });
    expect(() => parseSmokeOptions(["--import", "logo.png", "--materials", "Plans"]))
      .toThrow("either --import or --materials");
    expect(() => parseSmokeOptions(["--import", "logo.png", "--screen-from-material", "brief.pdf"]))
      .toThrow("either --import or --screen-from-material");
    expect(() => parseSmokeOptions(["--import", "logo.png", "--screen-from-first-material"]))
      .toThrow("either --import or --screen-from-first-material");
    expect(() => parseSmokeOptions(["--screen-from-material", "brief.pdf", "--pptx-deck", "deck.pptx"]))
      .toThrow("either --screen-from-material or --pptx-deck");
    expect(() => parseSmokeOptions(["--screen-from-material", "brief.pdf", "--screen-from-first-material"]))
      .toThrow("either --screen-from-material or --screen-from-first-material");
    expect(() => parseSmokeOptions(["--screen-from-first-material", "--pptx-deck", "deck.pptx"]))
      .toThrow("either --screen-from-first-material or --pptx-deck");
    expect(() => parseSmokeOptions(["--pptx-deck", "deck.pptx", "--revise"]))
      .toThrow("cannot be combined");
    expect(() => parseSmokeOptions(["--screen-from-material", "brief.pdf", "--revise"]))
      .toThrow("cannot be combined");
    expect(() => parseSmokeOptions(["--screen-from-first-material", "--revise"]))
      .toThrow("cannot be combined");
    expect(() => parseSmokeOptions(["--scene-object", "--screen-from-material", "brief.pdf"]))
      .toThrow("cannot be combined");
    expect(() => parseSmokeOptions(["--scene-object", "--revise"]))
      .toThrow("cannot be combined");
    expect(() => parseSmokeOptions(["--object-type", "BadType"]))
      .toThrow("requires one of");
    expect(() => parseSmokeOptions(["--material-mode", "bad"]))
      .toThrow("requires one of auto, editable, reference");
    expect(() => parseSmokeOptions(["--compare", "a.png", "--verify", "b.png"]))
      .toThrow("either --compare or --verify");
    expect(() => parseSmokeOptions(["--compare-threshold", "2"]))
      .toThrow("requires a number from 0 to 1");
    expect(() => parseSmokeOptions(["--ai-timeout-ms", "9999"]))
      .toThrow("requires an integer from 10000 to 600000");
    expect(() => parseSmokeOptions(["--ai-only", "--preview"]))
      .toThrow("requires --screen-from-material");
    expect(parseSmokeOptions(["--ai-only", "--ai-follow-up", "--screen-from-material", "brief.md"]))
      .toMatchObject({ aiOnly: true, aiFollowUp: true, materialScreenPath: "brief.md" });
    expect(() => parseSmokeOptions(["--ai-only", "--ai-follow-up"]))
      .toThrow("requires --screen-from-material");
    expect(() => parseSmokeOptions(["--ai-only", "--materials", "Plans"]))
      .toThrow("requires --screen-from-first-material");
    expect(() => parseSmokeOptions(["--unknown"])).toThrow("unknown smoke option");
  });

  test("parseDoctorOptions handles stale registry cleanup flag", () => {
    expect(parseDoctorOptions([])).toEqual({
      cleanStale: false,
      runtime: false,
      runtimeTimeoutMs: 45_000,
      projectPath: undefined,
    });
    expect(parseDoctorOptions(["--clean-stale"])).toMatchObject({ cleanStale: true, runtime: false });
    expect(parseDoctorOptions(["--runtime"])).toMatchObject({ cleanStale: false, runtime: true });
    expect(parseDoctorOptions(["--opencode-runtime"])).toMatchObject({ runtime: true });
    expect(parseDoctorOptions(["--runtime-timeout-ms", "9000"]))
      .toMatchObject({ runtime: true, runtimeTimeoutMs: 9000 });
    expect(parseDoctorOptions(["--project", "D:/Unity/MyGame"]))
      .toMatchObject({ projectPath: "D:/Unity/MyGame" });
    expect(() => parseDoctorOptions(["--unknown"])).toThrow("unknown doctor option");
    expect(() => parseDoctorOptions(["--project"])).toThrow("requires a Unity project path");
    expect(() => parseDoctorOptions(["--runtime-timeout-ms", "20"]))
      .toThrow("runtime-timeout-ms");
  });

  test("parseReadyOptions handles runtime and bridge wait flags", () => {
    expect(parseReadyOptions([])).toEqual({
      cleanStale: false,
      runtimeTimeoutMs: 45_000,
      wait: false,
      waitSelector: undefined,
      waitTimeoutMs: 60_000,
      waitIntervalMs: 1_000,
    });
    expect(parseReadyOptions([
      "--clean-stale",
      "--runtime-timeout-ms",
      "9000",
      "--wait",
      "--wait-timeout-ms=5000",
      "--wait-interval-ms",
      "250",
      "--unity-project",
      "MyGame",
    ])).toEqual({
      cleanStale: true,
      runtimeTimeoutMs: 9000,
      wait: true,
      waitSelector: "MyGame",
      waitTimeoutMs: 5000,
      waitIntervalMs: 250,
    });
    expect(parseReadyOptions(["--uos-target=ProjectA"])).toMatchObject({
      wait: true,
      waitSelector: "ProjectA",
    });
    expect(() => parseReadyOptions(["--unknown"])).toThrow("unknown ready option");
    expect(() => parseReadyOptions(["--wait-timeout-ms", "20"])).toThrow("wait-timeout-ms");
  });

  test("parseInstallUnityOptions handles project, package, and dry-run flags", () => {
    expect(parseInstallUnityOptions(["D:/Unity/MyGame"])).toEqual({
      projectPath: "D:/Unity/MyGame",
      packageSpecifier: undefined,
      dryRun: false,
      embed: true,
      force: false,
    });
    expect(parseInstallUnityOptions(["--project", "D:/Unity/MyGame", "--package", "https://example.com/uos.git", "--manifest-link", "--dry-run"]))
      .toEqual({
        projectPath: "D:/Unity/MyGame",
        packageSpecifier: "https://example.com/uos.git",
        dryRun: true,
        embed: false,
        force: false,
      });
    expect(parseInstallUnityOptions(["--unity-project=D:/Unity/MyGame", "--package=../Packages/com.lyx.oh-my-unity"]))
      .toMatchObject({
        projectPath: "D:/Unity/MyGame",
        packageSpecifier: "../Packages/com.lyx.oh-my-unity",
      });
    expect(parseInstallUnityOptions(["D:/Unity/MyGame", "--embed", "--force"]))
      .toMatchObject({ projectPath: "D:/Unity/MyGame", embed: true, force: true });
    expect(parseInstallUnityOptions(["D:/Unity/MyGame", "--no-embed"]))
      .toMatchObject({ projectPath: "D:/Unity/MyGame", embed: false });
    expect(() => parseInstallUnityOptions([])).toThrow("requires a Unity project path");
    expect(() => parseInstallUnityOptions(["--project"])).toThrow("requires a Unity project path");
    expect(() => parseInstallUnityOptions(["A", "B"])).toThrow("multiple Unity project paths");
  });

  test("parseWaitOptions handles selector, timeout, interval, and json flags", () => {
    expect(parseWaitOptions([])).toEqual({
      selector: undefined,
      timeoutMs: 60_000,
      intervalMs: 1_000,
      json: false,
    });
    expect(parseWaitOptions(["--unity-project", "Game", "--timeout-ms", "5000", "--interval-ms=250", "--json"]))
      .toEqual({
        selector: "Game",
        timeoutMs: 5000,
        intervalMs: 250,
        json: true,
      });
    expect(parseWaitOptions(["BravoGame"]).selector).toBe("BravoGame");
    expect(() => parseWaitOptions(["--timeout-ms", "10"])).toThrow("timeout-ms");
    expect(() => parseWaitOptions(["--interval-ms", "10"])).toThrow("interval-ms");
    expect(() => parseWaitOptions(["A", "B"])).toThrow("multiple project selectors");
  });

  test("parseProjectsOptions handles json output flag", () => {
    expect(parseProjectsOptions([])).toEqual({ json: false });
    expect(parseProjectsOptions(["--json"])).toEqual({ json: true });
    expect(() => parseProjectsOptions(["--unknown"])).toThrow("unknown projects option");
  });

  test("parseContextOptions handles selector, materials, attachments, json, and max chars", () => {
    expect(parseContextOptions([
      "--unity-project",
      "MyGame",
      "--uos-materials",
      "Plans",
      "--uos-file",
      "brief.pdf",
      "--uos-attach=mockup.png",
      "--json",
      "--max-chars",
      "1200",
      "--max-material-candidates=3",
      "--max-material-depth",
      "2",
      "--max-material-scan-files=40",
    ])).toEqual({
      selector: "MyGame",
      materialsDir: "Plans",
      files: ["brief.pdf", "mockup.png"],
      json: true,
      maxChars: 1200,
      maxMaterialCandidates: 3,
      maxMaterialDepth: 2,
      maxMaterialScanFiles: 40,
    });
    expect(parseContextOptions(["--uos-target=abc", "--max-chars=500"]).maxChars).toBe(500);
    expect(parseContextOptions(["--max-material-candidates", "0"]).maxMaterialCandidates).toBe(0);
    expect(() => parseContextOptions(["--unknown"])).toThrow("unknown context option");
    expect(() => parseContextOptions(["--max-chars", "20"])).toThrow("max-chars");
    expect(() => parseContextOptions(["--max-material-candidates", "51"])).toThrow("max-material-candidates");
    expect(() => parseContextOptions(["--max-material-depth", "21"])).toThrow("max-material-depth");
    expect(() => parseContextOptions(["--max-material-scan-files", "0"])).toThrow("max-material-scan-files");
  });

  test("parseMvpOptions handles selectors, wait, materials, prompt, and scan limits", () => {
    expect(parseMvpOptions([
      "--unity-project",
      "MyGame",
      "--wait",
      "--wait-timeout-ms=5000",
      "--wait-interval-ms",
      "250",
      "--uos-materials",
      "Plans",
      "--uos-file",
      "lobby.pptx",
      "--prompt",
      "create lobby",
      "--save",
      ".uos/mvp-evidence.json",
      "--json",
      "--max-material-candidates",
      "4",
      "--max-material-depth=2",
      "--max-material-scan-files",
      "30",
    ])).toEqual({
      selector: "MyGame",
      materialsDir: "Plans",
      files: ["lobby.pptx"],
      json: true,
      wait: true,
      waitTimeoutMs: 5000,
      waitIntervalMs: 250,
      prompt: "create lobby",
      savePath: ".uos/mvp-evidence.json",
      maxMaterialCandidates: 4,
      maxMaterialDepth: 2,
      maxMaterialScanFiles: 30,
    });
    expect(parseMvpOptions(["--uos-wait", "--uos-target=Game"]).wait).toBe(true);
    expect(() => parseMvpOptions(["--unknown"])).toThrow("unknown mvp option");
    expect(() => parseMvpOptions(["--prompt"])).toThrow("requires a prompt");
    expect(() => parseMvpOptions(["--save"])).toThrow("requires an output file path");
    expect(() => parseMvpOptions(["--wait-timeout-ms", "20"])).toThrow("wait-timeout-ms");
  });

  test("parseMvpProgressOptions handles evidence path and json output", () => {
    expect(parseMvpProgressOptions([])).toEqual({
      evidencePath: join(".uos", "mvp-evidence.json"),
      json: false,
    });
    expect(parseMvpProgressOptions([".uos/custom-evidence.json", "--json"])).toEqual({
      evidencePath: ".uos/custom-evidence.json",
      json: true,
    });
    expect(parseMvpProgressOptions(["--file", ".uos/mvp-evidence.json"])).toEqual({
      evidencePath: ".uos/mvp-evidence.json",
      json: false,
    });
    expect(() => parseMvpProgressOptions(["--file"])).toThrow("requires an evidence file path");
    expect(() => parseMvpProgressOptions(["--unknown"])).toThrow("unknown mvp-progress option");
    expect(() => parseMvpProgressOptions(["one.json", "two.json"])).toThrow("multiple evidence file paths");
  });

  test("parseE2EOptions handles Unity launch and smoke options", () => {
    expect(parseE2EOptions([
      "--project",
      "D:/Unity/MyGame",
      "--unity",
      "C:/Unity/Unity.exe",
      "--timeout-ms=90000",
      "--interval-ms",
      "500",
      "--stop-timeout-ms",
      "3000",
      "--log-file",
      "D:/logs/uos-e2e.log",
      "--selector",
      "MyGame",
      "--save",
      "--name",
      "BridgeE2E",
    ])).toEqual({
      projectPath: "D:/Unity/MyGame",
      unityPath: "C:/Unity/Unity.exe",
      selector: "MyGame",
      timeoutMs: 90000,
      intervalMs: 500,
      stopTimeoutMs: 3000,
      logFile: "D:/logs/uos-e2e.log",
      keepOpen: false,
      nographics: true,
      secondaryProjectPaths: [],
      entryDryRun: false,
      postSmokeEntryDryRun: false,
      publicSmoke: false,
      publicSmokeArgs: ["--write", "--revise", "--preview", "--name", "UOSE2ESmoke", "--save", "--name", "BridgeE2E"],
      publicMvp: false,
      publicMvpJson: false,
      publicChatDryRun: false,
      publicRunDryRun: false,
      publicRunAi: false,
      publicRunPrompt: "continue the selected UOS Unity editing session and summarize the attached material context",
      entryMaterialsDir: undefined,
      entryFiles: [],
      entryMaxMaterialCandidates: undefined,
      entryMaxMaterialDepth: undefined,
      entryMaxMaterialScanFiles: undefined,
      smokeOptions: {
        write: true,
        preview: true,
        save: true,
        revise: true,
        flow: false,
        contextFollowUp: false,
        sceneObjectRoundTrip: false,
        sceneObjectName: undefined,
        sceneObjectType: undefined,
        screenName: "BridgeE2E",
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
        aiRunTimeoutMs: 180000,
        aiFeedbackIterations: 1,
        aiRunObjectName: undefined,
        aiRunPrompt: undefined,
      },
    });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--compare", "reference.png"]).smokeOptions)
      .toMatchObject({ write: true, preview: true, comparePath: "reference.png" });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--screen-from-material", "README.md"]).smokeOptions)
      .toMatchObject({
        write: true,
        preview: true,
        revise: false,
        materialScreenPath: "README.md",
        screenName: "UOSE2ESmoke",
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--materials", "Plans", "--screen-from-first-material"]).smokeOptions)
      .toMatchObject({
        write: true,
        preview: true,
        revise: false,
        materialsDir: "Plans",
        materialScreenFromMaterials: true,
        screenName: "UOSE2ESmoke",
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--pptx-deck=deck.pptx"]).smokeOptions)
      .toMatchObject({
        write: true,
        preview: true,
        revise: false,
        pptxDeckPath: "deck.pptx",
        screenName: "UOSE2ESmoke",
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--public-smoke", "--screen-from-material", "README.md"]))
      .toMatchObject({
        publicSmoke: true,
        publicSmokeArgs: ["--preview", "--name", "UOSE2ESmoke", "--screen-from-material", "README.md"],
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--public-mvp-json"]))
      .toMatchObject({
        publicMvp: true,
        publicMvpJson: true,
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--public-chat-dry-run"]))
      .toMatchObject({
        publicChatDryRun: true,
      });
    expect(parseE2EOptions([
      "D:/Unity/MyGame",
      "--public-run-dry-run",
      "--public-run-prompt",
      "continue from attached deck",
    ]))
      .toMatchObject({
        publicRunDryRun: true,
        publicRunPrompt: "continue from attached deck",
      });
    expect(parseE2EOptions([
      "D:/Unity/MyGame",
      "--public-run-ai",
      "--public-run-ai-prompt",
      "read and create",
      "--public-run-ai-model",
      "anthropic/claude-haiku-4-5",
      "--public-run-ai-title",
      "Public AI",
      "--public-run-ai-screen-name",
      "PublicAIScreen",
      "--public-run-ai-timeout-ms",
      "300000",
    ]))
      .toMatchObject({
        publicRunAi: true,
        publicRunAiPrompt: "read and create",
        publicRunAiModel: "anthropic/claude-haiku-4-5",
        publicRunAiTitle: "Public AI",
        publicRunAiScreenName: "PublicAIScreen",
        publicRunTimeoutMs: 300000,
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--scene-object", "--object-type", "Cube"]).smokeOptions)
      .toMatchObject({
        write: true,
        preview: false,
        revise: false,
        sceneObjectRoundTrip: true,
        sceneObjectType: "Cube",
        screenName: "UOSE2ESmoke",
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--ai-follow-up", "--ai-feedback-iterations", "2"]).smokeOptions)
      .toMatchObject({
        write: true,
        preview: true,
        aiRun: true,
        aiFollowUp: true,
        aiFeedbackIterations: 2,
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--secondary-project", "D:/Unity/OtherGame"]))
      .toMatchObject({
        projectPath: "D:/Unity/MyGame",
        secondaryProjectPaths: ["D:/Unity/OtherGame"],
        smokeOptions: { write: false, preview: false, revise: false },
      });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--read-only"]).smokeOptions.write).toBe(false);
    expect(parseE2EOptions(["D:/Unity/MyGame", "--keep-open"]).keepOpen).toBe(true);
    expect(parseE2EOptions([
      "D:/Unity/MyGame",
      "--read-only",
      "--entry-dry-run",
      "--post-smoke-entry-dry-run",
      "--public-smoke",
      "--uos-materials",
      "Plans",
      "--uos-file=brief.md",
      "--uos-max-material-candidates",
      "2",
      "--uos-max-material-depth=3",
      "--uos-max-material-scan-files",
      "40",
    ])).toMatchObject({
      entryDryRun: true,
      postSmokeEntryDryRun: true,
      publicSmoke: true,
      publicSmokeArgs: [],
      entryMaterialsDir: "Plans",
      entryFiles: ["brief.md"],
      entryMaxMaterialCandidates: 2,
      entryMaxMaterialDepth: 3,
      entryMaxMaterialScanFiles: 40,
      smokeOptions: { write: false },
    });
    expect(parseE2EOptions(["D:/Unity/MyGame", "--graphics"]).nographics).toBe(false);
    expect(parseE2EOptions(["D:/Unity/MyGame", "--no-nographics"]).nographics).toBe(false);
    expect(parseE2EOptions(["D:/Unity/MyGame", "--graphics", "--headless"]).nographics).toBe(true);
    expect(() => parseE2EOptions([])).toThrow("requires a Unity project path");
    expect(() => parseE2EOptions(["A", "B"])).toThrow("multiple Unity project paths");
    expect(() => parseE2EOptions(["A", "--uos-file"])).toThrow("requires a file path");
    expect(() => parseE2EOptions(["A", "--unknown"])).toThrow("unknown smoke option");
  });

  test("installUnityPackage embeds the UOS package by default for share-safe projects", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-install-unity-test");
    const repoRoot = join(dir, "uos-repo");
    const project = join(dir, "TargetGame");
    const embeddedRoot = join(project, "Packages", "com.lyx.oh-my-unity");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(repoRoot, "Packages", "com.lyx.oh-my-unity"), { recursive: true });
    await writeFile(join(repoRoot, "Packages", "com.lyx.oh-my-unity", "package.json"), JSON.stringify({
      name: "com.lyx.oh-my-unity",
      displayName: "Oh My Unity",
      version: "0.1.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(project, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));

    try {
      const dryRun = await installUnityPackage({ projectPath: project, repoRoot, dryRun: true });
      expect(dryRun.changed).toBe(true);
      expect(dryRun.installMode).toBe("embedded");
      expect(JSON.parse(await readFile(join(project, "Packages", "manifest.json"), "utf8")).dependencies)
        .toEqual({ "com.unity.ugui": "2.0.0" });
      expect(await Bun.file(join(embeddedRoot, "package.json")).exists()).toBe(false);
      expect(formatInstallUnityPackageResult(dryRun)).toContain("dry-run: manifest was not written");

      const result = await installUnityPackage({ projectPath: project, repoRoot });
      expect(result.changed).toBe(true);
      const manifest = JSON.parse(await readFile(join(project, "Packages", "manifest.json"), "utf8"));
      expect(manifest.dependencies["com.unity.ugui"]).toBe("2.0.0");
      expect(manifest.dependencies["com.lyx.oh-my-unity"]).toBeUndefined();
      expect(await Bun.file(join(embeddedRoot, "package.json")).exists()).toBe(true);
      expect(result.installCheck.ok).toBe(true);
      expect(result.installCheck.installKind).toBe("embedded");
      expect(result.installCheck.localPackage.version).toBe("0.1.0");
      expect(formatInstallUnityPackageResult(result)).toContain("updated");
      expect(formatInstallUnityPackageResult(result)).toContain("check: ok");
      expect(formatInstallUnityPackageResult(result)).toContain("localPackageVersion: 0.1.0");

      const second = await installUnityPackage({ projectPath: project, repoRoot });
      expect(second.changed).toBe(false);
      expect(second.installCheck.ok).toBe(true);
      expect(formatInstallUnityPackageResult(second)).toContain("already configured");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("installUnityPackage rejects non-Unity directories", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-install-non-unity-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      await expect(installUnityPackage({ projectPath: dir, repoRoot: import.meta.dir }))
        .rejects.toThrow("missing ProjectSettings");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("installUnityPackage can write a local manifest link only when explicitly requested", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-install-unity-manifest-link-test");
    const repoRoot = join(dir, "uos-repo");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const project = join(dir, "TargetGame");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "com.lyx.oh-my-unity",
      displayName: "Oh My Unity",
      version: "0.1.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));
    await writeFile(join(project, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));

    try {
      const result = await installUnityPackage({ projectPath: project, repoRoot, embed: false });
      expect(result.installMode).toBe("manifest");
      const manifest = JSON.parse(await readFile(join(project, "Packages", "manifest.json"), "utf8"));
      expect(manifest.dependencies["com.lyx.oh-my-unity"]).toBe(unityFileSpecifier(packageRoot));
      expect(await Bun.file(join(project, "Packages", "com.lyx.oh-my-unity", "package.json")).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("installUnityPackage can embed the Unity package into a target project", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-install-unity-embed-test");
    const repoRoot = join(dir, "uos-repo");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const project = join(dir, "TargetGame");
    const embeddedRoot = join(project, "Packages", "com.lyx.oh-my-unity");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(packageRoot, "Editor"), { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "com.lyx.oh-my-unity",
      displayName: "Oh My Unity",
      version: "0.2.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));
    await writeFile(join(packageRoot, "Editor", "Bridge.cs"), "public class Bridge {}\n");
    await writeFile(join(project, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.unity.ugui": "2.0.0",
        "com.lyx.oh-my-unity": "https://example.com/old.git?path=Packages/com.lyx.oh-my-unity",
      },
    }, null, 2));
    await writeFile(join(project, "Packages", "packages-lock.json"), JSON.stringify({
      dependencies: {
        "com.lyx.oh-my-unity": {
          version: unityFileSpecifier(packageRoot),
          depth: 0,
          source: "local",
          dependencies: {},
        },
        "com.unity.ugui": {
          version: "2.0.0",
          depth: 0,
          source: "builtin",
          dependencies: {},
        },
      },
    }, null, 2));

    try {
      const dryRun = await installUnityPackage({ projectPath: project, repoRoot, embed: true, dryRun: true });
      expect(dryRun.installMode).toBe("embedded");
      expect(dryRun.changed).toBe(true);
      expect(await Bun.file(join(embeddedRoot, "package.json")).exists()).toBe(false);
      const dryRunLock = JSON.parse(await readFile(join(project, "Packages", "packages-lock.json"), "utf8"));
      expect(dryRunLock.dependencies["com.lyx.oh-my-unity"].source).toBe("local");

      const result = await installUnityPackage({ projectPath: project, repoRoot, embed: true });
      expect(result.installMode).toBe("embedded");
      expect(result.packageSpecifier).toBe(`embedded:${embeddedRoot}`);
      expect(result.changed).toBe(true);
      expect(await Bun.file(join(embeddedRoot, "package.json")).exists()).toBe(true);
      expect(await readFile(join(embeddedRoot, "Editor", "Bridge.cs"), "utf8")).toContain("Bridge");
      const manifest = JSON.parse(await readFile(join(project, "Packages", "manifest.json"), "utf8"));
      expect(manifest.dependencies["com.unity.ugui"]).toBe("2.0.0");
      expect(manifest.dependencies["com.lyx.oh-my-unity"]).toBeUndefined();
      const packagesLock = JSON.parse(await readFile(join(project, "Packages", "packages-lock.json"), "utf8"));
      expect(packagesLock.dependencies["com.lyx.oh-my-unity"]).toMatchObject({
        version: "file:com.lyx.oh-my-unity",
        depth: 0,
        source: "embedded",
        dependencies: {
          "com.unity.ugui": "2.0.0",
        },
      });
      expect(result.installCheck.ok).toBe(true);
      expect(result.installCheck.installKind).toBe("embedded");
      expect(result.installCheck.localPackage.version).toBe("0.2.0");
      expect(formatInstallUnityPackageResult(result)).toContain("mode: embedded");
      expect(formatInstallUnityPackageResult(result)).toContain("installKind: embedded");
      expect(formatInstallUnityPackageResult(result)).toContain("packagesLock: updated");

      await writeFile(join(packageRoot, "Editor", "Bridge.cs"), "public class Bridge2 {}\n");
      const existing = await installUnityPackage({ projectPath: project, repoRoot, embed: true });
      expect(existing.changed).toBe(false);
      expect(await readFile(join(embeddedRoot, "Editor", "Bridge.cs"), "utf8")).toContain("Bridge");
      expect(formatInstallUnityPackageResult(existing)).toContain("pass --force");

      const replaced = await installUnityPackage({ projectPath: project, repoRoot, embed: true, force: true });
      expect(replaced.changed).toBe(true);
      expect(await readFile(join(embeddedRoot, "Editor", "Bridge.cs"), "utf8")).toContain("Bridge2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("installUnityPackage rejects invalid embedded package metadata before writing", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-install-unity-invalid-package-test");
    const repoRoot = join(dir, "uos-repo");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const project = join(dir, "TargetGame");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "com.example.wrong",
      version: "0.1.0",
      dependencies: {},
    }, null, 2));

    try {
      await expect(installUnityPackage({ projectPath: project, repoRoot }))
        .rejects.toThrow("cannot embed invalid Unity package");
      expect(await Bun.file(join(project, "Packages", "com.lyx.oh-my-unity", "package.json")).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectUnityProjectInstall reports package and local package dependency state", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-project-install-inspect-test");
    const repoRoot = join(dir, "uos-repo");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const project = join(dir, "TargetGame");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await mkdir(join(project, "Packages"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "com.lyx.oh-my-unity",
      displayName: "Oh My Unity",
      version: "0.1.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));
    await writeFile(join(project, "Packages", "manifest.json"), JSON.stringify({ dependencies: {} }, null, 2));

    try {
      const missing = await inspectUnityProjectInstall(project, repoRoot);
      expect(missing.ok).toBe(false);
      expect(missing.installed).toBe(false);

      await installUnityPackage({ projectPath: project, repoRoot });
      const inspected = await inspectUnityProjectInstall(project, repoRoot);
      expect(inspected.ok).toBe(true);
      expect(inspected.installed).toBe(true);
      expect(inspected.installKind).toBe("embedded");
      expect(inspected.specifier).toBe(`embedded:${join(project, "Packages", "com.lyx.oh-my-unity")}`);
      expect(inspected.localPackage).toMatchObject({
        ok: true,
        name: "com.lyx.oh-my-unity",
        uguiDependency: "2.0.0",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectUnityProjectInstall recognizes embedded Unity packages", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-project-embedded-install-test");
    const project = join(dir, "EmbeddedGame");
    const packageRoot = join(project, "Packages", "com.lyx.oh-my-unity");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "com.lyx.oh-my-unity",
      version: "0.1.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));

    try {
      const inspected = await inspectUnityProjectInstall(project, dir);
      expect(inspected.ok).toBe(true);
      expect(inspected.installed).toBe(true);
      expect(inspected.installKind).toBe("embedded");
      expect(inspected.specifier).toBe(`embedded:${packageRoot}`);
      expect(inspected.localPackage?.uguiDependency).toBe("2.0.0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectUnityProjectInstall warns when manifest and embedded installs coexist", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-project-install-conflict-test");
    const repoRoot = join(dir, "uos-repo");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const project = join(dir, "ConflictGame");
    const embeddedRoot = join(project, "Packages", "com.lyx.oh-my-unity");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(embeddedRoot, { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    const packageJson = JSON.stringify({
      name: "com.lyx.oh-my-unity",
      version: "0.3.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2);
    await writeFile(join(packageRoot, "package.json"), packageJson);
    await writeFile(join(embeddedRoot, "package.json"), packageJson);
    await writeFile(join(project, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.lyx.oh-my-unity": unityFileSpecifier(packageRoot),
      },
    }, null, 2));

    try {
      const inspected = await inspectUnityProjectInstall(project, repoRoot);
      expect(inspected.ok).toBe(false);
      expect(inspected.installed).toBe(true);
      expect(inspected.installKind).toBe("manifest");
      expect(inspected.hasEmbeddedPackage).toBe(true);
      expect(inspected.hasInstallConflict).toBe(true);
      const output = formatDoctorReport({
        repoRoot,
        registry: { dir: join(dir, "registry"), missing: true, entries: [] },
        unityProject: inspected,
        opencodeResources: minimalOkResources(),
        files: [],
        commands: [],
        env: {},
      });
      expect(output).toContain("[warn] embedded package also exists");
      expect(output).toContain("Unity gives embedded packages precedence");

      const readiness = evaluateReadiness({
        registry: { entries: [{ status: "live" }] },
        unityProject: inspected,
        opencodeResources: minimalOkResources(),
        opencodeRuntime: { ok: true, duplicatePlugins: [] },
        files: [],
        commands: [],
        env: {},
      });
      expect(readiness.ready).toBe(false);
      expect(readiness.blockers.some((item: string) => item.includes("both manifest and embedded"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("discoverUnityProjectCatalog merges configured projects with install and live bridge status", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-project-catalog-test");
    const repoRoot = join(dir, "uos-repo");
    const unityRoot = join(dir, "UnityProjects");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const missingProject = join(unityRoot, "AlphaGame");
    const connectedProject = join(unityRoot, "BravoGame");
    const installedProject = join(unityRoot, "CharlieGame");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(join(missingProject, "ProjectSettings"), { recursive: true });
    await mkdir(join(missingProject, "Packages"), { recursive: true });
    await mkdir(join(connectedProject, "ProjectSettings"), { recursive: true });
    await mkdir(join(connectedProject, "Packages"), { recursive: true });
    await mkdir(join(installedProject, "ProjectSettings"), { recursive: true });
    await mkdir(join(installedProject, "Packages"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name: "com.lyx.oh-my-unity",
      version: "0.4.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2));
    await writeFile(join(missingProject, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(missingProject, "Packages", "manifest.json"), JSON.stringify({ dependencies: {} }, null, 2));
    await writeFile(join(connectedProject, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.69f1\n");
    await writeFile(join(connectedProject, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.unity.ugui": "2.0.0",
        "com.lyx.oh-my-unity": unityFileSpecifier(packageRoot),
      },
    }, null, 2));
    await writeFile(join(installedProject, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.70f1\n");
    await writeFile(join(installedProject, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.unity.ugui": "2.0.0",
        "com.lyx.oh-my-unity": unityFileSpecifier(packageRoot),
      },
    }, null, 2));

    try {
      const catalog = await discoverUnityProjectCatalog({
        unityProjectRoots: [unityRoot],
        repoRoot,
        liveEditors: [{
          instanceId: "bravo-editor",
          projectName: "BravoGame",
          projectPath: connectedProject,
          host: "127.0.0.1",
          port: 19001,
          token: "secret-token",
          unityVersion: "6000.0.69f1",
          uosPackageName: "com.lyx.oh-my-unity",
          uosPackageVersion: "0.4.0",
          protocolVersion: "1.0.0",
        }],
      });

      expect(catalog.count).toBe(3);
      const alpha = catalog.projects.find((project) => project.projectName === "AlphaGame");
      const bravo = catalog.projects.find((project) => project.projectName === "BravoGame");
      const charlie = catalog.projects.find((project) => project.projectName === "CharlieGame");
      expect(alpha).toMatchObject({
        status: "not-installed",
        connected: false,
        sessionReady: false,
        uos: {
          status: "not-installed",
          ok: false,
          installed: false,
        },
        bridge: {
          live: false,
        },
      });
      expect(bravo).toMatchObject({
        status: "connected",
        connected: true,
        sessionReady: true,
        unityVersion: "6000.0.69f1",
        uos: {
          status: "connected",
          ok: true,
          installed: true,
          installKind: "manifest",
          localPackage: {
            ok: true,
            version: "0.4.0",
          },
        },
        bridge: {
          live: true,
          editor: {
            instanceId: "bravo-editor",
            projectName: "BravoGame",
            projectPath: connectedProject,
            host: "127.0.0.1",
            port: 19001,
          },
        },
      });
      expect(charlie).toMatchObject({
        status: "installed",
        connected: false,
        sessionReady: false,
        unityVersion: "6000.0.70f1",
        uos: {
          status: "installed",
          ok: true,
          installed: true,
          installKind: "manifest",
        },
        bridge: {
          live: false,
        },
      });
      const output = formatUnityProjectCatalog(catalog);
      expect(output).toContain("[uos] Unity projects");
      expect(output).toContain("Status");
      expect(output).toContain("Install UOS");
      expect(output).toContain("AlphaGame");
      expect(output).toContain("Ready");
      expect(output).toContain("BravoGame");
      expect(output).toContain("Open Unity");
      expect(output).toContain("CharlieGame");
      expect(output).toContain("Linked");
      expect(output).toContain("Open");
      expect(output).toContain("If UOS is not linked, UOS installs first");
      expect(output).toContain("Action: c <number> link/update UOS");
      expect(output).not.toContain("secret-token");
      expect(selectUnityProjectCatalogEntry(catalog, "2")?.projectName).toBe("BravoGame");
      expect(selectUnityProjectCatalogEntry(catalog, connectedProject)?.projectName).toBe("BravoGame");
      expect(JSON.stringify(bravo)).not.toContain("secret-token");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("uninstallUnityPackage removes manifest and embedded UOS installs", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-project-uninstall-test");
    const repoRoot = join(dir, "uos-repo");
    const packageRoot = join(repoRoot, "Packages", "com.lyx.oh-my-unity");
    const project = join(dir, "DisconnectGame");
    const embeddedRoot = join(project, "Packages", "com.lyx.oh-my-unity");
    await rm(dir, { recursive: true, force: true });
    await mkdir(packageRoot, { recursive: true });
    await mkdir(embeddedRoot, { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.69f1\n");
    const packageJson = JSON.stringify({
      name: "com.lyx.oh-my-unity",
      version: "0.5.0",
      dependencies: {
        "com.unity.ugui": "2.0.0",
      },
    }, null, 2);
    await writeFile(join(packageRoot, "package.json"), packageJson);
    await writeFile(join(embeddedRoot, "package.json"), packageJson);
    await writeFile(join(project, "Packages", "manifest.json"), JSON.stringify({
      dependencies: {
        "com.unity.ugui": "2.0.0",
        "com.lyx.oh-my-unity": unityFileSpecifier(packageRoot),
      },
    }, null, 2));
    await writeFile(join(project, "Packages", "packages-lock.json"), JSON.stringify({
      dependencies: {
        "com.lyx.oh-my-unity": {
          version: "file:com.lyx.oh-my-unity",
          depth: 0,
          source: "embedded",
          dependencies: {
            "com.unity.ugui": "2.0.0",
          },
        },
      },
    }, null, 2));

    try {
      const dryRun = await uninstallUnityPackage({ projectPath: project, repoRoot, dryRun: true });
      expect(dryRun.changed).toBe(true);
      expect(await Bun.file(join(embeddedRoot, "package.json")).exists()).toBe(true);
      expect(JSON.parse(await readFile(join(project, "Packages", "manifest.json"), "utf8")).dependencies["com.lyx.oh-my-unity"])
        .toBe(unityFileSpecifier(packageRoot));
      expect(JSON.parse(await readFile(join(project, "Packages", "packages-lock.json"), "utf8")).dependencies["com.lyx.oh-my-unity"])
        .toBeDefined();

      const result = await uninstallUnityPackage({ projectPath: project, repoRoot });
      expect(result.changed).toBe(true);
      const manifest = JSON.parse(await readFile(join(project, "Packages", "manifest.json"), "utf8"));
      expect(manifest.dependencies["com.unity.ugui"]).toBe("2.0.0");
      expect(manifest.dependencies["com.lyx.oh-my-unity"]).toBeUndefined();
      const packagesLock = JSON.parse(await readFile(join(project, "Packages", "packages-lock.json"), "utf8"));
      expect(packagesLock.dependencies["com.lyx.oh-my-unity"]).toBeUndefined();
      expect(await Bun.file(join(embeddedRoot, "package.json")).exists()).toBe(false);
      expect(result.installCheck.installed).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("resolveSmokeImportPath resolves relative imports against material and project roots", () => {
    expect(resolveSmokeImportPath("logo.png", { projectPath: "D:/Unity/Project" }, {}, {}))
      .toBe(resolve("D:/Unity/Project", "logo.png"));
    expect(resolveSmokeImportPath("logo.png", { projectPath: "D:/Unity/Project" }, {}, { UNITY_MCP_MATERIALS_DIR: "D:/Plans" }))
      .toBe(resolve("D:/Plans", "logo.png"));
    expect(resolveSmokeImportPath("logo.png", { projectPath: "D:/Unity/Project" }, { materialsDir: "D:/ExplicitPlans" }, {}))
      .toBe(resolve("D:/ExplicitPlans", "logo.png"));
    expect(resolveSmokeImportPath("logo.png", { projectPath: "D:/Unity/Project" }, { materialsDir: "Assets/Plans" }, {}))
      .toBe(resolve("D:/Unity/Project", "Assets/Plans", "logo.png"));
    expect(resolveSmokeImportPath("C:/absolute/logo.png", { projectPath: "D:/Unity/Project" }, {}, {}))
      .toBe(resolve("C:/absolute/logo.png"));
  });

  test("selectSmokeMaterialImage chooses the first image while skipping generated folders", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-materials-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "Assets", "Plans"), { recursive: true });
    await mkdir(join(dir, "Library", "Plans"), { recursive: true });
    await writeFile(join(dir, "Library", "Plans", "ignored.png"), "not real png");
    await writeFile(join(dir, "Assets", "Plans", "brief.md"), "# Brief");
    await writeFile(join(dir, "Assets", "Plans", "hero.png"), "png bytes");

    try {
      expect(resolveSmokeMaterialsDir("Assets/Plans", { projectPath: dir }, {}))
        .toBe(resolve(dir, "Assets/Plans"));
      const selected = await selectSmokeMaterialImage({ projectPath: dir }, {
        materialsDir: ".",
        materialDepth: 4,
        materialMaxFiles: 100,
      }, {});
      expect(selected.sourcePath).toBe(join(dir, "Assets", "Plans", "hero.png"));
      expect(selected.relativePath).toBe("Assets/Plans/hero.png");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("selectSmokeMaterial chooses the first supported material and honors kind filters", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-screen-materials-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "Plans", "Nested"), { recursive: true });
    await mkdir(join(dir, "Library", "Plans"), { recursive: true });
    await writeFile(join(dir, "Library", "Plans", "ignored.pptx"), "ignored");
    await writeFile(join(dir, "Plans", "brief.md"), "# Brief");
    await writeFile(join(dir, "Plans", "deck.pptx"), "pptx bytes");
    await writeFile(join(dir, "Plans", "Nested", "mockup.png"), "png bytes");

    try {
      const selected = await selectSmokeMaterial({ projectPath: dir }, {
        materialsDir: "Plans",
        materialDepth: 4,
        materialMaxFiles: 100,
      }, {});
      expect(selected.relativePath).toBe("brief.md");
      expect(selected.kind).toBe("document");

      const pptx = await selectSmokeMaterial({ projectPath: dir }, {
        materialsDir: "Plans",
        materialScreenKind: "pptx",
      }, {});
      expect(pptx.relativePath).toBe("deck.pptx");
      expect(pptx.kind).toBe("pptx");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("shouldSelectUnityTarget skips when explicit bridge env is already set", () => {
    expect(shouldSelectUnityTarget([], {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
    })).toBe(false);
    expect(shouldSelectUnityTarget(["run", "hello"], {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
    }, { selector: "ChosenGame" })).toBe(true);
    expect(shouldSelectUnityTarget(["run", "hello"], {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
      UOS_UNITY_PROJECT: "ChosenGame",
    })).toBe(true);
    expect(shouldSelectUnityTarget(["--help"], {}, { selector: "ChosenGame" })).toBe(false);
    expect(shouldSelectUnityTarget(["run", "hello"], {
      UOS_SKIP_PROJECT_SELECT: "1",
      UOS_UNITY_PROJECT: "ChosenGame",
    })).toBe(false);
    expect(shouldSelectUnityTarget(["--help"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["projects"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["context"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["ctx"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["models"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["--print-logs", "models"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["--log-level", "DEBUG", "debug", "config"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["--version"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["-v"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["--print-logs", "--version"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["run", "--help"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["--print-logs", "run", "-h"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["session", "--help"], {})).toBe(false);
    expect(shouldSelectUnityTarget(["run", "hello"], {})).toBe(true);
    expect(shouldSelectUnityTarget(["--print-logs", "run", "hello"], {})).toBe(true);
    expect(shouldSelectUnityTarget(["--model", "anthropic/claude-opus-4-8"], {})).toBe(true);
    expect(shouldSelectUnityContextTarget(undefined, {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
    })).toBe(false);
    expect(shouldSelectUnityContextTarget("ChosenGame", {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
    })).toBe(true);
    expect(shouldSelectUnityContextTarget(undefined, {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
      UOS_UNITY_PROJECT: "ChosenGame",
    })).toBe(true);
    expect(shouldSelectUnityContextTarget("ChosenGame", {
      UOS_SKIP_PROJECT_SELECT: "1",
    })).toBe(false);
  });

  test("registryDir honors UOS_EDITOR_REGISTRY_DIR override", () => {
    expect(registryDir({ UOS_EDITOR_REGISTRY_DIR: "C:/tmp/uos-editors" }))
      .toBe("C:/tmp/uos-editors");
  });

  test("discoverLiveEditors filters stale and wrong-token registry entries", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-core-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, "live.json"), JSON.stringify({
      instanceId: "live",
      projectName: "LiveProject",
      projectPath: "D:/Unity/LiveProject",
      host: "127.0.0.1",
      port,
      token: "good-token",
      updatedAtUtc: "2026-06-04T02:00:00.000Z",
    }));
    await writeFile(join(dir, "wrong-token.json"), JSON.stringify({
      instanceId: "wrong",
      projectName: "WrongTokenProject",
      projectPath: "D:/Unity/Wrong",
      host: "127.0.0.1",
      port,
      token: "bad-token",
      updatedAtUtc: "2026-06-04T03:00:00.000Z",
    }));
    await writeFile(join(dir, "invalid.json"), JSON.stringify({
      projectName: "Invalid",
      host: "127.0.0.1",
      port: 0,
    }));

    try {
      const editors = await discoverLiveEditors({ registryDir: dir, timeoutMs: 500 });
      expect(editors).toHaveLength(1);
      expect(editors[0].instanceId).toBe("live");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("inspectEditorRegistry reports live, unreachable, and invalid entries", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-registry-inspect-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, "live.json"), JSON.stringify({
      instanceId: "live",
      projectName: "LiveProject",
      projectPath: "D:/Unity/LiveProject",
      host: "127.0.0.1",
      port: 19001,
      token: "good-token",
      updatedAtUtc: "2026-06-04T02:00:00.000Z",
    }));
    await writeFile(join(dir, "stale.json"), JSON.stringify({
      instanceId: "stale",
      projectName: "StaleProject",
      projectPath: "D:/Unity/StaleProject",
      host: "127.0.0.1",
      port: 19002,
      token: "old-token",
      processId: 222,
      updatedAtUtc: "2026-06-04T01:00:00.000Z",
    }));
    await writeFile(join(dir, "invalid.json"), JSON.stringify({ host: "127.0.0.1", port: 0 }));
    await writeFile(join(dir, "broken.json"), "{not-json");

    try {
      const inspected = await inspectEditorRegistry({
        registryDir: dir,
        handshake: async (entry: any) => entry.instanceId === "live",
        processAlive: (pid: number) => pid !== 222,
      });
      expect(inspected.missing).toBe(false);
      expect(inspected.entries.map((entry: any) => entry.status).sort())
        .toEqual(["invalid", "invalid", "live", "stale"]);
      expect(inspected.entries.find((entry: any) => entry.fileName === "stale.json")?.reason)
        .toBe("process 222 is not running");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("selectEditorBySelector matches index, instance id, name, and path", () => {
    const editors = sampleEditors();
    expect(selectEditorBySelector(editors, "2").instanceId).toBe("bravo-id");
    expect(selectEditorBySelector(editors, "alpha-id").projectName).toBe("AlphaGame");
    expect(selectEditorBySelector(editors, "bravogame").instanceId).toBe("bravo-id");
    expect(selectEditorBySelector(editors, "D:/Unity/AlphaGame").instanceId).toBe("alpha-id");
    expect(selectEditorBySelector(editors, "Unity/Bravo").instanceId).toBe("bravo-id");
    expect(() => selectEditorBySelector(editors, "missing")).toThrow("no connected Unity project");
  });

  test("selectEditorBySelector rejects ambiguous partial matches", () => {
    expect(() => selectEditorBySelector(sampleEditors(), "game"))
      .toThrow("select: --unity-project alpha-id");
    expect(() => selectEditorBySelector(sampleEditors(), "game"))
      .toThrow("select: --unity-project bravo-id");
    expect(() => selectEditorBySelector(sampleEditors(), "game"))
      .not.toThrow("alpha-token");
  });

  test("selectUnityTarget prompts for a connected project when multiple editors are live", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-select-target-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "alpha.json"), JSON.stringify(sampleEditors()[0]));
    await writeFile(join(dir, "bravo.json"), JSON.stringify(sampleEditors()[1]));

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    (stdin as any).isTTY = true;
    const chunks: Buffer[] = [];
    stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.end("2\n");

    try {
      const selected = await selectUnityTarget({
        registryDir: dir,
        handshake: async () => true,
        stdin,
        stdout,
      });
      expect(selected?.instanceId).toBe("bravo-id");
      expect(Buffer.concat(chunks).toString("utf8")).toContain("Select target project [1-2, id, name, or path]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("selectUnityTarget prompt accepts project name selectors", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-select-target-name-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "alpha.json"), JSON.stringify(sampleEditors()[0]));
    await writeFile(join(dir, "bravo.json"), JSON.stringify(sampleEditors()[1]));

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    (stdin as any).isTTY = true;
    stdin.end("BravoGame\n");

    try {
      const selected = await selectUnityTarget({
        registryDir: dir,
        handshake: async () => true,
        stdin,
        stdout,
      });
      expect(selected?.instanceId).toBe("bravo-id");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("selectUnityTarget requires an explicit selector for non-interactive multi-editor runs", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-select-target-nontty-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const stdin = new PassThrough();
    (stdin as any).isTTY = false;

    try {
      await writeFile(join(dir, "alpha.json"), JSON.stringify(sampleEditors()[0]));
      await writeFile(join(dir, "bravo.json"), JSON.stringify(sampleEditors()[1]));
      await expect(selectUnityTarget({
        registryDir: dir,
        handshake: async () => true,
        stdin,
        writeLine: () => {},
      })).rejects.toThrow("select: --unity-project alpha-id");
      await expect(selectUnityTarget({
        registryDir: dir,
        handshake: async () => true,
        stdin,
        writeLine: () => {},
      })).rejects.toThrow("select: --unity-project bravo-id");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("selectorFromEnv reads deterministic selector overrides", () => {
    expect(selectorFromEnv({ UOS_UNITY_PROJECT: "AlphaGame" })).toBe("AlphaGame");
    expect(selectorFromEnv({ UOS_TARGET: "bravo-id" })).toBe("bravo-id");
    expect(selectorFromEnv({ UOS_TARGET: "  " })).toBeUndefined();
  });

  test("buildTargetEnv injects selected Unity bridge and project metadata", () => {
    const env = buildTargetEnv({
      instanceId: "abc",
      projectName: "Chosen",
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
      token: "token",
    }, { KEEP: "1" });

    expect(env.KEEP).toBe("1");
    expect(env.UNITY_MCP_HOST).toBe("127.0.0.1");
    expect(env.UNITY_MCP_PORT).toBe("19001");
    expect(env.UNITY_MCP_TOKEN).toBe("token");
    expect(env.UOS_PROJECT_DIR).toBe("D:/Unity/Chosen");
    expect(env.UOS_CONTEXT_DIR).toBe(join("D:/Unity/Chosen", ".uos"));
    expect(env.UOS_EDITOR_INSTANCE_ID).toBe("abc");
    expect(env.UNITY_MCP_MATERIALS_DIR).toBe("D:/Unity/Chosen");
  });

  test("buildTargetEnv ignores inherited planning material root for selected targets unless opted in", () => {
    const env = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, { UNITY_MCP_MATERIALS_DIR: "D:/Plans" });

    expect(env.UNITY_MCP_MATERIALS_DIR).toBe("D:/Unity/Chosen");

    const inheritedEnv = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, {
      UNITY_MCP_MATERIALS_DIR: "D:/Plans",
      UOS_INHERIT_MATERIALS_DIR: "1",
    });
    expect(inheritedEnv.UNITY_MCP_MATERIALS_DIR).toBe("D:/Plans");

    const explicitBridgeEnv = buildTargetEnv(undefined, {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
      UOS_PROJECT_DIR: "D:/Unity/EnvProject",
      UNITY_MCP_MATERIALS_DIR: "D:/Plans",
    });
    expect(explicitBridgeEnv.UNITY_MCP_MATERIALS_DIR).toBe("D:/Plans");
    expect(explicitBridgeEnv.UOS_CONTEXT_DIR).toBe(join("D:/Unity/EnvProject", ".uos"));
  });

  test("resolveLaunchInputs resolves relative files against selected project when material env is inherited", () => {
    const target = { projectPath: "D:/Unity/Chosen" };
    const inputs = resolveLaunchInputs(target, {
      files: ["brief.md"],
      env: { UNITY_MCP_MATERIALS_DIR: "D:/OldPlans" },
    });
    expect(inputs.materialsDir).toBeUndefined();
    expect(inputs.files).toEqual([resolve("D:/Unity/Chosen", "brief.md")]);

    const inherited = resolveLaunchInputs(target, {
      files: ["brief.md"],
      env: {
        UNITY_MCP_MATERIALS_DIR: "D:/Plans",
        UOS_INHERIT_MATERIALS_DIR: "1",
      },
    });
    expect(inherited.materialsDir).toBe("D:/Plans");
    expect(inherited.files).toEqual([resolve("D:/Plans", "brief.md")]);

    const explicitBridge = resolveLaunchInputs(undefined, {
      files: ["brief.md"],
      env: {
        UOS_PROJECT_DIR: "D:/Unity/EnvProject",
        UNITY_MCP_MATERIALS_DIR: "D:/Plans",
      },
    });
    expect(explicitBridge.materialsDir).toBe("D:/Plans");
    expect(explicitBridge.files).toEqual([resolve("D:/Plans", "brief.md")]);
  });

  test("buildTargetEnv preserves explicit launcher planning material root", () => {
    const env = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, { UNITY_MCP_MATERIALS_DIR: "D:/OldPlans" }, {
      materialsDir: "D:/Plans",
    });

    expect(env.UNITY_MCP_MATERIALS_DIR).toBe(resolve("D:/Plans"));
  });

  test("buildTargetEnv clears stale launcher-owned context attachments", () => {
    const env = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, {
      UOS_CONTEXT_SUMMARY: "[uos context] projectName: PreviousGame",
      UOS_ATTACHED_FILES: JSON.stringify(["D:/OldPlans/brief.pdf"]),
    });

    expect(env.UOS_CONTEXT_SUMMARY).toBeUndefined();
    expect(env.UOS_ATTACHED_FILES).toBeUndefined();

    const attachedEnv = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, {
      UOS_ATTACHED_FILES: JSON.stringify(["D:/OldPlans/brief.pdf"]),
    }, {
      files: ["D:/NewPlans/mockup.png"],
    });
    expect(JSON.parse(attachedEnv.UOS_ATTACHED_FILES)).toEqual([resolve("D:/NewPlans/mockup.png")]);
  });

  test("buildTargetEnv injects launcher planning material root", () => {
    expect(resolveLaunchMaterialsDir("Assets/Plans", { projectPath: "D:/Unity/Chosen" }, {}))
      .toBe(resolve("D:/Unity/Chosen", "Assets/Plans"));
    expect(resolveLaunchMaterialsDir("Assets/Plans", undefined, { env: { UOS_PROJECT_DIR: "D:/Unity/EnvProject" } }))
      .toBe(resolve("D:/Unity/EnvProject", "Assets/Plans"));
    const env = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, { UNITY_MCP_MATERIALS_DIR: "D:/OldPlans" }, {
      materialsDir: "D:/NewPlans",
    });

    expect(env.UNITY_MCP_MATERIALS_DIR).toBe(resolve("D:/NewPlans"));

    const explicitBridgeEnv = buildTargetEnv(undefined, {
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "17801",
      UNITY_MCP_TOKEN: "token",
      UOS_PROJECT_DIR: "D:/Unity/EnvProject",
    }, {
      materialsDir: "Assets/Plans",
    });
    expect(explicitBridgeEnv.UNITY_MCP_MATERIALS_DIR)
      .toBe(resolve("D:/Unity/EnvProject", "Assets/Plans"));
  });

  test("buildTargetEnv injects launch material scan limits for tool defaults", () => {
    const inherited = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, {
      UOS_MAX_MATERIAL_CANDIDATES: "0",
      UOS_MAX_MATERIAL_DEPTH: "0",
      UOS_MAX_MATERIAL_SCAN_FILES: "1",
    });
    expect(inherited.UOS_MAX_MATERIAL_CANDIDATES).toBeUndefined();
    expect(inherited.UOS_MAX_MATERIAL_DEPTH).toBeUndefined();
    expect(inherited.UOS_MAX_MATERIAL_SCAN_FILES).toBeUndefined();

    const optIn = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, {
      UOS_MAX_MATERIAL_CANDIDATES: "4",
      UOS_MAX_MATERIAL_DEPTH: "2",
      UOS_MAX_MATERIAL_SCAN_FILES: "80",
      UOS_INHERIT_MATERIAL_LIMITS: "1",
    });
    expect(optIn.UOS_MAX_MATERIAL_CANDIDATES).toBe("4");
    expect(optIn.UOS_MAX_MATERIAL_DEPTH).toBe("2");
    expect(optIn.UOS_MAX_MATERIAL_SCAN_FILES).toBe("80");

    const env = buildTargetEnv({
      projectPath: "D:/Unity/Chosen",
      host: "127.0.0.1",
      port: 19001,
    }, {
      UOS_MAX_MATERIAL_CANDIDATES: "0",
      UOS_MAX_MATERIAL_DEPTH: "0",
      UOS_MAX_MATERIAL_SCAN_FILES: "1",
    }, {
      maxMaterialCandidates: 2,
      maxMaterialDepth: 3,
      maxMaterialScanFiles: 40,
    });

    expect(env.UOS_MAX_MATERIAL_CANDIDATES).toBe("2");
    expect(env.UOS_MAX_MATERIAL_DEPTH).toBe("3");
    expect(env.UOS_MAX_MATERIAL_SCAN_FILES).toBe("40");
  });

  test("buildForwardArgs injects UOS attachments for opencode run", () => {
    const target = { projectPath: "D:/Unity/Chosen" };
    expect(shouldPrepareRunContextAttachment(["run", "make a menu"])).toBe(true);
    expect(shouldPrepareRunContextAttachment(["--print-logs", "run", "make a menu"])).toBe(true);
    expect(shouldPrepareRunContextAttachment(["run", "--help"])).toBe(false);
    expect(shouldPrepareRunContextAttachment(["--print-logs", "run", "-h"])).toBe(false);
    expect(shouldPrepareRunContextAttachment(["models"])).toBe(false);
    expect(shouldPrepareRunContextAttachment([])).toBe(false);
    expect(shouldPrepareLaunchContext(["run", "make a menu"])).toBe(true);
    expect(shouldPrepareLaunchContext(["--model", "anthropic/claude-opus-4-8"])).toBe(true);
    expect(shouldPrepareLaunchContext([])).toBe(true);
    expect(shouldPrepareLaunchContext(["--help"])).toBe(false);
    expect(shouldPrepareLaunchContext(["--version"])).toBe(false);
    expect(shouldPrepareLaunchContext(["models"])).toBe(false);
    expect(shouldPrepareLaunchContext(["--print-logs", "models"])).toBe(false);
    expect(shouldPrepareLaunchContext(["run", "--help"])).toBe(false);
    expect(shouldPrepareLaunchContext(["--print-logs", "run", "-h"])).toBe(false);
    expect(shouldPrintLaunchSummary(["run", "make a menu"])).toBe(true);
    expect(shouldPrintLaunchSummary(["--model", "anthropic/claude-opus-4-8"])).toBe(true);
    expect(shouldPrintLaunchSummary([])).toBe(true);
    expect(shouldPrintLaunchSummary(["--help"])).toBe(false);
    expect(shouldPrintLaunchSummary(["--version"])).toBe(false);
    expect(shouldPrintLaunchSummary(["models"])).toBe(false);
    expect(shouldPrintLaunchSummary(["--print-logs", "models"])).toBe(false);
    expect(shouldPrintLaunchSummary(["run", "--help"])).toBe(false);
    expect(shouldPrintLaunchSummary(["--print-logs", "run", "-h"])).toBe(false);

    expect(resolveLaunchFilePath("brief.md", target, { materialsDir: "D:/Plans" }))
      .toBe(resolve("D:/Plans", "brief.md"));
    expect(resolveLaunchFilePath("brief.md", undefined, { env: { UOS_PROJECT_DIR: "D:/Unity/EnvProject" } }))
      .toBe(resolve("D:/Unity/EnvProject", "brief.md"));
    expect(buildForwardArgs(["run", "make a menu"], target, {
      materialsDir: "D:/Plans",
      files: ["brief.md", "mockup.png"],
      contextFiles: "C:/Temp/uos-run-context.md",
    })).toEqual([
      "run",
      "--file",
      "C:/Temp/uos-run-context.md",
      "--file",
      resolve("D:/Plans", "brief.md"),
      "--agent",
      "ochestrator",
      "make a menu",
    ]);
    expect(buildForwardArgs(["run", "--agent", "custom-agent", "make a menu"], target, {
      files: ["brief.md"],
    })).toEqual([
      "run",
      "--file",
      resolve("D:/Unity/Chosen", "brief.md"),
      "--agent",
      "ochestrator",
      "make a menu",
    ]);
    expect(buildForwardArgs(["--print-logs", "run", "make a menu"], target, {
      files: ["brief.md"],
      contextFiles: "C:/Temp/uos-run-context.md",
    })).toEqual([
      "--print-logs",
      "run",
      "--file",
      "C:/Temp/uos-run-context.md",
      "--file",
      resolve("D:/Unity/Chosen", "brief.md"),
      "--agent",
      "ochestrator",
      "make a menu",
    ]);
    expect(buildForwardArgs(["run", "--continue", "make the title green"], target, {
      files: ["brief.md"],
      contextFiles: "C:/Temp/uos-run-context.md",
    })).toEqual([
      "run",
      "--file",
      "C:/Temp/uos-run-context.md",
      "--file",
      resolve("D:/Unity/Chosen", "brief.md"),
      "--agent",
      "ochestrator",
      "--continue",
      "make the title green",
    ]);
    expect(buildForwardArgs(["run", "create from binary materials"], target, {
      files: ["brief.pdf", "mockup.png", "deck.pptx"],
      contextFiles: "C:/Temp/uos-run-context.md",
    })).toEqual([
      "run",
      "--file",
      "C:/Temp/uos-run-context.md",
      "--agent",
      "ochestrator",
      "create from binary materials",
    ]);
    const tuiArgs = buildForwardArgs([], target, {
      materialsDir: "D:/Plans",
      files: ["brief.pdf"],
    });
    expect(tuiArgs[0]).toBe("--prompt");
    expect(tuiArgs[1]).toContain("# UOS Startup");
    expect(tuiArgs[1]).toContain("get_uos_context");
    expect(tuiArgs[1]).toContain("select_uos_mode");
    expect(tuiArgs[1]).toContain("Selected Target");
    expect(tuiArgs[1]).toContain(resolve("D:/Plans", "brief.pdf"));
    expect(tuiArgs[1]).toContain("read_planning_material");
    expect(tuiArgs[1]).toContain("## Recommended Starter Tasks");
    expect(tuiArgs[1]).toContain("## Example Prompts");
    expect(tuiArgs[1]).toContain("## Planner-Friendly UX");
    expect(tuiArgs[1]).toContain("Create a screen from an image, playable video, PPTX, PDF, or DOCX planning material.");
    expect(tuiArgs[1]).toContain("현재 프로젝트에 어떤 화면과 자료가 있는지 보여줘.");
    expect(tuiArgs[1]).toContain("Ask clarification questions with 2-3 concrete choices plus optional free-form input.");
    expect(tuiArgs[1]).toContain("Before save/delete/broad changes, summarize impact and ask for explicit approval.");
    expect(tuiArgs[1]).toContain("After work, summarize what changed, preview/verification status, save state, and next options.");
    expect(tuiArgs).toContain("--agent");
    expect(tuiArgs).toContain("ochestrator");

    const launchEnv = buildTargetEnv(target, {}, { launchInputs: { files: [] } });
    const tuiWithLaunchEnv = buildForwardArgs([], target, {
      launchInputs: { files: [] },
      env: launchEnv,
    });
    expect(tuiWithLaunchEnv[0]).toBe("--prompt");
    expect(tuiWithLaunchEnv[1]).toContain("Planning material directory: D:/Unity/Chosen");

    const tuiWithResponseLanguage = buildForwardArgs([], target, {
      launchInputs: { files: [] },
      env: { UOS_RESPONSE_LANGUAGE: "Korean" },
    });
    expect(tuiWithResponseLanguage[1]).toContain("## Response Language");
    expect(tuiWithResponseLanguage[1]).toContain("Use Korean as the default response language");

    const tuiWithContextSummary = buildForwardArgs([], target, {
      launchInputs: { materialsDir: "D:/Plans", files: ["deck.pptx"] },
      env: {
        UOS_CONTEXT_SUMMARY: "[uos context] projectName: Chosen\nscreen: MainScreen_ID Main",
        UOS_BRIDGE_SUPPORTED_TOOLS: JSON.stringify(["get_project_info", "create_ui_screen", "save_scene"]),
        UOS_BRIDGE_WRITE_TOOLS: JSON.stringify(["create_ui_screen", "save_scene"]),
      },
    });
    expect(tuiWithContextSummary[0]).toBe("--prompt");
    expect(tuiWithContextSummary[1]).toContain("Bridge required tools:");
    expect(tuiWithContextSummary[1]).toContain("Bridge supported tools: 3");
    expect(tuiWithContextSummary[1]).toContain("Bridge required write tools:");
    expect(tuiWithContextSummary[1]).toContain("Bridge write tools: create_ui_screen, save_scene");
    expect(tuiWithContextSummary[1]).toContain("deck.pptx");
    expect(tuiWithContextSummary[1]).toContain("create_pptx_deck_screens");
    expect(tuiWithContextSummary[1]).toContain("Launch Context Summary Excerpt");
    expect(tuiWithContextSummary[1]).toContain("MainScreen_ID");

    const disconnectedCatalogTui = buildForwardArgs([], undefined, {
      launchInputs: { materialsDir: "D:/Unity/Alpha", files: [] },
      env: {
        UOS_PROJECT_NAME: "AlphaGame",
        UOS_PROJECT_DIR: "D:/Unity/Alpha",
        UOS_PROJECT_CATALOG_STATUS: "not-installed",
        UOS_PROJECT_UOS_INSTALLED: "0",
        UOS_PROJECT_BRIDGE_LIVE: "0",
      },
    });
    expect(disconnectedCatalogTui[1]).toContain("Unity project: AlphaGame at D:/Unity/Alpha");
    expect(disconnectedCatalogTui[1]).toContain("UOS launcher project status: not-installed");
    expect(disconnectedCatalogTui[1]).toContain("UOS package installed: no");
    expect(disconnectedCatalogTui[1]).toContain("Unity Editor bridge live: no");

    const tuiWithOptions = buildForwardArgs(["--model", "anthropic/claude-opus-4-8"], target, {});
    expect(tuiWithOptions[0]).toBe("--prompt");
    expect(tuiWithOptions).toEqual(expect.arrayContaining([
      "--agent",
      "ochestrator",
      "--model",
      "anthropic/claude-opus-4-8",
    ]));

    const tuiWithGlobalOption = buildForwardArgs(["--print-logs", "--model", "anthropic/claude-opus-4-8"], target, {});
    expect(tuiWithGlobalOption[0]).toBe("--prompt");
    expect(tuiWithGlobalOption).toEqual(expect.arrayContaining([
      "--agent",
      "ochestrator",
      "--print-logs",
      "--model",
      "anthropic/claude-opus-4-8",
    ]));

    expect(buildForwardArgs(["--agent", "custom-agent"], target, {})).toEqual([
      "--prompt",
      expect.stringContaining("get_uos_context"),
      "--agent",
      "ochestrator",
    ]);
    expect(buildForwardArgs(["--prompt", "custom prompt", "--agent", "custom-agent"], target, {})).toEqual([
      "--agent",
      "ochestrator",
      "--prompt",
      "custom prompt",
    ]);
    const continuedTuiArgs = buildForwardArgs(["--continue"], target, {});
    expect(continuedTuiArgs[0]).toBe("--prompt");
    expect(continuedTuiArgs[1]).toContain("# UOS Startup");
    expect(continuedTuiArgs[1]).toContain("Call `get_uos_context` first");
    expect(continuedTuiArgs).toEqual(expect.arrayContaining(["--agent", "ochestrator", "--continue"]));
    expect(buildForwardArgs(["--prompt", "resume with user context", "--continue"], target, {})).toEqual([
      "--agent",
      "ochestrator",
      "--prompt",
      "resume with user context",
      "--continue",
    ]);
    const sessionTuiArgs = buildForwardArgs(["--session", "sess_123"], target, {});
    expect(sessionTuiArgs[0]).toBe("--prompt");
    expect(sessionTuiArgs[1]).toContain("# UOS Startup");
    expect(sessionTuiArgs).toEqual(expect.arrayContaining(["--agent", "ochestrator", "--session", "sess_123"]));
    expect(buildForwardArgs(["models"], target, {})).toEqual(["models"]);
    expect(buildForwardArgs(["--print-logs", "models"], target, {})).toEqual(["--print-logs", "models"]);
    expect(buildForwardArgs(["--help"], target, {})).toEqual(["--help"]);
    expect(buildForwardArgs(["--version"], target, {})).toEqual(["--version"]);
    expect(buildForwardArgs(["--print-logs", "--version"], target, {})).toEqual(["--print-logs", "--version"]);
    expect(buildForwardArgs(["run", "--help"], target, { files: ["brief.pdf"] })).toEqual(["run", "--help"]);
    expect(buildForwardArgs(["--print-logs", "run", "-h"], target, { files: ["brief.pdf"] })).toEqual([
      "--print-logs",
      "run",
      "-h",
    ]);
    expect(buildForwardArgs(["session", "--help"], target, {})).toEqual(["session", "--help"]);
    expect(buildForwardArgs(["--log-level", "DEBUG", "debug", "config"], target, {})).toEqual([
      "--log-level",
      "DEBUG",
      "debug",
      "config",
    ]);

    const env = buildTargetEnv(target, {}, {
      materialsDir: "D:/Plans",
      files: ["brief.pdf"],
    });
    expect(JSON.parse(env.UOS_ATTACHED_FILES)).toEqual([resolve("D:/Plans", "brief.pdf")]);
  });

  test("buildEntryDryRun prepares interactive UOS startup for image, document, and PPTX materials", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-entry-materials-dry-run-test");
    const plansDir = join(projectDir, "Plans");
    const mockupPath = join(plansDir, "mockup.png");
    const docxPath = join(plansDir, "brief.docx");
    const deckPath = join(plansDir, "deck.pptx");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(mockupPath, "png placeholder");
    await writeFile(docxPath, "docx placeholder");
    await writeFile(deckPath, "pptx placeholder");

    try {
      const result = await buildEntryDryRun(liveTarget(projectDir), {
        entryMaterialsDir: "Plans",
        entryFiles: ["mockup.png", "brief.docx", "deck.pptx"],
        entryMaxMaterialCandidates: 6,
        entryMaxMaterialDepth: 2,
        entryMaxMaterialScanFiles: 25,
        env: {},
      });

      expect(result.launchInputs.materialsDir).toBe(plansDir);
      expect(result.launchInputs.files).toEqual([mockupPath, docxPath, deckPath]);
      expect(result.readiness.ready).toBe(true);
      expect(result.opencodeArgs[0]).toBe("--prompt");
      expect(result.opencodeArgs).toContain("--agent");
      expect(result.opencodeArgs).toContain("ochestrator");

      const prompt = result.opencodeArgs[1];
      expect(prompt).toContain("# UOS Startup");
      expect(prompt).toContain("get_uos_context");
      expect(prompt).toContain("read_planning_material");
      expect(prompt).toContain("analyze_planning_materials");
      expect(prompt).toContain(mockupPath);
      expect(prompt).toContain(docxPath);
      expect(prompt).toContain(deckPath);
      expect(prompt).toContain("image/mockup path");
      expect(prompt).toContain("DOCX material");
      expect(prompt).toContain("PPTX deck");
      expect(prompt).toContain("planningMaterialCandidates: 3");
      expect(prompt).toContain("mockup.png [image");
      expect(prompt).toContain("brief.docx [docx");
      expect(prompt).toContain("deck.pptx [pptx");
      expect(prompt).toContain("create_screen_from_material");
      expect(prompt).toContain("create_document_screen");
      expect(prompt).toContain("create_pptx_deck_screens");
      expect(prompt).toContain("verify_screen_against_reference");
      expect(prompt).toContain("## Recommended Starter Tasks");
      expect(prompt).toContain("## Example Prompts");
      expect(prompt).toContain("## Planner-Friendly UX");
      expect(prompt).toContain("Create a screen from an image, playable video, PPTX, PDF, or DOCX planning material.");
      expect(prompt).toContain("이 PPTX를 기준으로 첫 화면을 만들어줘.");
      expect(prompt).toContain("이 이미지 시안처럼 홈 화면을 만들어줘.");
      expect(prompt).toContain("Ask clarification questions with 2-3 concrete choices plus optional free-form input.");
      expect(prompt).toContain("Before save/delete/broad changes, summarize impact and ask for explicit approval.");
      expect(prompt).toContain("After work, summarize what changed, preview/verification status, save state, and next options.");

      expect(result.output).toContain("[uos] forwarded opencode argv:");
      expect(result.output).toContain("UOS_ATTACHED_FILES:");
      expect(result.output).toContain("UOS_MAX_MATERIAL_CANDIDATES: 6");
      expect(result.output).toContain("UOS_MAX_MATERIAL_DEPTH: 2");
      expect(result.output).toContain("UOS_MAX_MATERIAL_SCAN_FILES: 25");
      expect(result.output).toContain("UOS_BRIDGE_SUPPORTED_TOOLS");
      expect(result.output).toContain("UNITY_MCP_TOKEN: (set)");
      expect(result.output).not.toContain("good-token");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("buildMvpValidationReport prints user-led validation commands without leaking bridge token", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-mvp-validation-test");
    const plansDir = join(projectDir, "Plans");
    const deckPath = join(plansDir, "lobby.pptx");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(deckPath, "pptx placeholder");

    try {
      const report = await buildMvpValidationReport(liveTarget(projectDir), {
        selector: "MyGame",
        materialsDir: "Plans",
        files: ["lobby.pptx"],
        prompt: "create lobby",
        maxMaterialCandidates: 5,
        env: {},
      });
      expect(report.ok).toBe(true);
      expect(report.launchInputs.materialsDir).toBe(plansDir);
      expect(report.launchInputs.files).toEqual([deckPath]);
      expect(report.preflightSummary.status).toBe("ready-for-user-validation");
      expect(report.preflightSummary.commandLines.missing).toEqual([]);
      expect(report.preflightSummary.commandLines.required).toContain("publicMvpE2E");
      expect(report.preflightSummary.acceptanceGates.count).toBe(6);
      expect(report.preflightSummary.acceptanceGates.pendingUserEvidence).toEqual([
        "consumer-install-and-runtime",
        "ready-and-context",
        "public-mvp-preflight",
        "entry-dry-run",
        "real-ai-edit",
        "follow-up-edit",
      ]);
      expect(report.preflightSummary.acceptanceGates.optionalUserEvidence).toEqual([]);
      expect(report.preflightSummary.acceptanceGates.blockedByPreflight).toEqual([]);
      expect(report.commands.doctorProject).toEqual(["doctor", "--project", projectDir]);
      expect(report.commands.doctorRuntime).toEqual(["doctor", "--runtime"]);
      expect(report.commands.ready).toEqual(["ready", "--wait", "--unity-project", "MyGame"]);
      expect(report.commands.context).toEqual(["context", "--unity-project", "MyGame", "--uos-materials", plansDir, "--uos-file", deckPath]);
      expect(report.commands.publicMvpE2E).toEqual(["e2e", "--project", projectDir, "--read-only", "--public-mvp-json", "--uos-materials", plansDir, "--uos-file", deckPath]);
      expect(report.commands.runDryRun).toEqual(["--unity-project", "MyGame", "--uos-materials", plansDir, "--uos-file", deckPath, "--uos-dry-run", "run", "create lobby"]);
      expect(report.commands.runAiEdit).toEqual(["--unity-project", "MyGame", "--uos-materials", plansDir, "--uos-file", deckPath, "run", "create lobby"]);
      expect(report.acceptanceGates.map((gate: any) => gate.id)).toEqual([
        "consumer-install-and-runtime",
        "ready-and-context",
        "public-mvp-preflight",
        "entry-dry-run",
        "real-ai-edit",
        "follow-up-edit",
      ]);
      expect(report.acceptanceGates.every((gate: any) => gate.evidenceStatus.state === "pending-user-evidence")).toBe(true);
      expect(report.acceptanceGates.every((gate: any) => gate.evidenceStatus.userEvidenceRequired === true)).toBe(true);
      expect(report.acceptanceGates.every((gate: any) => gate.evidenceStatus.automaticPreflightReady === true)).toBe(true);
      expect(report.acceptanceGates.find((gate: any) => gate.id === "real-ai-edit").evidenceStatus.commandKeysPresent)
        .toEqual(["runAiEdit"]);

      const output = formatMvpValidationReport(report);
      expect(output).toContain("[uos mvp] validation preflight");
      expect(output).toContain("ready: yes");
      expect(output).toContain("material validation: ready");
      expect(output).toContain("preflight summary:");
      expect(output).toContain("status: ready-for-user-validation");
      expect(output).toContain("command lines: 9/9");
      expect(output).toContain("acceptance gates: 6");
      expect(output).toContain("bridge required tools: 17/17");
      expect(output).toContain("1. project install check: uos doctor --project");
      expect(output).toContain("2. opencode runtime check: uos doctor --runtime");
      expect(output).toContain("3. readiness: uos ready --wait --unity-project MyGame");
      expect(output).toContain("5. public MVP E2E: uos e2e --project");
      expect(output).toContain("6. chat dry-run: uos chat --unity-project MyGame");
      expect(output).toContain("7. run dry-run: uos --unity-project MyGame");
      expect(output).toContain("8. AI edit: uos --unity-project MyGame");
      expect(output).toContain("9. follow-up chat: uos chat --unity-project MyGame --continue");
      expect(output).toContain("acceptance gates:");
      expect(output).toContain("Consumer project package and opencode runtime");
      expect(output).toContain("status: pending-user-evidence; user evidence: required");
      expect(output).toContain("Real AI material edit");
      expect(output).toContain("The AI calls `get_uos_context` before mutating Unity.");
      expect(output).toContain(deckPath);
      expect(output).not.toContain("good-token");

      const json = formatMvpValidationJson(report);
      const parsed = JSON.parse(json);
      expect(parsed.ok).toBe(true);
      expect(parsed.target.projectName).toBe("LiveProject");
      expect(parsed.target.token).toBeUndefined();
      expect(parsed.launchInputs.files).toEqual([deckPath]);
      expect(parsed.materialReady).toBe(true);
      expect(parsed.preflightSummary.status).toBe("ready-for-user-validation");
      expect(parsed.preflightSummary.next).toBe("run-user-led-mvp-gates");
      expect(parsed.preflightSummary.commandLines.missing).toEqual([]);
      expect(parsed.preflightSummary.commandLines.present).toContain("publicMvpE2E");
      expect(parsed.preflightSummary.acceptanceGates.pendingUserEvidence).toContain("real-ai-edit");
      expect(parsed.preflightSummary.acceptanceGates.blockedByPreflight).toEqual([]);
      expect(parsed.commandLines.runAiEdit).toContain("uos --unity-project MyGame");
      expect(parsed.commandLines.runAiEdit).toContain("create lobby");
      expect(parsed.commandLines.doctorProject).toContain("uos doctor --project");
      expect(parsed.commandLines.doctorRuntime).toBe("uos doctor --runtime");
      expect(parsed.readiness.requiredTools).toContain("create_ui_screen");
      expect(parsed.acceptanceGates.map((gate: any) => gate.id)).toContain("consumer-install-and-runtime");
      expect(parsed.acceptanceGates.map((gate: any) => gate.id)).toContain("real-ai-edit");
      expect(parsed.acceptanceGates.find((gate: any) => gate.id === "real-ai-edit").evidenceStatus.state)
        .toBe("pending-user-evidence");
      expect(parsed.acceptanceGates.find((gate: any) => gate.id === "public-mvp-preflight").commands.publicMvpE2E)
        .toContain("uos e2e --project");
      expect(json).not.toContain("good-token");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("buildMvpValidationReport blocks when no planning material is supplied", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-mvp-no-material-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      const report = await buildMvpValidationReport(liveTarget(projectDir), {
        selector: "MyGame",
        env: {},
      });
      expect(report.ok).toBe(false);
      expect(report.preflightSummary.status).toBe("blocked");
      expect(report.preflightSummary.next).toBe("resolve-preflight-blockers");
      expect(report.preflightSummary.materialReady).toBe(false);
      expect(report.preflightSummary.acceptanceGates.blockedByPreflight).toContain("real-ai-edit");
      expect(report.acceptanceGates.find((gate: any) => gate.id === "real-ai-edit").evidenceStatus.state)
        .toBe("blocked-by-preflight");
      const output = formatMvpValidationReport(report);
      expect(output).toContain("ready: no");
      expect(output).toContain("status: blocked");
      expect(output).toContain("status: blocked-by-preflight; user evidence: required");
      expect(output).toContain("material validation: missing");
      expect(output).toContain("No planning material was supplied");
      expect(output).not.toContain("good-token");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("saveMvpValidationReport writes token-redacted MVP evidence JSON", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-mvp-save-test");
    const plansDir = join(projectDir, "Plans");
    const deckPath = join(plansDir, "lobby.pptx");
    const evidencePath = join(projectDir, ".uos", "mvp-evidence.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(deckPath, "pptx placeholder");

    try {
      const report = await buildMvpValidationReport(liveTarget(projectDir), {
        selector: "MyGame",
        materialsDir: "Plans",
        files: ["lobby.pptx"],
        prompt: "create lobby",
        env: {},
      });
      const savedPath = await saveMvpValidationReport(report, evidencePath);
      expect(savedPath).toBe(resolve(evidencePath));

      const parsed = JSON.parse(await readFile(evidencePath, "utf8"));
      expect(parsed.ok).toBe(true);
      expect(parsed.target.token).toBeUndefined();
      expect(parsed.commandLines.runAiEdit).toContain("create lobby");
      expect(parsed.preflightSummary.acceptanceGates.pendingUserEvidence).toContain("real-ai-edit");
      expect(parsed.acceptanceGates.find((gate: any) => gate.id === "real-ai-edit").evidenceStatus.state)
        .toBe("pending-user-evidence");
      expect(JSON.stringify(parsed)).not.toContain("good-token");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("formatMvpProgressReport summarizes a saved MVP evidence bundle", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-mvp-progress-test");
    const plansDir = join(projectDir, "Plans");
    const deckPath = join(plansDir, "lobby.pptx");
    const evidencePath = join(projectDir, ".uos", "mvp-evidence.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(plansDir, { recursive: true });
    await writeFile(deckPath, "pptx placeholder");

    try {
      const report = await buildMvpValidationReport(liveTarget(projectDir), {
        selector: "MyGame",
        materialsDir: "Plans",
        files: ["lobby.pptx"],
        prompt: "create lobby",
        env: {},
      });
      await saveMvpValidationReport(report, evidencePath);
      const data = JSON.parse(await readFile(evidencePath, "utf8"));

      const output = formatMvpProgressReport({ path: evidencePath, data });
      expect(output).toContain("[uos mvp-progress] evidence bundle");
      expect(output).toContain(`file: ${evidencePath}`);
      expect(output).toContain("preflight: ready-for-user-validation next=run-user-led-mvp-gates");
      expect(output).toContain("command lines: 9/9");
      expect(output).toContain("user evidence progress: 0/6 (0%)");
      expect(output).toContain("acceptance gates: 6 total, 6 pending, 0 optional, 0 blocked");
      expect(output).toContain("pending user evidence:");
      expect(output).toContain("next gate: Consumer project package and opencode runtime");
      expect(output).toContain("doctorProject: uos doctor --project");
      expect(output).not.toContain("good-token");

      const progressJson = JSON.parse(formatMvpProgressJson({ path: evidencePath, data }));
      expect(progressJson.acceptanceGates.pendingUserEvidence).toContain("real-ai-edit");
      expect(progressJson.acceptanceGates.progressPercent).toBe(0);
      expect(progressJson.nextGate.id).toBe("consumer-install-and-runtime");
      expect(JSON.stringify(progressJson)).not.toContain("good-token");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("validateLaunchInputs verifies material directories and files", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-launch-inputs-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "Plans"), { recursive: true });
    await writeFile(join(dir, "Plans", "brief.md"), "# Brief");
    await writeFile(join(dir, "Plans", "mockup.png"), "png bytes");

    try {
      const target = { projectPath: dir };
      const inputs = resolveLaunchInputs(target, {
        materialsDir: "Plans",
        files: ["brief.md", "mockup.png"],
      });
      expect(inputs.materialsDir).toBe(join(dir, "Plans"));
      expect(inputs.files).toEqual([join(dir, "Plans", "brief.md"), join(dir, "Plans", "mockup.png")]);
      await expect(validateLaunchInputs(target, { launchInputs: inputs })).resolves.toEqual(inputs);
      await expect(validateLaunchInputs(target, { materialsDir: "missing" })).rejects.toThrow("directory not found");
      await expect(validateLaunchInputs(target, { materialsDir: "Plans", files: ["missing.png"] }))
        .rejects.toThrow("file not found");

      const summary = formatLaunchSummary(target, ["run", "--file", inputs.files[0], "make UI"], inputs);
      expect(summary).toContain("launch summary");
      expect(summary).toContain("materials:");
      expect(summary).toContain("attached files: 2");
      expect(summary).toContain("attachment routing:");
      expect(summary).toContain("UOS tools: 2 file(s) via UOS_ATTACHED_FILES/read_planning_material");
      expect(summary).toContain("opencode run --file: 1 text-like file(s)");
      expect(summary).toContain("not passed to opencode --file: 1 binary/visual file(s)");
      expect(summary).not.toContain("TUI launches expose attached files");
      const tuiSummary = formatLaunchSummary(target, ["--agent", "ochestrator"], inputs);
      expect(tuiSummary).toContain("attached files: 2");
      expect(tuiSummary).toContain("opencode run --file: not used for TUI/non-run launches");
      expect(tuiSummary).toContain("TUI launches expose attached files through UOS_ATTACHED_FILES/get_uos_context");
      expect(tuiSummary).toContain("use `uos run` for opencode --file attachments");
      const promptSummary = formatLaunchSummary(target, [
        "--prompt",
        "# UOS Startup\n\nCall get_uos_context before mutating Unity.\n\n## Selected Target",
        "--agent",
        "ochestrator",
        "--continue",
      ]);
      expect(promptSummary).toContain("opencode: --prompt <# UOS Startup ...> --agent ochestrator --continue");
      expect(promptSummary).not.toContain("Call get_uos_context before mutating Unity");
      const warningSummary = formatLaunchSummary(target, ["run", "make UI"], inputs, {
        warnings: ["Unity bridge did not report supportedTools"],
      });
      expect(warningSummary).toContain("warnings:");
      expect(warningSummary).toContain("Unity bridge did not report supportedTools");
      const capabilitySummary = formatLaunchSummary(target, ["run", "make UI"], inputs, evaluateLaunchBridgeCapabilities({
        UOS_BRIDGE_SUPPORTED_TOOLS: JSON.stringify(["get_project_info", "list_screens"]),
        UOS_BRIDGE_WRITE_TOOLS: JSON.stringify(["save_scene"]),
      }));
      expect(capabilitySummary).toContain("bridge capabilities:");
      expect(capabilitySummary).toContain("required tools");
      expect(capabilitySummary).toContain("missing required tools:");
      expect(capabilitySummary).toContain("required write tools");
      expect(capabilitySummary).toContain("missing required write tools:");
      const contextSummary = formatLaunchSummary(target, ["--agent", "ochestrator"], inputs, undefined, {
        UOS_CONTEXT_SUMMARY: [
          "[uos context] projectName: LaunchGame",
          "[uos context] screens: 2",
          "[uos context] activeScreen: Main_ID",
          "[uos context] latestVerification: screen=Main_ID (Main) verdict=needs review mae=0.1 mismatch=0.2 diff=C:/Temp/uos/diff-Main_ID.png",
          "[uos context] planningMaterialCandidates: 3 (document=1, image=1, pptx=1)",
        ].join("\n"),
      });
      expect(contextSummary).toContain("context:");
      expect(contextSummary).toContain("screens: 2");
      expect(contextSummary).toContain("active screen: Main_ID");
      expect(contextSummary).toContain("latest verification: screen=Main_ID (Main) verdict=needs review");
      expect(contextSummary).toContain("material candidates: 3 (document=1, image=1, pptx=1)");
      const dryRun = formatLaunchDryRun(target, ["run", "--file", inputs.files[0], "make UI"], {
        UNITY_MCP_HOST: "127.0.0.1",
        UNITY_MCP_PORT: "17801",
        UNITY_MCP_TOKEN: "secret-token",
        UOS_PROJECT_DIR: dir,
        UNITY_MCP_MATERIALS_DIR: inputs.materialsDir,
        UOS_ATTACHED_FILES: JSON.stringify(inputs.files),
        UOS_CONTEXT_SUMMARY: "[uos context] screens: 1\n[uos context] latestVerification: screen=Main_ID verdict=close mismatch=0.01",
      }, inputs);
      expect(dryRun).toContain("forwarded opencode argv");
      expect(dryRun).toContain("UNITY_MCP_TOKEN: (set)");
      expect(dryRun).toContain("UOS_ATTACHED_FILES:");
      expect(dryRun).toContain("latest verification: screen=Main_ID verdict=close mismatch=0.01");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("buildLaunchEnv injects concise persisted UOS context summary", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-launch-env-test");
    const uosDir = join(projectDir, ".uos");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(uosDir, { recursive: true });
    await writeFile(join(uosDir, "project.json"), JSON.stringify({
      projectName: "LaunchContextGame",
      projectPath: projectDir,
    }));
    await writeFile(join(uosDir, "screens.json"), JSON.stringify({
      version: "1.0.0",
      updatedAt: "2026-06-04T04:00:00.000Z",
      lastSavedScenePath: "Assets/UOS_Generated.unity",
      screens: {
        Main_ID: {
          screenId: "Main_ID",
          screenName: "Main",
          source: {
            tool: "create_reference_screen_from_material",
            kind: "pptx",
            path: "D:/Plans/lobby.pptx",
            slideNumber: 1,
            renderedPath: "C:/Temp/uos/lobby-slide1.png",
            assetPaths: ["Assets/UOS/PPTX/lobby-slide1-hero.png"],
          },
          previews: [{
            savedPath: "C:/Temp/uos/preview-Main_ID.png",
            mimeType: "image/png",
            width: 1280,
            height: 720,
            ts: "2026-06-04T04:01:00.000Z",
          }],
          comparisons: [{
            referencePath: "C:/Temp/uos/lobby-slide1.png",
            candidatePath: "C:/Temp/uos/preview-Main_ID.png",
            diffPath: "C:/Temp/uos/diff-Main_ID.png",
            verdict: "needs review",
            meanAbsoluteError: 0.1,
            rootMeanSquareError: 0.12,
            mismatchRatio: 0.2,
            maxChannelDelta: 180,
            threshold: 0.05,
            ts: "2026-06-04T04:02:00.000Z",
          }],
          elements: {
            Element_Title: {
              elementId: "Element_Title",
              type: "Text",
              clientHintId: "title",
              rect: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 },
              props: { text: "Launch Menu", color: "#ffffff", fontSize: 42 },
            },
          },
        },
      },
      importedAssets: [{ assetPath: "Assets/UOS/Imported/logo.png", importedAsSprite: true }],
    }));

    try {
      const summary = await loadUosContextSummary(projectDir);
      expect(summary).toContain("LaunchContextGame");
      expect(summary).toContain("Main_ID");
      expect(summary).toContain("source: pptx D:/Plans/lobby.pptx slide=1 rendered=C:/Temp/uos/lobby-slide1.png");
      expect(summary).toContain('selector: screenQuery="lobby slide 1" sourceKind="pptx" sourcePathContains="lobby.pptx" slideNumber=1 latest=true');
      expect(summary).toContain("previews=1, comparisons=1");
      expect(summary).toContain("[uos context] latestVerification: screen=Main_ID (Main) verdict=needs review");
      expect(summary).toContain("mismatch=0.2");
      expect(summary).toContain("preview: C:/Temp/uos/preview-Main_ID.png image/png 1280x720");
      expect(summary).toContain("comparison: verdict=needs review mae=0.1 rmse=0.12 mismatch=0.2");
      expect(summary).toContain("diff=C:/Temp/uos/diff-Main_ID.png");
      expect(summary).toContain("Launch Menu");
      expect(summary).toContain("Assets/UOS/Imported/logo.png");

      const env = await buildLaunchEnv({
        projectName: "LaunchContextGame",
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 19001,
      }, {});
      expect(env.UOS_CONTEXT_SUMMARY).toBe(summary);

      const explicitEnv = await buildLaunchEnv(undefined, {
        UNITY_MCP_HOST: "127.0.0.1",
        UNITY_MCP_PORT: "19001",
        UNITY_MCP_TOKEN: "token",
        UOS_PROJECT_DIR: projectDir,
      });
      expect(explicitEnv.UOS_CONTEXT_SUMMARY).toBe(summary);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("buildLaunchEnv injects configured response language without overriding env", async () => {
    const target = {
      projectName: "LanguageGame",
      projectPath: "D:/Unity/LanguageGame",
      host: "127.0.0.1",
      port: 19001,
    };
    const env = await buildLaunchEnv(target, {}, {
      readUosConfig: async () => ({ responseLanguage: "Korean" }),
    });
    expect(env.UOS_RESPONSE_LANGUAGE).toBe("Korean");

    const overrideEnv = await buildLaunchEnv(target, {
      UOS_RESPONSE_LANGUAGE: "English",
    }, {
      readUosConfig: async () => ({ responseLanguage: "Korean" }),
    });
    expect(overrideEnv.UOS_RESPONSE_LANGUAGE).toBe("English");
  });

  test("buildLaunchEnv can inject selected bridge capability metadata", async () => {
    const target = {
      instanceId: "selected-editor",
      projectName: "CapabilityGame",
      projectPath: "D:/Unity/CapabilityGame",
      host: "127.0.0.1",
      port: 19001,
      token: "secret-token",
    };
    const env = await buildLaunchEnv(target, {}, {
      bridgeCapabilities: true,
      callUnityTool: async (calledTarget: any, tool: string) => {
        expect(calledTarget.token).toBe("secret-token");
        expect(tool).toBe("get_project_info");
        return {
          supportedTools: ["save_scene", "create_ui_screen", "get_project_info"],
          writeTools: ["save_scene", "create_ui_screen"],
        };
      },
    });

    expect(JSON.parse(env.UOS_BRIDGE_SUPPORTED_TOOLS)).toEqual([
      "create_ui_screen",
      "get_project_info",
      "save_scene",
    ]);
    expect(JSON.parse(env.UOS_BRIDGE_WRITE_TOOLS)).toEqual([
      "create_ui_screen",
      "save_scene",
    ]);
    expect(env.UOS_BRIDGE_CAPABILITY_ERROR).toBeUndefined();
    expect(JSON.stringify({
      UOS_BRIDGE_SUPPORTED_TOOLS: env.UOS_BRIDGE_SUPPORTED_TOOLS,
      UOS_BRIDGE_WRITE_TOOLS: env.UOS_BRIDGE_WRITE_TOOLS,
      UOS_BRIDGE_CAPABILITY_ERROR: env.UOS_BRIDGE_CAPABILITY_ERROR,
    })).not.toContain("secret-token");
  });

  test("evaluateLaunchBridgeCapabilities blocks AI launch when selected bridge lacks editing tools", () => {
    const ready = evaluateLaunchBridgeCapabilities({});
    expect(ready).toMatchObject({
      ready: true,
      blockers: [],
    });

    const probeFailure = evaluateLaunchBridgeCapabilities({
      UOS_BRIDGE_CAPABILITY_ERROR: "get_project_info timed out",
    });
    expect(probeFailure.ready).toBe(false);
    expect(probeFailure.blockers.join("\n")).toContain("capability probe failed");

    const legacyMetadata = evaluateLaunchBridgeCapabilities({
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "19001",
      UNITY_MCP_TOKEN: "secret-token",
    });
    expect(legacyMetadata.ready).toBe(true);
    expect(legacyMetadata.warnings.join("\n")).toContain("did not report supportedTools");
    expect(legacyMetadata.warnings.join("\n")).toContain("did not report writeTools");

    const emptyMetadata = evaluateLaunchBridgeCapabilities({
      UNITY_MCP_HOST: "127.0.0.1",
      UNITY_MCP_PORT: "19001",
      UNITY_MCP_TOKEN: "secret-token",
      UOS_BRIDGE_SUPPORTED_TOOLS: JSON.stringify([]),
      UOS_BRIDGE_WRITE_TOOLS: JSON.stringify([]),
    });
    expect(emptyMetadata.ready).toBe(false);
    expect(emptyMetadata.blockers.join("\n")).toContain("create_ui_screen");
    expect(emptyMetadata.blockers.join("\n")).toContain("required write tool");

    const missingTools = evaluateLaunchBridgeCapabilities({
      UOS_BRIDGE_SUPPORTED_TOOLS: JSON.stringify(["get_project_info", "list_screens"]),
      UOS_BRIDGE_WRITE_TOOLS: JSON.stringify(["save_scene"]),
    });
    expect(missingTools.ready).toBe(false);
    expect(missingTools.missingTools).toContain("create_ui_screen");
    expect(missingTools.missingWriteTools).toContain("create_ui_screen");
    expect(missingTools.blockers.join("\n")).toContain("create_ui_screen");
    expect(missingTools.blockers.join("\n")).toContain("required write tool");

    const formatted = formatLaunchBridgeCapabilityFailure(missingTools);
    expect(formatted).toContain("selected Unity bridge is not ready");
    expect(formatted).toContain("uos doctor --runtime");
    expect(formatted).toContain("Update/reinstall the UOS Unity package");
  });

  test("buildLaunchEnv regenerates stale inherited UOS context summary", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-launch-env-stale-summary-test");
    const uosDir = join(projectDir, ".uos");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(uosDir, { recursive: true });
    await writeFile(join(uosDir, "project.json"), JSON.stringify({
      projectName: "FreshSelectedGame",
      projectPath: projectDir,
    }));

    try {
      const env = await buildLaunchEnv({
        projectName: "FreshSelectedGame",
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 19001,
      }, {
        UOS_CONTEXT_SUMMARY: "[uos context] projectName: PreviousGame",
      });

      expect(env.UOS_CONTEXT_SUMMARY).toContain("FreshSelectedGame");
      expect(env.UOS_CONTEXT_SUMMARY).not.toContain("PreviousGame");

      const noProjectEnv = await buildLaunchEnv(undefined, {
        UOS_CONTEXT_SUMMARY: "[uos context] projectName: PreviousGame",
      });
      expect(noProjectEnv.UOS_CONTEXT_SUMMARY).toBeUndefined();
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("buildLaunchEnv injects launch input guidance without persisted UOS context", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-launch-input-summary-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "lobby.pptx"), "pptx bytes");

    try {
      const launchInputs = {
        materialsDir: join(projectDir, "Plans"),
        files: [join(projectDir, "Plans", "lobby.pptx")],
      };
      const summary = await loadUosContextSummary(projectDir, { launchInputs });
      expect(summary).toContain("planningMaterialsDir:");
      expect(summary).toContain("attachedFiles: 1");
      expect(summary).toContain("read_planning_material");
      expect(summary).toContain(`read_planning_material({ path: "${join(projectDir, "Plans", "lobby.pptx").replace(/\\/g, "\\\\")}" })`);
      expect(summary).toContain("create_pptx_deck_screens");
      expect(summary).toContain("analyze_planning_materials");
      expect(summary).toContain("create_reference_screen_from_material");
      expect(summary).toContain("verify_screen_against_reference");
      expect(summary).toContain("planningMaterialCandidates: 1 (pptx=1)");
      expect(summary).toContain("lobby.pptx [pptx, both]");
      expect(summary).toContain("tools=read_planning_material, create_screen_from_material, create_pptx_deck_screens");
      expect(summary).toContain("no persisted UOS screen context yet");

      const env = await buildLaunchEnv({
        projectName: "FreshProject",
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 19001,
      }, {}, { launchInputs });
      expect(env.UOS_CONTEXT_SUMMARY).toBe(summary);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("buildLaunchEnv honors launch material candidate limits for run sessions", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-launch-input-limits-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "deck.pptx"), "pptx bytes");
    await writeFile(join(projectDir, "Plans", "brief.md"), "# Brief");

    try {
      const launchInputs = {
        materialsDir: join(projectDir, "Plans"),
        files: [],
      };
      const env = await buildLaunchEnv({
        projectName: "FreshLimitedProject",
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 19001,
      }, {}, {
        launchInputs,
        maxMaterialCandidates: 1,
      });
      expect(env.UOS_MAX_MATERIAL_CANDIDATES).toBe("1");
      expect(env.UOS_CONTEXT_SUMMARY).toContain("planningMaterialCandidates: 1 (pptx=1)");
      expect(env.UOS_CONTEXT_SUMMARY).toContain("deck.pptx [pptx, directory]");
      expect(env.UOS_CONTEXT_SUMMARY).toContain("1 more material candidate(s) omitted");
      expect(env.UOS_CONTEXT_SUMMARY).not.toContain("brief.md [document, directory]");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("prepareRunContextAttachment writes token-redacted context for opencode run", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-run-context-attachment-test");
    const launchInputs = {
      materialsDir: join(dir, "Plans"),
      files: [
        join(dir, "Plans", "brief.md"),
        join(dir, "Plans", "deck.pptx"),
        join(dir, "Plans", "mockup.png"),
      ],
    };
    const target = {
      projectName: "RunContextGame",
      projectPath: "D:/Unity/RunContextGame",
      host: "127.0.0.1",
      port: 19001,
      token: "secret-token",
    };
    const env = {
      UOS_PROJECT_NAME: "RunContextGame",
      UOS_PROJECT_DIR: "D:/Unity/RunContextGame",
      UOS_CONTEXT_DIR: "D:/Unity/RunContextGame/.uos",
      UOS_MAX_MATERIAL_CANDIDATES: "2",
      UOS_MAX_MATERIAL_DEPTH: "3",
      UOS_MAX_MATERIAL_SCAN_FILES: "40",
      UOS_BRIDGE_SUPPORTED_TOOLS: JSON.stringify(["get_project_info", "create_ui_screen", "save_scene"]),
      UOS_BRIDGE_WRITE_TOOLS: JSON.stringify(["create_ui_screen", "save_scene"]),
    };
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    try {
      const summary = "[uos context] screen: Main_ID Main";
      const content = formatRunContextAttachment(summary, target, { launchInputs, env });
      expect(content).toContain("# UOS Launch Context");
      expect(content).toContain("RunContextGame");
      expect(content).toContain("Material candidate limit: 2");
      expect(content).toContain("Material scan depth: 3");
      expect(content).toContain("Material scan file limit: 40");
      expect(content).toContain("Bridge required tools:");
      expect(content).toContain("Bridge supported tools: 3");
      expect(content).toContain("Bridge required write tools:");
      expect(content).toContain("Bridge write tools: create_ui_screen, save_scene");
      expect(content).toContain("get_uos_context");
      expect(content).toContain("## Startup Checklist");
      expect(content).toContain(`read_planning_material({ path: ${JSON.stringify(join(dir, "Plans", "brief.md"))} })`);
      expect(content).toContain("analyze_planning_materials");
      expect(content).toContain("brief.md");
      expect(content).toContain("create_pptx_deck_screens");
      expect(content).toContain("create_reference_screen_from_material");
      expect(content).toContain("resolve_uos_context_target");
      expect(content).toContain("update_ui_element_from_context");
      expect(content).toContain("capture_preview_from_context");
      expect(content).toContain(summary);
      expect(content).not.toContain("secret-token");

      const emptyCapabilityContent = formatRunContextAttachment(summary, target, {
        launchInputs,
        env: {
          ...env,
          UOS_BRIDGE_SUPPORTED_TOOLS: JSON.stringify([]),
          UOS_BRIDGE_WRITE_TOOLS: JSON.stringify([]),
        },
      });
      expect(emptyCapabilityContent).toContain("Bridge supported tools: 0");
      expect(emptyCapabilityContent).toContain("Bridge write tools: 0 write tools");
      expect(emptyCapabilityContent).toContain("Bridge missing required write tools:");

      const attachment = await prepareRunContextAttachment(summary, target, {
        tempDir: dir,
        launchInputs,
        env,
      });
      expect(attachment).toBeDefined();
      if (attachment === undefined) throw new Error("expected launch context attachment");
      expect(attachment.file.startsWith(dir)).toBe(true);
      const raw = await readFile(attachment.file, "utf8");
      expect(raw).toContain("UOS Launch Context");
      expect(raw).toContain("Bridge required write tools:");
      expect(raw).toContain("Bridge write tools: create_ui_screen, save_scene");
      expect(raw).not.toContain("secret-token");

      await cleanupRunContextAttachment(attachment);
      let exists = true;
      try {
        await stat(attachment.file);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);

      const freshContent = formatRunContextAttachment(undefined, target, {
        launchInputs: { files: [] },
        env: {
          UOS_PROJECT_NAME: "RunContextGame",
          UOS_PROJECT_DIR: "D:/Unity/RunContextGame",
          UOS_CONTEXT_DIR: "D:/Unity/RunContextGame/.uos",
          UNITY_MCP_MATERIALS_DIR: "D:/Unity/RunContextGame",
        },
      });
      expect(freshContent).toContain("# UOS Launch Context");
      expect(freshContent).toContain("RunContextGame");
      expect(freshContent).toContain("No persisted UOS context summary was available at launch");
      expect(freshContent).toContain("get_uos_context");

      const freshAttachment = await prepareRunContextAttachment(undefined, target, {
        tempDir: dir,
        launchInputs: { files: [] },
        env: {
          UOS_PROJECT_NAME: "RunContextGame",
          UOS_PROJECT_DIR: "D:/Unity/RunContextGame",
          UOS_CONTEXT_DIR: "D:/Unity/RunContextGame/.uos",
        },
      });
      expect(freshAttachment).toBeDefined();
      if (freshAttachment !== undefined) await cleanupRunContextAttachment(freshAttachment);
      expect(formatRunContextAttachment(undefined, undefined, {})).toBeUndefined();
      expect(await prepareRunContextAttachment(undefined, undefined, { tempDir: dir })).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("buildContextReport formats selected project context without leaking bridge token", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-report-test");
    const uosDir = join(projectDir, ".uos");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(uosDir, { recursive: true });
    await writeFile(join(projectDir, "Plans", "brief.md"), "# Context Brief");
    await writeFile(join(uosDir, "project.json"), JSON.stringify({
      projectName: "ContextReportGame",
      projectPath: projectDir,
    }));
    await writeFile(join(uosDir, "screens.json"), JSON.stringify({
      version: "1.0.0",
      screens: {
        ContextScreen_ID: {
          screenId: "ContextScreen_ID",
          screenName: "ContextScreen",
          createdAt: "2026-06-04T00:00:00.000Z",
          updatedAt: "2026-06-04T00:00:00.000Z",
          elements: {},
        },
      },
    }));

    try {
      const launchInputs = resolveLaunchInputs({ projectPath: projectDir }, {
        materialsDir: "Plans",
        files: ["brief.md"],
      });
      const report = await buildContextReport({
        instanceId: "ctx-id",
        projectName: "ContextReportGame",
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 19001,
        token: "secret-token",
      }, {
        launchInputs,
        env: {},
        bridgeCapabilities: true,
        callUnityTool: async (_target: any, tool: string) => {
          expect(tool).toBe("get_project_info");
          return {
            supportedTools: ["get_project_info", "create_ui_screen", "save_scene"],
            writeTools: ["create_ui_screen", "save_scene"],
          };
        },
      });

      expect(report.target?.projectName).toBe("ContextReportGame");
      expect((report.target as any).token).toBeUndefined();
      expect(report.launchInputs.files).toEqual([join(projectDir, "Plans", "brief.md")]);
      expect(report.summary).toContain("ContextReportGame");
      expect(report.summary).toContain("attachedFiles: 1");
      expect(report.summary).toContain("planningMaterialCandidates: 1 (document=1)");
      expect(report.summary).toContain("brief.md [document, both]");
      expect(report.summary).toContain("ContextScreen_ID");
      expect(report.materialCandidates).toHaveLength(1);
      expect(report.materialCandidates[0]).toMatchObject({
        relativePath: "brief.md",
        kind: "document",
        source: "both",
      });

      const output = formatContextReport(report);
      expect(output).toContain("[uos context] selected launch context");
      expect(output).toContain("ContextReportGame");
      expect(output).toContain("bridgeCapabilities: supportedTools=3");
      expect(output).toContain("writeTools=2");
      expect(output).toContain("requiredTools=");
      expect(output).toContain("requiredWriteTools=");
      expect(output).toContain("attached files: 1");
      expect(output).toContain("get_uos_context");
      expect(output).not.toContain("secret-token");

      const json = formatContextJson(report);
      const parsed = JSON.parse(json);
      expect(parsed.target.projectName).toBe("ContextReportGame");
      expect(parsed.target.token).toBeUndefined();
      expect(parsed.materialCandidates).toHaveLength(1);
      expect(parsed.materialCandidates[0].recommendedTools).toContain("create_screen_from_material");
      expect(JSON.parse(parsed.env.UOS_BRIDGE_SUPPORTED_TOOLS)).toContain("create_ui_screen");
      expect(JSON.parse(parsed.env.UOS_BRIDGE_WRITE_TOOLS)).toContain("save_scene");
      expect(parsed.env.UOS_CONTEXT_SUMMARY).toBe("(set)");
      expect(json).not.toContain("secret-token");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("buildContextReport honors launch material candidate limits", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-context-report-limits-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "brief.md"), "# Context Brief");
    await writeFile(join(projectDir, "Plans", "deck.pptx"), "fake pptx bytes");

    try {
      const launchInputs = resolveLaunchInputs({ projectPath: projectDir }, {
        materialsDir: "Plans",
      });
      const report = await buildContextReport({
        instanceId: "ctx-limits-id",
        projectName: "ContextLimitGame",
        projectPath: projectDir,
        host: "127.0.0.1",
        port: 19002,
        token: "secret-token",
      }, {
        launchInputs,
        env: {},
        maxMaterialCandidates: 1,
      });

      expect(report.materialCandidates).toHaveLength(1);
      expect(report.materialCandidates[0]).toMatchObject({
        relativePath: "deck.pptx",
        kind: "pptx",
        source: "directory",
      });
      expect(report.summary).toContain("planningMaterialCandidates: 1 (pptx=1)");
      expect(report.summary).toContain("deck.pptx [pptx, directory]");
      expect(report.summary).toContain("1 more material candidate(s) omitted");

      const parsed = JSON.parse(formatContextJson(report));
      expect(parsed.materialCandidates).toHaveLength(1);
      expect(parsed.materialCandidates[0].relativePath).toBe("deck.pptx");
      expect(parsed.env.UOS_MAX_MATERIAL_CANDIDATES).toBe("1");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("formatEditorList includes stable project identifiers", () => {
    const output = formatEditorList(sampleEditors());
    expect(output).toContain("connected Unity projects");
    expect(output).toContain("id=alpha-id");
    expect(output).toContain("AlphaGame");
  });

  test("formatEditorJson returns machine-readable project selectors without bridge token", () => {
    const output = formatEditorJson(sampleEditors());
    const parsed = JSON.parse(output);
    expect(parsed.count).toBe(2);
    expect(parsed.editors[0]).toMatchObject({
      index: 1,
      instanceId: "alpha-id",
      projectName: "AlphaGame",
      projectPath: "D:/Unity/AlphaGame",
      host: "127.0.0.1",
      port: 19001,
    });
    expect(parsed.editors[0].selectors).toContain("alpha-id");
    expect(parsed.editors[0].selectors).toContain("AlphaGame");
    expect(output).not.toContain("alpha-token");
    expect(output).not.toContain("bravo-token");
  });

  test("formatEditorList includes UOS package and protocol metadata when registry provides it", () => {
    const output = formatEditorList([{
      ...sampleEditors()[0],
      uosPackageVersion: "0.1.0",
      protocolVersion: "1.0.0",
    }]);
    expect(output).toContain("UOS 0.1.0");
    expect(output).toContain("protocol 1.0.0");
  });

  test("waitForUnityTarget polls until a live editor appears", async () => {
    let now = 0;
    let calls = 0;
    const result = await waitForUnityTarget({
      timeoutMs: 5_000,
      intervalMs: 250,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      discoverLiveEditors: async () => {
        calls += 1;
        return calls < 3 ? [] : [sampleEditors()[0]];
      },
    });

    expect(result.timedOut).toBe(false);
    expect(result.target?.instanceId).toBe("alpha-id");
    expect(result.elapsedMs).toBe(500);
    expect(formatWaitResult(result)).toContain("ready after 500ms");
  });

  test("waitForUnityTarget waits for a matching selector and reports timeout", async () => {
    let now = 0;
    const timeout = await waitForUnityTarget({
      selector: "Missing",
      timeoutMs: 1_000,
      intervalMs: 500,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      discoverLiveEditors: async () => [sampleEditors()[0]],
    });
    expect(timeout.timedOut).toBe(true);
    expect(timeout.lastError).toContain("no connected Unity project");
    expect(formatWaitResult(timeout)).toContain("timed out after 1000ms");

    now = 0;
    const selected = await waitForUnityTarget({
      selector: "BravoGame",
      timeoutMs: 1_000,
      intervalMs: 500,
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
      discoverLiveEditors: async () => sampleEditors(),
    });
    expect(selected.timedOut).toBe(false);
    expect(selected.target?.instanceId).toBe("bravo-id");
  });

  test("normalizeScreens handles legacy ids and named screen records", () => {
    expect(normalizeScreens({ screens: [{ id: "Main_ID", name: "Main", active: true }] }))
      .toEqual([{ id: "Main_ID", name: "Main", active: true }]);
    expect(normalizeScreens({ screens: ["Legacy_ID"] }))
      .toEqual([{ id: "Legacy_ID" }]);
    expect(normalizeScreens({ screenIds: ["Compat_ID"] }))
      .toEqual([{ id: "Compat_ID" }]);
    expect(normalizeScreens({ screens: [{ id: "", name: "Ignored" }], screenIds: ["Fallback_ID"] }))
      .toEqual([{ id: "Fallback_ID" }]);
  });

  test("summarizeHierarchy emphasizes screen ownership and editable element ids", () => {
    const summary = summarizeHierarchy({
      roots: [{ name: "Main", elementId: "Screen_Main", type: "Screen" }],
      nodes: [
        {
          name: "Main",
          elementId: "Screen_Main",
          rootScreenId: "Screen_Main",
          rootScreenName: "Main",
          depth: 0,
          type: "Screen",
          childCount: 1,
        },
        {
          name: "title",
          elementId: "Element_Title",
          parentElementId: "Screen_Main",
          rootScreenId: "Screen_Main",
          rootScreenName: "Main",
          depth: 1,
          type: "Text",
          anchor: "MiddleCenter",
          rect: { x: 0.1, y: 0.2, w: 0.8, h: 0.1 },
          props: { text: "Main Menu", fontSize: 48, fontStyle: "Bold", color: "#ffffff" },
          childCount: 0,
        },
      ],
    });

    expect(summary).toContain("Hierarchy roots: 1");
    expect(summary).toContain("[Main/Screen_Main] Element_Title");
    expect(summary).toContain("parent=Screen_Main");
    expect(summary).toContain("anchor=MiddleCenter");
    expect(summary).toContain("rect=0.1,0.2,0.8,0.1");
    expect(summary).toContain('props(text="Main Menu", color=#ffffff, fontSize=48, fontStyle=Bold)');
  });

  test("collectDoctorReport and formatDoctorReport summarize dependencies and registry state", async () => {
    const repoRoot = join(import.meta.dir, "..", ".omx", "tmp", "uos-doctor-test");
    const registry = join(repoRoot, "registry");
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(join(repoRoot, ".opencode", "agents"), { recursive: true });
    await mkdir(join(repoRoot, ".opencode", "plugins"), { recursive: true });
    await mkdir(join(repoRoot, ".opencode", "tools"), { recursive: true });
    await mkdir(join(repoRoot, "Packages", "com.lyx.oh-my-unity"), { recursive: true });
    await mkdir(registry, { recursive: true });
    await writeFile(join(repoRoot, "package.json"), "{}");
    await writeFile(join(repoRoot, "opencode.json"), JSON.stringify({
      default_agent: "ochestrator",
    }));
    await writeFile(join(repoRoot, ".opencode", "agents", "ochestrator.md"), "");
    await writeFile(join(repoRoot, ".opencode", "plugins", "uos.ts"), "");
    await writeFile(join(repoRoot, ".opencode", "plugins", "claude-auth.ts"), "");
    await writeFile(join(repoRoot, ".opencode", "tools", "_bridge.ts"), "");
    for (const toolName of [
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
    ]) {
      await writeFile(join(repoRoot, ".opencode", "tools", `${toolName}.ts`), "");
    }
    await writeFile(join(repoRoot, "Packages", "com.lyx.oh-my-unity", "package.json"), "{}");
    await writeFile(join(registry, "live.json"), JSON.stringify(liveTarget(repoRoot)));

    try {
      const report = await collectDoctorReport({
        repoRoot,
        registryDir: registry,
        bridgeCapabilities: true,
        env: {
          UNITY_MCP_HOST: "127.0.0.1",
          UNITY_MCP_PORT: "17801",
          UOS_UNITY_PROJECT: "live",
        },
        handshake: async () => true,
        commandRunner: (command: string, args?: string[]) => {
          if (command === "opencode" && args?.[0] === "run" && args?.[1] === "--help") {
            return { status: 1, stdout: "", stderr: "not found" };
          }
          if (command === "opencode" && args?.[0] === "--help") {
            return { status: 1, stdout: "", stderr: "not found" };
          }
          if (command === "opencode") return { status: 1, stdout: "", stderr: "not found" };
          if (command === "soffice") return { status: 1, stdout: "", stderr: "not found" };
          if (command === "reg.exe") {
            return {
              status: 0,
              stdout: "    (Default)    REG_SZ    C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE\n",
              stderr: "",
            };
          }
          return { status: 0, stdout: `${command}-version\n`, stderr: "" };
        },
      });
      const output = formatDoctorReport(report);
      expect(output).toContain("[uos doctor]");
      expect(output).toContain("[ok] Unity package");
      expect(output).toContain("[ok] default agent: ochestrator");
      expect(output).toContain("[ok] tools: 58 entrypoint(s)");
      expect(output).not.toContain("[ok] plugin: opencode-claude-auth@latest");
      expect(output).toContain("[ok] local plugin:");
      expect(output).toContain(".opencode\\plugins\\claude-auth.ts");
      expect(output).toContain(".opencode\\plugins\\uos.ts");
      expect(output).toContain("opencode runtime:");
      expect(output).toContain("[skipped] run `uos doctor --runtime`");
      expect(output).toContain("opencode CLI capabilities:");
      expect(output).toContain("[missing] opencode run --file attachment handoff");
      expect(output).toContain("[missing] opencode");
      expect(output).toContain("[optional-missing] soffice");
      expect(output).toContain("[ok] PowerPoint");
      expect(output).toContain("Material capabilities:");
      expect(output).toContain("[ok] images: attached directly for model vision");
      expect(output).toContain("[ok] PDF pages: built-in pdf-parse renderer");
      expect(output).toContain("[ok] PPTX editable layout: built-in Open XML extractor");
      expect(output).toContain("[ok] PPTX rendered slides: PowerPoint");
      expect(output).toContain("live=1 stale=0 unreachable=0 invalid=0");
      expect(output).toContain("Unity bridge capabilities:");
      expect(output).toContain("17/17 required bridge tool(s) reported");
      expect(output).toContain("12/12 required write tool(s) reported");
      expect(output).toContain("UNITY_MCP_HOST: 127.0.0.1");
      expect(output).toContain("UOS_UNITY_PROJECT: live");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("formatDoctorReport explains PPTX fallback when no slide renderer is available", () => {
    const output = formatDoctorReport({
      repoRoot: "D:/UOS",
      files: [],
      commands: [
        { name: "node", required: true, result: { ok: true, version: "v22" } },
        { name: "bun", required: true, result: { ok: true, version: "1.3" } },
        { name: "opencode", required: true, result: { ok: true, version: "1.15" } },
        { name: "soffice", required: false, result: { ok: false, error: "not found" } },
        { name: "PowerPoint", required: false, result: { ok: false, error: "not found" } },
      ],
      registry: { dir: "D:/registry", entries: [], missing: true },
      opencodeResources: {
        config: { ok: true, path: "D:/UOS/opencode.json" },
        defaultAgent: { ok: true, name: "ochestrator" },
        tools: { count: 48, missing: [] },
        plugins: [],
        autoPlugin: { ok: true, path: "D:/UOS/.opencode/plugins/uos.ts" },
        duplicateLocalPlugins: [],
      },
      env: {},
    } as any);

    expect(output).toContain("Material capabilities:");
    expect(output).toContain("[fallback] PPTX rendered slides: no LibreOffice/PowerPoint; text/layout extraction still works");
    expect(output).toContain("[ok] DOCX/PPTX embedded images: built-in Open XML extractor");
  });

  test("formatDoctorReport skips install guidance when the selected Unity project already has UOS", () => {
    const output = formatDoctorReport({
      repoRoot: "D:/UOS",
      files: [],
      commands: [
        { name: "node", required: true, result: { ok: true } },
        { name: "bun", required: true, result: { ok: true } },
        { name: "opencode", required: true, result: { ok: true } },
        { name: "soffice", required: false, result: { ok: false } },
      ],
      registry: { dir: "D:/registry", entries: [], missing: false },
      unityProject: {
        ok: true,
        projectPath: "D:/Unity/InstalledGame",
        manifestPath: "D:/Unity/InstalledGame/Packages/manifest.json",
        installed: true,
        installKind: "local",
        specifier: "file:D:/UOS/Packages/com.lyx.oh-my-unity",
      },
      opencodeResources: {
        config: { ok: true, path: "D:/UOS/opencode.json" },
        defaultAgent: { ok: true, name: "ochestrator" },
        tools: { count: 48, missing: [] },
        plugins: [],
        autoPlugin: { ok: true, path: "D:/UOS/.opencode/plugins/uos.ts" },
        duplicateLocalPlugins: [],
      },
      env: {},
    } as any);

    expect(output).toContain("Open this Unity project; the UOS package is installed but no live bridge is registered.");
    expect(output).not.toContain("Run `uos install-unity <UnityProjectPath>` if the target project does not have the UOS package yet.");
  });

  test("inspectOpencodeResources reports missing local agent tools and plugins", async () => {
    const repoRoot = join(import.meta.dir, "..", ".omx", "tmp", "uos-resource-inspect-test");
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(join(repoRoot, ".opencode", "agents"), { recursive: true });
    await mkdir(join(repoRoot, ".opencode", "tools"), { recursive: true });
    await writeFile(join(repoRoot, "opencode.json"), JSON.stringify({
      default_agent: "ochestrator",
      plugin: ["file://./.opencode/plugins/uos.ts"],
    }));
    await writeFile(join(repoRoot, ".opencode", "tools", "get_project_info.ts"), "");

    try {
      const resources = await inspectOpencodeResources(repoRoot);
      expect(resources.config.ok).toBe(true);
      expect(resources.defaultAgent.ok).toBe(false);
      expect(resources.tools.count).toBe(1);
      expect(resources.tools.missing).toContain("create_ui_screen");
      expect(resources.tools.missing).toContain("create_scene_object");
      expect(resources.tools.missing).toContain("list_scene_objects");
      expect(resources.tools.missing).toContain("update_scene_object_from_context");
      expect(resources.tools.missing).toContain("delete_scene_object_from_context");
      expect(resources.tools.missing).toContain("resolve_scene_object_from_context");
      expect(resources.plugins[0]).toMatchObject({
        value: "file://./.opencode/plugins/uos.ts",
        local: true,
        ok: false,
      });
      expect(resources.localPlugins).toEqual([]);
      expect(resources.autoPlugin.ok).toBe(false);
      expect(resources.duplicateLocalPlugins).toHaveLength(1);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("inspectOpencodeRuntime reports resolved plugin duplicates and expired auth warnings", () => {
    const repoRoot = "C:/Users/lyx/MCP_for_Unity_LYX";
    const calls: string[][] = [];
    const runtime = inspectOpencodeRuntime(repoRoot, {
      runtimeTimeoutMs: 1000,
      commandRunner: (_command: string, args?: string[]) => {
        calls.push(args ?? []);
        return {
        status: 0,
        stdout: JSON.stringify({
          default_agent: "ochestrator",
          plugin: [
            "opencode-claude-auth@latest",
            "file://./.opencode/plugins/uos.ts",
            "file:///C:/Users/lyx/MCP_for_Unity_LYX/.opencode/plugins/uos.ts",
          ],
        }),
        stderr: "opencode-claude-auth: Claude credentials are expired and could not be refreshed. Run `claude` to re-authenticate.",
        };
      },
    });

    expect(calls[0]).toEqual(["--print-logs", "--log-level", "ERROR", "debug", "config"]);
    expect(runtime.ok).toBe(true);
    expect(runtime.authExpired).toBe(true);
    expect(runtime.defaultAgent).toBe("ochestrator");
    expect(runtime.duplicatePlugins).toHaveLength(1);
    expect(runtime.duplicatePlugins[0].values).toHaveLength(2);

    const pluginFailure = inspectOpencodeRuntime(repoRoot, {
      runtimeTimeoutMs: 1000,
      commandRunner: () => ({
        status: 0,
        stdout: JSON.stringify({
          default_agent: "ochestrator",
          plugin: ["opencode-claude-auth@latest"],
        }),
        stderr: "ERROR 2026-06-04T20:31:18 service=plugin error=undefined is not an object (evaluating 'O.config') plugin config hook failed",
      }),
    });
    expect(pluginFailure.ok).toBe(false);
    expect(pluginFailure.pluginErrors).toHaveLength(1);
    expect(pluginFailure.pluginErrors[0]).toContain("plugin config hook failed");
  });

  test("inspectOpencodeCliCapabilities verifies UOS run and interactive handoff flags", () => {
    const ok = inspectOpencodeCliCapabilities({
      commandRunner: (_command: string, args?: string[]) => {
        if (args?.[0] === "run") {
          return { status: 0, stdout: "Options:\n  --file file(s)\n  --agent agent", stderr: "" };
        }
        return { status: 0, stdout: "Options:\n  --agent agent\n  --prompt prompt", stderr: "" };
      },
    });
    expect(ok).toMatchObject({
      ok: true,
      runHelpOk: true,
      topHelpOk: true,
      runFile: true,
      runAgent: true,
      tuiAgent: true,
      tuiPrompt: true,
    });

    const missingFile = inspectOpencodeCliCapabilities({
      commandRunner: (_command: string, args?: string[]) => {
        if (args?.[0] === "run") {
          return { status: 0, stdout: "Options:\n  --agent agent", stderr: "" };
        }
        return { status: 0, stdout: "Options:\n  --agent agent\n  --prompt prompt", stderr: "" };
      },
    });
    expect(missingFile.ok).toBe(false);
    expect(missingFile.runFile).toBe(false);

    const missingPrompt = inspectOpencodeCliCapabilities({
      commandRunner: (_command: string, args?: string[]) => {
        if (args?.[0] === "run") {
          return { status: 0, stdout: "Options:\n  --file file(s)\n  --agent agent", stderr: "" };
        }
        return { status: 0, stdout: "Options:\n  --agent agent", stderr: "" };
      },
    });
    expect(missingPrompt.ok).toBe(false);
    expect(missingPrompt.tuiPrompt).toBe(false);
  });

  test("evaluateReadiness reports AI session blockers and ready state", () => {
    const baseReport: any = {
      repoRoot: "D:/UOS",
      files: [
        { name: "package.json", path: "D:/UOS/package.json", ok: true },
        { name: "ochestrator agent", path: "D:/UOS/.opencode/agents/ochestrator.md", ok: true },
      ],
      commands: [
        { name: "node", required: true, result: { ok: true } },
        { name: "bun", required: true, result: { ok: true } },
        { name: "opencode", required: true, result: { ok: true } },
        { name: "soffice", required: false, result: { ok: false } },
        { name: "PowerPoint", required: false, result: { ok: true } },
      ],
      registry: {
        entries: [{
          status: "live",
          entry: liveTarget("D:/Unity/ReadyProject"),
        }],
      },
      opencodeResources: {
        config: { ok: true },
        defaultAgent: { ok: true, name: "ochestrator" },
        tools: { missing: [] },
        autoPlugin: { ok: true },
        duplicateLocalPlugins: [],
      },
      opencodeRuntime: {
        ok: true,
        authExpired: false,
        defaultAgent: "ochestrator",
        duplicatePlugins: [],
      },
      opencodeCli: {
        ok: true,
        runHelpOk: true,
        topHelpOk: true,
        runFile: true,
        runAgent: true,
        tuiAgent: true,
        tuiPrompt: true,
        errors: [],
      },
      env: {},
    };

    const ready = evaluateReadiness(baseReport);
    expect(ready.ready).toBe(true);
    expect(ready.warnings).not.toContain("optional command unavailable: soffice");
    expect(ready.warnings.some((item: string) => item.includes("PPTX renderer"))).toBe(false);
    const readyOutput = formatReadyReport(baseReport, ready);
    expect(readyOutput).toContain("[uos ready] ready");
    expect(readyOutput).toContain("Live Unity projects:");
    expect(readyOutput).toContain("LiveProject - D:/Unity/ReadyProject");
    expect(readyOutput).toContain("select: --unity-project live");
    expect(readyOutput).toContain("uos --unity-project live --uos-dry-run");
    expect(readyOutput).not.toContain("good-token");

    const missingBridgeTool = evaluateReadiness({
      ...baseReport,
      bridgeCapabilities: {
        entries: [{
          source: "registry",
          target: liveTarget("D:/Unity/ReadyProject"),
          ok: true,
          supportedTools: ["get_project_info", "list_screens"],
          writeTools: ["save_scene"],
          missingTools: ["create_ui_screen"],
          missingWriteTools: ["create_ui_screen"],
        }],
      },
    });
    expect(missingBridgeTool.ready).toBe(false);
    expect(missingBridgeTool.blockers.some((item: string) =>
      item.includes("Unity bridge missing required tool(s)") && item.includes("create_ui_screen"))).toBe(true);
    expect(missingBridgeTool.blockers.some((item: string) =>
      item.includes("Unity bridge missing required write tool(s)") && item.includes("create_ui_screen"))).toBe(true);

    const legacyBridgeMetadata = evaluateReadiness({
      ...baseReport,
      bridgeCapabilities: {
        entries: [{
          source: "registry",
          target: liveTarget("D:/Unity/ReadyProject"),
          ok: true,
        }],
      },
    });
    expect(legacyBridgeMetadata.ready).toBe(true);
    expect(legacyBridgeMetadata.warnings.some((item: string) => item.includes("supportedTools"))).toBe(true);
    expect(legacyBridgeMetadata.warnings.some((item: string) => item.includes("writeTools"))).toBe(true);

    const editors = sampleEditors();
    const multiLiveReport = {
      ...baseReport,
      registry: {
        entries: editors.map((entry) => ({ status: "live", entry })),
      },
      bridgeCapabilities: {
        entries: [
          {
            source: "registry",
            target: editors[0],
            ok: true,
            supportedTools: ["get_project_info", "list_screens", "create_ui_screen"],
            writeTools: ["create_ui_screen", "save_scene"],
            missingTools: [],
            missingWriteTools: [],
          },
          {
            source: "registry",
            target: editors[1],
            ok: true,
            supportedTools: ["get_project_info", "list_screens"],
            writeTools: ["save_scene"],
            missingTools: ["create_ui_screen"],
            missingWriteTools: ["create_ui_screen"],
          },
        ],
      },
    };
    const multiLiveOutput = formatReadyReport(multiLiveReport, evaluateReadiness(multiLiveReport));
    expect(multiLiveOutput).toContain("AlphaGame");
    expect(multiLiveOutput).toContain("select: --unity-project alpha-id");
    expect(multiLiveOutput).toContain("AlphaGame - D:/Unity/AlphaGame (127.0.0.1:19001) select: --unity-project alpha-id capability=ready");
    expect(multiLiveOutput).toContain("BravoGame");
    expect(multiLiveOutput).toContain("select: --unity-project bravo-id");
    expect(multiLiveOutput).toContain("BravoGame - D:/Unity/Bravo (127.0.0.1:19002) select: --unity-project bravo-id capability=missing");
    expect(multiLiveOutput).toContain("uos --unity-project <selector> --uos-dry-run");
    expect(multiLiveOutput).not.toContain("alpha-token");
    expect(multiLiveOutput).not.toContain("bravo-token");

    const noPptxRenderer = evaluateReadiness({
      ...baseReport,
      commands: baseReport.commands.map((item: any) =>
        item.name === "PowerPoint" ? { ...item, result: { ok: false } } : item),
    });
    expect(noPptxRenderer.ready).toBe(true);
    expect(noPptxRenderer.warnings).toContain(
      "optional PPTX renderer unavailable: LibreOffice/PowerPoint; PPTX text/layout fallback will still work",
    );

    const blockedReport = {
      ...baseReport,
      registry: { entries: [] },
      opencodeRuntime: { ...baseReport.opencodeRuntime, authExpired: true },
    };
    const blocked = evaluateReadiness(blockedReport);
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers).toContain("Claude credentials are expired");
    expect(blocked.blockers).toContain("no live Unity Editor bridge found");
    expect(formatReadyReport(blockedReport, blocked)).toContain("[uos ready] not ready");

    const pluginHookFailure = evaluateReadiness({
      ...baseReport,
      opencodeRuntime: {
        ...baseReport.opencodeRuntime,
        ok: false,
        pluginErrors: ["error=undefined is not an object (evaluating 'O.config') plugin config hook failed"],
      },
    });
    expect(pluginHookFailure.ready).toBe(false);
    expect(pluginHookFailure.blockers).toContain("opencode runtime config did not load cleanly");
    expect(pluginHookFailure.blockers.some((item: string) =>
      item.includes("opencode plugin hook failed") && item.includes("plugin config hook failed"))).toBe(true);

    const explicitBridge = evaluateReadiness({
      ...baseReport,
      registry: { entries: [] },
      env: { UNITY_MCP_HOST: "127.0.0.1", UNITY_MCP_PORT: "17801", UNITY_MCP_TOKEN: "token" },
    });
    expect(explicitBridge.ready).toBe(true);
    expect(explicitBridge.warnings.some((item: string) => item.includes("UOS_PROJECT_DIR"))).toBe(true);

    const selectorOverridesExplicitBridge = evaluateReadiness({
      ...baseReport,
      registry: { entries: [] },
      env: {
        UNITY_MCP_HOST: "127.0.0.1",
        UNITY_MCP_PORT: "17801",
        UNITY_MCP_TOKEN: "token",
        UOS_UNITY_PROJECT: "ChosenGame",
      },
    });
    expect(selectorOverridesExplicitBridge.ready).toBe(false);
    expect(selectorOverridesExplicitBridge.blockers).toContain("no live Unity Editor bridge found");
    expect(selectorOverridesExplicitBridge.warnings).toContain(
      "selector env is set; inherited explicit bridge env will be ignored by UOS launch selection",
    );

    const missingCliCapability = evaluateReadiness({
      ...baseReport,
      opencodeCli: {
        ok: false,
        runHelpOk: true,
        topHelpOk: true,
        runFile: false,
        runAgent: true,
        tuiAgent: true,
        tuiPrompt: true,
        errors: [],
      },
    });
    expect(missingCliCapability.ready).toBe(false);
    expect(missingCliCapability.blockers).toContain("opencode run does not advertise --file attachments required for UOS material handoff");

    const missingTuiPrompt = evaluateReadiness({
      ...baseReport,
      opencodeCli: {
        ok: false,
        runHelpOk: true,
        topHelpOk: true,
        runFile: true,
        runAgent: true,
        tuiAgent: true,
        tuiPrompt: false,
        errors: [],
      },
    });
    expect(missingTuiPrompt.ready).toBe(false);
    expect(missingTuiPrompt.blockers).toContain("opencode TUI does not advertise --prompt required for interactive UOS startup context");
  });

  test("cleanStaleRegistryEntries removes only stale registry files", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-clean-stale-test");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const staleFile = join(dir, "stale.json");
    const liveFile = join(dir, "live.json");
    await writeFile(staleFile, JSON.stringify({
      instanceId: "stale",
      projectName: "StaleProject",
      projectPath: "D:/Unity/StaleProject",
      host: "127.0.0.1",
      port: 19002,
      processId: 222,
    }));
    await writeFile(liveFile, JSON.stringify({
      instanceId: "live",
      projectName: "LiveProject",
      projectPath: "D:/Unity/LiveProject",
      host: "127.0.0.1",
      port: 19001,
      processId: 111,
    }));

    try {
      const report = await collectDoctorReport({
        repoRoot: import.meta.dir,
        registryDir: dir,
        env: {},
        processAlive: (pid: number) => pid === 111,
        handshake: async () => true,
        commandRunner: () => ({ status: 0, stdout: "ok\n", stderr: "" }),
      });
      const cleaned = await cleanStaleRegistryEntries(report);
      expect(cleaned.removed).toBe(1);
      expect(await Bun.file(staleFile).exists()).toBe(false);
      expect(await Bun.file(liveFile).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("callUnityTool performs hello handshake and one bridge call", async () => {
    const data = await callUnityTool(liveTarget(), "get_project_info", {}, { timeoutMs: 500 });
    expect(data.projectName).toBe("LiveProject");
    expect(data.projectPath).toBe("D:/Unity/LiveProject");
    expect(data.supportedTools).toContain("create_ui_screen");
    expect(data.writeTools).toContain("save_scene");
  });

  test("runMaterialScreenTool invokes the Bun router with selected bridge env", async () => {
    let seen: any;
    const result = await runMaterialScreenTool(
      liveTarget("D:/Unity/LiveProject"),
      {
        path: "D:/Plans/lobby.pptx",
        mode: "auto",
        screenName: "LobbyFromDeck",
      },
      {
        repoRoot: "C:/UOS",
        env: { PATH: "C:/bin" },
        materialScreenCommandRunner: (command: string, args: string[], options: any) => {
          seen = {
            command,
            args,
            cwd: options.cwd,
            env: options.env,
          };
          return {
            status: 0,
            stdout: JSON.stringify({
              kind: "pptx",
              mode: "editable",
              path: "D:/Plans/lobby.pptx",
              intent: {
                version: "1.0.0",
                screenName: "LobbyFromDeck",
                referenceCanvas: { width: 1920, height: 1080 },
                elements: [],
              },
              created: { screenId: "LobbyFromDeck_ID", elements: [] },
              warnings: [],
            }),
            stderr: "",
          };
        },
      },
    );

    expect(result.created.screenId).toBe("LobbyFromDeck_ID");
    expect(seen.command).toBe("bun");
    expect(seen.args[0]).toBe("--eval");
    expect(seen.cwd).toBe("C:/UOS");
    expect(seen.env.UNITY_MCP_HOST).toBe("127.0.0.1");
    expect(seen.env.UNITY_MCP_PORT).toBe(String(port));
    expect(seen.env.UNITY_MCP_TOKEN).toBe("good-token");
    expect(seen.env.UOS_PROJECT_DIR).toBe("D:/Unity/LiveProject");
    expect(seen.env.UNITY_MCP_MATERIALS_DIR).toBe("D:/Unity/LiveProject");
    expect(JSON.parse(seen.env.UOS_SMOKE_MATERIAL_REQUEST).args).toMatchObject({
      path: "D:/Plans/lobby.pptx",
      mode: "auto",
      screenName: "LobbyFromDeck",
    });
  });

  test("runPptxDeckScreenTool invokes the Bun deck router with selected bridge env", async () => {
    let seen: any;
    const result = await runPptxDeckScreenTool(
      liveTarget("D:/Unity/LiveProject"),
      {
        path: "D:/Plans/lobby.pptx",
        slideNumbers: [1, 2],
        screenNamePrefix: "Lobby",
        createTransitions: true,
        activateFirst: true,
      },
      {
        repoRoot: "C:/UOS",
        env: { PATH: "C:/bin" },
        pptxDeckCommandRunner: (command: string, args: string[], options: any) => {
          seen = {
            command,
            args,
            cwd: options.cwd,
            env: options.env,
          };
          return {
            status: 0,
            stdout: JSON.stringify({
              path: "D:/Plans/lobby.pptx",
              slideNumbers: [1, 2],
              screens: [
                {
                  slideNumber: 1,
                  screenName: "Lobby Slide 1",
                  screenId: "LobbySlide1_ID",
                  created: { screenId: "LobbySlide1_ID", elements: [] },
                  importedAssets: [],
                  warnings: [],
                  draft: {
                    intent: {
                      version: "1.0.0",
                      screenName: "Lobby Slide 1",
                      referenceCanvas: { width: 1920, height: 1080 },
                      elements: [],
                    },
                  },
                },
              ],
              transitions: [],
              activeScreenId: "LobbySlide1_ID",
              warnings: [],
            }),
            stderr: "",
          };
        },
      },
    );

    expect(result.activeScreenId).toBe("LobbySlide1_ID");
    expect(seen.command).toBe("bun");
    expect(seen.args[0]).toBe("--eval");
    expect(seen.cwd).toBe("C:/UOS");
    expect(seen.env.UNITY_MCP_HOST).toBe("127.0.0.1");
    expect(seen.env.UNITY_MCP_PORT).toBe(String(port));
    expect(seen.env.UNITY_MCP_TOKEN).toBe("good-token");
    expect(seen.env.UOS_PROJECT_DIR).toBe("D:/Unity/LiveProject");
    expect(seen.env.UNITY_MCP_MATERIALS_DIR).toBe("D:/Unity/LiveProject");
    expect(JSON.parse(seen.env.UOS_SMOKE_PPTX_DECK_REQUEST).args).toMatchObject({
      path: "D:/Plans/lobby.pptx",
      slideNumbers: [1, 2],
      screenNamePrefix: "Lobby",
      createTransitions: true,
      activateFirst: true,
    });
  });

  test("smokePlanningIntent is a valid normalized write intent", () => {
    expect(smokePptxDeckScreenArgs("D:/Plans/deck.pptx", {
      screenName: "Onboarding",
      pptxDeckSlideNumbers: [1, 3],
      pptxDeckMaxSlides: 2,
      pptxDeckCreateTransitions: false,
      pptxDeckActivateFirst: false,
      pptxDeckTransitionTriggerPrefix: "continue",
      pptxDeckIncludeShapePanels: true,
      materialScreenAssetDir: "Assets/UOS/Decks",
      materialScreenOutputDir: "D:/tmp/deck-images",
    })).toEqual({
      path: "D:/Plans/deck.pptx",
      slideNumbers: [1, 3],
      maxSlides: 2,
      screenNamePrefix: "Onboarding",
      assetDir: "Assets/UOS/Decks",
      embeddedOutputDir: "D:/tmp/deck-images",
      includeShapePanels: true,
      createTransitions: false,
      transitionTriggerPrefix: "continue",
      activateFirst: false,
    });

    const intent = smokePlanningIntent("SmokeByTest");
    expect(intent.version).toBe("1.0.0");
    expect(intent.screenName).toBe("SmokeByTest");
    expect(intent.elements).toHaveLength(7);
    expect(intent.elements.map((element: any) => element.type))
      .toEqual(["Panel", "Text", "Button", "InputField", "Toggle", "Slider", "Dropdown"]);
    expect(intent.elements.find((element: any) => element.type === "InputField")?.props)
      .toMatchObject({ text: "Player name", placeholder: "Player name", inputText: "Codex" });
    expect(intent.elements.find((element: any) => element.type === "Toggle")?.props)
      .toMatchObject({ text: "Remember", isOn: true, hasIsOn: true });
    expect(intent.elements.find((element: any) => element.type === "Slider")?.props)
      .toMatchObject({ minValue: 0, maxValue: 10, value: 6, hasValue: true });
    expect(intent.elements.find((element: any) => element.type === "Dropdown")?.props)
      .toMatchObject({ options: ["Easy", "Normal", "Hard"], value: 1, hasValue: true });
    expect(smokePlanningIntent("SmokeWithSprite", { spriteAssetPath: "Assets/UOS/logo.png" }).elements[0].props.sprite)
      .toBe("Assets/UOS/logo.png");
    for (const element of intent.elements) {
      expect(element.rect.x).toBeGreaterThanOrEqual(0);
      expect(element.rect.y).toBeGreaterThanOrEqual(0);
      expect(element.rect.w).toBeGreaterThan(0);
      expect(element.rect.h).toBeGreaterThan(0);
      expect(element.rect.x + element.rect.w).toBeLessThanOrEqual(1);
      expect(element.rect.y + element.rect.h).toBeLessThanOrEqual(1);
    }
  });

  test("sanitizeSmokeJournalValue redacts bulky binary payloads", () => {
    const sanitized = sanitizeSmokeJournalValue({
      base64Data: "a".repeat(12000),
      dataUrl: "data:image/png;base64," + "b".repeat(12000),
      nested: { bytes: "raw-bytes", text: "keep" },
    }) as any;
    expect(sanitized.base64Data).toBe("[redacted base64Data, 12000 chars]");
    expect(sanitized.dataUrl).toContain("[redacted dataUrl");
    expect(sanitized.nested.bytes).toBe("[redacted bytes, 9 chars]");
    expect(sanitized.nested.text).toBe("keep");
  });

  test("compareSmokeImages writes a visual diff and reports close metrics", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-compare-test");
    const referencePath = join(projectDir, "reference.png");
    const candidatePath = join(projectDir, "candidate.png");
    const diffPath = join(projectDir, "diff.png");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      const sharp = (await import("sharp")).default;
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#ff0000" },
      }).png().toFile(referencePath);
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: "#ff0000" },
      }).png().toFile(candidatePath);

      expect(resolveSmokeComparePath("reference.png", liveTarget(projectDir))).toBe(referencePath);
      const result = await compareSmokeImages(referencePath, candidatePath, {
        maxWidth: 4,
        maxHeight: 4,
        threshold: 0.05,
        outputPath: diffPath,
      });

      expect(result.meanAbsoluteError).toBe(0);
      expect(result.mismatchRatio).toBe(0);
      expect(result.diffPath).toBe(diffPath);
      expect(await Bun.file(diffPath).exists()).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can verify and write through the selected bridge", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-context-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        preview: true,
        revise: true,
        flow: true,
        contextFollowUp: true,
        save: true,
        screenName: "SmokeByTest",
        importPath: "Plans/logo.png",
        assetPath: "Assets/UOS/Imported/logo.png",
        materialsDir: "D:/Materials",
        comparePath: "Plans/reference.png",
        compareOutputPath: "comparisons/diff.png",
        compareMaxWidth: 640,
        compareMaxHeight: 360,
        compareThreshold: 0.1,
        compareImageFiles: async (referencePath: string, candidatePath: string, options: any) => ({
          referencePath,
          candidatePath,
          diffPath: options.outputPath,
          diffMimeType: "image/png",
          referenceWidth: 1920,
          referenceHeight: 1080,
          candidateWidth: 1920,
          candidateHeight: 1080,
          compareWidth: options.maxWidth,
          compareHeight: options.maxHeight,
          meanAbsoluteError: 0.02,
          rootMeanSquareError: 0.03,
          mismatchRatio: 0.04,
          maxChannelDelta: 12,
          aspectRatioDelta: 0,
          threshold: options.threshold,
          size: 456,
        }),
        contextProjectDir: projectDir,
        now: () => "2026-06-04T03:00:00.000Z",
      });

      expect(result.projectInfo.projectName).toBe("LiveProject");
      expect(result.screensBefore.screens[0].name).toBe("Existing Screen");
      expect(result.imported.sourcePath).toBe(resolve("D:/Materials", "Plans/logo.png"));
      expect(result.imported.assetPath).toBe("Assets/UOS/Imported/logo.png");
      expect(result.created.screenId).toBe("SmokeByTest_ID");
      expect(result.created.elements).toHaveLength(7);
      expect(result.revision.updated.ok).toBe(true);
      expect(result.revision.added.elementId).toBe("Element_Revision");
      expect(result.revision.tempAdded.elementId).toBe("Element_Disposable");
      expect(result.revision.moved.ok).toBe(true);
      expect(result.revision.deleted.ok).toBe(true);
      expect(result.flowScreen.screenId).toBe("SmokeByTestNext_ID");
      expect(result.transitionArgs).toEqual({
        fromId: "SmokeByTest_ID",
        toId: "SmokeByTestNext_ID",
        trigger: "Element_3",
      });
      expect(result.transition.ok).toBe(true);
      expect(result.contextFollowUp.activeScreenId).toBe("SmokeByTest_ID");
      expect(result.contextFollowUp.updateCriteria).toEqual({ clientHintId: "smokeTitle", query: "smoke title" });
      expect(result.contextFollowUp.updateArgs).toMatchObject({
        elementId: "Element_2",
        props: { text: "UOS Smoke Context Follow-up" },
      });
      expect(result.contextFollowUp.updated.ok).toBe(true);
      expect(result.contextFollowUp.addCriteria).toEqual({ parentClientHintId: "smokePanel", parentQuery: "smoke panel" });
      expect(result.contextFollowUp.addArgs).toMatchObject({
        screenId: "SmokeByTest_ID",
        element: {
          clientHintId: "smokeContextBadge",
          parentElementId: "Element_1",
        },
      });
      expect(result.contextFollowUp.added.elementId).toBe("Element_ContextBadge");
      expect(result.contextFollowUp.hierarchy.screenId).toBe("SmokeByTest_ID");
      expect(result.preview.path).toContain("SmokeByTest_ID");
      expect(result.preview.base64Data).toBe("[redacted base64Data, 12000 chars]");
      expect(result.comparison.verdict).toBe("close");
      expect(result.comparison.referencePath).toBe(resolve("D:/Materials", "Plans/reference.png"));
      expect(result.comparison.candidatePath).toBe(result.preview.path);
      expect(result.comparison.diffPath).toBe(join(projectDir, ".uos", "comparisons", "diff.png"));
      expect(result.saved.path).toBe("Assets/UOS_Generated.unity");
      expect(result.context.contextDir).toBe(join(projectDir, ".uos"));
      expect(await Bun.file(result.preview.path).exists()).toBe(true);

      const index = JSON.parse(await readFile(join(projectDir, ".uos", "screens.json"), "utf8"));
      expect(index.screens.SmokeByTest_ID.elements.Element_1.props.sprite)
        .toBe("Assets/UOS/Imported/logo.png");
      expect(index.activeScreenId).toBe("SmokeByTest_ID");
      expect(index.screens.SmokeByTest_ID.active).toBe(true);
      expect(index.screens.SmokeByTest_ID.elements.Element_2.props.text)
        .toBe("UOS Smoke Context Follow-up");
      expect(index.screens.SmokeByTest_ID.elements.Element_2.props.color)
        .toBe("#f97316");
      expect(index.screens.SmokeByTest_ID.elements.Element_Revision.parentElementId)
        .toBe("Element_1");
      expect(index.screens.SmokeByTest_ID.elements.Element_ContextBadge.parentElementId)
        .toBe("Element_1");
      expect(index.screens.SmokeByTest_ID.elements.Element_ContextBadge.props.text)
        .toBe("Context follow-up");
      expect(index.screens.SmokeByTest_ID.elements.Element_Disposable.deleted)
        .toBe(true);
      expect(index.screens.SmokeByTest_ID.elements.Element_3.rect)
        .toEqual({ x: 0.18, y: 0.62, w: 0.64, h: 0.16 });
      expect(index.screens.SmokeByTest_ID.elements.Element_4.type).toBe("InputField");
      expect(index.screens.SmokeByTest_ID.elements.Element_4.props.text).toBe("Player name");
      expect(index.screens.SmokeByTest_ID.elements.Element_4.props.placeholder).toBe("Player name");
      expect(index.screens.SmokeByTest_ID.elements.Element_4.props.inputText).toBe("Codex");
      expect(index.screens.SmokeByTest_ID.elements.Element_5.type).toBe("Toggle");
      expect(index.screens.SmokeByTest_ID.elements.Element_5.props.text).toBe("Remember");
      expect(index.screens.SmokeByTest_ID.elements.Element_5.props.isOn).toBe(true);
      expect(index.screens.SmokeByTest_ID.elements.Element_6.type).toBe("Slider");
      expect(index.screens.SmokeByTest_ID.elements.Element_6.props.value).toBe(6);
      expect(index.screens.SmokeByTest_ID.elements.Element_6.props.minValue).toBe(0);
      expect(index.screens.SmokeByTest_ID.elements.Element_6.props.maxValue).toBe(10);
      expect(index.screens.SmokeByTest_ID.elements.Element_7.type).toBe("Dropdown");
      expect(index.screens.SmokeByTest_ID.elements.Element_7.props.options)
        .toEqual(["Easy", "Normal", "Hard"]);
      expect(index.screens.SmokeByTest_ID.elements.Element_7.props.value).toBe(1);
      expect(index.screens.SmokeByTestNext_ID.screenName)
        .toBe("SmokeByTestNext");
      expect(index.transitions[0]).toMatchObject({
        fromId: "SmokeByTest_ID",
        toId: "SmokeByTestNext_ID",
        trigger: "Element_3",
        ok: true,
        ts: "2026-06-04T03:00:00.000Z",
      });
      expect(index.screens.SmokeByTest_ID.previews[0].savedPath)
        .toBe(result.preview.path);
      expect(index.screens.SmokeByTest_ID.previews[0].savedPath)
        .toContain(join(projectDir, ".uos", "previews"));
      expect(index.screens.SmokeByTest_ID.previews[0].mimeType)
        .toBe("image/png");
      expect(index.screens.SmokeByTest_ID.comparisons[0].verdict)
        .toBe("close");
      expect(index.screens.SmokeByTest_ID.comparisons[0].diffPath)
        .toBe(join(projectDir, ".uos", "comparisons", "diff.png"));
      expect(index.screens.SmokeByTest_ID.comparisons[0].compareWidth)
        .toBe(640);
      expect(index.importedAssets[0].assetPath).toBe("Assets/UOS/Imported/logo.png");
      expect(index.lastSavedScenePath).toBe("Assets/UOS_Generated.unity");
      const journal = await readFile(join(projectDir, ".uos", "work-journal.jsonl"), "utf8");
      expect(journal).toContain("\"tool\":\"import_asset\"");
      expect(journal).toContain("\"tool\":\"create_ui_screen\"");
      expect(journal).toContain("\"tool\":\"update_ui_element\"");
      expect(journal).toContain("\"tool\":\"add_ui_element\"");
      expect(journal).toContain("\"tool\":\"move_ui_element\"");
      expect(journal).toContain("\"tool\":\"delete_ui_element\"");
      expect(journal).toContain("\"tool\":\"create_screen_transition\"");
      expect(journal).toContain("\"tool\":\"set_active_screen_from_context\"");
      expect(journal).toContain("\"tool\":\"update_ui_element_from_context\"");
      expect(journal).toContain("\"tool\":\"add_ui_element_from_context\"");
      expect(journal).toContain("\"tool\":\"capture_preview\"");
      expect(journal).toContain("\"tool\":\"compare_images\"");
      expect(journal).toContain("\"tool\":\"save_scene\"");
      expect(journal).toContain("[redacted base64Data, 12000 chars]");
      expect(journal).not.toContain("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      const output = formatSmokeResult(result);
      expect(output).toContain("connected: LiveProject");
      expect(output).toContain("imported asset: Assets/UOS/Imported/logo.png");
      expect(output).toContain("created screen: SmokeByTest_ID");
      expect(output).toContain("revised screen:");
      expect(output).toContain("deleted Element_Disposable");
      expect(output).toContain("flow screen: SmokeByTestNext_ID");
      expect(output).toContain("transition: SmokeByTest_ID -> SmokeByTestNext_ID");
      expect(output).toContain("context follow-up: active SmokeByTest_ID");
      expect(output).toContain("comparison: verdict=close");
      expect(output).toContain("saved scene: Assets/UOS_Generated.unity");
      expect(output).toContain("context:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can route an opencode AI smoke run through the selected bridge", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-run-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Smoke Test",
        aiRunObjectName: "AI Smoke Object",
        recordContext: false,
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "create_scene_object",
              "delete_scene_object",
              "UOS_AI_SMOKE_OK SceneObject_AI",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.projectInfo.projectName).toBe("LiveProject");
      expect(result.created).toBeUndefined();
      expect(result.aiRun).toMatchObject({
        ok: true,
        command: "opencode",
        title: "UOS AI Smoke Test",
        model: "anthropic/claude-haiku-4-5",
        agent: "ochestrator",
        objectName: "AI Smoke Object",
        observedTools: ["get_uos_context", "get_project_info", "create_scene_object", "delete_scene_object"],
        missingTools: [],
        expectedJournalTools: ["create_scene_object", "delete_scene_object"],
        observedJournalTools: [],
        missingJournalTools: ["create_scene_object", "delete_scene_object"],
        journalVerified: false,
        journalSkippedReason: "custom command runner",
        markerSeen: true,
      });
      expect(commandCall.command).toBe("opencode");
      expect(commandCall.args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--title"]);
      expect(commandCall.args).toContain("-m");
      expect(commandCall.args).toContain("anthropic/claude-haiku-4-5");
      expect(commandCall.args.at(-1)).toContain("AI Smoke Object");
      expect(commandCall.options.cwd).toContain("MCP_for_Unity_LYX");
      expect(commandCall.options.timeoutMs).toBe(180000);
      expect(commandCall.options.env.UNITY_MCP_HOST).toBe("127.0.0.1");
      expect(commandCall.options.env.UNITY_MCP_PORT).toBe(String(port));
      expect(commandCall.options.env.UNITY_MCP_TOKEN).toBe("good-token");
      expect(commandCall.options.env.UOS_PROJECT_DIR).toBe(projectDir);
      expect(commandCall.options.env.UOS_BRIDGE_SUPPORTED_TOOLS).toContain("create_scene_object");

      const output = formatSmokeResult(result);
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 object=AI Smoke Object type=Empty");
      expect(output).toContain("tools=get_uos_context,get_project_info,create_scene_object,delete_scene_object");
      expect(output).toContain("journal=skipped(custom command runner)");
      expect(output).not.toContain("write: skipped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can route an opencode AI conversational follow-up through persisted context", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-follow-up-test");
    const journalDir = join(projectDir, ".uos");
    const journalPath = join(journalDir, "work-journal.jsonl");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        preview: true,
        aiRun: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Follow-up Smoke Test",
        screenName: "AIFollowUpSmoke",
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          const preContext = JSON.parse(readFileSync(join(projectDir, ".uos", "screens.json"), "utf8"));
          expect(preContext.screens.AIFollowUpSmoke_ID.elements.Element_2.props.text).toBe("UOS Smoke Test");
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({
              ts,
              tool: "update_ui_element_from_context",
              sessionID: "ses_ai_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AIFollowUpSmoke_ID", elementId: "Element_2" },
                updateArgs: { elementId: "Element_2", props: { text: "UOS AI Context Follow-up", color: "#22c55e" } },
                updated: { ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "capture_preview_from_context",
              sessionID: "ses_ai_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AIFollowUpSmoke_ID" },
                previewArgs: { screenId: "AIFollowUpSmoke_ID" },
                captured: { ok: true, screenId: "AIFollowUpSmoke_ID", savedPath: join(projectDir, ".uos", "previews", "ai-follow-up.png") },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "update_ui_element_from_context",
              "capture_preview_from_context",
              "UOS_AI_SMOKE_OK AIFollowUpSmoke_ID Element_2",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.created.screenId).toBe("AIFollowUpSmoke_ID");
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        screenId: "AIFollowUpSmoke_ID",
        screenName: "AIFollowUpSmoke",
        expectedTools: ["get_uos_context", "get_project_info", "update_ui_element_from_context", "capture_preview_from_context"],
        observedTools: ["get_uos_context", "get_project_info", "update_ui_element_from_context", "capture_preview_from_context"],
        expectedJournalTools: ["update_ui_element_from_context", "capture_preview_from_context"],
        observedJournalTools: ["update_ui_element_from_context", "capture_preview_from_context"],
        missingJournalTools: [],
        journalScreenId: "AIFollowUpSmoke_ID",
        journalOrderOk: true,
        journalVerified: true,
      });
      expect(commandCall.command).toBe("opencode");
      expect(commandCall.args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--title"]);
      expect(commandCall.args).not.toContain("--file");
      expect(commandCall.args.at(-1)).toContain("update_ui_element_from_context");
      expect(commandCall.args.at(-1)).toContain("capture_preview_from_context");
      expect(commandCall.args.at(-1)).toContain("AIFollowUpSmoke_ID");
      expect(commandCall.args.at(-1)).toContain("UOS AI Context Follow-up");
      expect(commandCall.options.env.UOS_CONTEXT_SUMMARY).toContain("AIFollowUpSmoke_ID");

      const output = formatSmokeResult(result);
      expect(output).toContain("created screen: AIFollowUpSmoke_ID");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AIFollowUpSmoke_ID mode=context-follow-up");
      expect(output).toContain("tools=get_uos_context,get_project_info,update_ui_element_from_context,capture_preview_from_context");
      expect(output).toContain("journal=update_ui_element_from_context,capture_preview_from_context");
      expect(output).toContain("preview:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke routes an opencode AI follow-up through persisted visual feedback", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-feedback-follow-up-test");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const screensPath = join(projectDir, ".uos", "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "reference.png"), "fake reference png");

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        verifyPath: "Plans/reference.png",
        compareOutputPath: "comparisons/feedback-diff.png",
        aiRun: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Feedback Follow-up Smoke Test",
        screenName: "AIFeedbackFollowUp",
        contextProjectDir: projectDir,
        now: () => "2026-06-05T05:10:00.000Z",
        compareImageFiles: async (referencePath: string, candidatePath: string, options: any) => ({
          referencePath,
          candidatePath,
          diffPath: options.outputPath,
          diffMimeType: "image/png",
          referenceWidth: 1920,
          referenceHeight: 1080,
          candidateWidth: 1920,
          candidateHeight: 1080,
          compareWidth: options.maxWidth,
          compareHeight: options.maxHeight,
          meanAbsoluteError: 0.08,
          rootMeanSquareError: 0.1,
          mismatchRatio: 0.2,
          maxChannelDelta: 96,
          aspectRatioDelta: 0,
          threshold: options.threshold,
          size: 987,
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          const preContext = JSON.parse(readFileSync(screensPath, "utf8"));
          expect(preContext.screens.AIFeedbackFollowUp_ID.comparisons[0]).toMatchObject({
            verdict: "needs review",
            diffPath: join(projectDir, ".uos", "comparisons", "feedback-diff.png"),
          });
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("comparisons=1");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("comparison: verdict=needs review");
          expect(args.at(-1)).toContain("inspect_screen_feedback_from_context");
          expect(args.at(-1)).toContain("latest comparison");

          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            readFileSync(journalPath, "utf8").trimEnd(),
            JSON.stringify({
              ts,
              tool: "inspect_screen_feedback_from_context",
              sessionID: "ses_ai_feedback_follow_up",
              result: {
                ok: true,
                screen: { screenId: "AIFeedbackFollowUp_ID", comparisonCount: 1 },
                latestComparison: { verdict: "needs review", mismatchRatio: 0.2 },
                recommendedTools: ["get_scene_hierarchy_from_context", "update_ui_element_from_context"],
              },
            }),
            JSON.stringify({
              ts,
              tool: "update_ui_element_from_context",
              sessionID: "ses_ai_feedback_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AIFeedbackFollowUp_ID", elementId: "Element_2" },
                updateArgs: { elementId: "Element_2", props: { text: "UOS AI Context Follow-up", color: "#22c55e" } },
                updated: { ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "capture_preview_from_context",
              sessionID: "ses_ai_feedback_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AIFeedbackFollowUp_ID" },
                previewArgs: { screenId: "AIFeedbackFollowUp_ID" },
                captured: { ok: true, screenId: "AIFeedbackFollowUp_ID", savedPath: join(projectDir, ".uos", "previews", "feedback-follow-up.png") },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "inspect_screen_feedback_from_context",
              "update_ui_element_from_context",
              "capture_preview_from_context",
              "UOS_AI_SMOKE_OK AIFeedbackFollowUp_ID Element_2",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.verification).toMatchObject({
        screenId: "AIFeedbackFollowUp_ID",
        verdict: "needs review",
      });
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        screenId: "AIFeedbackFollowUp_ID",
        expectedTools: ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "update_ui_element_from_context", "capture_preview_from_context"],
        observedTools: ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "update_ui_element_from_context", "capture_preview_from_context"],
        expectedJournalTools: ["inspect_screen_feedback_from_context", "update_ui_element_from_context", "capture_preview_from_context"],
        observedJournalTools: ["inspect_screen_feedback_from_context", "update_ui_element_from_context", "capture_preview_from_context"],
        journalOrderOk: true,
      });
      expect(commandCall.args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--title"]);
      expect(commandCall.args).not.toContain("--file");

      const output = formatSmokeResult(result);
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AIFeedbackFollowUp_ID mode=context-follow-up action=update");
      expect(output).toContain("tools=get_uos_context,get_project_info,inspect_screen_feedback_from_context,update_ui_element_from_context,capture_preview_from_context");
      expect(output).toContain("journal=inspect_screen_feedback_from_context,update_ui_element_from_context,capture_preview_from_context");
      expect(output).toContain("verification: verdict=needs review");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke routes large visual feedback mismatch into a context move follow-up", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-feedback-move-test");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const screensPath = join(projectDir, ".uos", "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "reference.png"), "fake reference png");

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        verifyPath: "Plans/reference.png",
        compareOutputPath: "comparisons/feedback-move-diff.png",
        aiRun: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Feedback Move Smoke Test",
        screenName: "AIFeedbackMove",
        contextProjectDir: projectDir,
        now: () => "2026-06-05T05:20:00.000Z",
        compareImageFiles: async (referencePath: string, candidatePath: string, options: any) => ({
          referencePath,
          candidatePath,
          diffPath: options.outputPath,
          diffMimeType: "image/png",
          referenceWidth: 1920,
          referenceHeight: 1080,
          candidateWidth: 1920,
          candidateHeight: 1080,
          compareWidth: options.maxWidth,
          compareHeight: options.maxHeight,
          meanAbsoluteError: 0.2,
          rootMeanSquareError: 0.24,
          mismatchRatio: 0.5,
          maxChannelDelta: 120,
          aspectRatioDelta: 0,
          threshold: options.threshold,
          size: 1200,
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          const preContext = JSON.parse(readFileSync(screensPath, "utf8"));
          expect(preContext.screens.AIFeedbackMove_ID.comparisons[0]).toMatchObject({
            verdict: "different",
            diffPath: join(projectDir, ".uos", "comparisons", "feedback-move-diff.png"),
          });
          expect(args.at(-1)).toContain("inspect_screen_feedback_from_context");
          expect(args.at(-1)).toContain("get_scene_hierarchy_from_context");
          expect(args.at(-1)).toContain("move_ui_element_from_context");
          expect(args.at(-1)).toContain("verify_screen_against_reference_from_context");
          expect(args.at(-1)).not.toContain("update_ui_element_from_context exactly once");
          expect(args.at(-1)).toContain("\"clientHintId\":\"smokeTitle\"");
          expect(args.at(-1)).toContain("\"rect\":{\"x\":0.06,\"y\":0.06,\"w\":0.88,\"h\":0.12}");
          expect(args.at(-1)).toContain(JSON.stringify(join(projectDir, "Plans", "reference.png")));

          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            readFileSync(journalPath, "utf8").trimEnd(),
            JSON.stringify({
              ts,
              tool: "inspect_screen_feedback_from_context",
              sessionID: "ses_ai_feedback_move",
              result: {
                ok: true,
                screen: { screenId: "AIFeedbackMove_ID", comparisonCount: 1 },
                latestComparison: { verdict: "different", mismatchRatio: 0.5 },
                recommendedTools: ["get_scene_hierarchy_from_context", "move_ui_element_from_context"],
              },
            }),
            JSON.stringify({
              ts,
              tool: "get_scene_hierarchy_from_context",
              sessionID: "ses_ai_feedback_move",
              result: {
                ok: true,
                matched: { screenId: "AIFeedbackMove_ID" },
                hierarchy: { screenId: "AIFeedbackMove_ID", nodes: [] },
              },
            }),
            JSON.stringify({
              ts,
              tool: "move_ui_element_from_context",
              sessionID: "ses_ai_feedback_move",
              result: {
                ok: true,
                matched: { screenId: "AIFeedbackMove_ID", elementId: "Element_2" },
                moveArgs: {
                  elementId: "Element_2",
                  rect: { x: 0.06, y: 0.06, w: 0.88, h: 0.12 },
                  anchor: "TopLeft",
                },
                moved: { ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "verify_screen_against_reference_from_context",
              sessionID: "ses_ai_feedback_move",
              result: {
                ok: true,
                matched: { screenId: "AIFeedbackMove_ID" },
                verifyArgs: {
                  screenId: "AIFeedbackMove_ID",
                  referencePath: join(projectDir, "Plans", "reference.png"),
                },
                verified: {
                  ok: true,
                  screenId: "AIFeedbackMove_ID",
                  verdict: "needs review",
                  preview: {
                    ok: true,
                    screenId: "AIFeedbackMove_ID",
                    savedPath: join(projectDir, ".uos", "previews", "feedback-move-verify.png"),
                  },
                  comparison: {
                    screenId: "AIFeedbackMove_ID",
                    referencePath: join(projectDir, "Plans", "reference.png"),
                    candidatePath: join(projectDir, ".uos", "previews", "feedback-move-verify.png"),
                    diffPath: join(projectDir, ".uos", "comparisons", "feedback-move-verify-diff.png"),
                    verdict: "needs review",
                    mismatchRatio: 0.25,
                  },
                },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "inspect_screen_feedback_from_context",
              "get_scene_hierarchy_from_context",
              "move_ui_element_from_context",
              "verify_screen_against_reference_from_context",
              "UOS_AI_SMOKE_OK AIFeedbackMove_ID Element_2",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.verification).toMatchObject({
        screenId: "AIFeedbackMove_ID",
        verdict: "different",
      });
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        followUpAction: "move",
        screenId: "AIFeedbackMove_ID",
        expectedTools: ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "move_ui_element_from_context", "verify_screen_against_reference_from_context"],
        observedTools: ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "move_ui_element_from_context", "verify_screen_against_reference_from_context"],
        expectedJournalTools: ["inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "move_ui_element_from_context", "verify_screen_against_reference_from_context"],
        observedJournalTools: ["inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "move_ui_element_from_context", "verify_screen_against_reference_from_context"],
        journalOrderOk: true,
        journalVerification: {
          screenId: "AIFeedbackMove_ID",
          verdict: "needs review",
          previewPath: join(projectDir, ".uos", "previews", "feedback-move-verify.png"),
          diffPath: join(projectDir, ".uos", "comparisons", "feedback-move-verify-diff.png"),
          mismatchRatio: 0.25,
        },
      });
      expect(commandCall.args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--title"]);

      const output = formatSmokeResult(result);
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AIFeedbackMove_ID mode=context-follow-up action=move");
      expect(output).toContain("tools=get_uos_context,get_project_info,inspect_screen_feedback_from_context,get_scene_hierarchy_from_context,move_ui_element_from_context,verify_screen_against_reference_from_context");
      expect(output).toContain("journal=inspect_screen_feedback_from_context,get_scene_hierarchy_from_context,move_ui_element_from_context,verify_screen_against_reference_from_context");
      expect(output).toContain("opencode AI verification: screen=AIFeedbackMove_ID verdict=needs review");
      expect(output).toContain("mismatch=0.25");
      expect(output).toContain("verification: verdict=different");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can repeat visual feedback repairs until the latest verification improves", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-feedback-loop-test");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const screensPath = join(projectDir, ".uos", "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "reference.png"), "fake reference png");

    const commandCalls: any[] = [];
    let repairRecordCount = 0;
    const appendRepairJournal = (sessionID: string, verdict: string, mismatchRatio: number, suffix: string) => {
      repairRecordCount += 1;
      const ts = new Date(Date.now() + repairRecordCount * 1000).toISOString();
      writeFileSync(journalPath, [
        readFileSync(journalPath, "utf8").trimEnd(),
        JSON.stringify({
          ts,
          tool: "inspect_screen_feedback_from_context",
          sessionID,
          result: {
            ok: true,
            screen: { screenId: "AIFeedbackLoop_ID", comparisonCount: 1 },
            latestComparison: { verdict, mismatchRatio },
            recommendedTools: ["get_scene_hierarchy_from_context", "move_ui_element_from_context"],
          },
        }),
        JSON.stringify({
          ts,
          tool: "get_scene_hierarchy_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackLoop_ID" },
            hierarchy: { screenId: "AIFeedbackLoop_ID", nodes: [] },
          },
        }),
        JSON.stringify({
          ts,
          tool: "move_ui_element_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackLoop_ID", elementId: "Element_2" },
            moveArgs: {
              elementId: "Element_2",
              rect: { x: 0.06, y: 0.06, w: 0.88, h: 0.12 },
              anchor: "TopLeft",
            },
            moved: { ok: true },
          },
        }),
        JSON.stringify({
          ts,
          tool: "verify_screen_against_reference_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackLoop_ID" },
            verifyArgs: {
              screenId: "AIFeedbackLoop_ID",
              referencePath: join(projectDir, "Plans", "reference.png"),
            },
            verified: {
              ok: true,
              screenId: "AIFeedbackLoop_ID",
              verdict,
              preview: {
                ok: true,
                screenId: "AIFeedbackLoop_ID",
                savedPath: join(projectDir, ".uos", "previews", `feedback-loop-${suffix}.png`),
              },
              comparison: {
                screenId: "AIFeedbackLoop_ID",
                referencePath: join(projectDir, "Plans", "reference.png"),
                candidatePath: join(projectDir, ".uos", "previews", `feedback-loop-${suffix}.png`),
                diffPath: join(projectDir, ".uos", "comparisons", `feedback-loop-${suffix}-diff.png`),
                verdict,
                mismatchRatio,
              },
            },
          },
        }),
        "",
      ].join("\n"));

      const idx = JSON.parse(readFileSync(screensPath, "utf8"));
      const screen = idx.screens.AIFeedbackLoop_ID;
      screen.updatedAt = ts;
      screen.comparisons = [
        ...(Array.isArray(screen.comparisons) ? screen.comparisons : []),
        {
          ts,
          screenId: "AIFeedbackLoop_ID",
          referencePath: join(projectDir, "Plans", "reference.png"),
          candidatePath: join(projectDir, ".uos", "previews", `feedback-loop-${suffix}.png`),
          diffPath: join(projectDir, ".uos", "comparisons", `feedback-loop-${suffix}-diff.png`),
          verdict,
          mismatchRatio,
        },
      ];
      writeFileSync(screensPath, JSON.stringify(idx, null, 2));
    };

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        verifyPath: "Plans/reference.png",
        compareOutputPath: "comparisons/feedback-loop-diff.png",
        aiRun: true,
        aiFollowUp: true,
        aiFeedbackIterations: 3,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Feedback Loop Smoke Test",
        screenName: "AIFeedbackLoop",
        contextProjectDir: projectDir,
        now: () => "2026-06-05T05:30:00.000Z",
        compareImageFiles: async (referencePath: string, candidatePath: string, options: any) => ({
          referencePath,
          candidatePath,
          diffPath: options.outputPath,
          diffMimeType: "image/png",
          referenceWidth: 1920,
          referenceHeight: 1080,
          candidateWidth: 1920,
          candidateHeight: 1080,
          compareWidth: options.maxWidth,
          compareHeight: options.maxHeight,
          meanAbsoluteError: 0.2,
          rootMeanSquareError: 0.24,
          mismatchRatio: 0.5,
          maxChannelDelta: 120,
          aspectRatioDelta: 0,
          threshold: options.threshold,
          size: 1200,
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          const callNumber = commandCalls.length + 1;
          commandCalls.push({ command, args, options });
          expect(args.at(-1)).toContain("verify_screen_against_reference_from_context");
          if (callNumber === 1) {
            expect(args).not.toContain("--continue");
            appendRepairJournal("ses_ai_feedback_loop_1", "different", 0.45, "first");
          } else if (callNumber === 2) {
            expect(args).toContain("--continue");
            expect(options.env.UOS_CONTEXT_SUMMARY).toContain("comparison: verdict=different");
            appendRepairJournal("ses_ai_feedback_loop_2", "needs review", 0.24, "second");
          } else {
            throw new Error(`unexpected feedback repair call ${callNumber}`);
          }
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "inspect_screen_feedback_from_context",
              "get_scene_hierarchy_from_context",
              "move_ui_element_from_context",
              "verify_screen_against_reference_from_context",
              "UOS_AI_SMOKE_OK AIFeedbackLoop_ID Element_2",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(commandCalls).toHaveLength(2);
      expect(result.aiRuns).toHaveLength(2);
      expect(result.aiRuns?.[0]).toMatchObject({
        ok: true,
        continued: false,
        followUpAction: "move",
      });
      expect(result.aiRuns?.[1]).toMatchObject({
        ok: true,
        continued: true,
        feedbackIteration: 2,
        followUpAction: "move",
        journalVerification: {
          screenId: "AIFeedbackLoop_ID",
          verdict: "needs review",
          mismatchRatio: 0.24,
        },
      });
      expect(result.aiRun).toMatchObject({
        ok: true,
        continued: true,
        feedbackIteration: 2,
      });

      const latestIndex = JSON.parse(readFileSync(screensPath, "utf8"));
      expect(latestIndex.screens.AIFeedbackLoop_ID.comparisons.at(-1)).toMatchObject({
        verdict: "needs review",
        mismatchRatio: 0.24,
      });

      const output = formatSmokeResult(result);
      expect(output).toContain("continued feedbackIteration=2");
      expect(output).toContain("opencode AI verification: screen=AIFeedbackLoop_ID verdict=needs review");
      expect(output).toContain("mismatch=0.24");
      expect(output.match(/opencode AI run: ok/g)).toHaveLength(2);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke escalates repeated visual feedback repairs to delete and add replacement", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-feedback-replace-test");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const screensPath = join(projectDir, ".uos", "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "reference.png"), "fake reference png");

    const commandCalls: any[] = [];
    let repairRecordCount = 0;
    const nextTs = () => {
      repairRecordCount += 1;
      return new Date(Date.now() + repairRecordCount * 1000).toISOString();
    };
    const appendRecords = (records: any[]) => {
      writeFileSync(journalPath, [
        readFileSync(journalPath, "utf8").trimEnd(),
        ...records.map((record) => JSON.stringify(record)),
        "",
      ].join("\n"));
    };
    const appendComparisonToIndex = (ts: string, verdict: string, mismatchRatio: number, suffix: string) => {
      const idx = JSON.parse(readFileSync(screensPath, "utf8"));
      const screen = idx.screens.AIFeedbackReplace_ID;
      screen.updatedAt = ts;
      screen.comparisons = [
        ...(Array.isArray(screen.comparisons) ? screen.comparisons : []),
        {
          ts,
          screenId: "AIFeedbackReplace_ID",
          referencePath: join(projectDir, "Plans", "reference.png"),
          candidatePath: join(projectDir, ".uos", "previews", `feedback-replace-${suffix}.png`),
          diffPath: join(projectDir, ".uos", "comparisons", `feedback-replace-${suffix}-diff.png`),
          verdict,
          mismatchRatio,
        },
      ];
      writeFileSync(screensPath, JSON.stringify(idx, null, 2));
    };
    const appendMoveJournal = (sessionID: string, verdict: string, mismatchRatio: number, suffix: string) => {
      const ts = nextTs();
      appendRecords([
        {
          ts,
          tool: "inspect_screen_feedback_from_context",
          sessionID,
          result: {
            ok: true,
            screen: { screenId: "AIFeedbackReplace_ID", comparisonCount: 1 },
            latestComparison: { verdict, mismatchRatio },
            recommendedTools: ["get_scene_hierarchy_from_context", "move_ui_element_from_context"],
          },
        },
        {
          ts,
          tool: "get_scene_hierarchy_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID" },
            hierarchy: { screenId: "AIFeedbackReplace_ID", nodes: [] },
          },
        },
        {
          ts,
          tool: "move_ui_element_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID", elementId: "Element_2" },
            moveArgs: {
              elementId: "Element_2",
              rect: { x: 0.06, y: 0.06, w: 0.88, h: 0.12 },
              anchor: "TopLeft",
            },
            moved: { ok: true },
          },
        },
        {
          ts,
          tool: "verify_screen_against_reference_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID" },
            verifyArgs: {
              screenId: "AIFeedbackReplace_ID",
              referencePath: join(projectDir, "Plans", "reference.png"),
            },
            verified: {
              ok: true,
              screenId: "AIFeedbackReplace_ID",
              verdict,
              preview: {
                ok: true,
                screenId: "AIFeedbackReplace_ID",
                savedPath: join(projectDir, ".uos", "previews", `feedback-replace-${suffix}.png`),
              },
              comparison: {
                screenId: "AIFeedbackReplace_ID",
                referencePath: join(projectDir, "Plans", "reference.png"),
                candidatePath: join(projectDir, ".uos", "previews", `feedback-replace-${suffix}.png`),
                diffPath: join(projectDir, ".uos", "comparisons", `feedback-replace-${suffix}-diff.png`),
                verdict,
                mismatchRatio,
              },
            },
          },
        },
      ]);
      appendComparisonToIndex(ts, verdict, mismatchRatio, suffix);
    };
    const appendReplaceJournal = (sessionID: string, verdict: string, mismatchRatio: number, suffix: string) => {
      const ts = nextTs();
      appendRecords([
        {
          ts,
          tool: "inspect_screen_feedback_from_context",
          sessionID,
          result: {
            ok: true,
            screen: { screenId: "AIFeedbackReplace_ID", comparisonCount: 2 },
            latestComparison: { verdict: "different", mismatchRatio: 0.42 },
            recommendedTools: ["delete_ui_element_from_context", "add_ui_element_from_context"],
          },
        },
        {
          ts,
          tool: "get_scene_hierarchy_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID" },
            hierarchy: { screenId: "AIFeedbackReplace_ID", nodes: [] },
          },
        },
        {
          ts,
          tool: "delete_ui_element_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID", elementId: "Element_2" },
            deleteArgs: { elementId: "Element_2" },
            deleted: { ok: true, elementId: "Element_2" },
          },
        },
        {
          ts,
          tool: "add_ui_element_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID" },
            addArgs: {
              screenId: "AIFeedbackReplace_ID",
              element: {
                clientHintId: "uosAiFeedbackReplacement",
                type: "Text",
                rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.12 },
                anchor: "TopCenter",
                props: { text: "UOS AI visual repair", color: "#22c55e" },
              },
            },
            added: { ok: true, elementId: "Element_Replacement" },
          },
        },
        {
          ts,
          tool: "verify_screen_against_reference_from_context",
          sessionID,
          result: {
            ok: true,
            matched: { screenId: "AIFeedbackReplace_ID" },
            verifyArgs: {
              screenId: "AIFeedbackReplace_ID",
              referencePath: join(projectDir, "Plans", "reference.png"),
            },
            verified: {
              ok: true,
              screenId: "AIFeedbackReplace_ID",
              verdict,
              preview: {
                ok: true,
                screenId: "AIFeedbackReplace_ID",
                savedPath: join(projectDir, ".uos", "previews", `feedback-replace-${suffix}.png`),
              },
              comparison: {
                screenId: "AIFeedbackReplace_ID",
                referencePath: join(projectDir, "Plans", "reference.png"),
                candidatePath: join(projectDir, ".uos", "previews", `feedback-replace-${suffix}.png`),
                diffPath: join(projectDir, ".uos", "comparisons", `feedback-replace-${suffix}-diff.png`),
                verdict,
                mismatchRatio,
              },
            },
          },
        },
      ]);

      const idx = JSON.parse(readFileSync(screensPath, "utf8"));
      const screen = idx.screens.AIFeedbackReplace_ID;
      screen.elements.Element_2.deleted = true;
      screen.elements.Element_Replacement = {
        elementId: "Element_Replacement",
        clientHintId: "uosAiFeedbackReplacement",
        type: "Text",
        rect: { x: 0.08, y: 0.08, w: 0.84, h: 0.12 },
        anchor: "TopCenter",
        props: { text: "UOS AI visual repair", color: "#22c55e" },
        createdAt: ts,
        updatedAt: ts,
      };
      writeFileSync(screensPath, JSON.stringify(idx, null, 2));
      appendComparisonToIndex(ts, verdict, mismatchRatio, suffix);
    };

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        verifyPath: "Plans/reference.png",
        compareOutputPath: "comparisons/feedback-replace-diff.png",
        aiRun: true,
        aiFollowUp: true,
        aiFeedbackIterations: 3,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Feedback Replace Smoke Test",
        screenName: "AIFeedbackReplace",
        contextProjectDir: projectDir,
        now: () => "2026-06-05T05:40:00.000Z",
        compareImageFiles: async (referencePath: string, candidatePath: string, options: any) => ({
          referencePath,
          candidatePath,
          diffPath: options.outputPath,
          diffMimeType: "image/png",
          referenceWidth: 1920,
          referenceHeight: 1080,
          candidateWidth: 1920,
          candidateHeight: 1080,
          compareWidth: options.maxWidth,
          compareHeight: options.maxHeight,
          meanAbsoluteError: 0.2,
          rootMeanSquareError: 0.24,
          mismatchRatio: 0.5,
          maxChannelDelta: 120,
          aspectRatioDelta: 0,
          threshold: options.threshold,
          size: 1200,
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          const callNumber = commandCalls.length + 1;
          commandCalls.push({ command, args, options });
          const prompt = args.at(-1) ?? "";
          if (callNumber === 1) {
            expect(args).not.toContain("--continue");
            expect(prompt).toContain("move_ui_element_from_context");
            expect(prompt).not.toContain("delete_ui_element_from_context");
            appendMoveJournal("ses_ai_feedback_replace_1", "different", 0.45, "first");
            return {
              status: 0,
              stdout: [
                "get_uos_context",
                "get_project_info",
                "inspect_screen_feedback_from_context",
                "get_scene_hierarchy_from_context",
                "move_ui_element_from_context",
                "verify_screen_against_reference_from_context",
                "UOS_AI_SMOKE_OK AIFeedbackReplace_ID Element_2",
              ].join("\n"),
              stderr: "",
            };
          }
          if (callNumber === 2) {
            expect(args).toContain("--continue");
            expect(prompt).toContain("move_ui_element_from_context");
            expect(prompt).not.toContain("delete_ui_element_from_context");
            appendMoveJournal("ses_ai_feedback_replace_2", "different", 0.42, "second");
            return {
              status: 0,
              stdout: [
                "get_uos_context",
                "get_project_info",
                "inspect_screen_feedback_from_context",
                "get_scene_hierarchy_from_context",
                "move_ui_element_from_context",
                "verify_screen_against_reference_from_context",
                "UOS_AI_SMOKE_OK AIFeedbackReplace_ID Element_2",
              ].join("\n"),
              stderr: "",
            };
          }
          if (callNumber === 3) {
            expect(args).toContain("--continue");
            expect(prompt).toContain("delete_ui_element_from_context exactly once");
            expect(prompt).toContain("add_ui_element_from_context exactly once");
            expect(prompt).toContain("verify_screen_against_reference_from_context exactly once");
            expect(prompt).not.toContain("move_ui_element_from_context exactly once");
            appendReplaceJournal("ses_ai_feedback_replace_3", "needs review", 0.22, "third");
            return {
              status: 0,
              stdout: [
                "get_uos_context",
                "get_project_info",
                "inspect_screen_feedback_from_context",
                "get_scene_hierarchy_from_context",
                "delete_ui_element_from_context",
                "add_ui_element_from_context",
                "verify_screen_against_reference_from_context",
                "UOS_AI_SMOKE_OK AIFeedbackReplace_ID Element_2 Element_Replacement",
              ].join("\n"),
              stderr: "",
            };
          }
          throw new Error(`unexpected feedback repair call ${callNumber}`);
        },
      });

      expect(commandCalls).toHaveLength(3);
      expect(result.aiRuns).toHaveLength(3);
      expect(result.aiRuns?.[2]).toMatchObject({
        ok: true,
        continued: true,
        feedbackIteration: 3,
        followUpAction: "replace",
        expectedTools: ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "delete_ui_element_from_context", "add_ui_element_from_context", "verify_screen_against_reference_from_context"],
        observedTools: ["get_uos_context", "get_project_info", "inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "delete_ui_element_from_context", "add_ui_element_from_context", "verify_screen_against_reference_from_context"],
        expectedJournalTools: ["inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "delete_ui_element_from_context", "add_ui_element_from_context", "verify_screen_against_reference_from_context"],
        observedJournalTools: ["inspect_screen_feedback_from_context", "get_scene_hierarchy_from_context", "delete_ui_element_from_context", "add_ui_element_from_context", "verify_screen_against_reference_from_context"],
        journalOrderOk: true,
        journalVerification: {
          screenId: "AIFeedbackReplace_ID",
          verdict: "needs review",
          mismatchRatio: 0.22,
        },
      });
      const latestIndex = JSON.parse(readFileSync(screensPath, "utf8"));
      expect(latestIndex.screens.AIFeedbackReplace_ID.elements.Element_2.deleted).toBe(true);
      expect(latestIndex.screens.AIFeedbackReplace_ID.elements.Element_Replacement).toMatchObject({
        clientHintId: "uosAiFeedbackReplacement",
        type: "Text",
      });
      expect(latestIndex.screens.AIFeedbackReplace_ID.comparisons.at(-1)).toMatchObject({
        verdict: "needs review",
        mismatchRatio: 0.22,
      });

      const output = formatSmokeResult(result);
      expect(output).toContain("action=replace continued feedbackIteration=3");
      expect(output).toContain("tools=get_uos_context,get_project_info,inspect_screen_feedback_from_context,get_scene_hierarchy_from_context,delete_ui_element_from_context,add_ui_element_from_context,verify_screen_against_reference_from_context");
      expect(output).toContain("opencode AI verification: screen=AIFeedbackReplace_ID verdict=needs review");
      expect(output).toContain("mismatch=0.22");
      expect(output.match(/opencode AI run: ok/g)).toHaveLength(3);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can run AI-only scene object smoke with requested object metadata", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-only-scene-object-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        sceneObjectRoundTrip: true,
        sceneObjectName: "AIOnlyCube",
        sceneObjectType: "Cube",
        recordContext: false,
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "create_scene_object",
              "delete_scene_object",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.sceneObject).toBeUndefined();
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "scene-object",
        objectName: "AIOnlyCube",
        objectType: "Cube",
        expectedTools: ["get_uos_context", "get_project_info", "create_scene_object", "delete_scene_object"],
        observedTools: ["get_uos_context", "get_project_info", "create_scene_object", "delete_scene_object"],
      });
      expect(commandCall.args).not.toContain("--file");
      expect(commandCall.args.at(-1)).toContain("\"AIOnlyCube\"");
      expect(commandCall.args.at(-1)).toContain("\"Cube\"");

      const output = formatSmokeResult(result);
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 object=AIOnlyCube type=Cube mode=scene-object");
      expect(output).not.toContain("scene object:");
      expect(output).not.toContain("write: skipped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can verify opencode AI smoke mutations from the UOS journal", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-journal-test");
    const journalDir = join(projectDir, ".uos");
    const journalPath = join(journalDir, "work-journal.jsonl");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(journalDir, { recursive: true });

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunObjectName: "JournalCube",
        recordContext: false,
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({ ts, tool: "create_scene_object", result: { objectId: "SceneObject_Journal" } }),
            JSON.stringify({ ts, tool: "delete_scene_object", result: { ok: true } }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "create_scene_object",
              "delete_scene_object",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.aiRun).toMatchObject({
        ok: true,
        expectedJournalTools: ["create_scene_object", "delete_scene_object"],
        observedJournalTools: ["create_scene_object", "delete_scene_object"],
        missingJournalTools: [],
        journalOrderOk: true,
        journalVerified: true,
      });
      const output = formatSmokeResult(result);
      expect(output).toContain("journal=create_scene_object,delete_scene_object");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can verify opencode AI material smoke reads and mutations from the UOS journal", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-material-journal-test");
    const materialPath = join(projectDir, "Plans", "brief.md");
    const journalDir = join(projectDir, ".uos");
    const journalPath = join(journalDir, "work-journal.jsonl");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(journalDir, { recursive: true });
    await writeFile(materialPath, "# HUD\n\nCreate a score panel.");

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        materialScreenPath: "Plans/brief.md",
        screenName: "JournalMaterialSmoke",
        recordContext: false,
        materialScreenRunner: async (_target: any, args: any) => ({
          kind: "document",
          mode: "editable",
          args,
          created: {
            screenId: "JournalMaterialSmoke_ID",
            screenName: "JournalMaterialSmoke",
            elements: [],
          },
        }),
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({ ts, tool: "read_planning_material", result: { ok: true, path: materialPath } }),
            JSON.stringify({ ts, tool: "create_screen_from_material", result: { screenId: "JournalMaterialSmoke_AI_ID" } }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_screen_from_material",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "material-screen",
        materialPath,
        expectedJournalTools: ["read_planning_material", "create_screen_from_material"],
        observedJournalTools: ["read_planning_material", "create_screen_from_material"],
        missingJournalTools: [],
        journalOrderOk: true,
        journalVerified: true,
      });
      const output = formatSmokeResult(result);
      expect(output).toContain("journal=read_planning_material,create_screen_from_material");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke rejects opencode AI material journal records in mutation-before-read order", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-material-journal-order-test");
    const materialPath = join(projectDir, "Plans", "brief.md");
    const journalDir = join(projectDir, ".uos");
    const journalPath = join(journalDir, "work-journal.jsonl");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(journalDir, { recursive: true });
    await writeFile(materialPath, "# HUD\n\nCreate a score panel.");

    try {
      await expect(runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        materialScreenPath: "Plans/brief.md",
        screenName: "JournalOrderSmoke",
        recordContext: false,
        materialScreenRunner: async (_target: any, args: any) => ({
          kind: "document",
          mode: "editable",
          args,
          created: {
            screenId: "JournalOrderSmoke_ID",
            screenName: "JournalOrderSmoke",
            elements: [],
          },
        }),
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({ ts, tool: "create_screen_from_material", result: { screenId: "JournalOrderSmoke_AI_ID" } }),
            JSON.stringify({ ts, tool: "read_planning_material", result: { ok: true, path: materialPath } }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_screen_from_material",
            ].join("\n"),
            stderr: "",
          };
        },
      })).rejects.toThrow("journal order error");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke ignores direct smoke journal records when verifying opencode AI smoke", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-journal-direct-test");
    const journalDir = join(projectDir, ".uos");
    const journalPath = join(journalDir, "work-journal.jsonl");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(journalDir, { recursive: true });

    try {
      await expect(runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        recordContext: false,
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({ ts, tool: "create_scene_object", sessionID: "uos-smoke" }),
            JSON.stringify({ ts, tool: "delete_scene_object", sessionID: "uos-smoke" }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "create_scene_object",
              "delete_scene_object",
            ].join("\n"),
            stderr: "",
          };
        },
      })).rejects.toThrow("missing journal evidence: create_scene_object, delete_scene_object");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can route an opencode AI material smoke run with an attached planning file", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-material-test");
    const materialPath = join(projectDir, "Plans", "brief.md");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(materialPath, "# Main Menu\n\nCreate a Play button and Settings button.");

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Material Smoke Test",
        materialScreenPath: "Plans/brief.md",
        materialScreenMode: "auto",
        screenName: "AIMaterialSmoke",
        recordContext: false,
        materialScreenRunner: async (_target: any, args: any) => ({
          kind: "document",
          mode: "editable",
          args,
          created: {
            screenId: "AIMaterialSmoke_ID",
            screenName: "AIMaterialSmoke",
            elements: [],
          },
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_screen_from_material",
              "UOS_AI_SMOKE_OK AIMaterialSmoke_AI_ID",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.materialScreenArgs).toMatchObject({
        path: materialPath,
        mode: "auto",
        screenName: "AIMaterialSmoke",
      });
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "material-screen",
        materialPath,
        expectedTools: ["get_uos_context", "get_project_info", "read_planning_material", "create_screen_from_material"],
        observedTools: ["get_uos_context", "get_project_info", "read_planning_material", "create_screen_from_material"],
        missingTools: [],
      });
      expect(commandCall.args.slice(0, 4)).toEqual(["run", "--file", materialPath, "--agent"]);
      expect(commandCall.args).toContain("ochestrator");
      expect(commandCall.args.at(-1)).toContain("get_uos_context");
      expect(commandCall.args.at(-1)).toContain("read_planning_material");
      expect(commandCall.args.at(-1)).toContain("create_screen_from_material");
      expect(commandCall.args.at(-1)).toContain("AIMaterialSmoke");
      expect(commandCall.options.env.UOS_CONTEXT_SUMMARY).toContain("brief.md");

      const output = formatSmokeResult(result);
      expect(output).toContain("material screen: document/editable AIMaterialSmoke_ID");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 material=brief.md mode=material-screen");
      expect(output).toContain("tools=get_uos_context,get_project_info,read_planning_material,create_screen_from_material");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can run a two-turn opencode AI material conversation", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-two-turn-material-test");
    const materialPath = join(projectDir, "Plans", "brief.md");
    const contextDir = join(projectDir, ".uos");
    const journalPath = join(contextDir, "work-journal.jsonl");
    const screensPath = join(contextDir, "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await writeFile(materialPath, "# Battle Pass\n\nCreate a reward track screen.");

    const commandCalls: any[] = [];
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Two Turn Material Smoke Test",
        materialScreenPath: "Plans/brief.md",
        materialScreenMode: "auto",
        screenName: "AITwoTurnMaterial",
        recordContext: false,
        materialScreenRunner: async () => {
          throw new Error("direct material runner should not be called");
        },
        commandRunner: (command: string, args: string[], options: any) => {
          commandCalls.push({ command, args, options });
          const ts = new Date().toISOString();
          if (commandCalls.length === 1) {
            writeFileSync(screensPath, JSON.stringify({
              version: "1.0.0",
              updatedAt: ts,
              screens: {
                AITwoTurnMaterial_AI_ID: {
                  screenId: "AITwoTurnMaterial_AI_ID",
                  screenName: "AITwoTurnMaterial",
                  source: {
                    tool: "create_screen_from_material",
                    kind: "md",
                    mode: "editable",
                    path: materialPath,
                  },
                  elements: {
                    Element_Background: {
                      elementId: "Element_Background",
                      clientHintId: "md_background",
                      type: "Panel",
                      rect: { x: 0, y: 0, w: 1, h: 1 },
                      props: { color: "#101820" },
                    },
                    Element_Title: {
                      elementId: "Element_Title",
                      clientHintId: "md_title",
                      type: "Text",
                      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.14 },
                      props: { text: "Battle Pass", fontSize: 48 },
                    },
                  },
                },
              },
            }, null, 2));
            writeFileSync(journalPath, [
              JSON.stringify({ ts, tool: "read_planning_material", sessionID: "ses_ai_create", result: { ok: true, path: materialPath } }),
              JSON.stringify({ ts, tool: "create_screen_from_material", sessionID: "ses_ai_create", result: { screenId: "AITwoTurnMaterial_AI_ID" } }),
              "",
            ].join("\n"));
            return {
              status: 0,
              stdout: [
                "get_uos_context",
                "get_project_info",
                "read_planning_material",
                "create_screen_from_material",
                "UOS_AI_SMOKE_OK AITwoTurnMaterial_AI_ID",
              ].join("\n"),
              stderr: "",
            };
          }

          expect(args).toContain("--continue");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("AITwoTurnMaterial_AI_ID");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("brief.md");
          writeFileSync(journalPath, [
            readFileSync(journalPath, "utf8").trimEnd(),
            JSON.stringify({
              ts,
              tool: "update_ui_element_from_context",
              sessionID: "ses_ai_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AITwoTurnMaterial_AI_ID", elementId: "Element_Title" },
                updateArgs: { elementId: "Element_Title", props: { text: "UOS AI Context Follow-up", color: "#22c55e" } },
                updated: { ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "capture_preview_from_context",
              sessionID: "ses_ai_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AITwoTurnMaterial_AI_ID" },
                previewArgs: { screenId: "AITwoTurnMaterial_AI_ID" },
                captured: { ok: true, screenId: "AITwoTurnMaterial_AI_ID", savedPath: join(contextDir, "previews", "two-turn.png") },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "update_ui_element_from_context",
              "capture_preview_from_context",
              "UOS_AI_SMOKE_OK AITwoTurnMaterial_AI_ID Element_Title",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(commandCalls).toHaveLength(2);
      expect(commandCalls[0].args.slice(0, 4)).toEqual(["run", "--file", materialPath, "--agent"]);
      expect(commandCalls[0].args).not.toContain("--continue");
      expect(commandCalls[0].args.at(-1)).toContain("create_screen_from_material");
      expect(commandCalls[1].args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--continue"]);
      expect(commandCalls[1].args).not.toContain("--file");
      expect(commandCalls[1].args.at(-1)).toContain("update_ui_element_from_context");
      expect(commandCalls[1].args.at(-1)).toContain("AITwoTurnMaterial_AI_ID");

      expect(result.materialScreen).toBeUndefined();
      expect(result.selectedMaterial).toMatchObject({
        sourcePath: materialPath,
        mode: "screen-from-material",
      });
      expect(result.aiRuns).toHaveLength(2);
      expect(result.aiRuns[0]).toMatchObject({
        ok: true,
        mode: "material-screen",
        continued: false,
        journalScreenId: "AITwoTurnMaterial_AI_ID",
        observedJournalTools: ["read_planning_material", "create_screen_from_material"],
      });
      expect(result.aiRuns[1]).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        continued: true,
        screenId: "AITwoTurnMaterial_AI_ID",
        journalScreenId: "AITwoTurnMaterial_AI_ID",
        observedJournalTools: ["update_ui_element_from_context", "capture_preview_from_context"],
      });
      expect(result.aiRun).toBe(result.aiRuns[1]);

      const output = formatSmokeResult(result);
      expect(output).toContain("selected material: brief.md");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 material=brief.md mode=material-screen");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AITwoTurnMaterial_AI_ID mode=context-follow-up action=update continued");
      expect(output).toContain("journal=update_ui_element_from_context,capture_preview_from_context");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can run a two-turn opencode AI image conversation with an added annotation", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-two-turn-image-test");
    const materialPath = join(projectDir, "Plans", "mock.png");
    const contextDir = join(projectDir, ".uos");
    const journalPath = join(contextDir, "work-journal.jsonl");
    const screensPath = join(contextDir, "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await writeFile(materialPath, "png bytes");

    const commandCalls: any[] = [];
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Two Turn Image Smoke Test",
        materialScreenPath: "Plans/mock.png",
        materialScreenMode: "reference",
        screenName: "AITwoTurnImage",
        recordContext: false,
        materialScreenRunner: async () => {
          throw new Error("direct material runner should not be called");
        },
        commandRunner: (command: string, args: string[], options: any) => {
          commandCalls.push({ command, args, options });
          const ts = new Date().toISOString();
          if (commandCalls.length === 1) {
            writeFileSync(screensPath, JSON.stringify({
              version: "1.0.0",
              updatedAt: ts,
              screens: {
                AITwoTurnImage_AI_ID: {
                  screenId: "AITwoTurnImage_AI_ID",
                  screenName: "AITwoTurnImage",
                  source: {
                    tool: "create_screen_from_material",
                    kind: "image",
                    mode: "reference",
                    path: materialPath,
                  },
                  elements: {
                    Element_Image: {
                      elementId: "Element_Image",
                      clientHintId: "image_reference",
                      type: "Image",
                      rect: { x: 0, y: 0, w: 1, h: 1 },
                      props: { sprite: "Assets/UOS/Imported/mock.png" },
                    },
                  },
                },
              },
            }, null, 2));
            writeFileSync(journalPath, [
              JSON.stringify({ ts, tool: "read_planning_material", sessionID: "ses_ai_image_create", result: { ok: true, path: materialPath } }),
              JSON.stringify({ ts, tool: "create_screen_from_material", sessionID: "ses_ai_image_create", result: { screenId: "AITwoTurnImage_AI_ID" } }),
              "",
            ].join("\n"));
            return {
              status: 0,
              stdout: [
                "get_uos_context",
                "get_project_info",
                "read_planning_material",
                "create_screen_from_material",
                "UOS_AI_SMOKE_OK AITwoTurnImage_AI_ID",
              ].join("\n"),
              stderr: "",
            };
          }

          expect(args).toContain("--continue");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("AITwoTurnImage_AI_ID");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("mock.png");
          writeFileSync(journalPath, [
            readFileSync(journalPath, "utf8").trimEnd(),
            JSON.stringify({
              ts,
              tool: "add_ui_element_from_context",
              sessionID: "ses_ai_image_follow_up",
              result: {
                ok: true,
                matched: { ok: true, screenId: "AITwoTurnImage_AI_ID" },
                addArgs: {
                  screenId: "AITwoTurnImage_AI_ID",
                  element: {
                    clientHintId: "uosAiFollowUpLabel",
                    type: "Text",
                    props: { text: "UOS AI Context Follow-up", color: "#22c55e" },
                  },
                },
                added: { elementId: "Element_Annotation", ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "capture_preview_from_context",
              sessionID: "ses_ai_image_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AITwoTurnImage_AI_ID" },
                previewArgs: { screenId: "AITwoTurnImage_AI_ID" },
                captured: { ok: true, screenId: "AITwoTurnImage_AI_ID", savedPath: join(contextDir, "previews", "two-turn-image.png") },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "add_ui_element_from_context",
              "capture_preview_from_context",
              "UOS_AI_SMOKE_OK AITwoTurnImage_AI_ID Element_Annotation",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(commandCalls).toHaveLength(2);
      expect(commandCalls[0].args.slice(0, 3)).toEqual(["run", "--agent", "ochestrator"]);
      expect(commandCalls[0].args).not.toContain("--file");
      expect(commandCalls[0].args).not.toContain("--continue");
      expect(commandCalls[0].args.at(-1)).toContain("create_screen_from_material");
      expect(JSON.parse(commandCalls[0].options.env.UOS_ATTACHED_FILES)).toContain(materialPath);
      expect(commandCalls[0].options.env.UOS_CONTEXT_SUMMARY).toContain("mock.png");
      expect(commandCalls[1].args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--continue"]);
      expect(commandCalls[1].args).not.toContain("--file");
      expect(commandCalls[1].args.at(-1)).toContain("add_ui_element_from_context");
      expect(commandCalls[1].args.at(-1)).toContain("AITwoTurnImage_AI_ID");

      expect(result.materialScreen).toBeUndefined();
      expect(result.aiRuns).toHaveLength(2);
      expect(result.aiRuns[0]).toMatchObject({
        ok: true,
        mode: "material-screen",
        materialPath,
        continued: false,
        journalScreenId: "AITwoTurnImage_AI_ID",
        observedJournalTools: ["read_planning_material", "create_screen_from_material"],
      });
      expect(result.aiRuns[1]).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        followUpAction: "add",
        continued: true,
        screenId: "AITwoTurnImage_AI_ID",
        journalScreenId: "AITwoTurnImage_AI_ID",
        expectedTools: ["get_uos_context", "get_project_info", "add_ui_element_from_context", "capture_preview_from_context"],
        observedJournalTools: ["add_ui_element_from_context", "capture_preview_from_context"],
      });

      const output = formatSmokeResult(result);
      expect(output).toContain("selected material: mock.png");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 material=mock.png mode=material-screen");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AITwoTurnImage_AI_ID mode=context-follow-up action=add continued");
      expect(output).toContain("journal=add_ui_element_from_context,capture_preview_from_context");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can route an opencode AI follow-up after material screen creation", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-material-follow-up-test");
    const materialPath = join(projectDir, "Plans", "brief.md");
    const journalDir = join(projectDir, ".uos");
    const journalPath = join(journalDir, "work-journal.jsonl");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(materialPath, "# Daily Rewards\n\nMake the reward title prominent.");

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        preview: true,
        aiRun: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Material Follow-up Smoke Test",
        materialScreenPath: "Plans/brief.md",
        materialScreenMode: "auto",
        screenName: "AIMaterialFollowUp",
        materialScreenRunner: async (_target: any, args: any) => ({
          kind: "document",
          mode: "editable",
          path: args.path,
          intent: {
            version: "1.0.0",
            screenName: "AIMaterialFollowUp",
            referenceCanvas: { width: 1920, height: 1080 },
            elements: [
              {
                clientHintId: "md_background",
                type: "Panel",
                rect: { x: 0, y: 0, w: 1, h: 1 },
                props: { color: "#101820" },
              },
              {
                clientHintId: "md_title",
                type: "Text",
                rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.14 },
                props: { text: "Daily Rewards", fontSize: 48 },
              },
            ],
          },
          source: {
            tool: "create_screen_from_material",
            kind: "md",
            mode: "editable",
            path: args.path,
          },
          warnings: [],
          validation: { ok: true, errors: [], warnings: [] },
          created: {
            screenId: "AIMaterialFollowUp_ID",
            elements: [
              { clientHintId: "md_background", elementId: "Element_Background" },
              { clientHintId: "md_title", elementId: "Element_Title" },
            ],
          },
          specific: {},
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          const preContext = JSON.parse(readFileSync(join(projectDir, ".uos", "screens.json"), "utf8"));
          expect(preContext.screens.AIMaterialFollowUp_ID.source).toMatchObject({
            tool: "create_screen_from_material",
            kind: "md",
            path: materialPath,
          });
          expect(preContext.screens.AIMaterialFollowUp_ID.elements.Element_Title.props.text)
            .toBe("Daily Rewards");
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({
              ts,
              tool: "update_ui_element_from_context",
              sessionID: "ses_ai_material_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AIMaterialFollowUp_ID", elementId: "Element_Title" },
                updateArgs: { elementId: "Element_Title", props: { text: "UOS AI Context Follow-up", color: "#22c55e" } },
                updated: { ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "capture_preview_from_context",
              sessionID: "ses_ai_material_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AIMaterialFollowUp_ID" },
                previewArgs: { screenId: "AIMaterialFollowUp_ID" },
                captured: { ok: true, screenId: "AIMaterialFollowUp_ID", savedPath: join(projectDir, ".uos", "previews", "material-follow-up.png") },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "update_ui_element_from_context",
              "capture_preview_from_context",
              "UOS_AI_SMOKE_OK AIMaterialFollowUp_ID Element_Title",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.materialScreen.kind).toBe("document");
      expect(result.created.screenId).toBe("AIMaterialFollowUp_ID");
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        screenId: "AIMaterialFollowUp_ID",
        screenName: "AIMaterialFollowUp",
        expectedTools: ["get_uos_context", "get_project_info", "update_ui_element_from_context", "capture_preview_from_context"],
        observedTools: ["get_uos_context", "get_project_info", "update_ui_element_from_context", "capture_preview_from_context"],
        expectedJournalTools: ["update_ui_element_from_context", "capture_preview_from_context"],
        observedJournalTools: ["update_ui_element_from_context", "capture_preview_from_context"],
        missingJournalTools: [],
        journalScreenId: "AIMaterialFollowUp_ID",
        journalOrderOk: true,
        journalVerified: true,
      });
      expect(commandCall.args).not.toContain("--file");
      expect(commandCall.args.at(-1)).toContain("AIMaterialFollowUp_ID");
      expect(commandCall.args.at(-1)).toContain("Element_Title");
      expect(commandCall.args.at(-1)).toContain("update_ui_element_from_context");
      expect(commandCall.options.env.UOS_CONTEXT_SUMMARY).toContain("AIMaterialFollowUp_ID");
      expect(commandCall.options.env.UOS_CONTEXT_SUMMARY).toContain("brief.md");

      const output = formatSmokeResult(result);
      expect(output).toContain("material screen: document/editable AIMaterialFollowUp_ID");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AIMaterialFollowUp_ID mode=context-follow-up");
      expect(output).toContain("journal=update_ui_element_from_context,capture_preview_from_context");
      expect(output).toContain("preview:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can run AI-only material smoke without direct material mutation", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-only-material-test");
    const materialPath = join(projectDir, "Plans", "brief.md");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(materialPath, "# Inventory\n\nCreate an inventory panel.");

    let directRunnerCalled = false;
    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        materialScreenPath: "Plans/brief.md",
        screenName: "AIOnlyMaterialSmoke",
        recordContext: false,
        materialScreenRunner: async () => {
          directRunnerCalled = true;
          throw new Error("direct material runner should not be called");
        },
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_screen_from_material",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(directRunnerCalled).toBe(false);
      expect(result.materialScreen).toBeUndefined();
      expect(result.created).toBeUndefined();
      expect(result.selectedMaterial).toMatchObject({
        sourcePath: materialPath,
        relativePath: "brief.md",
        mode: "screen-from-material",
      });
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "material-screen",
        materialPath,
        expectedTools: ["get_uos_context", "get_project_info", "read_planning_material", "create_screen_from_material"],
      });
      expect(commandCall.args.slice(0, 4)).toEqual(["run", "--file", materialPath, "--agent"]);
      expect(commandCall.args.at(-1)).toContain("create_screen_from_material");

      const output = formatSmokeResult(result);
      expect(output).toContain("selected material: brief.md");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 material=brief.md mode=material-screen");
      expect(output).not.toContain("material screen:");
      expect(output).not.toContain("write: skipped");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can preview an AI-only material screen from journal evidence", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-only-material-preview-test");
    const materialPath = join(projectDir, "Plans", "mock.png");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const aiScreenId = "AIOnlyMaterialPreview_AI_ID";
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(join(projectDir, ".uos"), { recursive: true });
    await writeFile(materialPath, "fake png bytes");

    let directRunnerCalled = false;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiVerifyJournal: true,
        preview: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        materialScreenPath: "Plans/mock.png",
        materialScreenMode: "reference",
        screenName: "AIOnlyMaterialPreview",
        recordContext: false,
        materialScreenRunner: async () => {
          directRunnerCalled = true;
          throw new Error("direct material runner should not be called");
        },
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({
              ts,
              tool: "read_planning_material",
              sessionID: "ses_ai_only_preview",
              args: { path: materialPath },
              result: { ok: true },
            }),
            JSON.stringify({
              ts,
              tool: "create_screen_from_material",
              sessionID: "ses_ai_only_preview",
              args: {
                path: materialPath,
                mode: "reference",
                screenName: "AIOnlyMaterialPreview",
              },
              result: {
                kind: "image",
                mode: "reference",
                created: {
                  screenId: aiScreenId,
                  elements: [{ clientHintId: "image_reference", elementId: "Element_AI_Image" }],
                },
              },
            }),
          ].join("\n") + "\n");
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_screen_from_material",
              `UOS_AI_SMOKE_OK ${aiScreenId}`,
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(directRunnerCalled).toBe(false);
      expect(result.materialScreen).toBeUndefined();
      expect(result.created).toBeUndefined();
      expect(result.aiRun).toMatchObject({
        ok: true,
        journalScreenId: aiScreenId,
        observedJournalTools: ["read_planning_material", "create_screen_from_material"],
      });
      expect(result.preview).toMatchObject({
        path: `C:/tmp/${aiScreenId}.png`,
        width: 1920,
        height: 1080,
      });

      const output = formatSmokeResult(result);
      expect(output).toContain(`preview: C:/tmp/${aiScreenId}.png`);
      expect(output).not.toContain("material screen:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can verify an AI-only material screen from journal evidence", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-only-material-verify-test");
    const materialPath = join(projectDir, "Plans", "mock.png");
    const referencePath = join(projectDir, "Plans", "reference.png");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const aiScreenId = "AIOnlyMaterialVerify_AI_ID";
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(join(projectDir, ".uos"), { recursive: true });
    await writeFile(materialPath, "fake png bytes");
    await writeFile(referencePath, "fake reference bytes");

    let directRunnerCalled = false;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        materialScreenPath: "Plans/mock.png",
        materialScreenMode: "reference",
        verifyPath: "Plans/reference.png",
        screenName: "AIOnlyMaterialVerify",
        materialScreenRunner: async () => {
          directRunnerCalled = true;
          throw new Error("direct material runner should not be called");
        },
        compareImageFiles: async (reference: string, candidate: string) => ({
          referencePath: reference,
          candidatePath: candidate,
          diffPath: join(projectDir, ".uos", "comparisons", "diff-ai-only.png"),
          referenceWidth: 1920,
          referenceHeight: 1080,
          candidateWidth: 1920,
          candidateHeight: 1080,
          meanAbsoluteError: 0.01,
          rootMeanSquareError: 0.02,
          mismatchRatio: 0.03,
          maxChannelDelta: 8,
        }),
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({
              ts,
              tool: "read_planning_material",
              sessionID: "ses_ai_only_verify",
              args: { path: materialPath },
              result: { ok: true },
            }),
            JSON.stringify({
              ts,
              tool: "create_screen_from_material",
              sessionID: "ses_ai_only_verify",
              args: {
                path: materialPath,
                mode: "reference",
                screenName: "AIOnlyMaterialVerify",
              },
              result: {
                kind: "image",
                mode: "reference",
                created: {
                  screenId: aiScreenId,
                  elements: [{ clientHintId: "image_reference", elementId: "Element_AI_Image" }],
                },
              },
            }),
          ].join("\n") + "\n");
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_screen_from_material",
              `UOS_AI_SMOKE_OK ${aiScreenId}`,
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(directRunnerCalled).toBe(false);
      expect(result.materialScreen).toBeUndefined();
      expect(result.created).toBeUndefined();
      expect(result.aiRun).toMatchObject({
        ok: true,
        journalScreenId: aiScreenId,
      });
      expect(result.preview).toMatchObject({
        screenId: aiScreenId,
        savedPath: expect.stringContaining(aiScreenId),
      });
      expect(result.verification).toMatchObject({
        ok: true,
        screenId: aiScreenId,
        verdict: "close",
        preview: {
          screenId: aiScreenId,
        },
        comparison: {
          screenId: aiScreenId,
          referencePath,
          verdict: "close",
        },
      });

      const journal = await readFile(join(projectDir, ".uos", "work-journal.jsonl"), "utf8");
      expect(journal).toContain("\"tool\":\"verify_screen_against_reference\"");
      expect(journal).toContain(aiScreenId);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can preview an AI-only PPTX deck screen from journal evidence", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-only-pptx-preview-test");
    const pptxPath = join(projectDir, "Plans", "deck.pptx");
    const journalPath = join(projectDir, ".uos", "work-journal.jsonl");
    const activeScreenId = "AIOnlyDeckSlide1_AI_ID";
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(join(projectDir, ".uos"), { recursive: true });
    await writeFile(pptxPath, "fake pptx bytes");

    let directRunnerCalled = false;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiVerifyJournal: true,
        preview: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        pptxDeckPath: "Plans/deck.pptx",
        pptxDeckSlideNumbers: [1, 2],
        pptxDeckIncludeShapePanels: true,
        screenName: "AIOnlyDeckPreview",
        recordContext: false,
        pptxDeckRunner: async () => {
          directRunnerCalled = true;
          throw new Error("direct PPTX deck runner should not be called");
        },
        commandRunner: () => {
          const ts = new Date().toISOString();
          writeFileSync(journalPath, [
            JSON.stringify({
              ts,
              tool: "read_planning_material",
              sessionID: "ses_ai_only_pptx_preview",
              args: { path: pptxPath },
              result: { ok: true },
            }),
            JSON.stringify({
              ts,
              tool: "create_pptx_deck_screens",
              sessionID: "ses_ai_only_pptx_preview",
              args: {
                path: pptxPath,
                screenNamePrefix: "AIOnlyDeckPreview",
                slideNumbers: [1, 2],
                includeShapePanels: true,
              },
              result: {
                ok: true,
                path: pptxPath,
                screenCount: 2,
                activeScreenId,
                screens: [
                  {
                    slideNumber: 1,
                    screenId: activeScreenId,
                    created: { screenId: activeScreenId, elements: [] },
                  },
                  {
                    slideNumber: 2,
                    screenId: "AIOnlyDeckSlide2_AI_ID",
                    created: { screenId: "AIOnlyDeckSlide2_AI_ID", elements: [] },
                  },
                ],
              },
            }),
          ].join("\n") + "\n");
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_pptx_deck_screens",
              `UOS_AI_SMOKE_OK ${activeScreenId}`,
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(directRunnerCalled).toBe(false);
      expect(result.pptxDeck).toBeUndefined();
      expect(result.created).toBeUndefined();
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "pptx-deck",
        journalScreenId: activeScreenId,
        observedJournalTools: ["read_planning_material", "create_pptx_deck_screens"],
      });
      expect(result.preview).toMatchObject({
        path: `C:/tmp/${activeScreenId}.png`,
        width: 1920,
        height: 1080,
      });

      const output = formatSmokeResult(result);
      expect(output).toContain(`preview: C:/tmp/${activeScreenId}.png`);
      expect(output).not.toContain("pptx deck:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can route an opencode AI PPTX deck smoke run with an attached deck", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-pptx-test");
    const pptxPath = join(projectDir, "Plans", "deck.pptx");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(pptxPath, "pptx bytes");

    let commandCall: any;
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI PPTX Smoke Test",
        pptxDeckPath: "Plans/deck.pptx",
        pptxDeckSlideNumbers: [1, 2],
        pptxDeckIncludeShapePanels: true,
        screenName: "AIPptxDeckSmoke",
        recordContext: false,
        pptxDeckRunner: async (_target: any, args: any) => ({
          screens: [
            { slideNumber: 1, screenId: "AIPptxDeckSmoke_1_ID", created: { elements: [] } },
            { slideNumber: 2, screenId: "AIPptxDeckSmoke_2_ID", created: { elements: [] } },
          ],
          transitions: [],
          activeScreenId: "AIPptxDeckSmoke_1_ID",
          args,
        }),
        commandRunner: (command: string, args: string[], options: any) => {
          commandCall = { command, args, options };
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "read_planning_material",
              "create_pptx_deck_screens",
              "UOS_AI_SMOKE_OK AIPptxDeckSmoke_1_AI_ID",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(result.pptxDeckArgs).toMatchObject({
        path: pptxPath,
        slideNumbers: [1, 2],
        includeShapePanels: true,
        screenNamePrefix: "AIPptxDeckSmoke",
      });
      expect(result.aiRun).toMatchObject({
        ok: true,
        mode: "pptx-deck",
        materialPath: pptxPath,
        expectedTools: ["get_uos_context", "get_project_info", "read_planning_material", "create_pptx_deck_screens"],
        observedTools: ["get_uos_context", "get_project_info", "read_planning_material", "create_pptx_deck_screens"],
        missingTools: [],
      });
      expect(commandCall.args.slice(0, 3)).toEqual(["run", "--agent", "ochestrator"]);
      expect(commandCall.args).not.toContain("--file");
      expect(commandCall.args.at(-1)).toContain("get_uos_context");
      expect(commandCall.args.at(-1)).toContain("read_planning_material");
      expect(commandCall.args.at(-1)).toContain("create_pptx_deck_screens");
      expect(commandCall.args.at(-1)).toContain("AIPptxDeckSmoke");
      expect(commandCall.args.at(-1)).toContain("slideNumbers [1,2]");
      expect(commandCall.args.at(-1)).toContain("includeShapePanels to true");
      expect(JSON.parse(commandCall.options.env.UOS_ATTACHED_FILES)).toContain(pptxPath);
      expect(commandCall.options.env.UOS_CONTEXT_SUMMARY).toContain("deck.pptx");

      const output = formatSmokeResult(result);
      expect(output).toContain("pptx deck: 2 screen(s), 0 transition(s) active=AIPptxDeckSmoke_1_ID");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 material=deck.pptx mode=pptx-deck");
      expect(output).toContain("tools=get_uos_context,get_project_info,read_planning_material,create_pptx_deck_screens");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can run a two-turn opencode AI PPTX deck conversation", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-ai-two-turn-pptx-test");
    const pptxPath = join(projectDir, "Plans", "deck.pptx");
    const contextDir = join(projectDir, ".uos");
    const journalPath = join(contextDir, "work-journal.jsonl");
    const screensPath = join(contextDir, "screens.json");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await writeFile(pptxPath, "pptx bytes");

    const commandCalls: any[] = [];
    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        aiRun: true,
        aiOnly: true,
        aiFollowUp: true,
        aiVerifyJournal: true,
        aiRunModel: "anthropic/claude-haiku-4-5",
        aiRunAgent: "build",
        aiRunTitle: "UOS AI Two Turn PPTX Smoke Test",
        pptxDeckPath: "Plans/deck.pptx",
        pptxDeckSlideNumbers: [1, 2],
        pptxDeckIncludeShapePanels: true,
        screenName: "AITwoTurnDeck",
        recordContext: false,
        pptxDeckRunner: async () => {
          throw new Error("direct PPTX deck runner should not be called");
        },
        commandRunner: (command: string, args: string[], options: any) => {
          commandCalls.push({ command, args, options });
          const ts = new Date().toISOString();
          if (commandCalls.length === 1) {
            writeFileSync(screensPath, JSON.stringify({
              version: "1.0.0",
              updatedAt: ts,
              activeScreenId: "AITwoTurnDeck_AI_1_ID",
              screens: {
                AITwoTurnDeck_AI_1_ID: {
                  screenId: "AITwoTurnDeck_AI_1_ID",
                  screenName: "AITwoTurnDeck Slide 1",
                  source: {
                    tool: "create_pptx_deck_screens",
                    kind: "pptx",
                    mode: "editable",
                    path: pptxPath,
                    slideNumber: 1,
                  },
                  elements: {
                    Element_Title: {
                      elementId: "Element_Title",
                      clientHintId: "pptx_title",
                      type: "Text",
                      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.14 },
                      props: { text: "Deck Title", fontSize: 48 },
                    },
                  },
                },
                AITwoTurnDeck_AI_2_ID: {
                  screenId: "AITwoTurnDeck_AI_2_ID",
                  screenName: "AITwoTurnDeck Slide 2",
                  source: {
                    tool: "create_pptx_deck_screens",
                    kind: "pptx",
                    mode: "editable",
                    path: pptxPath,
                    slideNumber: 2,
                  },
                  elements: {},
                },
              },
            }, null, 2));
            writeFileSync(journalPath, [
              JSON.stringify({ ts, tool: "read_planning_material", sessionID: "ses_ai_deck_create", result: { ok: true, path: pptxPath } }),
              JSON.stringify({
                ts,
                tool: "create_pptx_deck_screens",
                sessionID: "ses_ai_deck_create",
                result: {
                  ok: true,
                  path: pptxPath,
                  activeScreenId: "AITwoTurnDeck_AI_1_ID",
                  screens: [
                    { slideNumber: 1, screenId: "AITwoTurnDeck_AI_1_ID", created: { screenId: "AITwoTurnDeck_AI_1_ID", elements: [] } },
                    { slideNumber: 2, screenId: "AITwoTurnDeck_AI_2_ID", created: { screenId: "AITwoTurnDeck_AI_2_ID", elements: [] } },
                  ],
                },
              }),
              "",
            ].join("\n"));
            return {
              status: 0,
              stdout: [
                "get_uos_context",
                "get_project_info",
                "read_planning_material",
                "create_pptx_deck_screens",
                "UOS_AI_SMOKE_OK AITwoTurnDeck_AI_1_ID",
              ].join("\n"),
              stderr: "",
            };
          }

          expect(args).toContain("--continue");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("AITwoTurnDeck_AI_1_ID");
          expect(options.env.UOS_CONTEXT_SUMMARY).toContain("deck.pptx");
          writeFileSync(journalPath, [
            readFileSync(journalPath, "utf8").trimEnd(),
            JSON.stringify({
              ts,
              tool: "update_ui_element_from_context",
              sessionID: "ses_ai_deck_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AITwoTurnDeck_AI_1_ID", elementId: "Element_Title" },
                updateArgs: { elementId: "Element_Title", props: { text: "UOS AI Context Follow-up", color: "#22c55e" } },
                updated: { ok: true },
              },
            }),
            JSON.stringify({
              ts,
              tool: "capture_preview_from_context",
              sessionID: "ses_ai_deck_follow_up",
              result: {
                ok: true,
                matched: { screenId: "AITwoTurnDeck_AI_1_ID" },
                previewArgs: { screenId: "AITwoTurnDeck_AI_1_ID" },
                captured: { ok: true, screenId: "AITwoTurnDeck_AI_1_ID", savedPath: join(contextDir, "previews", "two-turn-deck.png") },
              },
            }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: [
              "get_uos_context",
              "get_project_info",
              "update_ui_element_from_context",
              "capture_preview_from_context",
              "UOS_AI_SMOKE_OK AITwoTurnDeck_AI_1_ID Element_Title",
            ].join("\n"),
            stderr: "",
          };
        },
      });

      expect(commandCalls).toHaveLength(2);
      expect(commandCalls[0].args.slice(0, 3)).toEqual(["run", "--agent", "ochestrator"]);
      expect(commandCalls[0].args).not.toContain("--file");
      expect(commandCalls[0].args).not.toContain("--continue");
      expect(commandCalls[0].args.at(-1)).toContain("create_pptx_deck_screens");
      expect(JSON.parse(commandCalls[0].options.env.UOS_ATTACHED_FILES)).toContain(pptxPath);
      expect(commandCalls[0].options.env.UOS_CONTEXT_SUMMARY).toContain("deck.pptx");
      expect(commandCalls[1].args.slice(0, 4)).toEqual(["run", "--agent", "ochestrator", "--continue"]);
      expect(commandCalls[1].args).not.toContain("--file");
      expect(commandCalls[1].args.at(-1)).toContain("update_ui_element_from_context");
      expect(commandCalls[1].args.at(-1)).toContain("AITwoTurnDeck_AI_1_ID");

      expect(result.pptxDeck).toBeUndefined();
      expect(result.aiRuns).toHaveLength(2);
      expect(result.aiRuns[0]).toMatchObject({
        ok: true,
        mode: "pptx-deck",
        continued: false,
        journalScreenId: "AITwoTurnDeck_AI_1_ID",
        observedJournalTools: ["read_planning_material", "create_pptx_deck_screens"],
      });
      expect(result.aiRuns[1]).toMatchObject({
        ok: true,
        mode: "context-follow-up",
        continued: true,
        screenId: "AITwoTurnDeck_AI_1_ID",
        journalScreenId: "AITwoTurnDeck_AI_1_ID",
        observedJournalTools: ["update_ui_element_from_context", "capture_preview_from_context"],
      });

      const output = formatSmokeResult(result);
      expect(output).toContain("selected material: deck.pptx");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 material=deck.pptx mode=pptx-deck");
      expect(output).toContain("opencode AI run: ok model=anthropic/claude-haiku-4-5 screen=AITwoTurnDeck_AI_1_ID mode=context-follow-up action=update continued");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke records combined reference verification", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-verification-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        screenName: "VerifySmoke",
        verifyPath: "Plans/reference.png",
        compareOutputPath: "comparisons/verify-diff.png",
        compareMaxWidth: 800,
        compareMaxHeight: 450,
        compareThreshold: 0.08,
        compareImageFiles: async (referencePath: string, candidatePath: string, options: any) => ({
          referencePath,
          candidatePath,
          diffPath: options.outputPath,
          diffMimeType: "image/png",
          referenceWidth: 1600,
          referenceHeight: 900,
          candidateWidth: 1600,
          candidateHeight: 900,
          compareWidth: options.maxWidth,
          compareHeight: options.maxHeight,
          meanAbsoluteError: 0.08,
          rootMeanSquareError: 0.1,
          mismatchRatio: 0.2,
          maxChannelDelta: 64,
          aspectRatioDelta: 0,
          threshold: options.threshold,
          size: 789,
        }),
        contextProjectDir: projectDir,
        now: () => "2026-06-04T04:00:00.000Z",
      });

      expect(result.created.screenId).toBe("VerifySmoke_ID");
      expect(result.verification.verdict).toBe("needs review");
      expect(result.verification.preview.savedPath).toBe(result.preview.path);
      expect(result.verification.comparison.referencePath)
        .toBe(resolve(projectDir, "Plans/reference.png"));
      expect(result.verification.comparison.candidatePath).toBe(result.preview.path);
      expect(result.verification.comparison.diffPath)
        .toBe(join(projectDir, ".uos", "comparisons", "verify-diff.png"));
      expect(result.comparison).toEqual(result.verification.comparison);

      const index = JSON.parse(await readFile(join(projectDir, ".uos", "screens.json"), "utf8"));
      expect(index.screens.VerifySmoke_ID.previews).toHaveLength(1);
      expect(index.screens.VerifySmoke_ID.comparisons).toHaveLength(1);
      expect(index.screens.VerifySmoke_ID.comparisons[0]).toMatchObject({
        verdict: "needs review",
        referencePath: resolve(projectDir, "Plans/reference.png"),
        candidatePath: result.preview.path,
        diffPath: join(projectDir, ".uos", "comparisons", "verify-diff.png"),
        compareWidth: 800,
        compareHeight: 450,
        threshold: 0.08,
      });

      const journal = await readFile(join(projectDir, ".uos", "work-journal.jsonl"), "utf8");
      expect(journal).toContain("\"tool\":\"create_ui_screen\"");
      expect(journal).toContain("\"tool\":\"verify_screen_against_reference\"");
      expect(journal).not.toContain("\"tool\":\"capture_preview\"");
      expect(journal).not.toContain("\"tool\":\"compare_images\"");

      const output = formatSmokeResult(result);
      expect(output).toContain("verification: verdict=needs review");
      expect(output).not.toContain("comparison: verdict=needs review");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can round-trip a scene object through the selected bridge", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-scene-object-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(projectDir, { recursive: true });
    smokeSceneObjects.clear();

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        sceneObjectRoundTrip: true,
        sceneObjectName: "Smoke Sphere",
        sceneObjectType: "Sphere",
        save: true,
        contextProjectDir: projectDir,
        now: () => "2026-06-04T05:00:00.000Z",
      });

      expect(result.sceneObject.objectId).toBe("SceneObject_Smoke");
      expect(result.sceneObject.createArgs).toMatchObject({
        type: "Sphere",
        name: "Smoke Sphere",
      });
      expect(result.sceneObject.created).toMatchObject({
        objectId: "SceneObject_Smoke",
        name: "Smoke Sphere",
        type: "Sphere",
      });
      expect(result.sceneObject.listedAfterCreate.objects).toHaveLength(1);
      expect(result.sceneObject.updateArgs).toMatchObject({
        objectId: "SceneObject_Smoke",
        name: "Smoke Sphere Updated",
        transform: {
          position: { x: 2, y: 3, z: 4 },
        },
      });
      expect(result.sceneObject.updated).toMatchObject({
        objectId: "SceneObject_Smoke",
        name: "Smoke Sphere Updated",
        transform: {
          position: { x: 2, y: 3, z: 4 },
        },
      });
      expect(result.sceneObject.deleted.ok).toBe(true);
      expect(result.sceneObject.listedAfterDelete.objects).toHaveLength(0);
      expect(result.created).toBeUndefined();
      expect(result.saved.path).toBe("Assets/UOS_Generated.unity");

      const index = JSON.parse(await readFile(join(projectDir, ".uos", "screens.json"), "utf8"));
      expect(index.sceneObjects.SceneObject_Smoke).toMatchObject({
        objectId: "SceneObject_Smoke",
        name: "Smoke Sphere Updated",
        type: "Sphere",
        active: true,
        deleted: true,
        transform: {
          position: { x: 2, y: 3, z: 4 },
          rotation: { x: 0, y: 45, z: 0 },
          scale: { x: 1.25, y: 1.25, z: 1.25 },
        },
      });
      expect(index.lastSavedScenePath).toBe("Assets/UOS_Generated.unity");

      const journal = await readFile(join(projectDir, ".uos", "work-journal.jsonl"), "utf8");
      expect(journal).toContain("\"tool\":\"create_scene_object\"");
      expect(journal).toContain("\"tool\":\"list_scene_objects\"");
      expect(journal).toContain("\"tool\":\"update_scene_object\"");
      expect(journal).toContain("\"tool\":\"delete_scene_object\"");
      expect(journal).toContain("\"tool\":\"save_scene\"");

      const output = formatSmokeResult(result);
      expect(output).toContain("scene object: created SceneObject_Smoke Sphere");
      expect(output).toContain("scene object update: Smoke Sphere Updated pos=(2,3,4)");
      expect(output).toContain("scene object delete: ok");
      expect(output).toContain("saved scene: Assets/UOS_Generated.unity");
      expect(output).not.toContain("write: skipped");
    } finally {
      smokeSceneObjects.clear();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can import the first image from a materials directory", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-material-context-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Assets", "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Assets", "Plans", "hero.png"), "png bytes");

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        write: true,
        preview: true,
        materialsDir: "Assets/Plans",
        contextProjectDir: projectDir,
        now: () => "2026-06-04T03:30:00.000Z",
      });

      expect(result.selectedMaterial.relativePath).toBe("hero.png");
      expect(result.imported.sourcePath).toBe(join(projectDir, "Assets", "Plans", "hero.png"));
      expect(result.imported.assetPath).toBe("Assets/UOS/Imported/hero.png");
      expect(result.intent.elements[0].props.sprite).toBe("Assets/UOS/Imported/hero.png");
      expect(formatSmokeResult(result)).toContain("selected material: hero.png");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can create a screen through the smart material router", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-material-screen-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "brief.md"), "# Daily Rewards\n\nClaim your reward.");

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        preview: true,
        save: true,
        contextFollowUp: true,
        materialScreenPath: "brief.md",
        materialScreenMode: "auto",
        materialsDir: "Plans",
        screenName: "BriefFromSmoke",
        contextProjectDir: projectDir,
        now: () => "2026-06-04T06:00:00.000Z",
        materialScreenRunner: async (_target: any, args: any) => {
          expect(args).toMatchObject({
            path: join(projectDir, "Plans", "brief.md"),
            mode: "auto",
            screenName: "BriefFromSmoke",
          });
          return {
            kind: "document",
            mode: "editable",
            path: args.path,
            intent: {
              version: "1.0.0",
              screenName: "BriefFromSmoke",
              referenceCanvas: { width: 1920, height: 1080 },
              elements: [
                {
                  clientHintId: "md_background",
                  type: "Panel",
                  rect: { x: 0, y: 0, w: 1, h: 1 },
                  props: { color: "#101820" },
                },
                {
                  clientHintId: "md_title",
                  type: "Text",
                  rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.14 },
                  props: { text: "Daily Rewards", fontSize: 48 },
                },
              ],
            },
            source: {
              tool: "create_screen_from_material",
              kind: "md",
              mode: "editable",
              path: args.path,
            },
            warnings: [],
            validation: { ok: true, errors: [], warnings: [] },
            created: {
              screenId: "BriefFromSmoke_ID",
              elements: [
                { clientHintId: "md_background", elementId: "Element_Background" },
                { clientHintId: "md_title", elementId: "Element_Title" },
              ],
            },
            specific: {},
          };
        },
      });

      expect(result.materialScreen.kind).toBe("document");
      expect(result.created.screenId).toBe("BriefFromSmoke_ID");
      expect(result.contextFollowUp.updateCriteria).toEqual({ elementId: "Element_Title", query: "md_title" });
      expect(result.contextFollowUp.updateArgs).toMatchObject({
        elementId: "Element_Title",
        props: { text: "UOS Smoke Context Follow-up" },
      });
      expect(result.contextFollowUp.addCriteria).toEqual({
        parentClientHintId: "md_background",
        parentQuery: "md_background",
      });
      expect(result.contextFollowUp.addArgs.element.parentElementId).toBe("Element_Background");
      expect(result.contextFollowUp.added.elementId).toBe("Element_ContextBadge");
      expect(result.preview.path).toContain("BriefFromSmoke_ID");
      expect(result.saved.path).toBe("Assets/UOS_Generated.unity");

      const index = JSON.parse(await readFile(join(projectDir, ".uos", "screens.json"), "utf8"));
      expect(index.screens.BriefFromSmoke_ID.source).toMatchObject({
        tool: "create_screen_from_material",
        kind: "md",
        mode: "editable",
        path: join(projectDir, "Plans", "brief.md"),
      });
      expect(index.screens.BriefFromSmoke_ID.elements.Element_Title.props.text)
        .toBe("UOS Smoke Context Follow-up");
      expect(index.screens.BriefFromSmoke_ID.elements.Element_ContextBadge.parentElementId)
        .toBe("Element_Background");
      expect(index.screens.BriefFromSmoke_ID.elements.Element_ContextBadge.props.text)
        .toBe("Context follow-up");
      expect(index.screens.BriefFromSmoke_ID.previews[0].savedPath).toBe(result.preview.path);
      expect(index.lastSavedScenePath).toBe("Assets/UOS_Generated.unity");

      const journal = await readFile(join(projectDir, ".uos", "work-journal.jsonl"), "utf8");
      expect(journal).toContain("\"tool\":\"create_screen_from_material\"");
      expect(journal).toContain("\"tool\":\"set_active_screen_from_context\"");
      expect(journal).toContain("\"tool\":\"update_ui_element_from_context\"");
      expect(journal).toContain("\"tool\":\"add_ui_element_from_context\"");
      expect(journal).toContain("\"tool\":\"capture_preview\"");
      expect(journal).toContain("\"tool\":\"save_scene\"");

      const output = formatSmokeResult(result);
      expect(output).toContain("selected material: brief.md");
      expect(output).toContain("material screen: document/editable BriefFromSmoke_ID");
      expect(output).toContain("created screen: BriefFromSmoke_ID");
      expect(output).toContain("context follow-up: active BriefFromSmoke_ID");
      expect(output).toContain("preview:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can route the first supported material from a materials directory", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-first-material-screen-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "brief.md"), "# Daily Rewards\n\nClaim your reward.");
    await writeFile(join(projectDir, "Plans", "deck.pptx"), "pptx bytes");

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        preview: true,
        materialScreenFromMaterials: true,
        materialScreenMode: "auto",
        materialsDir: "Plans",
        screenName: "FirstMaterialFromSmoke",
        contextProjectDir: projectDir,
        now: () => "2026-06-04T06:30:00.000Z",
        materialScreenRunner: async (_target: any, args: any) => {
          expect(args).toMatchObject({
            path: join(projectDir, "Plans", "brief.md"),
            mode: "auto",
            screenName: "FirstMaterialFromSmoke",
          });
          return {
            kind: "document",
            mode: "editable",
            path: args.path,
            intent: {
              version: "1.0.0",
              screenName: "FirstMaterialFromSmoke",
              referenceCanvas: { width: 1920, height: 1080 },
              elements: [
                {
                  clientHintId: "md_title",
                  type: "Text",
                  rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.14 },
                  props: { text: "Daily Rewards", fontSize: 48 },
                },
              ],
            },
            source: {
              tool: "create_screen_from_material",
              kind: "md",
              mode: "editable",
              path: args.path,
            },
            warnings: [],
            validation: { ok: true, errors: [], warnings: [] },
            created: {
              screenId: "FirstMaterialFromSmoke_ID",
              elements: [{ clientHintId: "md_title", elementId: "Element_Title" }],
            },
            specific: {},
          };
        },
      });

      expect(result.selectedMaterial.relativePath).toBe("brief.md");
      expect(result.selectedMaterial.kind).toBe("document");
      expect(result.materialScreen.kind).toBe("document");
      expect(result.created.screenId).toBe("FirstMaterialFromSmoke_ID");
      expect(formatSmokeResult(result)).toContain("material screen: document/editable FirstMaterialFromSmoke_ID");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnitySmoke can create a PPTX deck flow through the deck router", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-smoke-pptx-deck-test");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "Plans", "deck.pptx"), "pptx bytes");

    try {
      const result = await runUnitySmoke(liveTarget(projectDir), {
        timeoutMs: 500,
        preview: true,
        save: true,
        pptxDeckPath: "deck.pptx",
        pptxDeckSlideNumbers: [1, 2],
        pptxDeckCreateTransitions: true,
        pptxDeckActivateFirst: true,
        pptxDeckTransitionTriggerPrefix: "next",
        pptxDeckIncludeShapePanels: true,
        materialsDir: "Plans",
        screenName: "DeckSmoke",
        contextProjectDir: projectDir,
        now: () => "2026-06-04T07:00:00.000Z",
        pptxDeckRunner: async (_target: any, args: any) => {
          expect(args).toMatchObject({
            path: join(projectDir, "Plans", "deck.pptx"),
            slideNumbers: [1, 2],
            screenNamePrefix: "DeckSmoke",
            createTransitions: true,
            activateFirst: true,
            transitionTriggerPrefix: "next",
            includeShapePanels: true,
          });
          return {
            path: args.path,
            slideNumbers: [1, 2],
            screens: [
              {
                slideNumber: 1,
                screenName: "DeckSmoke Slide 1",
                screenId: "DeckSmokeSlide1_ID",
                source: {
                  tool: "create_pptx_deck_screens",
                  kind: "pptx",
                  mode: "editable",
                  path: args.path,
                  slideNumber: 1,
                },
                importedAssets: [{
                  sourcePath: join(projectDir, ".uos", "deck", "image1.png"),
                  assetPath: "Assets/UOS/PPTX/deck-slide1-image1.png",
                  importedAsSprite: true,
                  assetType: "Sprite",
                }],
                draft: {
                  intent: {
                    version: "1.0.0",
                    screenName: "DeckSmoke Slide 1",
                    referenceCanvas: { width: 1920, height: 1080 },
                    elements: [{
                      clientHintId: "slide1_title",
                      type: "Text",
                      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
                      props: { text: "Slide 1" },
                    }],
                  },
                },
                created: {
                  screenId: "DeckSmokeSlide1_ID",
                  elements: [{ clientHintId: "slide1_title", elementId: "Element_Slide1Title" }],
                },
              },
              {
                slideNumber: 2,
                screenName: "DeckSmoke Slide 2",
                screenId: "DeckSmokeSlide2_ID",
                source: {
                  tool: "create_pptx_deck_screens",
                  kind: "pptx",
                  mode: "editable",
                  path: args.path,
                  slideNumber: 2,
                },
                importedAssets: [],
                draft: {
                  intent: {
                    version: "1.0.0",
                    screenName: "DeckSmoke Slide 2",
                    referenceCanvas: { width: 1920, height: 1080 },
                    elements: [{
                      clientHintId: "slide2_title",
                      type: "Text",
                      rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
                      props: { text: "Slide 2" },
                    }],
                  },
                },
                created: {
                  screenId: "DeckSmokeSlide2_ID",
                  elements: [{ clientHintId: "slide2_title", elementId: "Element_Slide2Title" }],
                },
              },
            ],
            transitions: [{
              fromId: "DeckSmokeSlide1_ID",
              toId: "DeckSmokeSlide2_ID",
              trigger: "next-1",
              ok: true,
            }],
            activeScreenId: "DeckSmokeSlide1_ID",
            warnings: [],
          };
        },
      });

      expect(result.pptxDeck.screens).toHaveLength(2);
      expect(result.created.screenId).toBe("DeckSmokeSlide1_ID");
      expect(result.preview.path).toContain("DeckSmokeSlide1_ID");

      const index = JSON.parse(await readFile(join(projectDir, ".uos", "screens.json"), "utf8"));
      expect(index.screens.DeckSmokeSlide1_ID.source).toMatchObject({
        tool: "create_pptx_deck_screens",
        kind: "pptx",
        mode: "editable",
        path: join(projectDir, "Plans", "deck.pptx"),
        slideNumber: 1,
      });
      expect(index.screens.DeckSmokeSlide1_ID.elements.Element_Slide1Title.props.text).toBe("Slide 1");
      expect(index.screens.DeckSmokeSlide2_ID.elements.Element_Slide2Title.props.text).toBe("Slide 2");
      expect(index.transitions[0]).toMatchObject({
        fromId: "DeckSmokeSlide1_ID",
        toId: "DeckSmokeSlide2_ID",
        trigger: "next-1",
        ok: true,
      });
      expect(index.activeScreenId).toBe("DeckSmokeSlide1_ID");

      const journal = await readFile(join(projectDir, ".uos", "work-journal.jsonl"), "utf8");
      expect(journal).toContain("\"tool\":\"create_pptx_deck_screens\"");
      expect(journal).toContain("\"tool\":\"capture_preview\"");
      expect(journal).toContain("\"tool\":\"save_scene\"");

      const output = formatSmokeResult(result);
      expect(output).toContain("selected material: deck.pptx");
      expect(output).toContain("pptx deck: 2 screen(s), 1 transition(s) active=DeckSmokeSlide1_ID");
      expect(output).toContain("deck screen: slide 2 DeckSmokeSlide2_ID");
      expect(output).toContain("preview:");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("resolveUnityExecutable accepts an explicit Unity executable and reads project version", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-unity-path-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    try {
      expect(await readUnityProjectVersion(projectDir)).toBe("6000.0.68f1");
      expect(await resolveUnityExecutable(projectDir, { unityPath: unityExe })).toBe(resolve(unityExe));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E launches Unity, waits, smokes, stops, and cleans stale registry", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-run-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(4321);
    let launched: { unityPath?: string; args?: string[]; logFile?: string } | undefined;
    let cleanup: any;

    try {
      const result = await runUnityE2E({
        projectPath: projectDir,
        unityPath: unityExe,
        timeoutMs: 5000,
        intervalMs: 250,
        stopTimeoutMs: 1000,
        launchUnity: async (exe: string, args: string[], context: any) => {
          launched = { unityPath: exe, args, logFile: context.logFile };
          return child;
        },
        waitForUnityTarget: async (options: any) => {
          expect(options.selector).toBe(projectDir);
          expect(options.timeoutMs).toBe(5000);
          expect(options.intervalMs).toBe(250);
          return { timedOut: false, elapsedMs: 25, editors: [liveTarget(projectDir)] };
        },
        collectDoctorReport: async () => ({ registry: { entries: [] } }),
        cleanStaleRegistryEntries: async () => ({ removed: 1 }),
        onCleanup: (state: any) => {
          cleanup = state;
        },
      });

      expect(launched?.unityPath).toBe(resolve(unityExe));
      expect(launched?.args).toContain("-batchmode");
      expect(launched?.args).toContain("-nographics");
      expect(launched?.args).toContain("-projectPath");
      expect(launched?.args).toContain(projectDir);
      expect(launched?.args).toContain("-logFile");
      expect(launched?.logFile).toBe(join(projectDir, ".uos", "e2e-unity.log"));
      expect(child.killed).toBe(true);
      expect(cleanup.stopped.exited).toBe(true);
      expect(result.cleaned.removed).toBe(1);
      expect(result.smoke.created.screenId).toBe("UOSE2ESmoke_ID");
      expect(formatE2EResult(result)).toContain("[uos e2e] ok");
      expect(formatE2EResult(result)).toContain("stale registry entries removed: 1");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E can verify selected-project entry dry-run forwarding", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-entry-dry-run-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(projectDir, "Plans", "brief.md"), "# Lobby\nCreate a lobby screen.");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(4433);
    const parsed = parseE2EOptions([
      projectDir,
      "--unity",
      unityExe,
      "--read-only",
      "--entry-dry-run",
      "--post-smoke-entry-dry-run",
      "--public-smoke",
      "--public-mvp-json",
      "--public-chat-dry-run",
      "--public-run-dry-run",
      "--public-run-prompt",
      "continue from the attached brief",
      "--public-run-ai",
      "--public-run-ai-prompt",
      "read attached brief and create a screen",
      "--public-run-ai-screen-name",
      "PublicRunBrief",
      "--uos-materials",
      "Plans",
      "--uos-file",
      "brief.md",
    ]);
    let smokedOptions: any;
    let publicSmokeCall: { command?: string; args?: string[]; cwd?: string } | undefined;
    let publicMvpCall: { command?: string; args?: string[]; cwd?: string } | undefined;
    let publicChatCall: { command?: string; args?: string[]; cwd?: string } | undefined;
    let publicRunCall: { command?: string; args?: string[]; cwd?: string } | undefined;
    let publicRunAiCall: { command?: string; args?: string[]; cwd?: string } | undefined;
    const publicSecret = "public-secret-token";
    const selectedTarget = liveTarget(projectDir);
    const bridgeSecret = selectedTarget.token;

    try {
      const result = await runUnityE2E({
        ...parsed,
        env: {
          ...process.env,
          UNITY_MCP_TOKEN: publicSecret,
        },
        repoRoot: join(import.meta.dir, ".."),
        launchUnity: async () => child,
        waitForUnityTarget: async () => ({
          timedOut: false,
          elapsedMs: 10,
          editors: [selectedTarget],
          target: selectedTarget,
        }),
        runUnitySmoke: async (_target: any, smokeOptions: any) => {
          smokedOptions = smokeOptions;
          const uosDir = join(projectDir, ".uos");
          await mkdir(uosDir, { recursive: true });
          await writeFile(join(uosDir, "project.json"), JSON.stringify({
            projectName: "LiveProject",
            projectPath: projectDir,
          }));
          await writeFile(join(uosDir, "screens.json"), JSON.stringify({
            version: "1.0.0",
            activeScreenId: "PostSmoke_ID",
            screens: {
              PostSmoke_ID: {
                screenId: "PostSmoke_ID",
                screenName: "PostSmoke",
                updatedAt: "2026-06-05T06:10:00.000Z",
                previews: [{
                  savedPath: join(projectDir, ".uos", "previews", "PostSmoke.png"),
                  mimeType: "image/png",
                  width: 1280,
                  height: 720,
                  ts: "2026-06-05T06:10:01.000Z",
                }],
                comparisons: [{
                  verdict: "close",
                  referencePath: join(projectDir, "Plans", "brief-reference.png"),
                  candidatePath: join(projectDir, ".uos", "previews", "PostSmoke.png"),
                  diffPath: join(projectDir, ".uos", "comparisons", "PostSmoke-diff.png"),
                  meanAbsoluteError: 0.02,
                  mismatchRatio: 0.04,
                  ts: "2026-06-05T06:10:02.000Z",
                }],
                elements: {},
              },
            },
          }));
          return { ok: true, target: selectedTarget, readOnly: smokeOptions.write === false };
        },
        publicSmokeCommandRunner: (command: string, args: string[], options: any) => {
          publicSmokeCall = { command, args, cwd: options.cwd };
          return {
            status: 0,
            stdout: [
              "[uos smoke] connected: LiveProject",
              "UNITY_MCP_TOKEN=" + publicSecret,
              "bridge token " + bridgeSecret,
              "[uos smoke] list_screens: ok",
              "",
            ].join("\n"),
            stderr: "public smoke stderr token " + publicSecret + " " + bridgeSecret,
          };
        },
        publicMvpCommandRunner: (command: string, args: string[], options: any) => {
          publicMvpCall = { command, args, cwd: options.cwd };
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              target: { projectName: "LiveProject", token: publicSecret },
              commandLines: mvpCommandLineFixtures(projectDir, bridgeSecret, join(projectDir, "Plans"), [join(projectDir, "Plans", "brief.md")]),
              acceptanceGates: mvpAcceptanceGateFixtures(),
              preflightSummary: mvpPreflightSummaryFixture(projectDir),
            }, null, 2),
            stderr: "public mvp stderr token " + publicSecret + " " + bridgeSecret,
          };
        },
        publicChatCommandRunner: (command: string, args: string[], options: any) => {
          publicChatCall = { command, args, cwd: options.cwd };
          return {
            status: 0,
            stdout: [
              "[uos] launch summary",
              "  opencode: --prompt <# UOS Startup ...> --agent ochestrator",
              "  note: TUI launches expose attached files through UOS_ATTACHED_FILES/get_uos_context; use `uos run` for opencode --file attachments in the first model turn.",
              "[uos] forwarded opencode argv:",
              "  [\"--prompt\",\"# UOS Startup\\n\\nCall get_uos_context and select_uos_mode before mutating Unity.\",\"--agent\",\"ochestrator\"]",
              "  {\"UNITY_MCP_TOKEN\":\"" + publicSecret + "\"}",
              "  bridgeToken=" + bridgeSecret,
              "  UOS_ATTACHED_FILES: [\"" + join(projectDir, "Plans", "brief.md").replace(/\\/g, "\\\\") + "\"]",
            ].join("\n"),
            stderr: "public chat stderr token " + publicSecret + " " + bridgeSecret,
          };
        },
        publicRunCommandRunner: (command: string, args: string[], options: any) => {
          publicRunCall = { command, args, cwd: options.cwd };
          return {
            status: 0,
            stdout: [
              "[uos] launch summary",
              "[uos] forwarded opencode argv:",
              "  [\"run\",\"--file\",\"C:/tmp/uos-run-context.md\",\"--file\",\"" + join(projectDir, "Plans", "brief.md").replace(/\\/g, "\\\\") + "\",\"--agent\",\"ochestrator\",\"--continue\",\"continue from the attached brief\"]",
              "  UNITY_MCP_TOKEN: " + publicSecret,
              "  bridge token " + bridgeSecret,
            ].join("\n"),
            stderr: "public run stderr token " + publicSecret + " " + bridgeSecret,
          };
        },
        publicRunAiCommandRunner: (command: string, args: string[], options: any) => {
          publicRunAiCall = { command, args, cwd: options.cwd };
          const ts = new Date().toISOString();
          writeFileSync(join(projectDir, ".uos", "work-journal.jsonl"), [
            JSON.stringify({ ts, tool: "read_planning_material", result: { ok: true, path: join(projectDir, "Plans", "brief.md") } }),
            JSON.stringify({ ts, tool: "create_screen_from_material", result: { screenId: "PublicRunAI_ID" } }),
            "",
          ].join("\n"));
          return {
            status: 0,
            stdout: "read_planning_material\ncreate_screen_from_material\nleaked token " + publicSecret + " " + bridgeSecret + "\n",
            stderr: "public run AI stderr token " + publicSecret + " " + bridgeSecret,
          };
        },
        collectDoctorReport: async () => ({ registry: { entries: [] } }),
        cleanStaleRegistryEntries: async () => ({ removed: 0 }),
      });

      const briefPath = join(projectDir, "Plans", "brief.md");
      expect(smokedOptions.write).toBe(false);
      expect(result.entryDryRun.launchInputs.materialsDir).toBe(join(projectDir, "Plans"));
      expect(result.entryDryRun.launchInputs.files).toEqual([briefPath]);
      expect(result.entryDryRun.opencodeArgs[0]).toBe("--prompt");
      expect(result.entryDryRun.opencodeArgs).toContain("--agent");
      expect(result.entryDryRun.opencodeArgs).toContain("ochestrator");
      expect(result.entryDryRun.opencodeArgs[1]).toContain("# UOS Startup");
      expect(result.entryDryRun.opencodeArgs[1]).toContain("get_uos_context");
      expect(result.entryDryRun.opencodeArgs[1]).toContain("read_planning_material");
      expect(result.entryDryRun.opencodeArgs[1]).toContain(briefPath);
      expect(result.entryDryRun.readiness.ready).toBe(true);
      expect(result.postSmokeEntryDryRun.launchInputs.files).toEqual([briefPath]);
      expect(result.postSmokeEntryDryRun.opencodeArgs[1]).toContain("latestVerification");
      expect(result.postSmokeEntryDryRun.opencodeArgs[1]).toContain("PostSmoke_ID");
      expect(result.postSmokeEntryDryRun.output).toContain("latest verification: screen=PostSmoke_ID (PostSmoke) verdict=close");
      expect(result.publicSmoke.status).toBe(0);
      expect(result.publicSmoke.stdout).not.toContain(publicSecret);
      expect(result.publicSmoke.stderr).not.toContain(publicSecret);
      expect(result.publicSmoke.stdout).not.toContain(bridgeSecret);
      expect(result.publicSmoke.stderr).not.toContain(bridgeSecret);
      expect(publicSmokeCall?.command).toBe(process.execPath);
      expect(publicSmokeCall?.args).toEqual([
        join(import.meta.dir, "..", "bin", "uos.js"),
        "smoke",
        "--unity-project",
        projectDir,
        "--uos-materials",
        "Plans",
      ]);
      expect(publicSmokeCall?.cwd).toBe(join(import.meta.dir, ".."));
      expect(result.publicMvp.status).toBe(0);
      expect(result.publicMvp.json).toBe(true);
      expect(result.publicMvp.parsedOk).toBe(true);
      expect(result.publicMvp.acceptanceGateIds).toContain("consumer-install-and-runtime");
      expect(result.publicMvp.acceptanceGateIds).toContain("real-ai-edit");
      expect(result.publicMvp.commandLineKeys).toContain("doctorProject");
      expect(result.publicMvp.commandLineKeys).toContain("runAiEdit");
      expect(result.publicMvp.commandLineKeys).toContain("publicMvpE2E");
      expect(result.publicMvp.commandLineValidation.ok).toBe(true);
      expect(result.publicMvp.preflightSummary.status).toBe("ready-for-user-validation");
      expect(result.publicMvp.preflightSummary.commandLines.missing).toEqual([]);
      expect(result.publicMvp.preflightSummaryValidation.ok).toBe(true);
      expect(result.publicMvp.stdout).not.toContain(publicSecret);
      expect(result.publicMvp.stderr).not.toContain(publicSecret);
      expect(result.publicMvp.stdout).not.toContain(bridgeSecret);
      expect(result.publicMvp.stderr).not.toContain(bridgeSecret);
      expect(publicMvpCall?.command).toBe(process.execPath);
      expect(publicMvpCall?.args).toEqual([
        join(import.meta.dir, "..", "bin", "uos.js"),
        "mvp",
        "--unity-project",
        projectDir,
        "--uos-materials",
        "Plans",
        "--uos-file",
        "brief.md",
        "--json",
      ]);
      expect(publicMvpCall?.cwd).toBe(join(import.meta.dir, ".."));
      expect(result.publicChatDryRun.status).toBe(0);
      expect(result.publicChatDryRun.stdout).not.toContain(publicSecret);
      expect(result.publicChatDryRun.stderr).not.toContain(publicSecret);
      expect(result.publicChatDryRun.stdout).not.toContain(bridgeSecret);
      expect(result.publicChatDryRun.stderr).not.toContain(bridgeSecret);
      expect(publicChatCall?.command).toBe(process.execPath);
      expect(publicChatCall?.args).toEqual([
        join(import.meta.dir, "..", "bin", "uos.js"),
        "chat",
        "--unity-project",
        projectDir,
        "--uos-materials",
        "Plans",
        "--uos-file",
        "brief.md",
        "--uos-dry-run",
      ]);
      expect(publicChatCall?.cwd).toBe(join(import.meta.dir, ".."));
      expect(result.publicRunDryRun.status).toBe(0);
      expect(result.publicRunDryRun.stdout).not.toContain(publicSecret);
      expect(result.publicRunDryRun.stderr).not.toContain(publicSecret);
      expect(result.publicRunDryRun.stdout).not.toContain(bridgeSecret);
      expect(result.publicRunDryRun.stderr).not.toContain(bridgeSecret);
      expect(publicRunCall?.command).toBe(process.execPath);
      expect(publicRunCall?.args).toEqual([
        join(import.meta.dir, "..", "bin", "uos.js"),
        "--unity-project",
        projectDir,
        "--uos-materials",
        "Plans",
        "--uos-file",
        "brief.md",
        "--uos-dry-run",
        "run",
        "--continue",
        "continue from the attached brief",
      ]);
      expect(publicRunCall?.cwd).toBe(join(import.meta.dir, ".."));
      expect(result.publicRunAi.status).toBe(0);
      expect(result.publicRunAi.ok).toBe(true);
      expect(result.publicRunAi.stdout).not.toContain(publicSecret);
      expect(result.publicRunAi.stderr).not.toContain(publicSecret);
      expect(result.publicRunAi.stdout).not.toContain(bridgeSecret);
      expect(result.publicRunAi.stderr).not.toContain(bridgeSecret);
      expect(result.publicRunAi.screenName).toBe("PublicRunBrief");
      expect(result.publicRunAi.observedJournalTools).toEqual(["read_planning_material", "create_screen_from_material"]);
      expect(result.publicRunAi.journalScreenId).toBe("PublicRunAI_ID");
      expect(publicRunAiCall?.command).toBe(process.execPath);
      expect(publicRunAiCall?.args).toEqual([
        join(import.meta.dir, "..", "bin", "uos.js"),
        "--unity-project",
        projectDir,
        "--uos-materials",
        "Plans",
        "--uos-file",
        "brief.md",
        "run",
        "--title",
        "UOS Public Run AI E2E",
        "-m",
        "anthropic/claude-haiku-4-5",
        "read attached brief and create a screen",
      ]);
      expect(publicRunAiCall?.cwd).toBe(join(import.meta.dir, ".."));

      const output = formatE2EResult(result);
      expect(output).toContain("[uos e2e] entry dry-run");
      expect(output).toContain("[uos e2e] public smoke");
      expect(output).toContain("[uos smoke] connected: LiveProject");
      expect(output).toContain("[uos e2e] public mvp preflight");
      expect(output).toContain("parsed ok: true");
      expect(output).toContain("preflight: ready-for-user-validation next=run-user-led-mvp-gates");
      expect(output).toContain("preflight command lines: 9/9");
      expect(output).toContain("preflight acceptance gates: 6");
      expect(output).toContain("command line validation: ok");
      expect(output).toContain("preflight summary validation: ok");
      const publicMvpSection = output.slice(
        output.indexOf("[uos e2e] public mvp preflight"),
        output.indexOf("[uos e2e] public chat dry-run"),
      );
      expect(publicMvpSection.indexOf("preflight: ready-for-user-validation")).toBeLessThan(publicMvpSection.indexOf("stdout:"));
      expect(output).toContain("[uos e2e] public chat dry-run");
      expect(output).toContain("TUI launches expose attached files through UOS_ATTACHED_FILES/get_uos_context");
      expect(output).toContain("[uos e2e] public run dry-run");
      expect(output).toContain("continue from the attached brief");
      expect(output).toContain("[uos e2e] public run AI");
      expect(output).toContain("screen name: PublicRunBrief");
      expect(output).toContain("journal: read_planning_material,create_screen_from_material");
      expect(output).toContain("screen: PublicRunAI_ID");
      expect(output).toContain("[uos e2e] post-smoke entry dry-run");
      expect(output).toContain("[uos] forwarded opencode argv:");
      expect(output).toContain("UNITY_MCP_TOKEN: (set)");
      expect(output).toContain("(redacted)");
      expect(output).not.toContain(publicSecret);
      expect(output).not.toContain(bridgeSecret);
      expect(output).toContain("UOS_BRIDGE_SUPPORTED_TOOLS");
      expect(output).toContain(briefPath);
      expect(output).toContain("latest verification: screen=PostSmoke_ID (PostSmoke) verdict=close");
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E redacts public command failure output", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-public-redaction-test");
    const unityExe = join(projectDir, "Unity.exe");
    const publicSecret = "public-failure-secret";
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(4434);
    const selectedTarget = {
      ...liveTarget(projectDir),
      token: publicSecret,
    };

    try {
      let message = "";
      try {
        await runUnityE2E({
          projectPath: projectDir,
          unityPath: unityExe,
          publicRunDryRun: true,
          publicRunPrompt: "continue from failure fixture",
          timeoutMs: 5000,
          intervalMs: 250,
          stopTimeoutMs: 1000,
          env: {
            ...process.env,
            UNITY_MCP_TOKEN: publicSecret,
          },
          repoRoot: join(import.meta.dir, ".."),
          launchUnity: async () => child,
          waitForUnityTarget: async () => ({
            timedOut: false,
            elapsedMs: 10,
            editors: [selectedTarget],
            target: selectedTarget,
          }),
          runUnitySmoke: async () => ({ ok: true, target: selectedTarget, readOnly: true }),
          publicRunCommandRunner: () => ({
            status: 1,
            stdout: "UNITY_MCP_TOKEN=" + publicSecret + "\n",
            stderr: "stderr leaked " + publicSecret + "\n",
            error: "spawn leaked " + publicSecret,
          }),
          collectDoctorReport: async () => ({ registry: { entries: [] } }),
          cleanStaleRegistryEntries: async () => ({ removed: 0 }),
        });
      } catch (err) {
        message = String((err as Error).message);
      }

      expect(message).toContain("[uos e2e] public run dry-run failed");
      expect(message).toContain("UNITY_MCP_TOKEN=(set)");
      expect(message).toContain("(redacted)");
      expect(message).not.toContain(publicSecret);
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E rejects public MVP JSON without acceptance gates", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-public-mvp-gates-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(5534);
    const selectedTarget = liveTarget(projectDir);

    try {
      let message = "";
      try {
        await runUnityE2E({
          projectPath: projectDir,
          unityPath: unityExe,
          publicMvp: true,
          publicMvpJson: true,
          timeoutMs: 5000,
          intervalMs: 250,
          stopTimeoutMs: 1000,
          repoRoot: join(import.meta.dir, ".."),
          launchUnity: async () => child,
          waitForUnityTarget: async () => ({
            timedOut: false,
            elapsedMs: 10,
            editors: [selectedTarget],
            target: selectedTarget,
          }),
          runUnitySmoke: async () => ({ ok: true, target: selectedTarget, readOnly: true }),
          publicMvpCommandRunner: () => ({
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              acceptanceGates: [{ id: "ready-and-context" }],
            }),
            stderr: "",
          }),
          collectDoctorReport: async () => ({ registry: { entries: [] } }),
          cleanStaleRegistryEntries: async () => ({ removed: 0 }),
        });
      } catch (err) {
        message = String((err as Error).message);
      }

      expect(message).toContain("[uos e2e] public mvp preflight JSON missing acceptance gates");
      expect(message).toContain("consumer-install-and-runtime");
      expect(message).toContain("real-ai-edit");
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E rejects public MVP JSON without walkthrough command lines", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-public-mvp-command-lines-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(5535);
    const selectedTarget = liveTarget(projectDir);

    try {
      let message = "";
      try {
        await runUnityE2E({
          projectPath: projectDir,
          unityPath: unityExe,
          publicMvp: true,
          publicMvpJson: true,
          timeoutMs: 5000,
          intervalMs: 250,
          stopTimeoutMs: 1000,
          repoRoot: join(import.meta.dir, ".."),
          launchUnity: async () => child,
          waitForUnityTarget: async () => ({
            timedOut: false,
            elapsedMs: 10,
            editors: [selectedTarget],
            target: selectedTarget,
          }),
          runUnitySmoke: async () => ({ ok: true, target: selectedTarget, readOnly: true }),
          publicMvpCommandRunner: () => ({
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              acceptanceGates: mvpAcceptanceGateFixtures(),
              commandLines: {
                ready: "uos ready --wait --unity-project fixture",
              },
            }),
            stderr: "",
          }),
          collectDoctorReport: async () => ({ registry: { entries: [] } }),
          cleanStaleRegistryEntries: async () => ({ removed: 0 }),
        });
      } catch (err) {
        message = String((err as Error).message);
      }

      expect(message).toContain("[uos e2e] public mvp preflight JSON missing command lines");
      expect(message).toContain("doctorProject");
      expect(message).toContain("runAiEdit");
      expect(message).toContain("chatContinue");
      expect(message).toContain("publicMvpE2E");
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E rejects public MVP JSON with stale walkthrough project or material command lines", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-public-mvp-command-content-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(projectDir, "Plans", "brief.md"), "# MVP brief\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(5536);
    const selectedTarget = liveTarget(projectDir);

    try {
      let message = "";
      try {
        await runUnityE2E({
          projectPath: projectDir,
          unityPath: unityExe,
          publicMvp: true,
          publicMvpJson: true,
          entryMaterialsDir: "Plans",
          entryFiles: ["brief.md"],
          timeoutMs: 5000,
          intervalMs: 250,
          stopTimeoutMs: 1000,
          repoRoot: join(import.meta.dir, ".."),
          launchUnity: async () => child,
          waitForUnityTarget: async () => ({
            timedOut: false,
            elapsedMs: 10,
            editors: [selectedTarget],
            target: selectedTarget,
          }),
          runUnitySmoke: async () => ({ ok: true, target: selectedTarget, readOnly: true }),
          publicMvpCommandRunner: () => ({
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              acceptanceGates: mvpAcceptanceGateFixtures(),
              commandLines: mvpCommandLineFixtures("D:/Unity/StaleProject"),
            }),
            stderr: "",
          }),
          collectDoctorReport: async () => ({ registry: { entries: [] } }),
          cleanStaleRegistryEntries: async () => ({ removed: 0 }),
        });
      } catch (err) {
        message = String((err as Error).message);
      }

      expect(message).toContain("[uos e2e] public mvp preflight JSON command lines do not match selected project/materials");
      expect(message).toContain("ready missing selected project");
      expect(message).toContain(projectDir);
      expect(message).toContain("publicMvpE2E missing project path");
      expect(message).toContain("context missing planning material Plans");
      expect(message).toContain("runAiEdit missing planning material brief.md");
      expect(message).toContain("publicMvpE2E missing planning material brief.md");
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E rejects public MVP JSON with blocked preflight summary", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-public-mvp-summary-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await mkdir(join(projectDir, "Plans"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(projectDir, "Plans", "brief.md"), "# MVP brief\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(5537);
    const selectedTarget = liveTarget(projectDir);

    try {
      let message = "";
      try {
        await runUnityE2E({
          projectPath: projectDir,
          unityPath: unityExe,
          publicMvp: true,
          publicMvpJson: true,
          entryMaterialsDir: "Plans",
          entryFiles: ["brief.md"],
          timeoutMs: 5000,
          intervalMs: 250,
          stopTimeoutMs: 1000,
          repoRoot: join(import.meta.dir, ".."),
          launchUnity: async () => child,
          waitForUnityTarget: async () => ({
            timedOut: false,
            elapsedMs: 10,
            editors: [selectedTarget],
            target: selectedTarget,
          }),
          runUnitySmoke: async () => ({ ok: true, target: selectedTarget, readOnly: true }),
          publicMvpCommandRunner: () => ({
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              acceptanceGates: mvpAcceptanceGateFixtures(),
              commandLines: mvpCommandLineFixtures(projectDir, "", "Plans", ["brief.md"]),
              preflightSummary: {
                ...mvpPreflightSummaryFixture(projectDir),
                status: "blocked",
                next: "resolve-preflight-blockers",
                aiSessionReady: false,
                commandLines: {
                  ...mvpPreflightSummaryFixture(projectDir).commandLines,
                  missing: ["publicMvpE2E"],
                },
              },
            }),
            stderr: "",
          }),
          collectDoctorReport: async () => ({ registry: { entries: [] } }),
          cleanStaleRegistryEntries: async () => ({ removed: 0 }),
        });
      } catch (err) {
        message = String((err as Error).message);
      }

      expect(message).toContain("[uos e2e] public mvp preflight JSON summary is not ready");
      expect(message).toContain("preflightSummary.status is blocked");
      expect(message).toContain("preflightSummary.next is resolve-preflight-blockers");
      expect(message).toContain("preflightSummary.aiSessionReady is not true");
      expect(message).toContain("preflightSummary.commandLines.missing has publicMvpE2E");
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E can pass scene object smoke options without default UI revision", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-scene-object-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(6543);
    const parsed = parseE2EOptions([
      projectDir,
      "--unity",
      unityExe,
      "--scene-object",
      "--object-type",
      "Cube",
    ]);
    let smokedOptions: any;

    try {
      const result = await runUnityE2E({
        ...parsed,
        launchUnity: async () => child,
        waitForUnityTarget: async () => ({
          timedOut: false,
          elapsedMs: 10,
          editors: [liveTarget(projectDir)],
        }),
        runUnitySmoke: async (_target: any, smokeOptions: any) => {
          smokedOptions = smokeOptions;
          return { ok: true, sceneObject: { objectId: "SceneObject_Smoke" } };
        },
        collectDoctorReport: async () => ({ registry: { entries: [] } }),
        cleanStaleRegistryEntries: async () => ({ removed: 0 }),
      });

      expect(smokedOptions).toMatchObject({
        write: true,
        preview: false,
        revise: false,
        sceneObjectRoundTrip: true,
        sceneObjectType: "Cube",
        screenName: "UOSE2ESmoke",
      });
      expect(smokedOptions.timeoutMs).toBe(TOOL_CALL_TIMEOUT_MS);
      expect(result.smoke.sceneObject.objectId).toBe("SceneObject_Smoke");
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E can launch and smoke multiple selected Unity editors", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-multi-run-test");
    const primaryProject = join(dir, "PrimaryGame");
    const secondaryProject = join(dir, "SecondaryGame");
    const unityExe = join(dir, "Unity.exe");
    const logFile = join(dir, "uos-e2e-multi.log");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(primaryProject, "ProjectSettings"), { recursive: true });
    await mkdir(join(secondaryProject, "ProjectSettings"), { recursive: true });
    await mkdir(join(primaryProject, "Plans"), { recursive: true });
    await mkdir(join(secondaryProject, "Plans"), { recursive: true });
    await writeFile(join(primaryProject, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(secondaryProject, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(join(primaryProject, "Plans", "brief.md"), "# Primary\n");
    await writeFile(join(secondaryProject, "Plans", "brief.md"), "# Secondary\n");
    await writeFile(unityExe, "fake unity");

    const children: FakeChildProcess[] = [];
    const launches: any[] = [];
    const waitSelectors: string[] = [];
    const smoked: any[] = [];
    const publicMvpCalls: any[] = [];
    const publicChatCalls: any[] = [];
    const publicRunCalls: any[] = [];

    try {
      const result = await runUnityE2E({
        projectPath: primaryProject,
        secondaryProjectPaths: [secondaryProject],
        unityPath: unityExe,
        logFile,
        timeoutMs: 5000,
        intervalMs: 250,
        stopTimeoutMs: 1000,
        nographics: false,
        publicMvp: true,
        publicMvpJson: true,
        publicChatDryRun: true,
        publicRunDryRun: true,
        publicRunPrompt: "continue each selected project",
        entryMaterialsDir: "Plans",
        entryFiles: ["brief.md"],
        launchUnity: async (exe: string, args: string[], context: any) => {
          const child = new FakeChildProcess(6500 + children.length);
          children.push(child);
          launches.push({ exe, args, context });
          return child;
        },
        waitForUnityTarget: async (options: any) => {
          waitSelectors.push(options.selector);
          const target = liveTarget(options.selector);
          return {
            timedOut: false,
            elapsedMs: 10 + waitSelectors.length,
            editors: [target],
            target,
          };
        },
        runUnitySmoke: async (target: any, smokeOptions: any) => {
          smoked.push({ target, smokeOptions });
          return {
            ok: true,
            target,
            projectPath: target.projectPath,
            write: smokeOptions.write,
          };
        },
        publicChatCommandRunner: (command: string, args: string[], options: any) => {
          publicChatCalls.push({ command, args, cwd: options.cwd });
          return {
            status: 0,
            stdout: `[uos] selected Unity project: ${args[3]}\n[uos] forwarded opencode argv:\n  [\"--prompt\",\"# UOS Startup\",\"--agent\",\"ochestrator\"]\n`,
            stderr: "",
          };
        },
        publicMvpCommandRunner: (command: string, args: string[], options: any) => {
          publicMvpCalls.push({ command, args, cwd: options.cwd });
          return {
            status: 0,
            stdout: JSON.stringify({
              ok: true,
              selector: args[3],
              commandLines: mvpCommandLineFixtures(args[3], "", "Plans", ["brief.md"]),
              acceptanceGates: mvpAcceptanceGateFixtures(),
              preflightSummary: mvpPreflightSummaryFixture(args[3]),
            }),
            stderr: "",
          };
        },
        publicRunCommandRunner: (command: string, args: string[], options: any) => {
          publicRunCalls.push({ command, args, cwd: options.cwd });
          return {
            status: 0,
            stdout: `[uos] selected Unity project: ${args[2]}\n[uos] forwarded opencode argv:\n  [\"run\",\"--agent\",\"ochestrator\",\"--continue\",\"continue each selected project\"]\n`,
            stderr: "",
          };
        },
        collectDoctorReport: async () => ({ registry: { entries: [] } }),
        cleanStaleRegistryEntries: async () => ({ removed: 2 }),
      });

      expect(launches).toHaveLength(2);
      expect(launches[0].context.projectPath).toBe(primaryProject);
      expect(launches[0].args).not.toContain("-nographics");
      expect(launches[0].context.logFile).toBe(logFile);
      expect(launches[1].context.projectPath).toBe(secondaryProject);
      expect(launches[1].args).not.toContain("-nographics");
      expect(launches[1].context.logFile).toBe(join(dir, "uos-e2e-multi-secondary-1.log"));
      expect(waitSelectors).toEqual([primaryProject, secondaryProject]);
      expect(smoked.map((item) => item.target.projectPath)).toEqual([primaryProject, secondaryProject]);
      expect(smoked.every((item) => item.smokeOptions.write === false)).toBe(true);
      expect(publicMvpCalls.map((item) => item.args)).toEqual([
        [
          join(import.meta.dir, "..", "bin", "uos.js"),
          "mvp",
          "--unity-project",
          primaryProject,
          "--uos-materials",
          "Plans",
          "--uos-file",
          "brief.md",
          "--json",
        ],
        [
          join(import.meta.dir, "..", "bin", "uos.js"),
          "mvp",
          "--unity-project",
          secondaryProject,
          "--uos-materials",
          "Plans",
          "--uos-file",
          "brief.md",
          "--json",
        ],
      ]);
      expect(publicChatCalls.map((item) => item.args)).toEqual([
        [
          join(import.meta.dir, "..", "bin", "uos.js"),
          "chat",
          "--unity-project",
          primaryProject,
          "--uos-materials",
          "Plans",
          "--uos-file",
          "brief.md",
          "--uos-dry-run",
        ],
        [
          join(import.meta.dir, "..", "bin", "uos.js"),
          "chat",
          "--unity-project",
          secondaryProject,
          "--uos-materials",
          "Plans",
          "--uos-file",
          "brief.md",
          "--uos-dry-run",
        ],
      ]);
      expect(publicRunCalls.map((item) => item.args)).toEqual([
        [
          join(import.meta.dir, "..", "bin", "uos.js"),
          "--unity-project",
          primaryProject,
          "--uos-materials",
          "Plans",
          "--uos-file",
          "brief.md",
          "--uos-dry-run",
          "run",
          "--continue",
          "continue each selected project",
        ],
        [
          join(import.meta.dir, "..", "bin", "uos.js"),
          "--unity-project",
          secondaryProject,
          "--uos-materials",
          "Plans",
          "--uos-file",
          "brief.md",
          "--uos-dry-run",
          "run",
          "--continue",
          "continue each selected project",
        ],
      ]);
      expect(result.publicMvpResults).toHaveLength(2);
      expect(result.publicMvpResults.every((item: any) => item.acceptanceGateIds.includes("consumer-install-and-runtime"))).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.acceptanceGateIds.includes("follow-up-edit"))).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.commandLineKeys.includes("doctorProject"))).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.commandLineKeys.includes("chatContinue"))).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.commandLineKeys.includes("publicMvpE2E"))).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.commandLineValidation.ok === true)).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.preflightSummaryValidation.ok === true)).toBe(true);
      expect(result.publicMvpResults.every((item: any) => item.preflightSummary.status === "ready-for-user-validation")).toBe(true);
      expect(result.publicChatDryRunResults).toHaveLength(2);
      expect(result.publicRunDryRunResults).toHaveLength(2);
      expect(children.every((child) => child.killed)).toBe(true);
      expect(result.mode).toBe("multi-editor");
      expect(result.projectPaths).toEqual([primaryProject, secondaryProject]);
      expect(result.stopped).toHaveLength(2);
      expect(result.cleaned.removed).toBe(2);

      const output = formatE2EResult(result);
      expect(output).toContain("mode: multi-editor");
      expect(output).toContain("projects: 2");
      expect(output).toContain("[uos e2e] public chat dry-run project[1]");
      expect(output).toContain("[uos e2e] public chat dry-run project[2]");
      expect(output).toContain("[uos e2e] public mvp preflight project[1]");
      expect(output).toContain("[uos e2e] public mvp preflight project[2]");
      expect(output).toContain("preflight: ready-for-user-validation next=run-user-led-mvp-gates");
      expect(output).toContain("preflight summary validation: ok");
      expect(output).toContain("[uos e2e] public run dry-run project[1]");
      expect(output).toContain("[uos e2e] public run dry-run project[2]");
      expect(output).toContain("continue each selected project");
      expect(output).toContain("Unity instances stopped: 2/2");
      expect(output).toContain("stale registry entries removed: 2");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("runUnityE2E smokes the wait-selected target instead of the first live editor", async () => {
    const projectDir = join(import.meta.dir, "..", ".omx", "tmp", "uos-e2e-selected-target-test");
    const unityExe = join(projectDir, "Unity.exe");
    await rm(projectDir, { recursive: true, force: true });
    await mkdir(join(projectDir, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectDir, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n");
    await writeFile(unityExe, "fake unity");

    const child = new FakeChildProcess(5432);
    const firstEditor = {
      ...liveTarget("D:/Unity/OtherProject"),
      instanceId: "first-editor",
      projectName: "OtherProject",
    };
    const selectedEditor = {
      ...liveTarget(projectDir),
      instanceId: "selected-editor",
      projectName: "SelectedProject",
    };
    let smokedTarget: any;

    try {
      const result = await runUnityE2E({
        projectPath: projectDir,
        unityPath: unityExe,
        selector: "SelectedProject",
        launchUnity: async () => child,
        waitForUnityTarget: async (options: any) => {
          expect(options.selector).toBe("SelectedProject");
          return {
            timedOut: false,
            elapsedMs: 10,
            editors: [firstEditor, selectedEditor],
            target: selectedEditor,
          };
        },
        runUnitySmoke: async (target: any) => {
          smokedTarget = target;
          return { ok: true, projectPath: target.projectPath };
        },
        collectDoctorReport: async () => ({ registry: { entries: [] } }),
        cleanStaleRegistryEntries: async () => ({ removed: 0 }),
      });

      expect(smokedTarget.instanceId).toBe("selected-editor");
      expect(smokedTarget.projectPath).toBe(projectDir);
      expect(result.smoke.projectPath).toBe(projectDir);
      expect(child.killed).toBe(true);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

function sampleEditors() {
  return [
    {
      instanceId: "alpha-id",
      projectName: "AlphaGame",
      projectPath: "D:/Unity/AlphaGame",
      host: "127.0.0.1",
      port: 19001,
      token: "alpha-token",
    },
    {
      instanceId: "bravo-id",
      projectName: "BravoGame",
      projectPath: "D:/Unity/Bravo",
      host: "127.0.0.1",
      port: 19002,
      token: "bravo-token",
    },
  ];
}

function liveTarget(projectPath = "D:/Unity/LiveProject") {
  return {
    instanceId: "live",
    projectName: "LiveProject",
    projectPath,
    host: "127.0.0.1",
    port,
    token: "good-token",
  };
}

function mvpAcceptanceGateFixtures() {
  return [
    { id: "consumer-install-and-runtime" },
    { id: "ready-and-context" },
    { id: "public-mvp-preflight" },
    { id: "entry-dry-run" },
    { id: "real-ai-edit" },
    { id: "follow-up-edit" },
  ];
}

function mvpCommandLineFixtures(selector = "D:/Unity/LiveProject", suffix = "", materialsDir?: string, files: string[] = []) {
  const extra = suffix.length > 0 ? " " + suffix : "";
  const materialArgs = [
    ...(materialsDir !== undefined ? [`--uos-materials ${materialsDir}`] : []),
    ...files.map((file) => `--uos-file ${file}`),
  ];
  const materials = materialArgs.length > 0 ? " " + materialArgs.join(" ") : "";
  return {
    doctorProject: `uos doctor --project ${selector}${extra}`,
    doctorRuntime: "uos doctor --runtime",
    ready: `uos ready --wait --unity-project ${selector}`,
    context: `uos context --unity-project ${selector}${materials}`,
    chatDryRun: `uos chat --unity-project ${selector}${materials} --uos-dry-run`,
    runDryRun: `uos --unity-project ${selector}${materials} --uos-dry-run run create lobby`,
    runAiEdit: `uos --unity-project ${selector}${materials} run create lobby${extra}`,
    chatContinue: `uos chat --unity-project ${selector} --continue`,
    publicMvpE2E: `uos e2e --project ${selector} --read-only --public-mvp-json${materials}`,
  };
}

function mvpPreflightSummaryFixture(projectPath = "D:/Unity/LiveProject") {
  const commandLineKeys = [
    "doctorProject",
    "doctorRuntime",
    "ready",
    "context",
    "chatDryRun",
    "runDryRun",
    "runAiEdit",
    "chatContinue",
    "publicMvpE2E",
  ];
  const acceptanceGateIds = mvpAcceptanceGateFixtures().map((gate) => gate.id);
  return {
    status: "ready-for-user-validation",
    next: "run-user-led-mvp-gates",
    selectedProject: true,
    materialReady: true,
    aiSessionReady: true,
    bridgeTools: { required: 17, available: 17, missing: [] },
    bridgeWriteTools: { required: 12, available: 12, missing: [] },
    commandLines: {
      required: commandLineKeys,
      present: commandLineKeys,
      missing: [],
    },
    acceptanceGates: {
      count: 6,
      ids: acceptanceGateIds,
      pendingUserEvidence: acceptanceGateIds,
      optionalUserEvidence: [],
      blockedByPreflight: [],
    },
    projectPath,
  };
}

function minimalOkResources() {
  return {
    config: { ok: true, path: "D:/UOS/opencode.json" },
    defaultAgent: { ok: true, name: "ochestrator" },
    tools: { count: 48, missing: [] },
    plugins: [],
    autoPlugin: { ok: true, path: "D:/UOS/.opencode/plugins/uos.ts" },
    duplicateLocalPlugins: [],
  };
}

class FakeChildProcess extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill() {
    this.killed = true;
    setTimeout(() => {
      this.exitCode = 0;
      this.emit("exit", 0, null);
    }, 0);
    return true;
  }
}

const smokeSceneObjects = new Map<string, any>();

function toolResult(msg: { id: number; tool: string; args?: any }) {
  switch (msg.tool) {
    case "get_project_info":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          projectName: "LiveProject",
          projectPath: "D:/Unity/LiveProject",
          unityVersion: "6000.0.68f1",
          uosPackageName: "com.lyx.oh-my-unity",
          uosPackageVersion: "0.1.0",
          protocolVersion: "1.0.0",
          bridgeHost: "127.0.0.1",
          bridgePort: port,
          autoStartBridge: true,
          editorInstanceId: "live",
          supportedTools: [
            "get_project_info",
            "list_screens",
            "get_scene_hierarchy",
            "capture_preview",
            "list_scene_objects",
            "create_ui_screen",
            "add_ui_element",
            "update_ui_element",
            "move_ui_element",
            "delete_ui_element",
            "create_screen_transition",
            "set_active_screen",
            "save_scene",
            "import_asset",
            "create_scene_object",
            "update_scene_object",
            "delete_scene_object",
          ],
          writeTools: [
            "add_ui_element",
            "create_scene_object",
            "create_screen_transition",
            "create_ui_screen",
            "delete_scene_object",
            "delete_ui_element",
            "import_asset",
            "move_ui_element",
            "save_scene",
            "set_active_screen",
            "update_scene_object",
            "update_ui_element",
          ],
        },
      };
    case "list_screens":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          activeScreenId: "ExistingScreen_ID",
          screens: [{ id: "ExistingScreen_ID", name: "Existing Screen", active: true }],
        },
      };
    case "create_ui_screen":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          screenId: `${msg.args.intent.screenName}_ID`,
          elements: msg.args.intent.elements.map((element: any, index: number) => ({
            clientHintId: element.clientHintId,
            elementId: `Element_${index + 1}`,
          })),
        },
      };
    case "import_asset":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          sourcePath: msg.args.sourcePath,
          assetPath: msg.args.assetPath ?? "Assets/UOS/Imported/logo.png",
          importedAsSprite: msg.args.importAsSprite !== false,
          assetType: msg.args.importAsSprite === false ? "Texture2D" : "Sprite",
        },
      };
    case "capture_preview":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          path: `C:/tmp/${msg.args.screenId}.png`,
          mimeType: "image/png",
          width: 1920,
          height: 1080,
          base64Data: "a".repeat(12000),
          size: 123,
        },
      };
    case "get_scene_hierarchy":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          screenId: msg.args.screenId,
          nodes: [
            { elementId: msg.args.screenId, type: "Canvas" },
            { elementId: "Element_1", type: "Panel" },
            { elementId: "Element_2", type: "Text" },
          ],
        },
      };
    case "create_scene_object": {
      const objectId = "SceneObject_Smoke";
      const object = {
        objectId,
        name: msg.args.name ?? "UOS Smoke Object",
        type: msg.args.type ?? "Cube",
        path: msg.args.name ?? "UOS Smoke Object",
        parentObjectId: "",
        active: msg.args.active !== false,
        transform: msg.args.transform ?? {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        components: ["Transform", "SceneObjectId"],
      };
      smokeSceneObjects.set(objectId, object);
      return { kind: "result", id: msg.id, ok: true, data: object };
    }
    case "list_scene_objects":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: { objects: [...smokeSceneObjects.values()] },
      };
    case "update_scene_object": {
      const existing = smokeSceneObjects.get(msg.args.objectId);
      const object = {
        ...(existing ?? {
          objectId: msg.args.objectId,
          type: "Cube",
          components: ["Transform", "SceneObjectId"],
        }),
        name: msg.args.name ?? existing?.name,
        path: msg.args.name ?? existing?.path,
        parentObjectId: msg.args.parentId ?? existing?.parentObjectId ?? "",
        active: typeof msg.args.active === "boolean" ? msg.args.active : existing?.active,
        transform: msg.args.transform ?? existing?.transform,
      };
      smokeSceneObjects.set(msg.args.objectId, object);
      return { kind: "result", id: msg.id, ok: true, data: object };
    }
    case "delete_scene_object":
      smokeSceneObjects.delete(msg.args.objectId);
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: { ok: true },
      };
    case "set_active_screen":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: { ok: true, screenId: msg.args.screenId, name: "Existing Screen", active: true },
      };
    case "update_ui_element":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: { ok: true },
      };
    case "add_ui_element":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          elementId: msg.args.element.clientHintId === "smokeDisposable"
            ? "Element_Disposable"
            : msg.args.element.clientHintId === "smokeContextBadge"
              ? "Element_ContextBadge"
              : "Element_Revision",
        },
      };
    case "move_ui_element":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: { ok: true },
      };
    case "delete_ui_element":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: { ok: true },
      };
    case "create_screen_transition":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          ok: true,
          fromId: msg.args.fromId,
          toId: msg.args.toId,
          trigger: msg.args.trigger,
        },
      };
    case "save_scene":
      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data: {
          ok: true,
          path: msg.args.path ?? "Assets/UOS_Generated.unity",
          sceneName: "UOS_Generated",
        },
      };
    default:
      return { kind: "result", id: msg.id, ok: false, error: `unknown tool ${msg.tool}` };
  }
}
