import { toolByName } from "./definitions.js";

export interface ToolCallOutcome {
  isError: boolean;
  text: string;
  data?: unknown;
}

export type BridgeCaller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Transport-free dispatch for a tools/call: resolve the tool, run deterministic
 * preflight validation, then either run a sidecar-local handler (filesystem-only
 * tools that don't need Unity) or proxy to Unity via the injected bridge caller.
 * Unit-tested with a fake caller; the live wiring lives in server.ts.
 */
export async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  callBridge: BridgeCaller,
): Promise<ToolCallOutcome> {
  const tool = toolByName(name);
  if (tool === undefined) {
    return { isError: true, text: `unknown tool: ${name}` };
  }

  if (tool.preflight !== undefined) {
    const result = tool.preflight(args);
    if (!result.ok) {
      return {
        isError: true,
        text: `preflight failed for ${name}:\n- ${result.errors.join("\n- ")}`,
      };
    }
  }

  try {
    const data = tool.localHandler !== undefined
      ? await tool.localHandler(args)
      : await callBridge(name, args);
    return { isError: false, text: stringifyResult(data), data };
  } catch (err) {
    return { isError: true, text: err instanceof Error ? err.message : String(err) };
  }
}

function stringifyResult(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
