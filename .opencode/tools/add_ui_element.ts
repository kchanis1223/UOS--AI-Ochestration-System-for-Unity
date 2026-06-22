/**
 * add_ui_element - bridge proxy. Adds a single element to an existing screen.
 * Returns { elementId } (server-minted canonical id).
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";
import { AddElementSchema, normalizeAddElementForBridge, validateAddElement } from "./_planning_intent";

export default tool({
  description: "Add a single element to an existing screen. Optionally pass element.parentElementId to parent it under an existing canonical element. Returns { elementId }.",
  args: {
    screenId: z.string(),
    element: AddElementSchema,
  },
  async execute(args) {
    const validation = validateAddElement(args.element);
    if (!validation.ok) {
      return {
        title: "add_ui_element: preflight failed",
        output: `preflight failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`,
        metadata: { ok: false, errors: validation.errors, warnings: validation.warnings },
      };
    }
    const data = (await call("add_ui_element", {
      ...args,
      element: normalizeAddElementForBridge(args.element),
    })) as { elementId: string };
    const warningText = validation.warnings.length > 0
      ? `\n\nWarnings:\n${validation.warnings.map((w) => `- ${w}`).join("\n")}`
      : "";
    return {
      title: `add_ui_element: ${args.element.type} -> ${data.elementId}`,
      output: `Added ${args.element.type} (id=${data.elementId}) to screen ${args.screenId}.` + warningText,
      metadata: { ok: true, warnings: validation.warnings, ...data },
    };
  },
});
