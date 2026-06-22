/**
 * validate_planning_intent - local preflight for PlanningIntent JSON.
 *
 * This tool does not call Unity. It lets the agent check generated intent JSON
 * before create_ui_screen mutates the selected scene.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { validatePlanningIntent } from "./_planning_intent";

export default tool({
  description:
    "Validate a PlanningIntent locally before create_ui_screen. Returns schema/tree errors and non-blocking layout warnings without mutating Unity.",
  args: {
    intent: z.unknown().describe("PlanningIntent JSON to validate before calling create_ui_screen."),
  },
  async execute(args) {
    const validation = validatePlanningIntent(args.intent);
    const parsed = validation.intent;
    const summary = parsed !== undefined
      ? `screen="${parsed.screenName}", elements=${parsed.elements.length}, referenceCanvas=${parsed.referenceCanvas.width}x${parsed.referenceCanvas.height}`
      : "intent could not be parsed";

    const sections: string[] = [`Summary: ${summary}`];
    if (validation.errors.length > 0) {
      sections.push(`Errors:\n${validation.errors.map((e) => `- ${e}`).join("\n")}`);
    }
    if (validation.warnings.length > 0) {
      sections.push(`Warnings:\n${validation.warnings.map((w) => `- ${w}`).join("\n")}`);
    }
    if (validation.ok) {
      sections.push("Result: valid for create_ui_screen preflight.");
    } else {
      sections.push("Result: fix the errors before calling create_ui_screen.");
    }

    return {
      title: validation.ok ? "validate_planning_intent: ok" : "validate_planning_intent: failed",
      output: sections.join("\n\n"),
      metadata: {
        ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
        screenName: parsed?.screenName,
        elementCount: parsed?.elements.length,
      },
    };
  },
});
