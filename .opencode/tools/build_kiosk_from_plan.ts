/**
 * build_kiosk_from_plan - local handler tool (no Unity proxy).
 *
 * Converts a reviewed KioskPlan into an EditorChangeSet / EditorCommandBatch.
 * It does not mutate Unity; the Orchestrator should show the batch summary and
 * pass the commands to the Editor execution boundary after approval.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { promises as fs } from "node:fs";
// @ts-expect-error - shared pure-JS planner core (no type declarations).
import { planKioskStructure, resolveKioskRoot } from "../../bin/kiosk-core.js";
// @ts-expect-error - shared pure-JS build core (no type declarations).
import { buildKioskEditorChangeSet, formatKioskBuildChangeSet } from "../../bin/kiosk-build-core.js";

function rootDir(ctxDirectory: string): string {
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["UNITY_MCP_MATERIALS_DIR"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return ctxDirectory;
}

export default tool({
  description:
    "Build an approved kiosk folder plan into a dry-run EditorChangeSet / EditorCommandBatch. Generates screen creation, material routing, navigation button, transition, and optional preview commands without mutating Unity. Use after plan_kiosk_structure has been reviewed.",
  args: {
    plan: z
      .unknown()
      .optional()
      .describe("Optional KioskPlan metadata returned by plan_kiosk_structure. When omitted, dir/options are used to regenerate the plan."),
    dir: z
      .string()
      .optional()
      .describe("Kiosk root folder when plan is omitted. Absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    maxDepth: z.number().int().min(0).max(32).optional().describe("Plan regeneration only: max folder depth. Default 8."),
    includeBack: z.boolean().optional().describe("Plan regeneration only: include parent back edges. Default true."),
    includeHome: z.boolean().optional().describe("Plan regeneration only: include home edges. Default true."),
    backLabel: z.string().optional().describe('Plan regeneration only: back button label. Default "이전".'),
    homeLabel: z.string().optional().describe('Plan regeneration only: home button label. Default "처음으로".'),
    mode: z.enum(["tree", "linear"]).optional().describe("Plan regeneration only: tree or linear kiosk flow."),
    planId: z.string().optional().describe("Optional stable id for the generated EditorChangeSet planId."),
    blueprintId: z.string().optional().describe("Optional approved ProductionBlueprint id to record in source metadata."),
    blueprintPath: z.string().optional().describe("Optional approved ProductionBlueprint file path to record in source metadata."),
    includePreviews: z.boolean().optional().describe("Append capture_preview_from_context commands after each screen creation. Default false."),
  },
  async execute(args, ctx) {
    let plan = args.plan;
    if (plan === undefined) {
      const root = resolveKioskRoot(args.dir, rootDir(ctx.directory));
      try {
        const stat = await fs.stat(root);
        if (!stat.isDirectory()) throw new Error("not a directory");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`build_kiosk_from_plan: cannot read "${root}": ${msg}`);
      }
      plan = await planKioskStructure(root, {
        maxDepth: args.maxDepth,
        includeBack: args.includeBack,
        includeHome: args.includeHome,
        backLabel: args.backLabel,
        homeLabel: args.homeLabel,
        mode: args.mode,
        blueprintId: args.blueprintId,
        blueprintPath: args.blueprintPath,
      });
    }

    const result = buildKioskEditorChangeSet(plan, {
      planId: args.planId,
      blueprintId: args.blueprintId,
      blueprintPath: args.blueprintPath,
      includePreviews: args.includePreviews,
    });

    return {
      title: result.ok
        ? `build_kiosk_from_plan: ${result.summary.commands} editor command(s)`
        : "build_kiosk_from_plan: invalid plan",
      output:
        formatKioskBuildChangeSet(result) +
        "\n\nDry run only: Unity was not modified. Review metadata.changeSet.batches[0].commands before Editor execution.",
      metadata: {
        ok: result.ok,
        errors: result.errors,
        warnings: result.warnings,
        summary: result.summary,
        changeSet: result.changeSet,
        dryRun: true,
      },
    };
  },
});
