/**
 * select_uos_mode - local orchestration helper.
 *
 * The Orchestrator uses this before internal submodel handoff work so mode
 * choice is explicit, inspectable, and testable. This tool never mutates Unity.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
// @ts-expect-error - shared pure-JS mode registry (no type declarations).
import { listUosModes, selectUosMode } from "../../bin/mode-core.js";

export default tool({
  description:
    "Select the best UOS work mode for a user request without mutating Unity. Use this at the start of an Orchestrator turn to route work to kiosk, screen-from-material, scene-object, visual-repair, inspection, code-editor, or constrained general fallback methods.",
  args: {
    request: z.string().describe("The user's current request or the Orchestrator's concise task brief."),
    materialsDir: z
      .string()
      .optional()
      .describe("Planning material root, if known. Defaults can also come from UNITY_MCP_MATERIALS_DIR."),
    attachedFiles: z.array(z.string()).optional().describe("Planning files attached or selected for this run."),
    contextSummary: z
      .string()
      .optional()
      .describe("Concise persisted UOS context summary, if already loaded."),
    listOnly: z.boolean().optional().describe("Return all registered modes without selecting a mode."),
  },
  async execute(args) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    if (args.listOnly === true) {
      const modes = listUosModes();
      return {
        title: `select_uos_mode: ${modes.length} registered mode(s)`,
        output: formatModeList(modes),
        metadata: { ok: true, modes },
      };
    }

    const attachedFiles = args.attachedFiles ?? parseAttachedFiles(env.UOS_ATTACHED_FILES);
    const selection = selectUosMode({
      request: args.request,
      materialsDir: args.materialsDir ?? env.UNITY_MCP_MATERIALS_DIR,
      attachedFiles,
      contextSummary: args.contextSummary ?? env.UOS_CONTEXT_SUMMARY,
    });
    return {
      title: `select_uos_mode: ${selection.selectedMode.id} (${selection.confidence})`,
      output: formatSelection(selection),
      metadata: { ok: true, ...selection },
    };
  },
});

function parseAttachedFiles(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // Fall through to delimiter parsing.
  }
  return value.split(/[;\n]/).map((item) => item.trim()).filter(Boolean);
}

function formatModeList(modes: any[]): string {
  return modes
    .map((mode) => [
      `- ${mode.id}: ${mode.title}`,
      `  submodels: ${formatSubmodels(mode)}`,
      mode.recipeFile ? `  recipe: ${mode.recipe} (${mode.recipeFile})` : "",
      `  primary handoff: ${mode.handoffFile}`,
      `  plan/build: ${mode.planArtifact} -> ${mode.buildArtifact}`,
      `  tools: ${mode.primaryTools.join(", ")}`,
    ].filter(Boolean).join("\n"))
    .join("\n");
}

function formatSelection(selection: any): string {
  const mode = selection.selectedMode;
  const candidates = selection.candidates
    .filter((candidate: any) => candidate.score > 0)
    .slice(0, 4)
    .map((candidate: any) => `${candidate.modeId}:${candidate.score}`)
    .join(", ");
  return [
    `Selected mode: ${mode.id} (${mode.title})`,
    `Confidence: ${selection.confidence}; score: ${selection.score}`,
    `Internal submodels: ${formatSubmodels(mode)}`,
    mode.recipeFile ? `Recipe: ${mode.recipe} (${mode.recipeFile})` : "",
    `Primary handoff file: ${mode.handoffFile}`,
    `Plan/build artifacts: ${mode.planArtifact} -> ${mode.buildArtifact}`,
    `Editor boundary: ${mode.editorRole}`,
    selection.reasons.length > 0 ? `Reasons:\n${selection.reasons.map((r: string) => `- ${r}`).join("\n")}` : "",
    candidates.length > 0 ? `Candidate scores: ${candidates}` : "Candidate scores: none",
    `Next actions:\n${selection.nextActions.map((a: string) => `- ${a}`).join("\n")}`,
  ].filter(Boolean).join("\n");
}

function formatSubmodels(mode: any): string {
  if (Array.isArray(mode.submodels) && mode.submodels.length > 0) {
    return mode.submodels.join(", ");
  }
  return mode.specialist;
}
