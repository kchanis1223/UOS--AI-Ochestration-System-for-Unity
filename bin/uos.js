#!/usr/bin/env node
/**
 * uos — Unity Orchestration System
 *
 * Forwards every argument to `opencode`. opencode itself walks up from cwd
 * to find the project's opencode.json, so this is a plain alias.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("opencode", process.argv.slice(2), {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 0);
