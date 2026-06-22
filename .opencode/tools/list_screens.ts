/**
 * list_screens - bridge proxy. Lists screens currently present in the Unity scene.
 */
import { tool } from "@opencode-ai/plugin";
import { call } from "./_bridge";

export interface ScreenSummary {
  id: string;
  name?: string;
  active?: boolean;
}

export interface ListScreensResponse {
  screens?: Array<string | { id?: string; name?: string; active?: boolean }>;
  screenIds?: string[];
  activeScreenId?: string;
}

export default tool({
  description: "List the screens currently present in the Unity scene.",
  args: {},
  async execute() {
    const data = (await call("list_screens", {})) as ListScreensResponse;
    const screens = normalizeScreens(data);
    const summary =
      screens.length === 0
        ? "No screens in current scene."
        : `Found ${screens.length} screen(s):\n` +
          screens.map((s) =>
            `  - ${s.id}${s.name !== undefined ? ` (${s.name})` : ""}${s.active === true ? " [active]" : ""}`,
          ).join("\n");
    return {
      title: `list_screens: ${screens.length} found`,
      output: data.activeScreenId !== undefined && data.activeScreenId.length > 0
        ? `${summary}\nActive screen: ${data.activeScreenId}`
        : summary,
      metadata: { ok: true, count: screens.length, activeScreenId: data.activeScreenId, screens },
    };
  },
});

export function normalizeScreens(data: ListScreensResponse): ScreenSummary[] {
  const fromScreens = Array.isArray(data.screens)
    ? data.screens
      .map((screen) => {
        if (typeof screen === "string") return { id: screen };
        if (screen !== null && typeof screen === "object" && typeof screen.id === "string") {
          return {
            id: screen.id,
            name: typeof screen.name === "string" && screen.name.length > 0 ? screen.name : undefined,
            active: screen.active === true ? true : undefined,
          };
        }
        return undefined;
      })
      .filter((screen): screen is ScreenSummary => screen !== undefined && screen.id.length > 0)
    : [];
  if (fromScreens.length > 0) return fromScreens;

  return Array.isArray(data.screenIds)
    ? data.screenIds
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => ({ id }))
    : [];
}
