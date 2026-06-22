/**
 * draft_planning_intent_from_document - extracted document text to PlanningIntent.
 *
 * Converts text-forward planning files into editable Unity UI drafts. Use this
 * for PDF, DOCX, Markdown, text, CSV, or JSON files when their body text defines
 * screen copy, sections, requirements, or CTA labels.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { draftPlanningIntentFromDocumentText, formatDocumentIntentDraft } from "./_document_intent_draft";
import { extractPlanningText, resolveCandidate, rootDir } from "./_materials";

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".csv", ".json"]);

export default tool({
  description:
    "Draft a valid PlanningIntent from a text-forward planning document (PDF, DOCX, Markdown, text, CSV, or JSON). Use before validate_planning_intent/create_ui_screen when a document defines screen copy, sections, requirements, or CTA labels.",
  args: {
    path: z.string().describe("Document path (absolute, or relative to UNITY_MCP_MATERIALS_DIR/session cwd). Supports PDF, DOCX, Markdown, text, CSV, and JSON."),
    screenName: z.string().optional().describe("Optional PlanningIntent screenName override."),
    referenceWidth: z.number().int().positive().optional().describe("Reference canvas width in pixels. Defaults to 1920."),
    referenceHeight: z.number().int().positive().optional().describe("Reference canvas height in pixels. Defaults to 1080."),
    maxTextElements: z.number().int().positive().max(30).optional().describe("Maximum body text elements to draft after the title. Defaults to 10."),
    includeBackground: z.boolean().optional().describe("Include a full-screen background Panel. Defaults to true."),
    includeButtons: z.boolean().optional().describe("Convert explicit CTA/button/action labels into Button elements. Defaults to true."),
  },
  async execute(args, ctx) {
    const resolved = resolveCandidate(args.path, rootDir(ctx.directory));
    const ext = extname(resolved).toLowerCase();
    if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) {
      throw new Error(`draft_planning_intent_from_document: expected a supported document file, got "${basename(resolved)}"`);
    }
    const extracted = await extractPlanningText(resolved);
    if (!extracted.ok || extracted.text === undefined) {
      throw new Error(`draft_planning_intent_from_document: text extraction failed for "${resolved}": ${extracted.error ?? "no text extracted"}`);
    }
    const kind = extracted.kind === "plain-text" ? ext.replace(/^\./, "") || "text" : extracted.kind;
    const draft = draftPlanningIntentFromDocumentText(
      { path: resolved, text: extracted.text, kind },
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
      title: `draft_planning_intent_from_document: ${draft.intent.screenName}`,
      output:
        formatDocumentIntentDraft(draft) +
        "\n\nNext: call validate_planning_intent on metadata.intent, adjust if needed, then call create_ui_screen with intent=metadata.intent and source=metadata.source.",
      metadata: {
        ok: true,
        ...draft,
        source: { tool: "draft_planning_intent_from_document", ...draft.source },
        extractedText: extracted,
      },
    };
  },
});
