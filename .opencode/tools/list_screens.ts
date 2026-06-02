/**
 * list_screens — bridge proxy. Lists screens currently present in the Unity scene.
 */
import { tool } from "@opencode-ai/plugin";
import { call } from "./_bridge";

export default tool({
  description: "List the screens currently present in the Unity scene.",
  args: {},
  async execute() {
    const data = (await call("list_screens", {})) as { screens?: Array<{ id: string; name?: string }> };
    const screens = data.screens ?? [];
    const summary =
      screens.length === 0
        ? "No screens in current scene."
        : `Found ${screens.length} screen(s):\n` +
          screens.map((s) => `  - ${s.id}${s.name !== undefined ? ` (${s.name})` : ""}`).join("\n");
    return {
      title: `list_screens: ${screens.length} found`,
      output: summary,
      metadata: { ok: true, count: screens.length, screens },
    };
  },
});
