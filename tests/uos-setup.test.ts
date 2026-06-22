import { describe, expect, test } from "bun:test";
import { mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverConfiguredUnityProjects, normalizeResponseLanguage, readUosConfig, resolveUosConfigPaths } from "../bin/uos-config-core.js";
import { parseSetupOptions, resolvePluginUrls, resolveSetupPaths, runSetup } from "../bin/uos-setup.js";

function normalizeLinkTarget(target: string): string {
  const withoutVerbatimPrefix = target
    .replace(/^\\\\\?\\UNC\\/, "\\\\")
    .replace(/^\\\\\?\\/, "");
  return resolve(withoutVerbatimPrefix);
}

describe("uos setup", () => {
  test("parseSetupOptions handles Unity project roots", () => {
    expect(parseSetupOptions(["--unity-projects", "D:/UnityProject"])).toEqual({
      unityProjectRoots: ["D:/UnityProject"],
      installDependencies: true,
      responseLanguage: undefined,
    });
    expect(parseSetupOptions(["--unity-root=D:/UnityProject", "--no-install-dependencies", "--language", "ko"])).toEqual({
      unityProjectRoots: ["D:/UnityProject"],
      installDependencies: false,
      responseLanguage: "ko",
    });
    expect(parseSetupOptions(["--response-language=English"])).toEqual({
      unityProjectRoots: [],
      installDependencies: true,
      responseLanguage: "English",
    });
    expect(() => parseSetupOptions(["--unity-projects"])).toThrow("requires a folder path");
    expect(() => parseSetupOptions(["--language"])).toThrow("requires a language");
    expect(() => parseSetupOptions(["--unknown"])).toThrow("unknown option");
  });

  test("normalizes response language aliases", () => {
    expect(normalizeResponseLanguage("ko")).toBe("Korean");
    expect(normalizeResponseLanguage("한국어")).toBe("Korean");
    expect(normalizeResponseLanguage("en-US")).toBe("English");
    expect(normalizeResponseLanguage("Japanese")).toBe("Japanese");
    expect(normalizeResponseLanguage("Portuguese")).toBe("Portuguese");
    expect(normalizeResponseLanguage("  ")).toBeUndefined();
  });

  test("resolves repo-relative file plugin URLs", () => {
    const repoRoot = resolve("uos-setup-url-root");
    const resolved = resolvePluginUrls({
      plugin: [
        "opencode-claude-auth@latest",
        "file://./.opencode/plugins/uos.ts",
        "file:./tools/local-plugin.ts",
      ],
    }, repoRoot);

    expect(resolved.plugin).toEqual([
      "opencode-claude-auth@latest",
      pathToFileURL(join(repoRoot, ".opencode", "plugins", "uos.ts")).toString(),
      pathToFileURL(join(repoRoot, "tools", "local-plugin.ts")).toString(),
    ]);
  });

  test("writes global config backup and links UOS opencode resources", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "uos-setup-test");
    const repoRoot = join(root, "repo");
    const homeDir = join(root, "home");
    const paths = resolveSetupPaths({ repoRoot, homeDir });
    await rm(root, { recursive: true, force: true });

    try {
      for (const dir of ["agents", "tools", "plugins"]) {
        await mkdir(join(repoRoot, ".opencode", dir), { recursive: true });
        await writeFile(join(repoRoot, ".opencode", dir, "sentinel.txt"), dir, "utf8");
      }
      await writeFile(join(repoRoot, ".opencode", "package.json"), JSON.stringify({
        dependencies: {
          "@opencode-ai/plugin": "1.15.13",
          "opencode-claude-auth": "1.5.4",
        },
      }), "utf8");
      await writeFile(join(repoRoot, "opencode.json"), JSON.stringify({
        default_agent: "orchestrator",
        agent: {
          build: { disable: true },
          plan: { disable: true },
        },
      }), "utf8");
      await writeFile(join(repoRoot, "bridge-capabilities.json"), JSON.stringify({
        requiredTools: ["get_project_info", "create_ui_screen"],
        requiredWriteTools: ["create_ui_screen"],
      }), "utf8");

      await mkdir(paths.globalDir, { recursive: true });
      await mkdir(join(paths.globalDir, "agents"), { recursive: true });
      await writeFile(join(paths.globalDir, "agents", "old.txt"), "old", "utf8");
      await writeFile(join(paths.globalDir, "tools"), "old file", "utf8");
      await writeFile(join(paths.globalDir, "package.json"), JSON.stringify({
        dependencies: {
          "existing-plugin": "9.9.9",
        },
      }), "utf8");
      await writeFile(paths.globalCfg, "{\"old\":true}", "utf8");
      const installCalls: Array<{ command: string; args?: string[]; cwd?: string }> = [];

      const result = await runSetup({
        repoRoot,
        homeDir,
        now: () => 42,
        log: () => {},
        commandRunner: (command: string, args?: string[], options?: { cwd?: string }) => {
          installCalls.push({ command, args, cwd: options?.cwd });
          return { status: 0, stdout: "installed", stderr: "" };
        },
      });

      expect(result.backupConfig).toBe(`${paths.globalCfg}.bak-42`);
      expect(JSON.parse(await readFile(`${paths.globalCfg}.bak-42`, "utf8"))).toEqual({ old: true });
      const config = JSON.parse(await readFile(paths.globalCfg, "utf8"));
      expect(config.plugin).toBeUndefined();
      expect(config.default_agent).toBe("orchestrator");
      expect(config.agent).toEqual({
        build: { disable: true },
        plan: { disable: true },
      });
      expect(result.packageSync).toMatchObject({
        path: paths.globalPackageJson,
        sourcePath: paths.projectPackageJson,
        changed: true,
        missing: true,
        backupPath: `${paths.globalPackageJson}.bak-42`,
      });
      expect(JSON.parse(await readFile(`${paths.globalPackageJson}.bak-42`, "utf8"))).toEqual({
        dependencies: {
          "existing-plugin": "9.9.9",
        },
      });
      expect(JSON.parse(await readFile(paths.globalPackageJson, "utf8")).dependencies).toEqual({
        "@opencode-ai/plugin": "1.15.13",
        "existing-plugin": "9.9.9",
        "opencode-claude-auth": "1.5.4",
      });
      expect(result.dependencyInstall).toMatchObject({
        command: "npm install --ignore-scripts",
        cwd: paths.globalDir,
        ok: true,
      });
      expect(installCalls).toEqual([
        { command: "npm", args: ["install", "--ignore-scripts"], cwd: paths.globalDir },
      ]);

      for (const dir of ["agents", "tools", "plugins"]) {
        const dst = join(paths.globalDir, dir);
        expect(normalizeLinkTarget(await readlink(dst))).toBe(resolve(join(repoRoot, ".opencode", dir)));
        expect(await readFile(join(dst, "sentinel.txt"), "utf8")).toBe(dir);
      }
      expect(result.backupDirs).toEqual([
        {
          name: "agents",
          src: join(repoRoot, ".opencode", "agents"),
          dst: join(paths.globalDir, "agents"),
          backupPath: `${join(paths.globalDir, "agents")}.bak-42`,
        },
      ]);
      expect(await readFile(join(paths.globalDir, "agents.bak-42", "old.txt"), "utf8")).toBe("old");
      expect(result.linkedDirs.map((item) => item.name)).toEqual(["agents", "tools", "plugins"]);
      expect(result.syncedFiles).toEqual([{
        name: "bridge-capabilities.json",
        src: join(repoRoot, "bridge-capabilities.json"),
        dst: join(paths.globalDir, "bridge-capabilities.json"),
        changed: true,
      }]);
      expect(JSON.parse(await readFile(join(paths.globalDir, "bridge-capabilities.json"), "utf8"))).toEqual({
        requiredTools: ["get_project_info", "create_ui_screen"],
        requiredWriteTools: ["create_ui_screen"],
      });
      expect(result.skippedDirs).toEqual([]);
      expect(result.skippedFiles).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stores configured Unity project roots in UOS config", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "uos-setup-unity-roots-test");
    const repoRoot = join(root, "repo");
    const homeDir = join(root, "home");
    const unityRoot = join(root, "UnityProject");
    const paths = resolveSetupPaths({ repoRoot, homeDir });
    const configPaths = resolveUosConfigPaths({ homeDir });
    await rm(root, { recursive: true, force: true });

    try {
      await mkdir(join(repoRoot, ".opencode"), { recursive: true });
      await mkdir(unityRoot, { recursive: true });
      await writeFile(join(repoRoot, "opencode.json"), JSON.stringify({
        default_agent: "orchestrator",
      }), "utf8");

      const result = await runSetup({
        repoRoot,
        homeDir,
        unityProjectRoots: [unityRoot, unityRoot],
        responseLanguage: "ko",
        installDependencies: false,
        log: () => {},
      });

      expect(result.uosConfig.path).toBe(configPaths.configFile);
      expect(result.uosConfig.config.unityProjectRoots).toEqual([resolve(unityRoot)]);
      expect(result.uosConfig.config.responseLanguage).toBe("Korean");
      expect(await readUosConfig({ homeDir })).toEqual({
        unityProjectRoots: [resolve(unityRoot)],
        responseLanguage: "Korean",
      });
      expect(JSON.parse(await readFile(configPaths.configFile, "utf8"))).toEqual({
        unityProjectRoots: [resolve(unityRoot)],
        responseLanguage: "Korean",
      });
      expect(paths.globalDir).toContain(join(homeDir, ".config", "opencode"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("discovers Unity projects under configured roots", async () => {
    const root = join(import.meta.dir, "..", ".omx", "tmp", "uos-project-root-scan-test");
    const repoRoot = join(root, "repo");
    const homeDir = join(root, "home");
    const unityRoot = join(root, "UnityProject");
    const alpha = join(unityRoot, "AlphaGame");
    const bravo = join(unityRoot, "Nested", "BravoGame");
    const ignored = join(unityRoot, "Library", "IgnoredGame");
    await rm(root, { recursive: true, force: true });

    try {
      for (const project of [alpha, bravo, ignored]) {
        await mkdir(join(project, "ProjectSettings"), { recursive: true });
      }
      await writeFile(join(alpha, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.68f1\n", "utf8");
      await writeFile(join(bravo, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.3f1\n", "utf8");
      await writeFile(join(ignored, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.9.9f1\n", "utf8");
      await mkdir(repoRoot, { recursive: true });
      await writeFile(join(repoRoot, "opencode.json"), "{}", "utf8");

      await runSetup({
        repoRoot,
        homeDir,
        unityProjectRoots: [unityRoot, unityRoot],
        installDependencies: false,
        log: () => {},
      });

      const projects = await discoverConfiguredUnityProjects({ homeDir });
      expect(projects.map((project) => project.projectName)).toEqual(["AlphaGame", "BravoGame"]);
      expect(projects.map((project) => project.unityVersion)).toEqual(["6000.0.68f1", "6000.3.3f1"]);
      expect(projects.map((project) => project.projectPath)).toEqual([resolve(alpha), resolve(bravo)]);
      expect(projects.every((project) => project.discoveryRoot === resolve(unityRoot))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
