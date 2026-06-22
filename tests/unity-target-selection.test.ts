import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { listUnityProjects } from "../.opencode/tools/list_unity_projects.ts";
import { selectUnityProject } from "../.opencode/tools/select_unity_project.ts";
import { readActiveUnityTarget } from "../.opencode/tools/_unity_target_state.ts";

const alpha = {
  instanceId: "alpha-id",
  projectName: "AlphaGame",
  projectPath: "D:/Unity/AlphaGame",
  host: "127.0.0.1",
  port: 19001,
  token: "alpha-token",
};

const bravo = {
  instanceId: "bravo-id",
  projectName: "BravoGame",
  projectPath: "D:/Unity/BravoGame",
  host: "127.0.0.1",
  port: 19002,
  token: "bravo-token",
};

describe("opencode Unity target selection", () => {
  test("lists current project and switches session target without leaking token", async () => {
    const dir = join(import.meta.dir, "..", ".omx", "tmp", "unity-target-selection");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const env: Record<string, string | undefined> = {
      UOS_CONTEXT_DIR: join(dir, ".uos"),
      UOS_PROJECT_DIR: alpha.projectPath,
      UOS_PROJECT_NAME: alpha.projectName,
      UOS_EDITOR_INSTANCE_ID: alpha.instanceId,
      UNITY_MCP_HOST: alpha.host,
      UNITY_MCP_PORT: String(alpha.port),
      UNITY_MCP_TOKEN: alpha.token,
    };
    const discover = async () => [alpha, bravo];

    try {
      const before = await listUnityProjects({ env, discover });
      expect(before.output).toContain("AlphaGame");
      expect(before.output).toContain("[selected]");
      expect(before.output).toContain("BravoGame");
      expect(JSON.stringify(before.metadata ?? before)).not.toContain("alpha-token");

      const selected = await selectUnityProject({
        selector: "BravoGame",
        env,
        cwd: dir,
        discover,
      });
      expect(selected.output).toContain("selected Unity project: BravoGame");
      expect(selected.output).toContain("future Unity bridge calls");
      expect(JSON.stringify(selected.metadata)).not.toContain("bravo-token");
      expect(env.UOS_PROJECT_NAME).toBe("BravoGame");
      expect(env.UNITY_MCP_PORT).toBe("19002");
      expect(env.UNITY_MCP_TOKEN).toBe("bravo-token");

      const active = await readActiveUnityTarget({ env, cwd: dir });
      expect(active?.source).toBe("session");
      expect(active?.target.projectName).toBe("BravoGame");
      expect(active?.target.token).toBe("bravo-token");

      const after = await listUnityProjects({ env, discover });
      expect(after.editors.find((entry: any) => entry.projectName === "BravoGame")?.selected).toBe(true);
      expect(after.editors.find((entry: any) => entry.projectName === "AlphaGame")?.selected).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("select without selector returns choices and does not switch", async () => {
    const env: Record<string, string | undefined> = {
      UOS_PROJECT_DIR: alpha.projectPath,
      UOS_PROJECT_NAME: alpha.projectName,
      UOS_EDITOR_INSTANCE_ID: alpha.instanceId,
      UNITY_MCP_HOST: alpha.host,
      UNITY_MCP_PORT: String(alpha.port),
      UNITY_MCP_TOKEN: alpha.token,
    };
    const result = await selectUnityProject({
      env,
      discover: async () => [alpha, bravo],
    });
    expect(result.metadata.needsSelector).toBe(true);
    expect(result.metadata.switched).toBe(false);
    expect(result.output).toContain("No selector was provided");
    expect(env.UOS_PROJECT_NAME).toBe("AlphaGame");
  });
});
