import { basename, extname } from "node:path";
import {
  type EmbeddedImage,
  extractEmbeddedImages,
  type EmbeddedImageResult,
} from "./_embedded_images";
import {
  createImageReferenceScreenWithAsset,
  formatCreatedImageReferenceScreen,
  type CreatedImageReferenceScreen,
  type ImageAssetImporter,
  type ImageScreenCreator,
} from "./_image_intent_assets";

export interface DocxImageReferenceScreenOptions {
  imageNumber?: number;
  packagePath?: string;
  screenName?: string;
  referenceWidth?: number;
  clientHintId?: string;
  assetPath?: string;
  assetDir?: string;
  outputDir?: string;
  maxImages?: number;
}

export interface CreatedDocxImageReferenceScreen extends CreatedImageReferenceScreen {
  docx: {
    path: string;
    packagePath: string;
    imageNumber: number;
  };
  embeddedImage: EmbeddedImage;
  embeddedImages: EmbeddedImage[];
  extraction: EmbeddedImageResult;
}

export async function createDocxImageReferenceScreen(
  filePath: string,
  options: DocxImageReferenceScreenOptions,
  importer: ImageAssetImporter,
  creator: ImageScreenCreator,
): Promise<CreatedDocxImageReferenceScreen> {
  const extracted = await extractEmbeddedImages(filePath, {
    outputDir: options.outputDir,
    maxImages: options.maxImages,
  });
  if (!extracted.ok || extracted.images.length === 0) {
    throw new Error(`create_docx_image_reference_screen: no embedded raster images found in "${filePath}"`);
  }

  const selected = selectEmbeddedImage(extracted.images, options);
  const imageNumber = extracted.images.indexOf(selected) + 1;
  const created = await createImageReferenceScreenWithAsset(
    selected.path,
    {
      screenName: options.screenName?.trim() || defaultDocxScreenName(filePath, imageNumber),
      referenceWidth: options.referenceWidth ?? selected.width,
      clientHintId: options.clientHintId ?? `docx_image_${imageNumber}`,
      assetPath: options.assetPath,
      assetDir: options.assetDir,
    },
    importer,
    creator,
  );

  return {
    ...created,
    docx: {
      path: filePath,
      packagePath: selected.packagePath,
      imageNumber,
    },
    embeddedImage: selected,
    embeddedImages: extracted.images,
    extraction: extracted,
  };
}

export function formatCreatedDocxImageReferenceScreen(created: CreatedDocxImageReferenceScreen): string {
  return [
    `DOCX source: ${created.docx.path}`,
    `Embedded image: #${created.docx.imageNumber} ${created.docx.packagePath} -> ${created.embeddedImage.path}`,
    "",
    formatCreatedImageReferenceScreen(created),
  ].join("\n");
}

function selectEmbeddedImage(images: EmbeddedImage[], options: DocxImageReferenceScreenOptions): EmbeddedImage {
  if (options.packagePath !== undefined && options.packagePath.trim().length > 0) {
    const normalized = normalizePackagePath(options.packagePath);
    const found = images.find((image) => normalizePackagePath(image.packagePath) === normalized);
    if (found === undefined) {
      throw new Error(`create_docx_image_reference_screen: packagePath not found: ${options.packagePath}`);
    }
    return found;
  }

  const index = Math.max(1, Math.round(options.imageNumber ?? 1)) - 1;
  const selected = images[index];
  if (selected === undefined) {
    throw new Error(`create_docx_image_reference_screen: imageNumber ${index + 1} is out of range (1-${images.length})`);
  }
  return selected;
}

function defaultDocxScreenName(filePath: string, imageNumber: number): string {
  const stem = basename(filePath, extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
  return `${stem || "Docx"}Image${imageNumber}`;
}

function normalizePackagePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}
