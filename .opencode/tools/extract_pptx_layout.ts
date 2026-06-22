/**
 * extract_pptx_layout - deterministic PPTX Open XML layout extraction.
 *
 * This does not render slides. It extracts slide dimensions, positioned text
 * boxes, and picture bounds so the agent can derive PlanningIntent rects even
 * when LibreOffice/PowerPoint are unavailable.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { extractPptxLayout, formatPptxLayout } from "./_pptx_layout";
import { resolveCandidate, rootDir } from "./_materials";

const PagesSchema = z.array(z.number().int().positive()).max(50);

export default tool({
  description:
    "Extract PPTX slide layout without rendering: slide size, positioned text boxes, pictures, normalized rects, and suggested Unity element types. Use when PPTX visuals matter or renderers are unavailable.",
  args: {
    path: z.string().describe("PPTX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    pages: PagesSchema.optional().describe("Specific 1-based slide numbers to inspect. Overrides first/last."),
    first: z.number().int().positive().optional().describe("Inspect the first N slides. Defaults to all slides."),
    last: z.number().int().positive().optional().describe("When paired with first, inspect inclusive first..last; alone inspects last N slides."),
    maxItemsPerSlide: z.number().int().positive().max(500).optional().describe("Maximum positioned items per slide. Defaults to 100."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".pptx") {
      throw new Error(`extract_pptx_layout: expected a .pptx file, got "${basename(resolved)}"`);
    }

    const layout = await extractPptxLayout(resolved, {
      pages: args.pages,
      first: args.first,
      last: args.last,
      maxItemsPerSlide: args.maxItemsPerSlide,
    });
    return {
      title: `extract_pptx_layout: ${basename(resolved)} (${layout.slides.length} slide(s))`,
      output:
        formatPptxLayout(layout) +
        "\n\nUse item.rect values directly as normalized PlanningIntent rects after checking the visual intent.",
      metadata: { ok: true, ...layout },
    };
  },
});
