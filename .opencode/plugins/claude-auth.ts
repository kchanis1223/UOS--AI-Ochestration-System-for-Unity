import type { Plugin } from "@opencode-ai/plugin";
import ClaudeAuthPlugin from "opencode-claude-auth";

export const ClaudeAuth: Plugin = async (ctx, options) => {
  const hooks = await ClaudeAuthPlugin(ctx, options);
  delete hooks.config;
  return hooks;
};
