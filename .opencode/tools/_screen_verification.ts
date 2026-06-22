import { pathToFileURL } from "node:url";
import {
  compareImageFiles,
  type CompareImagesOptions,
  type CompareImagesResult,
  verdictForImageComparison,
} from "./_image";
import { resolveCandidate, rootDir } from "./_materials";
import { persistPreview } from "./_preview";

export interface CapturePreviewResponse {
  screenId?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  base64Data?: string;
  size?: number;
}

export interface VerifyScreenArgs extends CompareImagesOptions {
  screenId: string;
  referencePath: string;
}

export interface VerifyScreenOptions {
  directory: string;
  capturePreview: (screenId: string) => Promise<CapturePreviewResponse>;
  now?: () => number;
}

export interface VerifiedScreen {
  ok: true;
  screenId: string;
  verdict: "close" | "needs review" | "different";
  preview: {
    ok: true;
    screenId: string;
    savedPath: string;
    uri: string;
    mimeType: string;
    width?: number;
    height?: number;
    size?: number;
  };
  comparison: CompareImagesResult & {
    ok: true;
    verdict: "close" | "needs review" | "different";
    uri: string;
  };
}

export async function verifyScreenAgainstReference(
  args: VerifyScreenArgs,
  options: VerifyScreenOptions,
): Promise<VerifiedScreen> {
  const root = rootDir(options.directory);
  const referencePath = resolveCandidate(args.referencePath, root);
  const captured = await options.capturePreview(args.screenId);
  const mimeType = captured.mimeType ?? "image/png";
  if (typeof captured.base64Data !== "string" || captured.base64Data.length === 0) {
    throw new Error(`verify_screen_against_reference: Unity returned no base64Data for screen ${args.screenId}`);
  }

  const persisted = await persistPreview(captured.base64Data, args.screenId, mimeType, { now: options.now });
  const comparison = await compareImageFiles(referencePath, persisted.absPath, {
    maxWidth: args.maxWidth,
    maxHeight: args.maxHeight,
    threshold: args.threshold,
    outputPath: args.outputPath,
  });
  const verdict = verdictForImageComparison(comparison);

  return {
    ok: true,
    screenId: args.screenId,
    verdict,
    preview: {
      ok: true,
      screenId: args.screenId,
      savedPath: persisted.absPath,
      uri: persisted.uri,
      mimeType,
      width: captured.width,
      height: captured.height,
      size: captured.size,
    },
    comparison: {
      ok: true,
      verdict,
      uri: pathToFileURL(comparison.diffPath).toString(),
      ...comparison,
    },
  };
}
