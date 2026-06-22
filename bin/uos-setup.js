#!/usr/bin/env node
/**
 * uos setup - make opencode see UOS resources from any directory.
 *
 * opencode auto-discovers agents/tools/plugins from $XDG_CONFIG_HOME/opencode/
 * (usually ~/.config/opencode/). This script links this repo's
 * .opencode/{agents,tools,plugins}/ into that global path so this repo remains
 * the single source of truth while direct opencode launches can still see UOS.
 *
 * Why links, not copies:
 *   - Live edits in this repo are picked up immediately.
 *   - Windows uses a junction so setup does not require admin privileges.
 *   - POSIX uses a regular directory symlink.
 *
 * Side effect: ~/.config/opencode/opencode.jsonc is rewritten from this repo's
 * opencode.json. Agents/tools/plugins are discovered from the linked folders,
 * so local file plugins should not also be listed explicitly in opencode.json.
 * Any existing global config is moved to opencode.jsonc.bak-<timestamp>.
 * Existing global resource directories are also backed up before replacing them
 * with links.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { saveResponseLanguage, saveUnityProjectRoots } from "./uos-config-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, "..");

export const SYNCED_DIRS = ["agents", "tools", "plugins"];
export const SYNCED_FILES = ["bridge-capabilities.json"];

export function parseSetupOptions(argv = []) {
  const options = {
    unityProjectRoots: [],
    installDependencies: true,
    responseLanguage: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    if (
      key === "--unity-projects"
      || key === "--unity-project-root"
      || key === "--unity-root"
      || key === "--project-root"
    ) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos setup] ${key} requires a folder path`);
      }
      options.unityProjectRoots.push(value.trim());
      continue;
    }
    if (key === "--no-install-dependencies") {
      options.installDependencies = false;
      continue;
    }
    if (
      key === "--language"
      || key === "--lang"
      || key === "--response-language"
      || key === "--uos-language"
    ) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value.trim().length === 0) {
        throw new Error(`[uos setup] ${key} requires a language code or name`);
      }
      options.responseLanguage = value.trim();
      continue;
    }
    throw new Error(`[uos setup] unknown option: ${arg}`);
  }
  return options;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function backupPathFor(target, timestamp) {
  const base = `${target}.bak-${timestamp}`;
  if (!(await exists(base))) return base;
  for (let i = 1; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
}

export function resolveSetupPaths(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const globalDir = path.resolve(
    options.globalDir ?? path.join(options.homeDir ?? os.homedir(), ".config", "opencode"),
  );
  return {
    repoRoot,
    opencodeDir: path.join(repoRoot, ".opencode"),
    projectConfig: path.join(repoRoot, "opencode.json"),
    projectPackageJson: path.join(repoRoot, ".opencode", "package.json"),
    globalDir,
    globalCfg: path.join(globalDir, "opencode.jsonc"),
    globalPackageJson: path.join(globalDir, "package.json"),
  };
}

export function resolvePluginUrls(cfg, repoRoot = defaultRepoRoot) {
  if (!Array.isArray(cfg.plugin)) return cfg;
  const next = { ...cfg };
  next.plugin = cfg.plugin.map((entry) => {
    if (typeof entry !== "string") return entry;
    for (const prefix of ["file://./", "file:./"]) {
      if (entry.startsWith(prefix)) {
        const rel = entry.slice(prefix.length);
        return pathToFileURL(path.resolve(repoRoot, rel)).toString();
      }
    }
    return entry;
  });
  return next;
}

function assertChildPath(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`refusing to replace path outside opencode config dir: ${child}`);
  }
}

async function replaceWithSymlink(src, dst, globalDir, options = {}) {
  assertChildPath(globalDir, dst);
  const now = options.now ?? (() => Date.now());
  let backupPath;
  if (await exists(dst)) {
    const stat = await fs.lstat(dst);
    if (stat.isSymbolicLink() || stat.isFile()) {
      await fs.unlink(dst);
    } else if (stat.isDirectory()) {
      backupPath = await backupPathFor(dst, now());
      assertChildPath(globalDir, backupPath);
      await fs.rename(dst, backupPath);
    } else {
      await fs.unlink(dst);
    }
  }
  await fs.symlink(src, dst, process.platform === "win32" ? "junction" : "dir");
  return { backupPath };
}

async function syncFile(src, dst, globalDir, options = {}) {
  assertChildPath(globalDir, dst);
  const now = options.now ?? (() => Date.now());
  let backupPath;
  let changed = true;
  if (await exists(dst)) {
    const stat = await fs.lstat(dst);
    if (stat.isFile() || stat.isSymbolicLink()) {
      try {
        const [current, incoming] = await Promise.all([
          fs.readFile(dst, "utf8"),
          fs.readFile(src, "utf8"),
        ]);
        changed = current !== incoming;
      } catch {
        changed = true;
      }
      if (!changed) return { changed: false };
      backupPath = await backupPathFor(dst, now());
      assertChildPath(globalDir, backupPath);
      await fs.rename(dst, backupPath);
    } else if (stat.isDirectory()) {
      backupPath = await backupPathFor(dst, now());
      assertChildPath(globalDir, backupPath);
      await fs.rename(dst, backupPath);
    } else {
      await fs.unlink(dst);
    }
  }
  await fs.copyFile(src, dst);
  return { changed, backupPath };
}

async function readJsonObject(file) {
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  return raw;
}

function mergeDependencies(base, incoming) {
  const next = { ...base };
  let changed = false;
  const deps = incoming.dependencies;
  if (deps !== null && typeof deps === "object" && !Array.isArray(deps)) {
    const current = next.dependencies !== null && typeof next.dependencies === "object" && !Array.isArray(next.dependencies)
      ? { ...next.dependencies }
      : {};
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== "string") continue;
      if (current[name] !== version) {
        current[name] = version;
        changed = true;
      }
    }
    next.dependencies = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
  }
  if (next.private !== true) {
    next.private = true;
    changed = true;
  }
  return { manifest: next, changed };
}

function dependencyPackagePath(globalDir, name) {
  const parts = name.startsWith("@") ? name.split("/") : [name];
  return path.join(globalDir, "node_modules", ...parts, "package.json");
}

async function dependencyMissing(globalDir, deps) {
  for (const name of Object.keys(deps ?? {})) {
    if (!(await exists(dependencyPackagePath(globalDir, name)))) return true;
  }
  return false;
}

async function syncPackageDependencies(paths, options = {}) {
  if (!(await exists(paths.projectPackageJson))) {
    return { skipped: true, reason: "repo .opencode/package.json not found" };
  }
  const now = options.now ?? (() => Date.now());
  const source = await readJsonObject(paths.projectPackageJson);
  let current = {};
  let hadExisting = false;
  if (await exists(paths.globalPackageJson)) {
    current = await readJsonObject(paths.globalPackageJson);
    hadExisting = true;
  }
  const { manifest, changed } = mergeDependencies(current, source);
  let backupPath;
  if (changed) {
    if (hadExisting) {
      backupPath = await backupPathFor(paths.globalPackageJson, now());
      assertChildPath(paths.globalDir, backupPath);
      await fs.rename(paths.globalPackageJson, backupPath);
    }
    await fs.writeFile(paths.globalPackageJson, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const deps = manifest.dependencies ?? {};
  const missing = await dependencyMissing(paths.globalDir, deps);
  return {
    skipped: false,
    path: paths.globalPackageJson,
    sourcePath: paths.projectPackageJson,
    dependencies: deps,
    changed,
    missing,
    backupPath,
  };
}

function runNpmInstall(globalDir, options = {}) {
  const commandRunner = options.commandRunner ?? ((command, args, runOptions) => {
    const result = spawnSync(command, args, {
      cwd: runOptions?.cwd,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error,
    };
  });
  return commandRunner("npm", ["install", "--ignore-scripts"], { cwd: globalDir });
}

export async function runSetup(options = {}) {
  const paths = resolveSetupPaths(options);
  const { repoRoot, opencodeDir, projectConfig, globalDir, globalCfg } = paths;
  const log = options.log ?? console.log;
  const now = options.now ?? (() => Date.now());
  const linkedDirs = [];
  const skippedDirs = [];
  const syncedFiles = [];
  const skippedFiles = [];
  const backupDirs = [];
  const backupFiles = [];
  let packageSync;
  let dependencyInstall;
  let backupConfig;
  let uosConfig;

  log(`[uos setup] repo root:        ${repoRoot}`);
  log(`[uos setup] global opencode:  ${globalDir}`);

  await fs.mkdir(globalDir, { recursive: true });

  if (await exists(globalCfg)) {
    backupConfig = `${globalCfg}.bak-${now()}`;
    await fs.rename(globalCfg, backupConfig);
    log(`[uos setup] backed up existing global config -> ${backupConfig}`);
  }

  const raw = JSON.parse(await fs.readFile(projectConfig, "utf8"));
  const resolved = resolvePluginUrls(raw, repoRoot);
  await fs.writeFile(globalCfg, JSON.stringify(resolved, null, 2));
  log(`[uos setup] wrote global config -> ${globalCfg}`);

  for (const dir of SYNCED_DIRS) {
    const src = path.join(opencodeDir, dir);
    const dst = path.join(globalDir, dir);
    if (!(await exists(src))) {
      skippedDirs.push({ name: dir, src, dst });
      log(`[uos setup] skip ${dir}/ (not present in repo)`);
      continue;
    }
    const linkResult = await replaceWithSymlink(src, dst, globalDir, { now });
    if (linkResult.backupPath) {
      backupDirs.push({ name: dir, src, dst, backupPath: linkResult.backupPath });
      log(`[uos setup] backed up existing ${dir}/ -> ${linkResult.backupPath}`);
    }
    linkedDirs.push({ name: dir, src, dst });
    log(`[uos setup] ${dir}/ -> ${src}`);
  }

  for (const file of SYNCED_FILES) {
    const src = path.join(repoRoot, file);
    const dst = path.join(globalDir, file);
    if (!(await exists(src))) {
      skippedFiles.push({ name: file, src, dst });
      log(`[uos setup] skip ${file} (not present in repo)`);
      continue;
    }
    const syncResult = await syncFile(src, dst, globalDir, { now });
    if (syncResult.backupPath) {
      backupFiles.push({ name: file, src, dst, backupPath: syncResult.backupPath });
      log(`[uos setup] backed up existing ${file} -> ${syncResult.backupPath}`);
    }
    syncedFiles.push({ name: file, src, dst, changed: syncResult.changed });
    log(`[uos setup] ${file} -> ${dst}`);
  }

  packageSync = await syncPackageDependencies(paths, { now });
  if (packageSync.skipped) {
    log(`[uos setup] skip plugin dependencies (${packageSync.reason})`);
  } else {
    const deps = Object.entries(packageSync.dependencies ?? {}).map(([name, version]) => `${name}@${version}`);
    log(`[uos setup] plugin dependencies -> ${packageSync.path}`);
    if (packageSync.backupPath) {
      log(`[uos setup] backed up existing package.json -> ${packageSync.backupPath}`);
    }
    if (deps.length > 0) {
      log(`[uos setup] dependency manifest includes: ${deps.join(", ")}`);
    }
    if (options.installDependencies !== false && (packageSync.changed || packageSync.missing)) {
      const install = runNpmInstall(globalDir, options);
      dependencyInstall = {
        command: "npm install --ignore-scripts",
        cwd: globalDir,
        status: install.status,
        ok: install.status === 0 && install.error === undefined,
        error: install.error?.message,
        stdout: install.stdout,
        stderr: install.stderr,
      };
      if (dependencyInstall.ok) {
        log("[uos setup] installed global opencode plugin dependencies");
      } else {
        log(`[uos setup] warning: npm install failed in ${globalDir}; run \`npm install --ignore-scripts\` there manually`);
      }
    } else if (options.installDependencies === false) {
      log("[uos setup] skipped npm install by option");
    } else {
      log("[uos setup] global opencode plugin dependencies already installed");
    }
  }

  if (Array.isArray(options.unityProjectRoots) && options.unityProjectRoots.length > 0) {
    uosConfig = await saveUnityProjectRoots(options.unityProjectRoots, options);
    log(`[uos setup] Unity project roots -> ${uosConfig.path}`);
    for (const root of uosConfig.config.unityProjectRoots) {
      log(`  - ${root}`);
    }
  }
  if (options.responseLanguage !== undefined) {
    uosConfig = await saveResponseLanguage(options.responseLanguage, options);
    log(`[uos setup] response language -> ${uosConfig.config.responseLanguage}`);
  }

  log("");
  log("[uos setup] done.");
  log("Verify global opencode resources from anywhere:");
  log("  opencode debug config");
  log("Then verify UOS bridge readiness with a target Unity project open:");
  log("  uos ready");
  log("");
  log("Re-run `uos setup` after moving this repo or after pulling new config, agents, tools, or plugins.");

  return {
    repoRoot,
    globalDir,
    globalCfg,
    backupConfig,
    backupDirs,
    backupFiles,
    linkedDirs,
    skippedDirs,
    syncedFiles,
    skippedFiles,
    packageSync,
    dependencyInstall,
    uosConfig,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseSetupOptions(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  runSetup(options).catch((err) => {
    console.error("[uos setup] failed:", err.stack ?? err.message ?? err);
    process.exit(1);
  });
}
