/**
 * create_screen_transition — bridge proxy. Creates a navigation transition
 * between two screens (panel toggle via ScreenFlowController).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description: "Create a navigation transition between two screens (panel toggle via ScreenFlowController).",
  args: {
    fromId: z.string(),
    toId: z.string(),
    trigger: z.string().describe("e.g. a button elementId or named event."),
  },
  async execute(args) {
    const data = (await call("create_screen_transition", args)) as Record<string, unknown>;
    return {
      title: `create_screen_transition: ${args.fromId} → ${args.toId}`,
      output: `Created transition ${args.fromId} → ${args.toId} (trigger: ${args.trigger}).`,
      metadata: { ok: true, ...data },
    };
  },
});
