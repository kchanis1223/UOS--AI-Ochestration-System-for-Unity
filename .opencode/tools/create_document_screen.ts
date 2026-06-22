/**
 * create_document_screen - text-forward document -> PlanningIntent -> Unity screen.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { basename, extname } from "node:path";
import { call } from "./_bridge";
import { normalizeIntentForBridge } from "./_planning_intent";
import {
  createDocumentScreen,
  formatCreatedDocumentScreen,
  type CreateDocumentScreenResult,
} from "./_document_screen";
import { resolveCandidate, rootDir } from "./_materials";

const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".csv", ".json"]);

export default tool({
  description:
    "Create a Unity UI screen directly from a text-forward planning document (PDF, DOCX, Markdown, text, CSV, or JSON): extract text, draft a PlanningIntent, validate it, and call create_ui_screen.",
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
      throw new Error(`create_document_screen: expected a supported document file, got "${basename(resolved)}"`);
    }

    const created = await createDocumentScreen(
      resolved,
      {
        screenName: args.screenName,
        referenceWidth: args.referenceWidth,
        referenceHeight: args.referenceHeight,
        maxTextElements: args.maxTextElements,
        includeBackground: args.includeBackground,
        includeButtons: args.includeButtons,
      },
      async (intent) => {
        const result = await call("create_ui_screen", { intent: normalizeIntentForBridge(intent) }) as CreateDocumentScreenResult;
        return result;
      },
    );

    return {
      title: `create_document_screen: ${created.draft.intent.screenName} -> ${created.created.screenId}`,
      output:
        formatCreatedDocumentScreen(created) +
        "\n\nNext: call capture_preview, inspect the result, then use update_ui_element/move_ui_element for follow-up edits.",
      metadata: {
        ok: true,
        screenId: created.created.screenId,
        elements: created.created.elements,
        intent: created.draft.intent,
        draft: created.draft,
        source: created.source,
        extractedText: created.extractedText,
        warnings: created.warnings,
        validation: created.validation,
        created: created.created,
      },
    };
  },
});
