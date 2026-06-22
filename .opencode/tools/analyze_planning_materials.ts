import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  analyzePlanningMaterials,
  formatPlanningMaterialsBrief,
} from "./_planning_brief";
import { rootDir } from "./_materials";

export default tool({
  description:
    "Create a concise planning-material brief from the material folder and launch-attached files. Use it at the start of a UOS session to choose which image, video, DOCX, PDF, or PPTX files to inspect first. Video is filename/metadata-only content media.",
  args: {
    dir: z
      .string()
      .optional()
      .describe("Optional directory to scan, absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd. Defaults to the material root."),
    files: z
      .array(z.string())
      .max(100)
      .optional()
      .describe("Extra material files to include, absolute or relative to UNITY_MCP_MATERIALS_DIR/session cwd."),
    includeLaunchAttached: z
      .boolean()
      .optional()
      .describe("Include files from UOS_ATTACHED_FILES. Defaults to true."),
    recursive: z
      .boolean()
      .optional()
      .describe("Recursively scan the material directory. Defaults to true."),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(20)
      .optional()
      .describe("Maximum recursion depth when recursive=true. Defaults to 4."),
    maxFiles: z
      .number()
      .int()
      .positive()
      .max(5000)
      .optional()
      .describe("Maximum directory material files to inspect. Defaults to 500."),
    maxTextFiles: z
      .number()
      .int()
      .min(0)
      .max(50)
      .optional()
      .describe("Maximum non-image files to read for short text excerpts. Defaults to 8."),
    maxTextCharsPerFile: z
      .number()
      .int()
      .min(100)
      .max(20000)
      .optional()
      .describe("Maximum extracted text characters per non-image file. Defaults to 1500."),
  },
  async execute(args, ctx) {
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const attached = args.includeLaunchAttached === false
      ? []
      : parseAttachedFiles(env.UOS_ATTACHED_FILES);
    const brief = await analyzePlanningMaterials({
      root: rootDir(ctx.directory),
      dir: args.dir,
      files: [...attached, ...(args.files ?? [])],
      recursive: args.recursive,
      maxDepth: args.maxDepth,
      maxFiles: args.maxFiles,
      maxTextFiles: args.maxTextFiles,
      maxTextCharsPerFile: args.maxTextCharsPerFile,
    });

    return {
      title: `analyze_planning_materials: ${brief.total} material(s)`,
      output: formatPlanningMaterialsBrief(brief),
      metadata: { ok: true, ...brief },
    };
  },
});

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
    // Debug/manual launches may pass a delimited string.
  }
  return trimmed
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
