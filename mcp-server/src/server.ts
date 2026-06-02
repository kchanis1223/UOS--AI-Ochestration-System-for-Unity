import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_DEFINITIONS } from "./tools/definitions.js";
import { dispatchToolCall, type BridgeCaller } from "./tools/dispatch.js";
import { SIDECAR_NAME, SIDECAR_VERSION } from "./config.js";

/**
 * Build the MCP Server with the full tool surface wired to the injected bridge
 * caller. Keeping the bridge injectable lets the dispatch be exercised without a
 * live Unity Editor.
 */
export function createMcpServer(callBridge: BridgeCaller): Server {
  const server = new Server(
    { name: SIDECAR_NAME, version: SIDECAR_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const outcome = await dispatchToolCall(name, args ?? {}, callBridge);
    return {
      content: [{ type: "text", text: outcome.text }],
      isError: outcome.isError,
    };
  });

  return server;
}
