import { extname } from "node:path";
import {
  draftPlanningIntentFromDocumentText,
  formatDocumentIntentDraft,
  type DocumentIntentDraft,
  type DocumentIntentDraftOptions,
} from "./_document_intent_draft";
import { extractPlanningText, type TextExtraction } from "./_materials";
import { validatePlanningIntent, type PlanningIntentValidation } from "./_planning_intent";

export interface DocumentScreenOptions extends DocumentIntentDraftOptions {}

export interface CreateDocumentScreenResult {
  screenId: string;
  elements: Array<{ clientHintId?: string; elementId: string }>;
}

export type DocumentScreenCreator = (intent: DocumentIntentDraft["intent"]) => Promise<CreateDocumentScreenResult>;

export interface PreparedDocumentScreen {
  draft: DocumentIntentDraft;
  extractedText: TextExtraction;
  source: {
    tool: "create_document_screen";
    kind: string;
    path: string;
  };
  validation: PlanningIntentValidation;
}

export interface CreatedDocumentScreen extends PreparedDocumentScreen {
  created: CreateDocumentScreenResult;
  warnings: string[];
}

export async function prepareDocumentScreenDraft(
  filePath: string,
  options: DocumentScreenOptions = {},
): Promise<PreparedDocumentScreen> {
  const extracted = await extractPlanningText(filePath);
  if (!extracted.ok || extracted.text === undefined) {
    throw new Error(`create_document_screen: text extraction failed for "${filePath}": ${extracted.error ?? "no text extracted"}`);
  }
  const kind = extracted.kind === "plain-text" ? extname(filePath).replace(/^\./, "") || "text" : extracted.kind;
  const draft = draftPlanningIntentFromDocumentText(
    { path: filePath, text: extracted.text, kind },
    options,
  );
  const validation = validatePlanningIntent(draft.intent);
  return {
    draft,
    extractedText: extracted,
    source: {
      tool: "create_document_screen",
      kind: draft.source.kind,
      path: draft.source.path,
    },
    validation,
  };
}

export async function createDocumentScreen(
  filePath: string,
  options: DocumentScreenOptions,
  creator: DocumentScreenCreator,
): Promise<CreatedDocumentScreen> {
  const prepared = await prepareDocumentScreenDraft(filePath, options);
  return createPreparedDocumentScreen(prepared, creator);
}

export async function createPreparedDocumentScreen(
  prepared: PreparedDocumentScreen,
  creator: DocumentScreenCreator,
): Promise<CreatedDocumentScreen> {
  if (!prepared.validation.ok) {
    throw new Error(`create_document_screen: draft validation failed: ${prepared.validation.errors.join("; ")}`);
  }
  const created = await creator(prepared.draft.intent);
  return {
    ...prepared,
    created,
    warnings: [...prepared.draft.warnings, ...prepared.validation.warnings],
  };
}

export function formatCreatedDocumentScreen(created: CreatedDocumentScreen): string {
  const mappingRows = created.created.elements
    .map((pair, index) => `| ${index + 1} | ${pair.clientHintId ?? "(none)"} | ${pair.elementId} |`)
    .join("\n");
  const mappingTable = created.created.elements.length > 0
    ? `\n\n| # | clientHintId | elementId |\n|---|---|---|\n${mappingRows}`
    : "";
  const warningText = created.warnings.length > 0
    ? `\n\nWarnings:\n${created.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : "";
  return [
    `Created document screen "${created.draft.intent.screenName}" (id=${created.created.screenId}).`,
    `Source: ${created.source.path} (${created.source.kind})`,
    `Reference canvas: ${created.draft.intent.referenceCanvas.width}x${created.draft.intent.referenceCanvas.height}`,
    `Draft elements: ${created.draft.intent.elements.length}`,
    "",
    formatDocumentIntentDraft(created.draft),
  ].join("\n") + mappingTable + warningText;
}
