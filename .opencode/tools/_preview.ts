import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PersistPreviewOptions {
  outputDir?: string;
  now?: () => number;
}

export interface PersistedPreview {
  absPath: string;
  uri: string;
  filename: string;
}

export async function persistPreview(
  base64Data: string,
  screenId: string,
  mimeType: string,
  options: PersistPreviewOptions = {},
): Promise<PersistedPreview> {
  const dir = options.outputDir ?? join(tmpdir(), "oh-my-unity", "previews");
  await mkdir(dir, { recursive: true });
  const ext = extensionForMimeType(mimeType);
  const absPath = join(dir, `preview-${safeFileStem(screenId)}-${options.now?.() ?? Date.now()}.${ext}`);
  await writeFile(absPath, Buffer.from(base64Data, "base64"));
  return {
    absPath,
    uri: pathToFileURL(absPath).toString(),
    filename: basename(absPath),
  };
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    default: {
      const subtype = mimeType.split("/")[1]?.replace(/[^a-zA-Z0-9]+/g, "");
      return subtype && subtype.length > 0 ? subtype : "bin";
    }
  }
}

function safeFileStem(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "screen";
}
