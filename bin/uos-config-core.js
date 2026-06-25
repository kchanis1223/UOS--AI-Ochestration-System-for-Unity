import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const UNITY_PROJECT_SCAN_IGNORE_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".uos",
  "Library",
  "Temp",
  "Obj",
  "Logs",
  "Build",
  "Builds",
  "node_modules",
]);

export function resolveUosConfigPaths(options = {}) {
  const configDir = path.resolve(
    options.configDir
      ?? path.join(options.homeDir ?? os.homedir(), ".config", "uos"),
  );
  return {
    configDir,
    configFile: path.join(configDir, "config.json"),
  };
}

export function normalizeUnityProjectRoots(values = [], options = {}) {
  const items = Array.isArray(values) ? values : [values];
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const seen = new Set();
  const roots = [];
  for (const item of items) {
    if (typeof item !== "string" || item.trim().length === 0) continue;
    const resolved = path.resolve(cwd, item.trim());
    const key = normalizeComparablePath(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(resolved);
  }
  return roots;
}

export function normalizeResponseLanguage(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const key = trimmed.toLowerCase();
  switch (key) {
    case "ko":
    case "ko-kr":
    case "kr":
    case "korean":
    case "한국어":
    case "한글":
      return "Korean";
    case "en":
    case "en-us":
    case "en-gb":
    case "english":
      return "English";
    case "ja":
    case "jp":
    case "ja-jp":
    case "japanese":
    case "日本語":
      return "Japanese";
    case "zh":
    case "zh-cn":
    case "zh-tw":
    case "chinese":
    case "中文":
      return "Chinese";
    default:
      return trimmed;
  }
}

export async function readUosConfig(options = {}) {
  const paths = resolveUosConfigPaths(options);
  try {
    const parsed = JSON.parse(await fs.readFile(paths.configFile, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config root must be an object");
    }
    const responseLanguage = normalizeResponseLanguage(parsed.responseLanguage);
    const config = {
      ...parsed,
      unityProjectRoots: normalizeUnityProjectRoots(parsed.unityProjectRoots ?? [], options),
    };
    if (responseLanguage !== undefined) {
      config.responseLanguage = responseLanguage;
    } else {
      delete config.responseLanguage;
    }
    return config;
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { unityProjectRoots: [] };
    }
    throw new Error(`[uos config] failed to read ${paths.configFile}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function writeUosConfig(config = {}, options = {}) {
  const paths = resolveUosConfigPaths(options);
  const next = {
    ...config,
    unityProjectRoots: normalizeUnityProjectRoots(config.unityProjectRoots ?? [], options),
  };
  const defaultUnityExecutable = normalizeOptionalAbsolutePath(config.defaultUnityExecutable, options);
  if (defaultUnityExecutable !== undefined) {
    next.defaultUnityExecutable = defaultUnityExecutable;
  } else {
    delete next.defaultUnityExecutable;
  }
  const unityEditors = normalizeUnityEditorMap(config.unityEditors, options);
  if (Object.keys(unityEditors).length > 0) {
    next.unityEditors = unityEditors;
  } else {
    delete next.unityEditors;
  }
  const responseLanguage = normalizeResponseLanguage(config.responseLanguage);
  if (responseLanguage !== undefined) {
    next.responseLanguage = responseLanguage;
  } else {
    delete next.responseLanguage;
  }
  await fs.mkdir(paths.configDir, { recursive: true });
  await fs.writeFile(paths.configFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return {
    path: paths.configFile,
    config: next,
  };
}

export async function saveResponseLanguage(language, options = {}) {
  const responseLanguage = normalizeResponseLanguage(language);
  if (responseLanguage === undefined) {
    throw new Error("[uos setup] --language requires a language code or name");
  }
  const current = await readUosConfig(options);
  return writeUosConfig({
    ...current,
    responseLanguage,
  }, options);
}

export async function saveUnityProjectRoots(roots = [], options = {}) {
  const normalized = normalizeUnityProjectRoots(roots, options);
  if (normalized.length === 0) {
    throw new Error("[uos setup] --unity-projects requires at least one folder path");
  }
  const current = await readUosConfig(options);
  return writeUosConfig({
    ...current,
    unityProjectRoots: normalized,
  }, options);
}

export async function saveUnityExecutableConfig(input = {}, options = {}) {
  const current = await readUosConfig(options);
  const next = { ...current };
  const defaultUnityExecutable = normalizeOptionalAbsolutePath(input.defaultUnityExecutable, options);
  if (defaultUnityExecutable !== undefined) {
    next.defaultUnityExecutable = defaultUnityExecutable;
  }
  const version = typeof input.version === "string" && input.version.trim().length > 0
    ? input.version.trim()
    : undefined;
  const unityExecutable = normalizeOptionalAbsolutePath(input.unityExecutable, options);
  if (version !== undefined && unityExecutable !== undefined) {
    next.unityEditors = {
      ...(current.unityEditors ?? {}),
      [version]: unityExecutable,
    };
  }
  return writeUosConfig(next, options);
}

export async function discoverConfiguredUnityProjects(options = {}) {
  const config = options.config ?? await readUosConfig(options);
  const roots = normalizeUnityProjectRoots(options.unityProjectRoots ?? config.unityProjectRoots ?? [], options);
  const maxDepth = boundedPositiveInt(options.maxDepth, 4);
  const projects = [];
  for (const root of roots) {
    projects.push(...await scanUnityProjects(root, {
      root,
      maxDepth,
      depth: 0,
      fsApi: options.fsApi,
    }));
  }
  return dedupeUnityProjects(projects)
    .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectPath.localeCompare(b.projectPath));
}

async function scanUnityProjects(dir, options) {
  const fsApi = options.fsApi ?? fs;
  if (await isUnityProjectRoot(dir, fsApi)) {
    return [await unityProjectRecord(dir, options.root, fsApi)];
  }
  if (options.depth >= options.maxDepth) return [];

  let entries;
  try {
    entries = await fsApi.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (UNITY_PROJECT_SCAN_IGNORE_DIRS.has(entry.name)) continue;
    projects.push(...await scanUnityProjects(path.join(dir, entry.name), {
      ...options,
      depth: options.depth + 1,
    }));
  }
  return projects;
}

async function isUnityProjectRoot(dir, fsApi = fs) {
  try {
    const stat = await fsApi.stat(path.join(dir, "ProjectSettings", "ProjectVersion.txt"));
    return stat.isFile();
  } catch {
    return false;
  }
}

async function unityProjectRecord(projectPath, discoveryRoot, fsApi = fs) {
  const versionFile = path.join(projectPath, "ProjectSettings", "ProjectVersion.txt");
  let unityVersion;
  try {
    unityVersion = parseUnityVersion(await fsApi.readFile(versionFile, "utf8"));
  } catch {
    unityVersion = undefined;
  }
  return {
    projectName: path.basename(projectPath),
    projectPath: path.resolve(projectPath),
    discoveryRoot: path.resolve(discoveryRoot),
    unityVersion,
  };
}

function parseUnityVersion(text) {
  const match = String(text ?? "").match(/m_EditorVersion:\s*([^\r\n]+)/);
  return match?.[1]?.trim();
}

function dedupeUnityProjects(projects) {
  const seen = new Set();
  const result = [];
  for (const project of projects) {
    const key = normalizeComparablePath(project.projectPath);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(project);
  }
  return result;
}

function boundedPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeOptionalAbsolutePath(value, options = {}) {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return path.resolve(cwd, value.trim());
}

function normalizeUnityEditorMap(value, options = {}) {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = {};
  for (const [version, executable] of Object.entries(value)) {
    if (typeof version !== "string" || version.trim().length === 0) continue;
    const normalized = normalizeOptionalAbsolutePath(executable, options);
    if (normalized !== undefined) entries[version.trim()] = normalized;
  }
  return entries;
}

function normalizeComparablePath(value) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}
