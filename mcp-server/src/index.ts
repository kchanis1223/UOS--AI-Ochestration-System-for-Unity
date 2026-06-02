#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";
import { BridgeClient } from "./bridge/bridgeClient.js";
import { resolveConfig } from "./config.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  const bridge = new BridgeClient(config.bridge);

  // stdout is reserved for the MCP stdio transport; log to stderr only.
  bridge.onStatus((status, detail) => {
    const suffix = detail !== undefined ? ` (${detail})` : "";
    process.stderr.write(`[bridge] ${status}${suffix}\n`);
  });
  bridge.connect();

  const server = createMcpServer((tool, args) => bridge.call(tool, args));
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = (): void => {
    bridge.close();
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[fatal] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
