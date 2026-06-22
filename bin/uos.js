#!/usr/bin/env node
/**
 * uos - Unity Orchestration System launcher.
 *
 * Subcommands:
 *   uos setup     - link this repo's opencode agents/tools/plugins into the
 *                   global opencode config. See bin/uos-setup.js.
 *   uos install-unity
 *                 - add the UOS Unity package to a target Unity project's
 *                   Packages/manifest.json.
 *   uos doctor    - diagnose local dependencies, registry entries, and bridge
 *                   discovery state. Add --project <UnityProjectPath> to inspect
 *                   that project's UOS package manifest entry.
 *   uos ready     - run a runtime preflight and exit 0 only when an AI session
 *                   can start against a Unity Editor bridge.
 *   uos mvp       - print a read-only user-led MVP validation walkthrough for
 *                   one selected Unity Editor project and planning material.
 *   uos mvp-progress
 *                 - read a saved MVP evidence bundle and print validation
 *                   progress for the next user-led session.
 *   uos wait      - wait until at least one Unity Editor bridge, or a selected
 *                   bridge, is live in the local registry.
 *   uos projects  - list live Unity Editor bridges discovered on this machine.
 *                   Add --json for token-redacted machine-readable output.
 *   uos context   - print the selected project's launch/material/.uos context
 *                   without starting opencode or mutating Unity.
 *   uos smoke     - verify the selected Unity Editor bridge. Add --write,
 *                   --import, --screen-from-material, --context-follow-up,
 *                   --scene-object, --ai-run, --ai-only, --preview, --compare,
 *                   --verify, and --save to exercise a fuller path.
 *   uos e2e       - launch Unity batchmode, wait for the bridge, run smoke,
 *                   then stop Unity and clean stale registry entries. Add
 *                   --secondary-project to verify multi-Editor selection.
 *   uos <args>    - select a connected Unity Editor project, inject its bridge
 *                   connection env, then forward to opencode from the UOS root.
 *
 * UOS-only selector flags are stripped before forwarding:
 *   --unity-project <index|id|name|path>
 *   --uos-project <index|id|name|path>
 *   --uos-target <index|id|name|path>
 *   --uos-materials <planning-material-dir>
 *   --uos-materials-dir <planning-material-dir>
 *   --uos-file <planning-material-file>
 *   --uos-attach <planning-material-file>
 *   --uos-max-material-candidates <N>
 *   --uos-max-material-depth <N>
 *   --uos-max-material-scan-files <N>
 *   --uos-dry-run | --uos-preflight | --uos-print-launch
 *   uos setup --language <code|name>
 *
 * Context-only material scan flags include:
 *   --max-material-candidates <N>
 *   --max-material-depth <N>
 *   --max-material-scan-files <N>
 *
 * Smoke-only material flow flags include:
 *   --screen-from-material <file>
 *   --screen-from-first-material
 *   --pptx-deck <file> [--slides 1,2] [--max-slides N]
 *   --scene-object [--object-name Name] [--object-type Cube]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  buildContextReport,
  buildLaunchEnv,
  buildMvpValidationReport,
  buildForwardArgs,
  cleanupRunContextAttachment,
  evaluateLaunchBridgeCapabilities,
  evaluateReadiness,
  formatLaunchBridgeCapabilityFailure,
  formatLaunchDryRun,
  formatLaunchSummary,
  formatMvpValidationJson,
  formatMvpValidationReport,
  formatMvpProgressJson,
  formatMvpProgressReport,
  formatE2EResult,
  formatWaitResult,
  formatReadyReport,
  cleanStaleRegistryEntries,
  collectDoctorReport,
  discoverLiveEditors,
  discoverUnityProjectCatalog,
  formatDoctorReport,
  formatEditorList,
  formatEditorJson,
  formatUnityProjectCatalog,
  formatInstallUnityPackageResult,
  formatUosHelp,
  formatContextJson,
  formatContextReport,
  formatSmokeResult,
  installUnityPackage,
  parseUosArgs,
  parseDoctorOptions,
  parseE2EOptions,
  parseInstallUnityOptions,
  normalizeUosEntryArgs,
  parseContextOptions,
  parseMvpOptions,
  parseMvpProgressOptions,
  parseProjectsOptions,
  parseReadyOptions,
  parseSmokeOptions,
  parseUosHelpTopic,
  parseWaitOptions,
  prepareRunContextAttachment,
  saveMvpValidationReport,
  loadMvpEvidenceBundle,
  validateLaunchInputs,
  runUnityE2E,
  runUnitySmoke,
  selectUnityProjectCatalogEntry,
  selectUnityTarget,
  shouldSelectUnityContextTarget,
  shouldPrepareLaunchContext,
  shouldPrepareRunContextAttachment,
  shouldPrintLaunchSummary,
  shouldSelectUnityTarget,
  uninstallUnityPackage,
  waitForUnityTarget,
} from "./uos-core.js";
import { planKioskStructure, formatKioskPlanOutline, parseKioskPlanOptions } from "./kiosk-core.js";

const rawArgs = process.argv.slice(2);
const args = normalizeUosEntryArgs(rawArgs);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const helpTopic = parseUosHelpTopic(rawArgs);

if (helpTopic !== undefined) {
  console.log(formatUosHelp(helpTopic));
} else if (args[0] === "setup") {
  try {
    const { parseSetupOptions, runSetup } = await import("./uos-setup.js");
    await runSetup(parseSetupOptions(args.slice(1)));
  } catch (err) {
    console.error("[uos setup] failed:", err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  }
} else if (args[0] === "install-unity" || args[0] === "install-package") {
  let installOptions;
  try {
    installOptions = parseInstallUnityOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  try {
    const result = await installUnityPackage({
      ...installOptions,
      repoRoot,
    });
    console.log(formatInstallUnityPackageResult(result));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else if (args[0] === "doctor") {
  let doctorOptions;
  try {
    doctorOptions = parseDoctorOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  let report = await collectDoctorReport({
    repoRoot,
    runtime: doctorOptions.runtime,
    runtimeTimeoutMs: doctorOptions.runtimeTimeoutMs,
    projectPath: doctorOptions.projectPath,
    bridgeCapabilities: true,
  });
  if (doctorOptions.cleanStale) {
    const cleaned = await cleanStaleRegistryEntries(report);
    console.log(`[uos doctor] removed stale registry entries: ${cleaned.removed}`);
    report = await collectDoctorReport({
      repoRoot,
      runtime: doctorOptions.runtime,
      runtimeTimeoutMs: doctorOptions.runtimeTimeoutMs,
      projectPath: doctorOptions.projectPath,
      bridgeCapabilities: true,
    });
  }
  console.log(formatDoctorReport(report));
} else if (args[0] === "projects" || args[0] === "list") {
  let projectsOptions;
  try {
    projectsOptions = parseProjectsOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const editors = await discoverLiveEditors();
  console.log(projectsOptions.json ? formatEditorJson(editors) : formatEditorList(editors));
} else if (args[0] === "context" || args[0] === "ctx") {
  let contextOptions;
  try {
    contextOptions = parseContextOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  let target;
  const needsTarget = shouldSelectUnityContextTarget(contextOptions.selector, process.env);
  try {
    target = needsTarget ? await selectUnityTarget({ selector: contextOptions.selector }) : undefined;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (needsTarget && target === undefined) process.exit(1);

  let launchInputs;
  try {
    launchInputs = await validateLaunchInputs(target, {
      materialsDir: contextOptions.materialsDir,
      files: contextOptions.files,
      env: process.env,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const report = await buildContextReport(target, {
    materialsDir: contextOptions.materialsDir,
    files: contextOptions.files,
    launchInputs,
    env: process.env,
    bridgeCapabilities: true,
    maxChars: contextOptions.maxChars,
    maxMaterialCandidates: contextOptions.maxMaterialCandidates,
    maxMaterialDepth: contextOptions.maxMaterialDepth,
    maxMaterialScanFiles: contextOptions.maxMaterialScanFiles,
  });
  console.log(contextOptions.json ? formatContextJson(report) : formatContextReport(report));
} else if (args[0] === "e2e") {
  let e2eOptions;
  try {
    e2eOptions = parseE2EOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  try {
    const result = await runUnityE2E({
      ...e2eOptions,
      repoRoot,
    });
    console.log(formatE2EResult(result));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else if (args[0] === "wait") {
  let waitOptions;
  try {
    waitOptions = parseWaitOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const result = await waitForUnityTarget(waitOptions);
  if (waitOptions.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatWaitResult(result));
  }
  process.exit(result.timedOut ? 1 : 0);
} else if (args[0] === "ready") {
  let readyOptions;
  try {
    readyOptions = parseReadyOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (readyOptions.wait) {
    const waitResult = await waitForUnityTarget({
      selector: readyOptions.waitSelector,
      timeoutMs: readyOptions.waitTimeoutMs,
      intervalMs: readyOptions.waitIntervalMs,
    });
    console.log(formatWaitResult(waitResult));
    if (waitResult.timedOut) process.exit(1);
  }
  const readyEnv = readyOptions.waitSelector !== undefined
    ? { ...process.env, UOS_UNITY_PROJECT: readyOptions.waitSelector }
    : process.env;
  let report = await collectDoctorReport({
    repoRoot,
    env: readyEnv,
    runtime: true,
    runtimeTimeoutMs: readyOptions.runtimeTimeoutMs,
    bridgeCapabilities: true,
  });
  if (readyOptions.cleanStale) {
    const cleaned = await cleanStaleRegistryEntries(report);
    console.log(`[uos ready] removed stale registry entries: ${cleaned.removed}`);
    report = await collectDoctorReport({
      repoRoot,
      env: readyEnv,
      runtime: true,
      runtimeTimeoutMs: readyOptions.runtimeTimeoutMs,
      bridgeCapabilities: true,
    });
  }
  const readiness = evaluateReadiness(report);
  console.log(formatReadyReport(report, readiness));
  process.exit(readiness.ready ? 0 : 1);
} else if (args[0] === "mvp-progress" || args[0] === "mvp-status" || args[0] === "mvp-evidence") {
  let progressOptions;
  try {
    progressOptions = parseMvpProgressOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  try {
    const bundle = await loadMvpEvidenceBundle(progressOptions.evidencePath);
    console.log(progressOptions.json ? formatMvpProgressJson(bundle) : formatMvpProgressReport(bundle));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else if (args[0] === "mvp" || args[0] === "validate-mvp" || args[0] === "mvp-check") {
  let mvpOptions;
  try {
    mvpOptions = parseMvpOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  let target;
  try {
    if (mvpOptions.wait) {
      const waitResult = await waitForUnityTarget({
        selector: mvpOptions.selector,
        timeoutMs: mvpOptions.waitTimeoutMs,
        intervalMs: mvpOptions.waitIntervalMs,
      });
      if (waitResult.timedOut) {
        console.log(formatWaitResult(waitResult));
        process.exit(1);
      }
      target = waitResult.target;
    }
    if (target === undefined) {
      target = await selectUnityTarget({ selector: mvpOptions.selector });
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (target === undefined) process.exit(1);

  try {
    const report = await buildMvpValidationReport(target, {
      ...mvpOptions,
      env: process.env,
    });
    const savedPath = mvpOptions.savePath !== undefined
      ? await saveMvpValidationReport(report, mvpOptions.savePath)
      : undefined;
    console.log(mvpOptions.json ? formatMvpValidationJson(report) : formatMvpValidationReport(report));
    if (savedPath !== undefined) {
      if (!mvpOptions.json) {
        console.log("");
        console.log(`[uos mvp] saved evidence bundle: ${savedPath}`);
      }
    }
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
} else if (args[0] === "smoke") {
  let parsed;
  let smokeOptions;
  try {
    parsed = parseUosArgs(args.slice(1));
    smokeOptions = parseSmokeOptions(parsed.opencodeArgs);
    if (
      parsed.materialsDir !== undefined
      && smokeOptions.materialsDir === undefined
      && smokeOptions.importPath === undefined
    ) {
      smokeOptions.materialsDir = parsed.materialsDir;
      smokeOptions.write = true;
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  let target;
  try {
    await waitForLaunchTargetIfRequested(parsed);
    target = await selectUnityTarget({ selector: parsed.selector });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (target === undefined) process.exit(1);

  try {
    const result = await runUnitySmoke(target, smokeOptions);
    console.log(formatSmokeResult(result));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else if (args[0] === "kiosk-plan" || args[0] === "kiosk") {
  let kioskOptions;
  try {
    kioskOptions = parseKioskPlanOptions(args.slice(1));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  if (kioskOptions.dir === undefined) {
    console.error(
      "usage: uos kiosk-plan <ref-folder> [--json] [--no-back] [--no-home] [--linear] [--max-depth N] [--back-label L] [--home-label L]",
    );
    process.exit(2);
  }
  try {
    const plan = await planKioskStructure(kioskOptions.dir, kioskOptions);
    console.log(kioskOptions.json ? JSON.stringify(plan, null, 2) : formatKioskPlanOutline(plan));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else {
  let parsed;
  try {
    parsed = parseUosArgs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  let target;
  let launchBaseEnv = process.env;
  let allowMissingBridge = false;
  let catalogProject = shouldOpenUnityProjectCatalog(args, process.env)
    ? await promptUnityProjectCatalogSelection({ repoRoot })
    : undefined;

  if (shouldOpenUnityProjectCatalog(args, process.env) && catalogProject === undefined) {
    process.exit(1);
  }

  if (catalogProject !== undefined) {
    try {
      catalogProject = await ensureCatalogProjectInstalledForEntry(catalogProject, { repoRoot });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    launchBaseEnv = buildCatalogProjectEnv(catalogProject, process.env);
    allowMissingBridge = true;
    if (catalogProject.bridge?.live === true) {
      try {
        target = await selectUnityTarget({ selector: catalogProject.projectPath });
      } catch (err) {
        console.error(`[uos] selected project's bridge is no longer live; opening project context without a bridge: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    const needsTarget = shouldSelectUnityTarget(parsed.opencodeArgs, process.env, {
      selector: parsed.selector,
    });
    try {
      if (needsTarget) await waitForLaunchTargetIfRequested(parsed);
      target = needsTarget ? await selectUnityTarget({ selector: parsed.selector }) : undefined;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }

    if (needsTarget && target === undefined && process.env.UOS_ALLOW_NO_TARGET !== "1") {
      process.exit(1);
    }
  }

  const prepareLaunchContext = shouldPrepareLaunchContext(parsed.opencodeArgs);
  let launchInputs;
  try {
    launchInputs = prepareLaunchContext
      ? await validateLaunchInputs(target, {
          materialsDir: parsed.materialsDir,
          files: parsed.files,
          env: launchBaseEnv,
        })
      : { materialsDir: undefined, files: [] };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const launchEnv = prepareLaunchContext
    ? await buildLaunchEnv(target, launchBaseEnv, {
        materialsDir: parsed.materialsDir,
        files: parsed.files,
        launchInputs,
        env: launchBaseEnv,
        bridgeCapabilities: true,
        maxMaterialCandidates: parsed.maxMaterialCandidates,
        maxMaterialDepth: parsed.maxMaterialDepth,
        maxMaterialScanFiles: parsed.maxMaterialScanFiles,
      })
    : { ...launchBaseEnv };
  const launchBridgeReadiness = evaluateLaunchBridgeCapabilities(launchEnv);
  if (prepareLaunchContext && !parsed.dryRun && !allowMissingBridge && !launchBridgeReadiness.ready) {
    console.error(formatLaunchBridgeCapabilityFailure(launchBridgeReadiness));
    process.exit(2);
  }
  let runContextAttachment;
  try {
    if (prepareLaunchContext && shouldPrepareRunContextAttachment(parsed.opencodeArgs)) {
      runContextAttachment = await prepareRunContextAttachment(launchEnv.UOS_CONTEXT_SUMMARY, target, {
        repoRoot,
        launchInputs,
        env: launchEnv,
      });
    }
  } catch (err) {
    console.error(`[uos] failed to prepare launch context attachment: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const opencodeArgs = buildForwardArgs(parsed.opencodeArgs, target, {
    materialsDir: parsed.materialsDir,
    files: parsed.files,
    launchInputs,
    env: launchEnv,
    contextFiles: runContextAttachment?.file,
  });
  if (parsed.dryRun) {
    console.log(formatLaunchDryRun(target, opencodeArgs, launchEnv, launchInputs));
    await cleanupLaunchContextAttachment(runContextAttachment);
    process.exit(0);
  }
  if (process.env.UOS_LAUNCH_SUMMARY !== "0" && shouldPrintLaunchSummary(parsed.opencodeArgs)) {
    console.error(formatLaunchSummary(target, opencodeArgs, launchInputs, launchBridgeReadiness, launchEnv));
  }
  let result;
  try {
    // Spawn opencode's real executable directly (no nested shell) so the
    // interactive TUI gets a proper raw-mode console. Falls back to the legacy
    // shell launch if the executable can't be resolved.
    const opencodeSpawn = resolveOpencodeSpawn();
    result = opencodeSpawn !== null
      ? spawnSync(opencodeSpawn.command, [...opencodeSpawn.leadingArgs, ...opencodeArgs], {
          stdio: "inherit",
          shell: false,
          cwd: repoRoot,
          env: launchEnv,
        })
      : spawnSync("opencode", opencodeArgs, {
          stdio: "inherit",
          shell: true,
          cwd: repoRoot,
          env: launchEnv,
        });
  } finally {
    await cleanupLaunchContextAttachment(runContextAttachment);
  }
  if (result.error !== undefined) {
    console.error(`[uos] failed to start opencode: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

async function cleanupLaunchContextAttachment(attachment) {
  try {
    await cleanupRunContextAttachment(attachment);
  } catch (err) {
    console.error(`[uos] warning: failed to remove launch context attachment: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function shouldOpenUnityProjectCatalog(argv, env = process.env) {
  return Array.isArray(argv)
    && argv.length === 0
    && env.UOS_SKIP_PROJECT_CATALOG !== "1";
}

async function promptUnityProjectCatalogSelection(options = {}) {
  let catalog = await loadUnityProjectCatalog(options);

  if (!Array.isArray(catalog.projects) || catalog.projects.length === 0) {
    console.log(formatUnityProjectCatalog(catalog));
    return undefined;
  }
  if (!process.stdin.isTTY) {
    console.log(formatUnityProjectCatalog(catalog));
    console.error("[uos] project selection requires an interactive terminal.");
    return undefined;
  }
  if (typeof process.stdin.setRawMode === "function" && process.env.UOS_SIMPLE_PROJECT_SELECT !== "1") {
    return promptUnityProjectCatalogTui(catalog, options);
  }
  console.log(formatUnityProjectCatalog(catalog));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    while (true) {
      const answer = (await rl.question("[uos] project> ")).trim();
      if (answer.toLowerCase() === "q" || answer.toLowerCase() === "quit" || answer.toLowerCase() === "exit") {
        return undefined;
      }
      const action = parseCatalogPromptAction(answer);
      if (action !== undefined) {
        try {
          const project = selectUnityProjectCatalogEntry(catalog, action.selector);
          const message = await runCatalogProjectAction(project, action.action, options);
          catalog = await loadUnityProjectCatalog(options);
          console.log(message);
          console.log(formatUnityProjectCatalog(catalog));
        } catch (err) {
          console.error(err instanceof Error ? err.message : String(err));
        }
        continue;
      }
      try {
        return selectUnityProjectCatalogEntry(catalog, answer);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    rl.close();
  }
}

async function loadUnityProjectCatalog(options = {}) {
  try {
    return await discoverUnityProjectCatalog({ repoRoot: options.repoRoot ?? repoRoot });
  } catch (err) {
    console.error(`[uos] failed to discover configured Unity projects: ${err instanceof Error ? err.message : String(err)}`);
    return { count: 0, projects: [] };
  }
}

async function promptUnityProjectCatalogTui(initialCatalog, options = {}) {
  let catalog = initialCatalog;
  let selectedIndex = 0;
  let message = "Up/Down select, Enter opens, c links/updates UOS, d unlinks UOS, q quits.";
  let rowRegions = [];
  let busy = false;
  const stdin = process.stdin;
  const stdout = process.stdout;

  const render = () => {
    const rendered = renderUnityProjectCatalogTui(catalog, selectedIndex, message, {
      columns: stdout.columns,
    });
    rowRegions = rendered.rowRegions;
    stdout.write("\x1b[2J\x1b[H");
    stdout.write(rendered.text);
  };

  return await new Promise((resolve) => {
    const finish = (project) => {
      cleanup();
      stdout.write("\n");
      resolve(project);
    };
    const refresh = async (nextMessage) => {
      catalog = await loadUnityProjectCatalog(options);
      const count = catalog.projects.length;
      selectedIndex = count === 0 ? 0 : Math.min(selectedIndex, count - 1);
      message = nextMessage;
      render();
    };
    const runAction = async (action, project = catalog.projects[selectedIndex]) => {
      if (busy || project === undefined) return;
      busy = true;
      message = `${action === "connect" ? "Linking UOS to" : "Unlinking UOS from"} ${project.projectName}...`;
      render();
      try {
        const nextMessage = await runCatalogProjectAction(project, action, options);
        await refresh(nextMessage);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
        render();
      } finally {
        busy = false;
      }
    };
    const onKeypress = async (_str, key = {}) => {
      if (busy) return;
      const count = catalog.projects.length;
      if (key.name === "q" || (key.ctrl === true && key.name === "c")) {
        cleanup();
        stdout.write("\n");
        resolve(undefined);
        return;
      }
      if (key.name === "up") {
        selectedIndex = count === 0 ? 0 : (selectedIndex + count - 1) % count;
        render();
        return;
      }
      if (key.name === "down") {
        selectedIndex = count === 0 ? 0 : (selectedIndex + 1) % count;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(catalog.projects[selectedIndex]);
        return;
      }
      if (key.name === "c") {
        await runAction("connect");
        return;
      }
      if (key.name === "d") {
        await runAction("disconnect");
      }
    };
    const onData = async (chunk) => {
      if (busy) return;
      const mouse = decodeSgrMouseEvent(chunk);
      if (mouse === undefined || mouse.type !== "press") return;
      const hit = rowRegions.find((region) => region.y === mouse.y);
      if (hit === undefined) return;
      selectedIndex = hit.index;
      render();
      if (mouse.x >= hit.actionStart && mouse.x <= hit.actionEnd) {
        const project = catalog.projects[selectedIndex];
        await runAction(project?.uos?.installed === true ? "disconnect" : "connect", project);
        return;
      }
      finish(catalog.projects[selectedIndex]);
    };
    const cleanup = () => {
      stdin.off("keypress", onKeypress);
      stdin.off("data", onData);
      stdout.write("\x1b[?1000l\x1b[?1006l");
      stdin.setRawMode(false);
      stdin.pause();
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1b[?1000h\x1b[?1006h");
    stdin.on("keypress", onKeypress);
    stdin.on("data", onData);
    render();
  });
}

function renderUnityProjectCatalogTui(catalog, selectedIndex, message, options = {}) {
  const projects = Array.isArray(catalog.projects) ? catalog.projects : [];
  const rowRegions = [];
  const width = Math.max(84, Math.min(140, Number.parseInt(String(options.columns ?? 100), 10) || 100));
  const nameWidth = Math.max(20, Math.min(38, width - 74));
  const lines = [
    "UOS Project Launcher",
    "Select a Unity project to edit with AI.",
    message,
    "Enter opens the selected project. If UOS is not linked, UOS installs first.",
    "Mouse: click a row to open it, or click Action to link/unlink UOS.",
    "",
  ].filter((line) => line !== undefined && line !== "");
  if (projects.length === 0) {
    lines.push("No Unity projects found. Run `uos setup --unity-projects <dir>` first.");
    return { text: `${lines.join("\n")}\n`, rowRegions };
  }
  lines.push([
    " ",
    padTuiCell("#", 3, "left"),
    padTuiCell("Status", 13),
    padTuiCell("UOS", 12),
    padTuiCell("Editor", 8),
    padTuiCell("Project", nameWidth),
    padTuiCell("Unity", 12),
    "Action",
  ].join(" "));
  lines.push("-".repeat(Math.min(width, 118)));
  projects.forEach((project, index) => {
    const selected = index === selectedIndex ? ">" : " ";
    const action = project.uos?.installed === true ? "Remove UOS" : "Link UOS";
    const row = lines.length + 1;
    const rowText = [
      selected,
      padTuiCell(String(index + 1), 3, "left"),
      padTuiCell(tuiStatusLabel(project.status), 13),
      padTuiCell(tuiUosLabel(project.uos), 12),
      padTuiCell(project.bridge?.live === true ? "Open" : "Closed", 8),
      padTuiCell(project.projectName ?? "(unnamed)", nameWidth),
      padTuiCell(project.unityVersion ?? "-", 12),
      action,
    ].join(" ");
    const actionStart = rowText.lastIndexOf(action) + 1;
    rowRegions.push({ y: row, index, actionStart, actionEnd: actionStart + action.length - 1 });
    lines.push(rowText);
  });
  const selected = projects[selectedIndex];
  if (selected !== undefined) {
    lines.push("", "Selected");
    lines.push(`  Project: ${selected.projectName ?? "(unnamed)"} (${selected.unityVersion ?? "unknown Unity"})`);
    lines.push(`  Path: ${selected.projectPath ?? "(unknown path)"}`);
    lines.push(`  Status: ${tuiStatusLabel(selected.status)} - ${tuiStatusDetail(selected.status)}`);
    lines.push(`  UOS: ${tuiUosLabel(selected.uos)} | Unity Editor: ${selected.bridge?.live === true ? "Open" : "Closed"}`);
    lines.push(`  Enter: ${selected.uos?.installed === true ? "open opencode for this project" : "install UOS package, then open opencode"}`);
  }
  lines.push("", "Keys: Up/Down move | Enter open | c link/update UOS | d unlink UOS | q quit");
  return { text: `${lines.join("\n")}\n`, rowRegions };
}

function tuiStatusLabel(status) {
  switch (status) {
    case "connected": return "Ready";
    case "installed": return "Open Unity";
    case "not-installed": return "Install UOS";
    case "needs-attention": return "Check UOS";
    case "live-needs-attention": return "Bridge Issue";
    default: return "Unknown";
  }
}

function tuiStatusDetail(status) {
  switch (status) {
    case "connected": return "UOS is linked and the Unity Editor bridge is live.";
    case "installed": return "UOS is linked; open Unity and start the bridge before editing.";
    case "not-installed": return "UOS will be installed into this project before entry.";
    case "needs-attention": return "UOS is present but the install needs repair.";
    case "live-needs-attention": return "Unity is open, but the UOS install or bridge metadata needs repair.";
    default: return "Project state could not be determined.";
  }
}

function tuiUosLabel(uos = {}) {
  if (uos.installed !== true) return "Not linked";
  if (uos.ok === true) {
    if (uos.installKind === "embedded") return "Embedded";
    return "Linked";
  }
  return "Check";
}

function padTuiCell(value, width, align = "right") {
  const text = fitTuiCell(value, width);
  return align === "left" ? text.padStart(width) : text.padEnd(width);
}

function fitTuiCell(value, width) {
  const text = String(value ?? "");
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function decodeSgrMouseEvent(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
  const match = text.match(/\x1b\[<(\d+);(\d+);(\d+)([mM])/);
  if (match === null) return undefined;
  const button = Number.parseInt(match[1], 10);
  return {
    button,
    x: Number.parseInt(match[2], 10),
    y: Number.parseInt(match[3], 10),
    type: match[4] === "M" ? "press" : "release",
  };
}

function parseCatalogPromptAction(answer) {
  const match = answer.match(/^(c|connect|d|disconnect)\s+(.+)$/i);
  if (match === null) return undefined;
  return {
    action: match[1].toLowerCase().startsWith("d") ? "disconnect" : "connect",
    selector: match[2],
  };
}

async function runCatalogProjectAction(project, action, options = {}) {
  if (project?.projectPath === undefined) throw new Error("[uos] selected project has no path");
  if (action === "disconnect") {
    const result = await uninstallUnityPackage({
      projectPath: project.projectPath,
      repoRoot: options.repoRoot ?? repoRoot,
    });
    return result.changed
      ? `[uos] unlinked UOS from ${project.projectName}`
      : `[uos] UOS was already unlinked from ${project.projectName}`;
  }
  const result = await installUnityPackage({
    projectPath: project.projectPath,
    repoRoot: options.repoRoot ?? repoRoot,
  });
  return result.changed
    ? `[uos] linked UOS to ${project.projectName}`
    : `[uos] UOS was already linked to ${project.projectName}`;
}

async function ensureCatalogProjectInstalledForEntry(project, options = {}) {
  if (project?.projectPath === undefined) throw new Error("[uos] selected project has no path");
  if (project.uos?.installed === true) return project;

  const name = project.projectName ?? project.projectPath;
  console.error(`[uos] ${name} is not linked to UOS. Installing UOS package before entry...`);
  const result = await installUnityPackage({
    projectPath: project.projectPath,
    repoRoot: options.repoRoot ?? repoRoot,
  });
  console.error(result.changed
    ? `[uos] installed UOS package in ${name}.`
    : `[uos] UOS package was already configured in ${name}.`);

  const refreshed = await loadUnityProjectCatalog(options);
  try {
    return selectUnityProjectCatalogEntry(refreshed, project.projectPath);
  } catch {
    return {
      ...project,
      status: result.installCheck?.ok === true ? "installed" : "needs-attention",
      uos: {
        ...project.uos,
        status: result.installCheck?.ok === true ? "installed" : "needs-attention",
        ok: result.installCheck?.ok === true,
        installed: result.installCheck?.installed === true,
        installKind: result.installCheck?.installKind,
      },
    };
  }
}

function buildCatalogProjectEnv(project, baseEnv = process.env) {
  const env = { ...baseEnv };
  env.UOS_PROJECT_DIR = project.projectPath ?? "";
  env.UOS_PROJECT_NAME = project.projectName ?? "";
  env.UOS_CONTEXT_DIR = project.projectPath ? join(project.projectPath, ".uos") : "";
  env.UOS_PROJECT_CATALOG_STATUS = project.status ?? "";
  env.UOS_PROJECT_UOS_INSTALLED = project.uos?.installed === true ? "1" : "0";
  env.UOS_PROJECT_BRIDGE_LIVE = project.bridge?.live === true ? "1" : "0";
  if (!env.UNITY_MCP_MATERIALS_DIR && project.projectPath) {
    env.UNITY_MCP_MATERIALS_DIR = project.projectPath;
  }
  if (project.bridge?.live !== true) {
    delete env.UNITY_MCP_HOST;
    delete env.UNITY_MCP_PORT;
    delete env.UNITY_MCP_TOKEN;
    delete env.UOS_EDITOR_INSTANCE_ID;
    delete env.UOS_BRIDGE_SUPPORTED_TOOLS;
    delete env.UOS_BRIDGE_WRITE_TOOLS;
    delete env.UOS_BRIDGE_CAPABILITY_ERROR;
  }
  return env;
}

async function waitForLaunchTargetIfRequested(parsed) {
  if (parsed?.wait !== true) return;
  const waitResult = await waitForUnityTarget({
    selector: parsed.selector,
    timeoutMs: parsed.waitTimeoutMs,
    intervalMs: parsed.waitIntervalMs,
  });
  console.error(formatWaitResult(waitResult));
  if (waitResult.timedOut) process.exit(1);
}

// Resolve opencode's real executable so it can be spawned WITHOUT a nested shell.
// On Windows, `opencode` on PATH is a .cmd shim; launching it via shell:true wraps
// it in an extra `cmd /c`, which breaks the interactive TUI's raw-mode console
// (while the non-interactive `run` path survives). Reading the shim lets us spawn
// the underlying program directly with the console inherited. Returns
// { command, leadingArgs } for a shell-free spawn, or null to fall back.
function resolveOpencodeSpawn() {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    const found = spawnSync(finder, ["opencode"], { encoding: "utf8" });
    if (found.status !== 0 || typeof found.stdout !== "string") return null;
    const paths = found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (process.platform !== "win32") {
      return paths[0] ? { command: paths[0], leadingArgs: [] } : null;
    }
    // Prefer a real executable already on PATH.
    const exeOnPath = paths.find((p) => p.toLowerCase().endsWith(".exe"));
    if (exeOnPath && existsSync(exeOnPath)) return { command: exeOnPath, leadingArgs: [] };
    // Otherwise read the .cmd shim and resolve the program it launches.
    const shimPath = paths.find((p) => p.toLowerCase().endsWith(".cmd"));
    if (shimPath === undefined || !existsSync(shimPath)) return null;
    const shim = readFileSync(shimPath, "utf8");
    const match = shim.match(/%~?dp0%?[\\/]+([^"\r\n]+?\.(?:exe|mjs|cjs|js))/i);
    if (match === null) return null;
    const target = join(dirname(shimPath), match[1].replace(/[\\/]+/g, sep));
    if (!existsSync(target)) return null;
    return target.toLowerCase().endsWith(".exe")
      ? { command: target, leadingArgs: [] }
      : { command: process.execPath, leadingArgs: [target] };
  } catch {
    return null;
  }
}
