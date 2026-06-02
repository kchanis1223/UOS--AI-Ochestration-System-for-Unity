import type { BridgeConfig } from "./bridge/bridgeClient.js";

/** Protocol version negotiated with the Unity package. Major must match. */
export const PROTOCOL_VERSION = "1.0.0";

export const SIDECAR_NAME = "unity-conv-mcp-sidecar";
export const SIDECAR_VERSION = "0.1.0";

export interface ResolvedConfig {
  bridge: BridgeConfig;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17801;

/** Resolve bridge config from environment (overridable by the panel's snippet). */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const port = parsePort(env["UNITY_MCP_PORT"]) ?? DEFAULT_PORT;
  const host = env["UNITY_MCP_HOST"]?.trim() || DEFAULT_HOST;
  const sharedToken = env["UNITY_MCP_TOKEN"]?.trim() ?? "";
  return {
    bridge: {
      host,
      port,
      sharedToken,
      protocolVersion: PROTOCOL_VERSION,
    },
  };
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return undefined;
  return n;
}
