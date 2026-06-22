/**
 * draft_production_blueprint - persist a reviewed ProductionBlueprint.
 *
 * This tool is read/write only against UOS artifact storage. It does not call
 * Unity or mutate the selected scene.
 */
import { tool } from "@opencode-ai/plugin";
import { dirname } from "node:path";
import { z } from "zod";
// @ts-expect-error - shared pure-JS blueprint persistence helpers (no type declarations).
import { writeProductionBlueprint } from "../../bin/production-blueprint-core.js";

export default tool({
  description:
    "Validate and persist a ProductionBlueprint under .uos/orchestrator/blueprints for broad UOS creation work. This does not mutate Unity. Use after material interpretation and user confirmation, before Plan/Build artifacts.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then UOS_CONTEXT_DIR parent, then the current session directory."),
    blueprint: z
      .object({})
      .passthrough()
      .describe("ProductionBlueprint JSON object. Must pass validateProductionBlueprint; approved blueprints require approval.status='approved' and ambiguity.estimate <= 20."),
  },
  async execute(args, ctx) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const projectDir = firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR, parentOf(env.UOS_CONTEXT_DIR), ctx.directory);
    const result = await writeProductionBlueprint(projectDir, args.blueprint);
    if (!result.ok) {
      return {
        title: "draft_production_blueprint: invalid",
        output: formatInvalidBlueprint(result.errors, result.warnings),
        metadata: {
          ok: false,
          errors: result.errors,
          warnings: result.warnings,
          projectDir,
        },
      };
    }

    return {
      title: `draft_production_blueprint: ${result.blueprint.id}`,
      output: formatBlueprintSummary(result.blueprint, result.path),
      metadata: {
        ok: true,
        errors: [],
        warnings: result.warnings,
        projectDir,
        path: result.path,
        blueprint: result.blueprint,
      },
    };
  },
});

function formatInvalidBlueprint(errors: string[], warnings: string[]): string {
  const lines = [
    "ProductionBlueprint was not saved.",
    "",
    "Fix these fields before continuing to Plan/Build:",
  ];
  for (const error of errors) lines.push(`- ${error}`);
  if (warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of warnings) lines.push(`- ${warning}`);
  }
  lines.push(
    "",
    "Next: ask the user a focused clarification question with 2-3 choices, update the blueprint, then call this tool again.",
  );
  return lines.join("\n");
}

function formatBlueprintSummary(blueprint: any, filePath: string | undefined): string {
  const lines = [
    "# Production Blueprint",
    "",
    `- Title: ${blueprint.title}`,
    `- Goal: ${blueprint.goal}`,
    `- Mode: ${blueprint.modeId}${blueprint.recipeId !== undefined ? ` / recipe=${blueprint.recipeId}` : ""}`,
    `- Status: ${blueprint.status}`,
    `- Approval: ${blueprint.approval?.status ?? "(missing)"}`,
    `- Ambiguity: ${blueprint.ambiguity?.estimate ?? "(missing)"}%`,
    `- Sources: ${Array.isArray(blueprint.sources) ? blueprint.sources.length : 0}`,
    `- Screens: ${Array.isArray(blueprint.screens) ? blueprint.screens.length : 0}`,
    `- Interactions: ${Array.isArray(blueprint.interactions) ? blueprint.interactions.length : 0}`,
  ];
  if (filePath !== undefined) lines.push(`- Saved: ${filePath}`);
  lines.push(
    "",
    blueprint.status === "approved"
      ? "Next: convert this approved ProductionBlueprint into the selected mode's Plan artifact."
      : "Next: show this blueprint to the user and ask them to approve, revise, or pause before broad Unity mutation.",
  );
  return lines.join("\n");
}

function parentOf(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? dirname(trimmed) : undefined;
}

function firstNonBlank(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return ".";
}
