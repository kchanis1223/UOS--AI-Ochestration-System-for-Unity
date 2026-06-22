/**
 * delete_ui_element - bridge proxy. Deletes an element by canonical elementId.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description: "Delete an element by its canonical elementId.",
  args: {
    elementId: z.string(),
  },
  async execute(args) {
    const data = (await call("delete_ui_element", args)) as Record<string, unknown>;
    return {
      title: `delete_ui_element: ${args.elementId}`,
      output: `Deleted element ${args.elementId}.`,
      metadata: { ok: true, ...data },
    };
  },
});
