import { tool } from "@opencode-ai/plugin";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  comparisonAttachmentsForContext,
  formatUosContext,
  launchMaterialAttachmentsForContext,
  loadUosContext,
  previewAttachmentsForContext,
  recommendedLaunchWorkflow,
  sourceMaterialAttachmentsForContext,
  sourceReferenceAttachmentsForContext,
} from "./_uos_context";
import { readActiveUnityTarget, type ActiveUnityTargetState, type UnityTargetEntry } from "./_unity_target_state";

const BRIDGE_CAPABILITY_CONTRACT = loadBridgeCapabilityContract();
const REQUIRED_UNITY_BRIDGE_TOOLS = BRIDGE_CAPABILITY_CONTRACT.requiredTools;
const REQUIRED_UNITY_WRITE_TOOLS = BRIDGE_CAPABILITY_CONTRACT.requiredWriteTools;

function loadBridgeCapabilityContract(): { requiredTools: string[]; requiredWriteTools: string[] } {
  const candidatePaths = [
    fileURLToPath(new URL("../../bridge-capabilities.json", import.meta.url)),
    fileURLToPath(new URL("../bridge-capabilities.json", import.meta.url)),
  ];
  const contractPath = candidatePaths.find((candidate) => fileExists(candidate));
  if (contractPath === undefined) {
    throw new Error(`get_uos_context: failed to find bridge capability contract in ${candidatePaths.join(", ")}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(contractPath, "utf8"));
  } catch (err) {
    throw new Error(`get_uos_context: failed to read bridge capability contract: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    requiredTools: normalizeContractToolList((parsed as any)?.requiredTools, "requiredTools"),
    requiredWriteTools: normalizeContractToolList((parsed as any)?.requiredWriteTools, "requiredWriteTools"),
  };
}

function fileExists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

function normalizeContractToolList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`get_uos_context: bridge capability contract field ${field} must be an array`);
  }
  const tools = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  if (tools.length !== value.length) {
    throw new Error(`get_uos_context: bridge capability contract field ${field} contains invalid tool names`);
  }
  return [...new Set(tools)];
}

export default tool({
  description:
    "Load the selected Unity project's persisted UOS context plus launch material candidates from attached image/document/PPTX files. Use this near the start of a conversational editing session.",
  args: {
    projectDir: z
      .string()
      .optional()
      .describe("Unity project root. Defaults to UOS_PROJECT_DIR, then UOS_CONTEXT_DIR parent, then the current session directory."),
    maxJournalEntries: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe("Maximum number of recent journal entries to include. Defaults to 20."),
    maxPreviewAttachments: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Maximum number of existing captured preview images to attach for vision. Defaults to 3."),
    maxLaunchMaterialAttachments: z
      .number()
      .int()
      .min(0)
      .max(50)
      .optional()
      .describe("Maximum number of launch-attached material files to return as file attachments. Defaults to 10."),
    maxSourceReferenceAttachments: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Maximum number of source/reference images from persisted screen source metadata to attach. Defaults to 5."),
    maxSourceMaterialAttachments: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Maximum number of original source material files from persisted screen source metadata to attach. Defaults to 5."),
    maxComparisonAttachments: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Maximum number of persisted visual diff images from compare_images to attach. Defaults to 3."),
    maxMaterialCandidates: z
      .number()
      .int()
      .min(0)
      .max(50)
      .optional()
      .describe("Maximum number of launch planning material candidates to summarize. Defaults to UOS_MAX_MATERIAL_CANDIDATES, then 12."),
    maxMaterialDepth: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Maximum planning material directory recursion depth for context candidate summaries. Defaults to UOS_MAX_MATERIAL_DEPTH, then 4."),
    maxMaterialScanFiles: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .describe("Maximum number of files to inspect while summarizing launch planning material candidates. Defaults to UOS_MAX_MATERIAL_SCAN_FILES, then 500."),
  },
  async execute(args, ctx) {
    const baseEnv =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const activeUnityTarget = await readActiveUnityTarget({ env: baseEnv, cwd: ctx.directory });
    const env = activeUnityTarget !== undefined
      ? envWithUnityTarget(baseEnv, activeUnityTarget.target, activeUnityTarget.stateFile)
      : baseEnv;
    const projectDir = firstNonBlank(args.projectDir, env.UOS_PROJECT_DIR);
    const contextDir = projectDir === undefined ? firstNonBlank(env.UOS_CONTEXT_DIR) : undefined;
    const launchInputs = {
      planningMaterialsDir: firstNonBlank(env.UNITY_MCP_MATERIALS_DIR),
      attachedFiles: parseAttachedFiles(env.UOS_ATTACHED_FILES),
    };
    const maxMaterialCandidates = args.maxMaterialCandidates
      ?? parseEnvBoundedInt(env.UOS_MAX_MATERIAL_CANDIDATES, 0, 50);
    const maxMaterialDepth = args.maxMaterialDepth
      ?? parseEnvBoundedInt(env.UOS_MAX_MATERIAL_DEPTH, 0, 20);
    const maxMaterialScanFiles = args.maxMaterialScanFiles
      ?? parseEnvBoundedInt(env.UOS_MAX_MATERIAL_SCAN_FILES, 1, 5000);
    const context = await loadUosContext(contextDir !== undefined
      ? {
        contextDir,
        maxJournalEntries: args.maxJournalEntries,
        maxMaterialCandidates,
        maxMaterialDepth,
        maxMaterialScanFiles,
        ...launchInputs,
      }
      : {
        projectDir: projectDir ?? ctx.directory,
        maxJournalEntries: args.maxJournalEntries,
        maxMaterialCandidates,
        maxMaterialDepth,
        maxMaterialScanFiles,
        ...launchInputs,
      });
    const launchMaterialAttachments = await launchMaterialAttachmentsForContext(
      context,
      args.maxLaunchMaterialAttachments,
    );
    const previewAttachments = await previewAttachmentsForContext(context, args.maxPreviewAttachments);
    const sourceReferenceAttachments = await sourceReferenceAttachmentsForContext(
      context,
      args.maxSourceReferenceAttachments,
    );
    const sourceMaterialAttachments = await sourceMaterialAttachmentsForContext(
      context,
      args.maxSourceMaterialAttachments,
    );
    const comparisonAttachments = await comparisonAttachmentsForContext(
      context,
      args.maxComparisonAttachments,
    );
    const attachments = uniqueToolAttachments([
      ...launchMaterialAttachments,
      ...sourceMaterialAttachments,
      ...sourceReferenceAttachments,
      ...comparisonAttachments,
      ...previewAttachments,
    ]);
    const launchWorkflow = recommendedLaunchWorkflow(context);
    const selectedUnity = selectedUnityFromEnv(env, context.projectDir, activeUnityTarget);
    const selectedUnityOutput = formatSelectedUnity(selectedUnity);
    const selectedUnityReadinessOutput = formatSelectedUnityReadiness(selectedUnity);
    const output = [
      formatUosContext(context),
      selectedUnityOutput !== undefined ? `\n${selectedUnityOutput}` : "",
      selectedUnityReadinessOutput !== undefined ? `\n${selectedUnityReadinessOutput}` : "",
      launchMaterialAttachments.length > 0
        ? `\nAttached launch material file(s): ${launchMaterialAttachments.length}`
        : "",
      previewAttachments.length > 0
        ? `\nAttached latest preview image(s) for vision: ${previewAttachments.length}`
        : "",
      sourceReferenceAttachments.length > 0
        ? `\nAttached source/reference image(s) for vision: ${sourceReferenceAttachments.length}`
        : "",
      sourceMaterialAttachments.length > 0
        ? `\nAttached persisted source material file(s): ${sourceMaterialAttachments.length}`
        : "",
      comparisonAttachments.length > 0
        ? `\nAttached visual diff image(s) for vision: ${comparisonAttachments.length}`
        : "",
    ].join("");
    const hasLaunchInputs = context.planningMaterialsDir !== undefined || context.attachedFiles.length > 0;
    return {
      title: context.hasContext || hasLaunchInputs ? "get_uos_context: loaded" : "get_uos_context: empty",
      output,
      metadata: {
        ok: true,
        ...context,
        launchMaterialAttachments,
        previewAttachments,
        sourceMaterialAttachments,
        sourceReferenceAttachments,
        comparisonAttachments,
        recommendedLaunchWorkflow: launchWorkflow,
        selectedUnity,
      },
      attachments,
    };
  },
});

function envWithUnityTarget(
  env: Record<string, string | undefined>,
  target: UnityTargetEntry,
  stateFile: string | undefined,
): Record<string, string | undefined> {
  return {
    ...env,
    UNITY_MCP_HOST: target.host,
    UNITY_MCP_PORT: target.port !== undefined ? String(target.port) : undefined,
    UNITY_MCP_TOKEN: target.token ?? "",
    UOS_PROJECT_DIR: target.projectPath,
    UOS_PROJECT_NAME: target.projectName,
    UOS_CONTEXT_DIR: target.projectPath !== undefined ? path.join(target.projectPath, ".uos") : env.UOS_CONTEXT_DIR,
    UOS_EDITOR_INSTANCE_ID: target.instanceId,
    UOS_TARGET_SESSION_FILE: stateFile ?? env.UOS_TARGET_SESSION_FILE,
  };
}

interface SelectedUnityContext {
  projectDir?: string;
  projectName?: string;
  editorInstanceId?: string;
  selectionSource?: "env" | "session";
  targetStateFile?: string;
  bridge?: {
    host: string;
    port: string;
  };
  supportedTools?: string[];
  writeTools?: string[];
  capabilityError?: string;
  bridgeReadiness?: {
    ready: boolean;
    blockers: string[];
    warnings: string[];
    requiredTools: string[];
    requiredWriteTools: string[];
    missingTools?: string[];
    missingWriteTools?: string[];
  };
  hasBridgeEnv: boolean;
}

function selectedUnityFromEnv(
  env: Record<string, string | undefined>,
  contextProjectDir: string,
  activeUnityTarget?: ActiveUnityTargetState,
): SelectedUnityContext {
  const host = firstNonBlank(env.UNITY_MCP_HOST);
  const port = firstNonBlank(env.UNITY_MCP_PORT);
  const projectDir = firstNonBlank(env.UOS_PROJECT_DIR, contextProjectDir);
  const projectName = firstNonBlank(env.UOS_PROJECT_NAME);
  const editorInstanceId = firstNonBlank(env.UOS_EDITOR_INSTANCE_ID);
  const supportedTools = parseStringArrayEnv(env.UOS_BRIDGE_SUPPORTED_TOOLS);
  const writeTools = parseStringArrayEnv(env.UOS_BRIDGE_WRITE_TOOLS);
  const capabilityError = firstNonBlank(env.UOS_BRIDGE_CAPABILITY_ERROR);
  const selected: SelectedUnityContext = {
    hasBridgeEnv: host !== undefined && port !== undefined,
  };
  if (projectDir !== undefined) selected.projectDir = projectDir;
  if (projectName !== undefined) selected.projectName = projectName;
  if (editorInstanceId !== undefined) selected.editorInstanceId = editorInstanceId;
  if (activeUnityTarget?.source !== undefined) selected.selectionSource = activeUnityTarget.source;
  if (activeUnityTarget?.stateFile !== undefined) selected.targetStateFile = activeUnityTarget.stateFile;
  if (host !== undefined && port !== undefined) selected.bridge = { host, port };
  if (supportedTools !== undefined) selected.supportedTools = supportedTools;
  if (writeTools !== undefined) selected.writeTools = writeTools;
  if (capabilityError !== undefined) selected.capabilityError = capabilityError;
  if (
    selected.hasBridgeEnv
    || selected.supportedTools !== undefined
    || selected.writeTools !== undefined
    || selected.capabilityError !== undefined
  ) {
    selected.bridgeReadiness = evaluateSelectedUnityBridge(selected);
  }
  return selected;
}

function formatSelectedUnity(selected: SelectedUnityContext): string | undefined {
  if (
    selected.projectDir === undefined
    && selected.projectName === undefined
    && selected.editorInstanceId === undefined
    && selected.bridge === undefined
  ) {
    return undefined;
  }
  const identity = selected.projectName !== undefined
    ? `${selected.projectName}${selected.projectDir !== undefined ? ` at ${selected.projectDir}` : ""}`
    : selected.projectDir;
  const parts = [
    `[uos context] selectedUnity: ${identity ?? "(unknown project)"}`,
    selected.editorInstanceId !== undefined ? `editor=${selected.editorInstanceId}` : undefined,
    selected.selectionSource !== undefined ? `source=${selected.selectionSource}` : undefined,
    selected.targetStateFile !== undefined ? `state=${selected.targetStateFile}` : undefined,
    selected.bridge !== undefined ? `bridge=${selected.bridge.host}:${selected.bridge.port}` : undefined,
    selected.supportedTools !== undefined ? `tools=${selected.supportedTools.length} supported` : undefined,
    selected.writeTools !== undefined
      ? `writeTools=${selected.writeTools.length > 0 ? selected.writeTools.join(",") : "0"}`
      : undefined,
    selected.bridgeReadiness?.missingTools !== undefined
      ? `requiredTools=${REQUIRED_UNITY_BRIDGE_TOOLS.length - selected.bridgeReadiness.missingTools.length}/${REQUIRED_UNITY_BRIDGE_TOOLS.length}`
      : undefined,
    selected.bridgeReadiness?.missingTools !== undefined && selected.bridgeReadiness.missingTools.length > 0
      ? `missingTools=${selected.bridgeReadiness.missingTools.join(",")}`
      : undefined,
    selected.bridgeReadiness?.missingWriteTools !== undefined
      ? `requiredWriteTools=${REQUIRED_UNITY_WRITE_TOOLS.length - selected.bridgeReadiness.missingWriteTools.length}/${REQUIRED_UNITY_WRITE_TOOLS.length}`
      : undefined,
    selected.bridgeReadiness?.missingWriteTools !== undefined && selected.bridgeReadiness.missingWriteTools.length > 0
      ? `missingWriteTools=${selected.bridgeReadiness.missingWriteTools.join(",")}`
      : undefined,
    selected.capabilityError !== undefined ? `capabilityError=${selected.capabilityError}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join(" ");
}

function formatSelectedUnityReadiness(selected: SelectedUnityContext): string | undefined {
  const readiness = selected.bridgeReadiness;
  if (readiness === undefined) return undefined;
  const status = readiness.blockers.length > 0
    ? "blocked"
    : readiness.warnings.length > 0 ? "warning" : "ready";
  const lines = [`[uos context] bridgeReadiness: ${status}`];
  for (const blocker of readiness.blockers.slice(0, 6)) {
    lines.push(`  - blocker: ${blocker}`);
  }
  if (readiness.blockers.length > 6) {
    lines.push(`  - ... ${readiness.blockers.length - 6} more blocker(s) omitted`);
  }
  for (const warning of readiness.warnings.slice(0, 4)) {
    lines.push(`  - warning: ${warning}`);
  }
  if (readiness.warnings.length > 4) {
    lines.push(`  - ... ${readiness.warnings.length - 4} more warning(s) omitted`);
  }
  if (status === "blocked") {
    lines.push("  - next: do not mutate Unity until the selected bridge reports the required editing tools; run get_project_info or uos doctor --runtime after updating the UOS Unity package.");
  } else if (status === "warning") {
    lines.push("  - next: proceed carefully; call get_project_info before write operations if capability metadata is missing.");
  }
  return lines.join("\n");
}

function evaluateSelectedUnityBridge(selected: SelectedUnityContext): NonNullable<SelectedUnityContext["bridgeReadiness"]> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let missingRequiredTools: string[] | undefined;
  let missingRequiredWriteTools: string[] | undefined;

  if (selected.capabilityError !== undefined) {
    blockers.push(`Unity bridge capability probe failed: ${selected.capabilityError}`);
  }
  if (selected.supportedTools !== undefined) {
    missingRequiredTools = missingTools(REQUIRED_UNITY_BRIDGE_TOOLS, selected.supportedTools);
    if (missingRequiredTools.length > 0) {
      blockers.push(`Unity bridge missing required tool(s): ${missingRequiredTools.join(", ")}`);
    }
  } else if (selected.hasBridgeEnv && selected.capabilityError === undefined) {
    warnings.push("Unity bridge did not report supportedTools");
  }
  if (selected.writeTools !== undefined) {
    missingRequiredWriteTools = missingTools(REQUIRED_UNITY_WRITE_TOOLS, selected.writeTools);
    if (missingRequiredWriteTools.length > 0) {
      blockers.push(`Unity bridge missing required write tool(s): ${missingRequiredWriteTools.join(", ")}`);
    }
  } else if (selected.hasBridgeEnv && selected.capabilityError === undefined) {
    warnings.push("Unity bridge did not report writeTools");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    requiredTools: REQUIRED_UNITY_BRIDGE_TOOLS,
    requiredWriteTools: REQUIRED_UNITY_WRITE_TOOLS,
    missingTools: missingRequiredTools,
    missingWriteTools: missingRequiredWriteTools,
  };
}

function missingTools(required: string[], available: string[]): string[] {
  const availableSet = new Set(available);
  return required.filter((name) => !availableSet.has(name));
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function parseAttachedFiles(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
    }
  } catch {
    // Older launcher/debug values can still be useful as a delimited list.
  }
  return trimmed
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseStringArrayEnv(value: string | undefined): string[] | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return undefined;
    const items = parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
    return [...new Set(items)];
  } catch {
    return undefined;
  }
}

function parseEnvBoundedInt(value: string | undefined, min: number, max: number): number | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function uniqueToolAttachments(
  attachments: Array<{ type: "file"; mime: string; url: string; filename: string }>,
) {
  const seen = new Set<string>();
  const result: Array<{ type: "file"; mime: string; url: string; filename: string }> = [];
  for (const attachment of attachments) {
    if (seen.has(attachment.url)) continue;
    seen.add(attachment.url);
    result.push({
      type: attachment.type,
      mime: attachment.mime,
      url: attachment.url,
      filename: attachment.filename,
    });
  }
  return result;
}
