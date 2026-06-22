/**
 * draft_planning_intent_from_docx - DOCX body text to PlanningIntent draft.
 *
 * This gives document-first specs a deterministic bridge into Unity editing:
 * extract DOCX body text, create a simple editable UI draft, validate it, then
 * let the agent revise/create through the normal screen tools.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { draftPlanningIntentFromDocxText, formatDocxIntentDraft } from "./_docx_intent_draft";
import { extractPlanningText, resolveCandidate, rootDir } from "./_materials";

export default tool({
  description:
    "Draft a valid PlanningIntent from DOCX body text. Use before validate_planning_intent/create_ui_screen when a Word document defines screen copy, sections, or CTA labels.",
  args: {
    path: z.string().describe("DOCX path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd)."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to 1920."),
    referenceHeight: z.number().int().positive().optional().describe("Reference canvas height in pixels. Defaults to 1080."),
    maxTextElements: z.number().int().positive().max(30).optional().describe("Maximum body text elements to draft after the title. Defaults to 10."),
    includeBackground: z.boolean().optional().describe("Include a full-screen background Panel. Defaults to true."),
    includeButtons: z.boolean().optional().describe("Convert explicit CTA/button/action labels into Button elements. Defaults to true."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    if (extname(resolved).toLowerCase() !== ".docx") {
      throw new Error(`draft_planning_intent_from_docx: expected a .docx file, got "${basename(resolved)}"`);
    }
    const extracted = await extractPlanningText(resolved);
    if (!extracted.ok || extracted.text === undefined) {
      throw new Error(`draft_planning_intent_from_docx: text extraction failed for "${resolved}": ${extracted.error ?? "no text extracted"}`);
    }
    const draft = draftPlanningIntentFromDocxText(
      { path: resolved, text: extracted.text },
      {
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        referenceHeight: args.referenceHeight,
        maxTextElements: args.maxTextElements,
        includeBackground: args.includeBackground,
        includeButtons: args.includeButtons,
      },
    );
    return {
      title: `draft_planning_intent_from_docx: ${draft.intent.screenName}`,
      output:
        formatDocxIntentDraft(draft) +
        "\n\nNext: call validate_planning_intent on metadata.intent, adjust if needed, then call create_ui_screen with intent=metadata.intent and source=metadata.source.",
      metadata: {
        ok: true,
        ...draft,
        source: { tool: "draft_planning_intent_from_docx", ...draft.source },
        extractedText: extracted,
      },
    };
  },
});
