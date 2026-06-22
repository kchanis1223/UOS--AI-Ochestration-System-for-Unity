/**
 * plan_kiosk_structure - local handler tool (no Unity proxy).
 *
 * Plans a kiosk screen structure (sitemap) from a nested planning folder.
 * Every subfolder becomes a screen: folders with child folders are "menu"
 * screens, leaf folders are "detail" screens. It returns the screen tree plus a
 * drilldown/back/home navigation plan WITHOUT mutating Unity. This is the
 * read-only "preview" step the user reviews before build_kiosk_from_plan.
 *
 * Deterministic planning logic lives in bin/kiosk-core.js so the `uos kiosk-plan`
 * CLI and this tool share one implementation.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { promises as fs } from "node:fs";
// @ts-expect-error - shared pure-JS planner core (no type declarations).
import { planKioskStructure, formatKioskPlanOutline, resolveKioskRoot } from "../../bin/kiosk-core.js";

function rootDir(ctxDirectory: string): string {
  const fromEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.["UNITY_MCP_MATERIALS_DIR"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return ctxDirectory;
}

export default tool({
  description:
    "Plan a kiosk screen structure (sitemap) from a nested planning folder WITHOUT mutating Unity. Every subfolder becomes a screen: folders with children are menu screens, leaf folders are detail screens. Returns the screen tree and drilldown/back/home navigation plan. Use this preview step first, then build_kiosk_from_plan after the user approves.",
  args: {
    dir: z
      .string()
      .optional()
      .describe(
        "Kiosk root folder (absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd). The folder itself becomes the root/home screen. Defaults to UNITY_MCP_MATERIALS_DIR or the session directory.",
      ),
    maxDepth: z.number().int().min(0).max(32).optional().describe("Max folder depth to descend. Default 8."),
    includeBack: z.boolean().optional().describe("Add a back edge from each child to its parent. Default true."),
    includeHome: z.boolean().optional().describe("Add a home edge from each non-root screen to the root. Default true."),
    backLabel: z.string().optional().describe('Back button label. Default "이전".'),
    homeLabel: z.string().optional().describe('Home button label. Default "처음으로".'),
    mode: z
      .enum(["tree", "linear"])
      .optional()
      .describe("tree = drilldown hierarchy (default). linear = sequential prev/next flow over all folders."),
    blueprintId: z.string().optional().describe("Optional ProductionBlueprint id to record in KioskPlan source metadata."),
    blueprintPath: z.string().optional().describe("Optional ProductionBlueprint file path to record in KioskPlan source metadata."),
  },
  async execute(args, ctx) {
    const root = resolveKioskRoot(args.dir, rootDir(ctx.directory));
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) throw new Error("not a directory");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`plan_kiosk_structure: cannot read "${root}": ${msg}`);
    }

    const plan = await planKioskStructure(root, {
      maxDepth: args.maxDepth,
      includeBack: args.includeBack,
      includeHome: args.includeHome,
      backLabel: args.backLabel,
      homeLabel: args.homeLabel,
      mode: args.mode,
      blueprintId: args.blueprintId,
      blueprintPath: args.blueprintPath,
    });

    return {
      title: `plan_kiosk_structure: ${plan.counts.screens} screen(s)`,
      output:
        formatKioskPlanOutline(plan) +
        "\n\nNext: review this sitemap with the user. After approval, call build_kiosk_from_plan with the same dir/options to create the screens and wire drilldown/back/home navigation.",
      metadata: { ok: true, ...plan },
    };
  },
});
