import {
  draftPlanningIntentFromDocumentText,
  formatDocumentIntentDraft,
  type DocumentIntentDraft,
  type DocumentIntentDraftOptions,
} from "./_document_intent_draft";

export type DocxIntentDraftOptions = DocumentIntentDraftOptions;
export type DocxIntentDraft = DocumentIntentDraft;

export function draftPlanningIntentFromDocxText(
  source: { path: string; text: string },
  options: DocxIntentDraftOptions = {},
): DocxIntentDraft {
  return draftPlanningIntentFromDocumentText(
    { ...source, kind: "docx" },
    { ...options, clientHintPrefix: options.clientHintPrefix ?? "docx" },
  );
}

export function formatDocxIntentDraft(draft: DocxIntentDraft): string {
  return formatDocumentIntentDraft(draft);
}
