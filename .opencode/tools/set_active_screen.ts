/**
 * set_active_screen - bridge proxy. Activates one registered screen and hides
 * the other registered screens through ScreenFlowController.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export interface SetActiveScreenResponse {
  ok?: boolean;
  screenId?: string;
  name?: string;
  active?: boolean;
}

export default tool({
  description:
    "Activate one registered Unity UI screen by canonical screenId and deactivate the other registered screens. Use when the desired screenId is already known.",
  args: {
    screenId: z.string().describe("Canonical screenId to show, e.g. screen-... from create_ui_screen/list_screens/get_uos_context."),
  },
  async execute(args) {
    const data = (await call("set_active_screen", args)) as SetActiveScreenResponse;
    const name = data.name !== undefined && data.name.length > 0 ? ` (${data.name})` : "";
    return {
      title: `set_active_screen: ${args.screenId}`,
      output: `Activated screen ${args.screenId}${name}. Other registered screens were hidden.`,
      metadata: { ok: true, ...data, screenId: data.screenId ?? args.screenId },
    };
  },
});
