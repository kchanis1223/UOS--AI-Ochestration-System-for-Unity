import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { createDocumentScreen } from "../.opencode/tools/_document_screen.ts";
import { draftPlanningIntentFromDocumentText } from "../.opencode/tools/_document_intent_draft.ts";
import { extractEmbeddedImages } from "../.opencode/tools/_embedded_images.ts";
import { compareImageFiles, prepareVisionImageAttachment, preprocessImageFile } from "../.opencode/tools/_image.ts";
import { createScreenFromMaterial } from "../.opencode/tools/_material_screen.ts";
import { draftPlanningIntentFromDocxText } from "../.opencode/tools/_docx_intent_draft.ts";
import { draftPlanningIntentFromPptxLayout } from "../.opencode/tools/_intent_draft.ts";
import {
  extractPlanningText,
  guessMimeType,
  inspectPlanningMaterial,
  listPlanningMaterialFiles,
  SUPPORTED_EXTENSIONS,
} from "../.opencode/tools/_materials.ts";
import {
  validatePlanningIntent,
} from "../.opencode/tools/_planning_intent.ts";
import {
  analyzePlanningMaterials,
  formatPlanningMaterialsBrief,
} from "../.opencode/tools/_planning_brief.ts";
import {
  createImageReferenceScreenWithAsset,
  prepareImageIntentWithAsset,
} from "../.opencode/tools/_image_intent_assets.ts";
import { createPdfReferenceScreen } from "../.opencode/tools/_pdf_reference_screen.ts";
import { createDocxImageReferenceScreen } from "../.opencode/tools/_docx_reference_screen.ts";
import { createReferenceScreenFromMaterial } from "../.opencode/tools/_material_reference_screen.ts";
import {
  createPptxDeckScreensWithAssets,
  createPptxScreenWithAssets,
  preparePptxIntentWithAssets,
} from "../.opencode/tools/_pptx_intent_assets.ts";
import { extractPptxLayout, formatPptxLayout } from "../.opencode/tools/_pptx_layout.ts";
import { renderPdfPages, renderPptxToImages } from "../.opencode/tools/_render.ts";
import { verifyScreenAgainstReference } from "../.opencode/tools/_screen_verification.ts";
import readPlanningMaterialTool from "../.opencode/tools/read_planning_material.ts";
import pptxToImagesTool from "../.opencode/tools/pptx_to_images.ts";

describe("planning material extraction", () => {
  test("supports document and presentation planning material extensions", () => {
    expect(SUPPORTED_EXTENSIONS.has(".pptx")).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has(".docx")).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has(".md")).toBe(true);
    expect(SUPPORTED_EXTENSIONS.has(".mp4")).toBe(true);
    expect(guessMimeType(".docx")).toContain("wordprocessingml");
    expect(guessMimeType(".mp4")).toBe("video/mp4");
  });

  test("extracts plain text planning material", async () => {
    const dir = await tmpMaterialDir("plain");
    const file = join(dir, "brief.md");
    await writeFile(file, "# Kiosk Flow\n\nMain menu and detail screen.");

    try {
      const extracted = await extractPlanningText(file);
      expect(extracted.ok).toBe(true);
      expect(extracted.kind).toBe("plain-text");
      expect(extracted.text).toContain("Kiosk Flow");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("inspects image dimensions and PPTX structure for planning metadata", async () => {
    const dir = await tmpMaterialDir("inspect");
    const image = join(dir, "mockup.png");
    const deck = join(dir, "deck.pptx");
    const pngBytes = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: "#224466ff",
      },
    }).png().toBuffer();
    await writeFile(image, pngBytes);

    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml("Intro"));
    zip.file("ppt/slides/slide2.xml", slideXml("Settings"));
    zip.file("ppt/media/image1.png", pngBytes);
    await writeFile(deck, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const imageSummary = await inspectPlanningMaterial(image);
      expect(imageSummary.kind).toBe("image");
      expect(imageSummary.width).toBe(320);
      expect(imageSummary.height).toBe(180);
      expect(imageSummary.mimeType).toBe("image/png");

      const deckSummary = await inspectPlanningMaterial(deck);
      expect(deckSummary.kind).toBe("pptx");
      expect(deckSummary.slideCount).toBe(2);
      expect(deckSummary.embeddedImageCount).toBe(1);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("treats video planning material as metadata-only content media", async () => {
    const dir = await tmpMaterialDir("video-material");
    const video = join(dir, "intro.mp4");
    await writeFile(video, Buffer.from("fake video bytes"));

    try {
      const summary = await inspectPlanningMaterial(video);
      expect(summary.kind).toBe("video");
      expect(summary.mimeType).toBe("video/mp4");
      expect(summary.isImage).toBe(false);

      const listed = await listPlanningMaterialFiles(dir);
      expect(listed.entries).toHaveLength(1);
      expect(listed.entries[0]).toMatchObject({
        name: "intro.mp4",
        kind: "video",
        mimeType: "video/mp4",
      });

      const analyzed = await analyzePlanningMaterials({ root: dir, recursive: true });
      const item = analyzed.items[0];
      expect(item.kind).toBe("video");
      expect(item.extractedText).toBeUndefined();
      expect(item.recommendedTools).toEqual(["read_planning_material", "create_screen_from_material", "import_asset"]);
      expect(formatPlanningMaterialsBrief(analyzed)).toContain("video is treated as playable content media");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("read_planning_material downscales large planning images for vision attachment", async () => {
    const dir = await tmpMaterialDir("read-large-image");
    const image = join(dir, "kiosk-screen.png");
    await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 4,
        background: "#224466ff",
      },
    }).png().toFile(image);

    let toolAttachmentPath: string | undefined;
    try {
      const prepared = await prepareVisionImageAttachment(image, {
        maxWidth: 800,
        maxHeight: 800,
        outputDir: join(dir, "prepared"),
      });
      expect(prepared.resized).toBe(true);
      expect(prepared.width).toBeLessThanOrEqual(800);
      expect(prepared.height).toBeLessThanOrEqual(800);
      expect(prepared.mimeType).toBe("image/jpeg");
      expect(prepared.path).not.toBe(image);

      const result = await readPlanningMaterialTool.execute(
        { path: image },
        { directory: dir } as any,
      );
      expect(result.output).toContain("Vision attachment: downscaled copy");
      expect(result.metadata.visionImage.resized).toBe(true);
      expect(result.metadata.visionImage.originalWidth).toBe(1920);
      expect(result.metadata.visionImage.width).toBeLessThanOrEqual(1600);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].mime).toBe("image/jpeg");
      toolAttachmentPath = fileURLToPath(result.attachments[0].url);
      expect(toolAttachmentPath).not.toBe(image);
      const metadata = await sharp(toolAttachmentPath).metadata();
      expect(metadata.width).toBeLessThanOrEqual(1600);
      expect(metadata.height).toBeLessThanOrEqual(1600);
    } finally {
      sharp.cache(false);
      if (toolAttachmentPath !== undefined) await rm(toolAttachmentPath, { force: true });
      await cleanupDir(dir);
    }
  });

  test("read_planning_material attaches embedded PPTX images for first-pass vision", async () => {
    const dir = await tmpMaterialDir("read-pptx-embedded-images");
    const deck = join(dir, "deck.pptx");
    const screenshot = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: "#334455ff",
      },
    }).png().toBuffer();
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml("Slide with mockup"));
    zip.file("ppt/media/image1.png", screenshot);
    await writeFile(deck, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const result = await readPlanningMaterialTool.execute(
        { path: deck },
        { directory: dir } as any,
      );
      expect(result.output).toContain("Embedded image attachment(s): 1");
      expect(result.attachments).toHaveLength(2);
      expect(result.attachments[0]).toMatchObject({
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename: "deck.pptx",
      });
      expect(result.attachments[1]).toMatchObject({
        mime: "image/png",
        filename: "001-image1.png",
      });
      expect(result.metadata.embeddedImages.images).toHaveLength(1);
      expect(result.metadata.embeddedImages.images[0]).toMatchObject({
        width: 120,
        height: 80,
      });
      expect(result.metadata.extractedText.text).toContain("Slide with mockup");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("read_planning_material attaches rendered PDF pages for first-pass vision", async () => {
    const dir = await tmpMaterialDir("read-pdf-rendered-pages");
    const pdf = join(dir, "brief.pdf");
    await writeFile(pdf, minimalPdf("PDF Wireframe"));

    let renderedDir: string | undefined;
    try {
      const result = await readPlanningMaterialTool.execute(
        { path: pdf, maxPdfPages: 1, pdfDesiredWidth: 300 },
        { directory: dir } as any,
      );
      renderedDir = result.metadata.pdfRender.outputDir;

      expect(result.output).toContain("Rendered PDF page attachment(s): 1");
      expect(result.attachments).toHaveLength(2);
      expect(result.attachments[0]).toMatchObject({
        mime: "application/pdf",
        filename: "brief.pdf",
      });
      expect(result.attachments[1]).toMatchObject({
        mime: "image/png",
        filename: "brief-page-001.png",
      });
      const renderedPath = fileURLToPath(result.attachments[1].url);
      const bytes = await readFile(renderedPath);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(result.metadata.pdfRender.images).toHaveLength(1);
      expect(result.metadata.pdfRender.images[0]).toMatchObject({
        pageNumber: 1,
        width: 300,
        height: 144,
      });
      expect(result.metadata.extractedText.text).toContain("PDF Wireframe");
    } finally {
      if (renderedDir !== undefined) await rm(renderedDir, { recursive: true, force: true });
      await cleanupDir(dir);
    }
  });

  test("lists planning materials recursively while skipping generated folders", async () => {
    const dir = await tmpMaterialDir("recursive-list");
    const nested = join(dir, "Assets", "Planning", "UI");
    const ignored = join(dir, "Library", "Planning");
    await mkdir(nested, { recursive: true });
    await mkdir(ignored, { recursive: true });
    await writeFile(join(nested, "brief.md"), "# Nested brief");
    await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 4,
        background: "#112233ff",
      },
    }).png().toFile(join(nested, "mockup.png"));
    await writeFile(join(ignored, "ignored.md"), "# Generated cache");

    try {
      const shallow = await listPlanningMaterialFiles(dir);
      expect(shallow.entries).toHaveLength(0);

      const recursive = await listPlanningMaterialFiles(dir, { recursive: true });
      expect(recursive.truncated).toBe(false);
      expect(recursive.entries.map((entry) => entry.relativePath)).toEqual([
        "Assets/Planning/UI/brief.md",
        "Assets/Planning/UI/mockup.png",
      ]);
      expect(recursive.entries.find((entry) => entry.name === "mockup.png")?.width).toBe(64);

      const capped = await listPlanningMaterialFiles(dir, { recursive: true, maxFiles: 1 });
      expect(capped.entries).toHaveLength(1);
      expect(capped.truncated).toBe(true);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("builds a prioritized planning-material brief with next tool guidance", async () => {
    const dir = await tmpMaterialDir("planning-brief");
    const deck = join(dir, "deck.pptx");
    const briefFile = join(dir, "brief.md");
    const pdf = join(dir, "brief.pdf");
    const docx = join(dir, "brief.docx");
    const mockup = join(dir, "mockup.png");
    const pngBytes = await sharp({
      create: {
        width: 1920,
        height: 1080,
        channels: 4,
        background: "#203040ff",
      },
    }).png().toBuffer();

    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml("Main menu", "Start button"));
    zip.file("ppt/slides/slide2.xml", slideXml("Settings", "Audio toggle"));
    zip.file("ppt/media/image1.png", pngBytes);
    await writeFile(deck, await zip.generateAsync({ type: "nodebuffer" }));
    const docxZip = new JSZip();
    docxZip.file("word/document.xml", "<w:document/>");
    docxZip.file("word/media/image1.png", pngBytes);
    await writeFile(docx, await docxZip.generateAsync({ type: "nodebuffer" }));
    await writeFile(briefFile, "# UI Brief\n\nCreate main menu and settings screens.");
    await writeFile(pdf, minimalPdf("PDF Wireframe"));
    await writeFile(mockup, pngBytes);

    try {
      const analyzed = await analyzePlanningMaterials({
        root: dir,
        recursive: true,
        maxTextFiles: 5,
        maxTextCharsPerFile: 300,
      });

      expect(analyzed.total).toBe(5);
      expect(analyzed.counts.pptx).toBe(1);
      expect(analyzed.counts.image).toBe(1);
      expect(analyzed.counts.pdf).toBe(1);
      expect(analyzed.counts.docx).toBe(1);
      expect(analyzed.items[0].relativePath).toBe("deck.pptx");
      expect(analyzed.items[0].recommendedTools).toContain("create_screen_from_material");
      expect(analyzed.items[0].recommendedTools).toContain("pptx_to_images");
      expect(analyzed.items[0].recommendedTools).toContain("create_pptx_slide_screen");
      expect(analyzed.items[0].recommendedTools).toContain("create_pptx_deck_screens");
      expect(analyzed.items[0].recommendedTools).toContain("create_reference_screen_from_material");
      expect(analyzed.items[0].recommendedTools).toContain("extract_embedded_images");
      expect(analyzed.items[0].extractedText?.excerpt).toContain("Main menu");
      expect(analyzed.items.find((item) => item.relativePath === "mockup.png")?.recommendedTools)
        .toContain("create_screen_from_material");
      expect(analyzed.items.find((item) => item.relativePath === "mockup.png")?.recommendedTools)
        .toContain("import_asset");
      expect(analyzed.items.find((item) => item.relativePath === "mockup.png")?.recommendedTools)
        .toContain("prepare_image_ui_draft");
      expect(analyzed.items.find((item) => item.relativePath === "mockup.png")?.recommendedTools)
        .toContain("create_image_reference_screen");
      expect(analyzed.items.find((item) => item.relativePath === "mockup.png")?.recommendedTools)
        .toContain("create_reference_screen_from_material");
      expect(analyzed.items.find((item) => item.relativePath === "mockup.png")?.recommendedTools)
        .toContain("verify_screen_against_reference");
      expect(analyzed.items.find((item) => item.relativePath === "brief.pdf")?.recommendedTools)
        .toContain("create_screen_from_material");
      expect(analyzed.items.find((item) => item.relativePath === "brief.pdf")?.recommendedTools)
        .toContain("create_pdf_page_reference_screen");
      expect(analyzed.items.find((item) => item.relativePath === "brief.pdf")?.recommendedTools)
        .toContain("draft_planning_intent_from_document");
      expect(analyzed.items.find((item) => item.relativePath === "brief.pdf")?.recommendedTools)
        .toContain("create_document_screen");
      expect(analyzed.items.find((item) => item.relativePath === "brief.docx")?.recommendedTools)
        .toContain("create_docx_image_reference_screen");
      expect(analyzed.items.find((item) => item.relativePath === "brief.docx")?.recommendedTools)
        .toContain("draft_planning_intent_from_docx");
      expect(analyzed.items.find((item) => item.relativePath === "brief.docx")?.recommendedTools)
        .toContain("create_document_screen");
      expect(analyzed.items.find((item) => item.relativePath === "brief.md")?.recommendedTools)
        .toContain("draft_planning_intent_from_document");
      expect(analyzed.items.find((item) => item.relativePath === "brief.md")?.recommendedTools)
        .toContain("create_document_screen");

      const output = formatPlanningMaterialsBrief(analyzed);
      expect(output).toContain("Recommended workflow");
      expect(output).toContain("Verification workflow");
      expect(output).toContain("verify_screen_against_reference");
      expect(output).toContain("for PDF/PPTX, use the rendered page/slide path");
      expect(output).toContain('read_planning_material "deck.pptx"');
      expect(output).toContain('create_screen_from_material "deck.pptx"');
      expect(output).toContain('extract_pptx_layout "deck.pptx"');
      expect(output).toContain('draft_planning_intent_from_pptx "deck.pptx"');
      expect(output).toContain('create_reference_screen_from_material "deck.pptx"');
      expect(output).toContain('create_pptx_slide_screen "deck.pptx"');
      expect(output).toContain('create_pptx_deck_screens "deck.pptx"');
      expect(output).toContain('prepare_pptx_ui_draft "deck.pptx"');
      expect(output).toContain('create_screen_from_material "brief.pdf"');
      expect(output).toContain('draft_planning_intent_from_document "brief.pdf"');
      expect(output).toContain('create_document_screen "brief.pdf"');
      expect(output).toContain('create_pdf_page_reference_screen "brief.pdf"');
      expect(output).toContain('draft_planning_intent_from_docx "brief.docx"');
      expect(output).toContain("tools: read_planning_material, create_screen_from_material, draft_planning_intent_from_docx, draft_planning_intent_from_document, create_document_screen, create_reference_screen_from_material, create_docx_image_reference_screen, extract_embedded_images");
      expect(output).toContain("tools: read_planning_material, create_screen_from_material, draft_planning_intent_from_document");
      expect(output).toContain('pptx_to_images "deck.pptx"');
      expect(output).toContain("Priority material candidates");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("extracts PPTX slide text from Open XML package", async () => {
    const dir = await tmpMaterialDir("pptx");
    const file = join(dir, "deck.pptx");

    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", slideXml("Second slide", "CTA button"));
    zip.file("ppt/slides/slide1.xml", slideXml("Main menu", "Hero image"));
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const extracted = await extractPlanningText(file);
      expect(extracted.ok).toBe(true);
      expect(extracted.kind).toBe("pptx");
      expect(extracted.text).toContain("Slide 1");
      expect(extracted.text).toContain("Main menu");
      expect(extracted.text).toContain("Slide 2");
      expect(extracted.text).toContain("CTA button");
      expect(extracted.text!.indexOf("Slide 1")).toBeLessThan(extracted.text!.indexOf("Slide 2"));
    } finally {
      await cleanupDir(dir);
    }
  });

  test("extracts PPTX positioned text and picture layout", async () => {
    const dir = await tmpMaterialDir("pptx-layout");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000" type="wide"/>
      </p:presentation>
    `);
    zip.file("ppt/slides/slide1.xml", slideLayoutXml({
      titleRunPrXml: '<a:rPr b="1" i="1"><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></a:rPr>',
      titleFillXml: '<a:solidFill><a:srgbClr val="102030"/></a:solidFill>',
      extraShapeXml: `
        <p:sp>
          <p:nvSpPr><p:cNvPr id="4" name="Accent Panel"/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="609600" y="5486400"/><a:ext cx="3657600" cy="685800"/></a:xfrm>
            <a:solidFill><a:srgbClr val="445566"/></a:solidFill>
          </p:spPr>
        </p:sp>
      `,
    }));
    zip.file("ppt/slides/_rels/slide1.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 4,
        background: "#6688aaff",
      },
    }).png().toBuffer());
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const layout = await extractPptxLayout(file);
      expect(layout.slideWidthEmu).toBe(12192000);
      expect(layout.slideHeightEmu).toBe(6858000);
      expect(layout.aspectRatio).toBe(1.777778);
      expect(layout.slides).toHaveLength(1);
      expect(layout.slides[0].items).toHaveLength(3);

      const [title, panel, picture] = layout.slides[0].items;
      expect(title.kind).toBe("text");
      expect(title.suggestedElementType).toBe("Text");
      expect(title.text).toBe("Hero Title");
      expect(title.fontStyle).toBe("BoldAndItalic");
      expect(title.color).toBe("#FFCC00");
      expect(title.fillColor).toBe("#102030");
      expect(title.rect).toMatchObject({ x: 0.1, y: 0.1, w: 0.5, h: 0.1 });

      expect(panel.kind).toBe("shape");
      expect(panel.suggestedElementType).toBe("Panel");
      expect(panel.fillColor).toBe("#445566");
      expect(panel.rect).toMatchObject({ x: 0.05, y: 0.8, w: 0.3, h: 0.1 });

      expect(picture.kind).toBe("picture");
      expect(picture.suggestedElementType).toBe("Image");
      expect(picture.relationshipId).toBe("rIdImage1");
      expect(picture.mediaPath).toBe("ppt/media/image1.png");
      expect(picture.rect).toMatchObject({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });

      const output = formatPptxLayout(layout);
      expect(output).toContain("Slide 1: 3 item(s)");
      expect(output).toContain('text -> Text rect=0.1,0.1,0.5,0.1 fontStyle=BoldAndItalic color=#FFCC00 fill=#102030 text="Hero Title"');
      expect(output).toContain('shape -> Panel rect=0.05,0.8,0.3,0.1 fill=#445566 name="Accent Panel"');
      expect(output).toContain("picture -> Image rect=0.5,0.5,0.25,0.25 media=ppt/media/image1.png");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("drafts a valid PlanningIntent from PPTX layout", async () => {
    const dir = await tmpMaterialDir("pptx-intent-draft");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000" type="wide"/>
      </p:presentation>
    `);
    zip.file("ppt/slides/slide1.xml", slideLayoutXml({
      titleRunPrXml: '<a:rPr b="1"><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></a:rPr>',
      titleFillXml: '<a:solidFill><a:srgbClr val="102030"/></a:solidFill>',
      extraShapeXml: `
        <p:sp>
          <p:nvSpPr><p:cNvPr id="4" name="Accent Panel"/></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="609600" y="5486400"/><a:ext cx="3657600" cy="685800"/></a:xfrm>
            <a:solidFill><a:srgbClr val="445566"/></a:solidFill>
          </p:spPr>
        </p:sp>
      `,
    }));
    zip.file("ppt/slides/_rels/slide1.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 4,
        background: "#6688aaff",
      },
    }).png().toBuffer());
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const layout = await extractPptxLayout(file);
      const embedded = await extractEmbeddedImages(file, { outputDir: join(dir, "embedded") });
      const draft = draftPlanningIntentFromPptxLayout(layout, {
        screenName: "DeckMainMenu",
        referenceWidth: 1920,
        includeShapePanels: true,
        embeddedImages: embedded.images,
        assetMap: [{ mediaPath: "ppt/media/image1.png", assetPath: "Assets/UOS/Imported/hero.png" }],
      });

      expect(draft.intent.screenName).toBe("DeckMainMenu");
      expect(draft.intent.referenceCanvas).toEqual({ width: 1920, height: 1080 });
      expect(draft.intent.elements).toHaveLength(4);
      expect(draft.intent.elements[0]).toMatchObject({
        clientHintId: "slide1_text_title_fill",
        type: "Panel",
        rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
        props: { color: "#102030" },
      });
      expect(draft.intent.elements[1]).toMatchObject({
        clientHintId: "slide1_text_title",
        type: "Text",
        rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
        props: { text: "Hero Title", fontStyle: "Bold", color: "#FFCC00" },
      });
      expect(draft.intent.elements[2]).toMatchObject({
        clientHintId: "slide1_panel_accent_panel",
        type: "Panel",
        rect: { x: 0.05, y: 0.8, w: 0.3, h: 0.1 },
        props: { color: "#445566" },
      });
      expect(draft.intent.elements[3]).toMatchObject({
        clientHintId: "slide1_image_hero_image",
        type: "Image",
        rect: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
        props: { sprite: "Assets/UOS/Imported/hero.png" },
      });
      expect(draft.mediaHints[0]).toMatchObject({
        clientHintId: "slide1_image_hero_image",
        mediaPath: "ppt/media/image1.png",
        sourcePath: embedded.images[0].path,
        suggestedAssetPath: "Assets/UOS/Imported/hero.png",
        assetPath: "Assets/UOS/Imported/hero.png",
      });
      expect(validatePlanningIntent(draft.intent).ok).toBe(true);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("prepares a PPTX UI draft by importing matched picture assets", async () => {
    const dir = await tmpMaterialDir("pptx-ui-draft");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000" type="wide"/>
      </p:presentation>
    `);
    zip.file("ppt/slides/slide1.xml", slideLayoutXml());
    zip.file("ppt/slides/_rels/slide1.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 4,
        background: "#6688aaff",
      },
    }).png().toBuffer());
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const importedRequests: Array<{ sourcePath: string; assetPath: string; mediaPath: string }> = [];
      const prepared = await preparePptxIntentWithAssets(
        file,
        {
          screenName: "PreparedDeck",
          embeddedOutputDir: join(dir, "embedded"),
          assetDir: "Assets/UOS/PPTX",
        },
        async (request) => {
          importedRequests.push({
            sourcePath: request.sourcePath,
            assetPath: request.assetPath,
            mediaPath: request.mediaPath,
          });
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Texture2D" };
        },
      );

      expect(importedRequests).toHaveLength(1);
      expect(importedRequests[0].mediaPath).toBe("ppt/media/image1.png");
      expect(importedRequests[0].assetPath).toBe("Assets/UOS/PPTX/deck-slide1-image1.png");
      expect(prepared.importedAssets[0]).toMatchObject({
        mediaPath: "ppt/media/image1.png",
        packagePath: "ppt/media/image1.png",
        assetPath: "Assets/UOS/PPTX/deck-slide1-image1.png",
        importedAsSprite: true,
      });
      expect(prepared.draft.intent.elements[1]).toMatchObject({
        clientHintId: "slide1_image_hero_image",
        type: "Image",
        props: { sprite: "Assets/UOS/PPTX/deck-slide1-image1.png" },
      });
      expect(validatePlanningIntent(prepared.draft.intent).ok).toBe(true);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("creates a PPTX slide screen by importing picture assets and applying the draft", async () => {
    const dir = await tmpMaterialDir("pptx-slide-screen");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000" type="wide"/>
      </p:presentation>
    `);
    zip.file("ppt/slides/slide1.xml", slideLayoutXml());
    zip.file("ppt/slides/_rels/slide1.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 4,
        background: "#6688aaff",
      },
    }).png().toBuffer());
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const calls: string[] = [];
      const created = await createPptxScreenWithAssets(
        file,
        {
          screenName: "CreatedDeck",
          embeddedOutputDir: join(dir, "embedded"),
          assetDir: "Assets/UOS/PPTX",
        },
        async (request) => {
          calls.push(`import:${request.mediaPath}:${request.assetPath}`);
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId: "CreatedDeck_ID",
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `Element_${index + 1}`,
            })),
          };
        },
      );

      expect(calls).toEqual([
        "import:ppt/media/image1.png:Assets/UOS/PPTX/deck-slide1-image1.png",
        "create:CreatedDeck:2",
      ]);
      expect(created.created.screenId).toBe("CreatedDeck_ID");
      expect(created.created.elements).toHaveLength(2);
      expect(created.validation.ok).toBe(true);
      expect(created.draft.intent.elements[1]).toMatchObject({
        clientHintId: "slide1_image_hero_image",
        type: "Image",
        props: { sprite: "Assets/UOS/PPTX/deck-slide1-image1.png" },
      });
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("creates PPTX deck screens with optional transitions and first-screen activation", async () => {
    const dir = await tmpMaterialDir("pptx-deck-screens");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000" type="wide"/>
      </p:presentation>
    `);
    zip.file("ppt/slides/slide1.xml", slideLayoutXml());
    zip.file("ppt/slides/slide2.xml", slideLayoutXml({ titleRunProps: 'i="1"' }));
    zip.file("ppt/slides/_rels/slide1.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/slides/_rels/slide2.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 4,
        background: "#6688aaff",
      },
    }).png().toBuffer());
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const calls: string[] = [];
      const created = await createPptxDeckScreensWithAssets(
        file,
        {
          screenNamePrefix: "Deck",
          embeddedOutputDir: join(dir, "embedded"),
          assetDir: "Assets/UOS/PPTX",
          createTransitions: true,
          activateFirst: true,
        },
        async (request) => {
          calls.push(`import:${request.mediaPath}:${request.assetPath}`);
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          const screenId = `${intent.screenName.replace(/\s+/g, "")}_ID`;
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId,
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `${screenId}_Element_${index + 1}`,
            })),
          };
        },
        async (request) => {
          calls.push(`transition:${request.fromId}->${request.toId}:${request.trigger}`);
          return { ...request, ok: true };
        },
        async (screenId) => {
          calls.push(`active:${screenId}`);
          return { screenId, active: true, ok: true };
        },
      );

      expect(created.slideNumbers).toEqual([1, 2]);
      expect(created.screens.map((screen) => screen.screenName)).toEqual(["Deck Slide 1", "Deck Slide 2"]);
      expect(created.screens.map((screen) => screen.screenId)).toEqual(["DeckSlide1_ID", "DeckSlide2_ID"]);
      expect(created.screens[0].source).toMatchObject({
        tool: "create_pptx_deck_screens",
        kind: "pptx",
        mode: "editable",
        path: file,
        slideNumber: 1,
        assetPaths: ["Assets/UOS/PPTX/deck-slide1-image1.png"],
      });
      expect(created.screens[1].source).toMatchObject({
        slideNumber: 2,
        assetPaths: ["Assets/UOS/PPTX/deck-slide2-image1.png"],
      });
      expect(created.transitions).toEqual([{
        fromId: "DeckSlide1_ID",
        toId: "DeckSlide2_ID",
        trigger: "next-slide-1",
        ok: true,
      }]);
      expect(created.activeScreenId).toBe("DeckSlide1_ID");
      expect(calls).toEqual([
        "import:ppt/media/image1.png:Assets/UOS/PPTX/deck-slide1-image1.png",
        "create:Deck Slide 1:2",
        "import:ppt/media/image1.png:Assets/UOS/PPTX/deck-slide2-image1.png",
        "create:Deck Slide 2:2",
        "transition:DeckSlide1_ID->DeckSlide2_ID:next-slide-1",
        "active:DeckSlide1_ID",
      ]);
      expect(created.screens.every((screen) => screen.validation.ok)).toBe(true);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("prepares an image UI draft by importing the mockup as a sprite", async () => {
    const dir = await tmpMaterialDir("image-ui-draft");
    const file = join(dir, "main mockup.png");
    await sharp({
      create: {
        width: 1280,
        height: 720,
        channels: 4,
        background: "#203040ff",
      },
    }).png().toFile(file);

    try {
      const importedRequests: Array<{ sourcePath: string; assetPath: string }> = [];
      const prepared = await prepareImageIntentWithAsset(
        file,
        {
          screenName: "MainMockup",
          assetDir: "Assets/UOS/Mockups",
          clientHintId: "mockup_reference",
        },
        async (request) => {
          importedRequests.push({
            sourcePath: request.sourcePath,
            assetPath: request.assetPath,
          });
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
      );

      expect(importedRequests).toEqual([{
        sourcePath: file,
        assetPath: "Assets/UOS/Mockups/main_mockup.png",
      }]);
      expect(prepared.source).toMatchObject({
        path: file,
        width: 1280,
        height: 720,
        mimeType: "image/png",
      });
      expect(prepared.importedAsset).toMatchObject({
        sourcePath: file,
        assetPath: "Assets/UOS/Mockups/main_mockup.png",
        importedAsSprite: true,
      });
      expect(prepared.intent).toMatchObject({
        screenName: "MainMockup",
        referenceCanvas: { width: 1280, height: 720 },
        elements: [{
          clientHintId: "mockup_reference",
          type: "Image",
          rect: { x: 0, y: 0, w: 1, h: 1 },
          anchor: "TopLeft",
          props: { sprite: "Assets/UOS/Mockups/main_mockup.png" },
        }],
      });
      expect(validatePlanningIntent(prepared.intent).ok).toBe(true);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("creates an image reference screen by importing and applying the draft", async () => {
    const dir = await tmpMaterialDir("image-reference-screen");
    const file = join(dir, "screen.png");
    await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 4,
        background: "#112244ff",
      },
    }).png().toFile(file);

    try {
      const calls: string[] = [];
      const created = await createImageReferenceScreenWithAsset(
        file,
        { screenName: "ReferenceScreen", assetPath: "Assets/UOS/Refs/screen.png" },
        async (request) => {
          calls.push(`import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements[0].props?.sprite}`);
          return {
            screenId: "ReferenceScreen_ID",
            elements: [{ clientHintId: intent.elements[0].clientHintId, elementId: "Element_Reference" }],
          };
        },
      );

      expect(calls).toEqual([
        "import:Assets/UOS/Refs/screen.png",
        "create:ReferenceScreen:Assets/UOS/Refs/screen.png",
      ]);
      expect(created.created).toEqual({
        screenId: "ReferenceScreen_ID",
        elements: [{ clientHintId: "reference_image", elementId: "Element_Reference" }],
      });
      expect(created.validation.ok).toBe(true);
      expect(created.intent.elements[0]).toMatchObject({
        type: "Image",
        props: { sprite: "Assets/UOS/Refs/screen.png" },
      });
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("creates a PDF page reference screen by rendering, importing, and applying the draft", async () => {
    const dir = await tmpMaterialDir("pdf-page-reference-screen");
    const file = join(dir, "brief.pdf");
    await writeFile(file, minimalPdf("Unity PDF Screen"));

    try {
      const calls: string[] = [];
      const created = await createPdfReferenceScreen(
        file,
        {
          pageNumber: 1,
          screenName: "PdfReference",
          outputDir: join(dir, "rendered"),
          desiredWidth: 300,
          assetPath: "Assets/UOS/PDF/brief-page-001.png",
        },
        async (request) => {
          calls.push(`import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.referenceCanvas.width}x${intent.referenceCanvas.height}`);
          return {
            screenId: "PdfReference_ID",
            elements: [{ clientHintId: intent.elements[0].clientHintId, elementId: "Element_Pdf" }],
          };
        },
      );

      expect(calls).toEqual([
        "import:Assets/UOS/PDF/brief-page-001.png",
        "create:PdfReference:300x144",
      ]);
      expect(created.pdf).toMatchObject({
        path: file,
        pageNumber: 1,
        renderer: "pdf-parse",
      });
      expect(created.renderedPage.path).toContain("brief-page-001-page-001.png");
      expect(created.created).toEqual({
        screenId: "PdfReference_ID",
        elements: [{ clientHintId: "pdf_page_1", elementId: "Element_Pdf" }],
      });
      expect(created.intent.elements[0]).toMatchObject({
        type: "Image",
        props: { sprite: "Assets/UOS/PDF/brief-page-001.png" },
      });
    } finally {
      await cleanupDir(dir);
    }
  });

  test("creates a DOCX image reference screen by extracting, importing, and applying the draft", async () => {
    const dir = await tmpMaterialDir("docx-image-reference-screen");
    const file = join(dir, "brief.docx");
    const imageBytes = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 4,
        background: "#334455ff",
      },
    }).png().toBuffer();
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document/>");
    zip.file("word/media/image1.png", imageBytes);
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const calls: string[] = [];
      const created = await createDocxImageReferenceScreen(
        file,
        {
          imageNumber: 1,
          screenName: "DocxReference",
          outputDir: join(dir, "embedded"),
          assetPath: "Assets/UOS/DOCX/brief-image-001.png",
        },
        async (request) => {
          calls.push(`import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.referenceCanvas.width}x${intent.referenceCanvas.height}`);
          return {
            screenId: "DocxReference_ID",
            elements: [{ clientHintId: intent.elements[0].clientHintId, elementId: "Element_Docx" }],
          };
        },
      );

      expect(calls).toEqual([
        "import:Assets/UOS/DOCX/brief-image-001.png",
        "create:DocxReference:640x360",
      ]);
      expect(created.docx).toMatchObject({
        path: file,
        packagePath: "word/media/image1.png",
        imageNumber: 1,
      });
      expect(created.embeddedImage.path).toContain("001-image1.png");
      expect(created.created).toEqual({
        screenId: "DocxReference_ID",
        elements: [{ clientHintId: "docx_image_1", elementId: "Element_Docx" }],
      });
      expect(created.intent.elements[0]).toMatchObject({
        type: "Image",
        props: { sprite: "Assets/UOS/DOCX/brief-image-001.png" },
      });
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("auto-routes image, PDF, DOCX, and PPTX materials into reference screens", async () => {
    const dir = await tmpMaterialDir("material-reference-screen");
    const image = join(dir, "mockup.png");
    const pdf = join(dir, "brief.pdf");
    const docx = join(dir, "brief.docx");
    const deck = join(dir, "deck.pptx");
    await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 4,
        background: "#112233ff",
      },
    }).png().toFile(image);
    await writeFile(pdf, minimalPdf("Unity PDF Screen"));

    const docxZip = new JSZip();
    docxZip.file("word/document.xml", "<w:document/>");
    docxZip.file("word/media/image1.png", await sharp({
      create: {
        width: 200,
        height: 120,
        channels: 4,
        background: "#445566ff",
      },
    }).png().toBuffer());
    await writeFile(docx, await docxZip.generateAsync({ type: "nodebuffer" }));

    const zip = new JSZip();
    zip.file("ppt/presentation.xml", `
      <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldSz cx="12192000" cy="6858000" type="wide"/>
      </p:presentation>
    `);
    zip.file("ppt/slides/slide1.xml", slideLayoutXml());
    zip.file("ppt/slides/_rels/slide1.xml.rels", `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
      </Relationships>
    `);
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 100,
        height: 60,
        channels: 4,
        background: "#6688aaff",
      },
    }).png().toBuffer());
    await writeFile(deck, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const calls: string[] = [];
      const imageCreated = await createReferenceScreenFromMaterial(
        image,
        { screenName: "AutoImage", assetDir: "Assets/UOS/Auto" },
        async (request) => {
          calls.push(`image-import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (request) => {
          calls.push(`pptx-import:${request.assetPath}`);
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId: `${intent.screenName}_ID`,
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `Element_${index + 1}`,
            })),
          };
        },
      );
      const pdfCreated = await createReferenceScreenFromMaterial(
        pdf,
        {
          screenName: "AutoPdf",
          outputDir: join(dir, "rendered"),
          desiredWidth: 300,
          assetPath: "Assets/UOS/Auto/brief-page.png",
        },
        async (request) => {
          calls.push(`image-import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (request) => {
          calls.push(`pptx-import:${request.assetPath}`);
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId: `${intent.screenName}_ID`,
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `Element_${index + 1}`,
            })),
          };
        },
      );
      const docxCreated = await createReferenceScreenFromMaterial(
        docx,
        {
          screenName: "AutoDocx",
          outputDir: join(dir, "docx-images"),
          assetPath: "Assets/UOS/Auto/brief-image.png",
        },
        async (request) => {
          calls.push(`image-import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (request) => {
          calls.push(`pptx-import:${request.assetPath}`);
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId: `${intent.screenName}_ID`,
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `Element_${index + 1}`,
            })),
          };
        },
      );
      const pptxCreated = await createReferenceScreenFromMaterial(
        deck,
        { screenName: "AutoDeck", assetDir: "Assets/UOS/AutoPptx", outputDir: join(dir, "embedded") },
        async (request) => {
          calls.push(`image-import:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (request) => {
          calls.push(`pptx-import:${request.mediaPath}:${request.assetPath}`);
          return { assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId: `${intent.screenName}_ID`,
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `Element_${index + 1}`,
            })),
          };
        },
      );

      expect(imageCreated.kind).toBe("image");
      expect(imageCreated.importedAsset?.assetPath).toBe("Assets/UOS/Auto/mockup.png");
      expect(imageCreated.created.screenId).toBe("AutoImage_ID");
      expect(pdfCreated.kind).toBe("pdf");
      expect(pdfCreated.importedAsset?.assetPath).toBe("Assets/UOS/Auto/brief-page.png");
      expect(pdfCreated.created.screenId).toBe("AutoPdf_ID");
      expect(docxCreated.kind).toBe("docx");
      expect(docxCreated.importedAsset?.assetPath).toBe("Assets/UOS/Auto/brief-image.png");
      expect(docxCreated.created.screenId).toBe("AutoDocx_ID");
      expect(pptxCreated.kind).toBe("pptx");
      expect(pptxCreated.importedAssets?.[0].assetPath).toBe("Assets/UOS/AutoPptx/deck-slide1-image1.png");
      expect(pptxCreated.created.screenId).toBe("AutoDeck_ID");
      expect(calls).toContain("image-import:Assets/UOS/Auto/mockup.png");
      expect(calls).toContain("image-import:Assets/UOS/Auto/brief-page.png");
      expect(calls).toContain("image-import:Assets/UOS/Auto/brief-image.png");
      expect(calls).toContain("pptx-import:ppt/media/image1.png:Assets/UOS/AutoPptx/deck-slide1-image1.png");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("creates a rendered PPTX reference screen when requested", async () => {
    const dir = await tmpMaterialDir("pptx-rendered-reference-screen");
    const deck = join(dir, "deck.pptx");
    const renderedSlide = join(dir, "deck-slide-002.png");
    await writeFile(deck, Buffer.from("fake pptx bytes"));
    await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 4,
        background: "#224466ff",
      },
    }).png().toFile(renderedSlide);
    const renderedSize = (await readFile(renderedSlide)).byteLength;

    try {
      const calls: string[] = [];
      const created = await createReferenceScreenFromMaterial(
        deck,
        {
          pptxMode: "rendered",
          slideNumber: 2,
          screenName: "RenderedDeck",
          assetDir: "Assets/UOS/Rendered",
        },
        async (request) => {
          calls.push(`image-import:${request.sourcePath}:${request.assetPath}`);
          return { sourcePath: request.sourcePath, assetPath: request.assetPath, importedAsSprite: true, assetType: "Sprite" };
        },
        async () => {
          throw new Error("PPTX embedded asset importer should not be used for rendered references");
        },
        async (intent) => {
          calls.push(`create:${intent.screenName}:${intent.elements.length}`);
          return {
            screenId: "RenderedDeck_ID",
            elements: intent.elements.map((element, index) => ({
              clientHintId: element.clientHintId,
              elementId: `Element_${index + 1}`,
            })),
          };
        },
        async (filePath, options) => {
          expect(filePath).toBe(deck);
          expect(options.pages).toEqual([2]);
          return {
            ok: true,
            rendered: true,
            renderer: "fake-pptx-renderer",
            images: [{
              path: renderedSlide,
              pageNumber: 2,
              width: 640,
              height: 360,
              size: renderedSize,
              mimeType: "image/png",
            }],
            total: 5,
            outputDir: dir,
          };
        },
      );

      const specific = created.specific as any;
      expect(created.kind).toBe("pptx");
      expect(created.pptxMode).toBe("rendered");
      expect(created.importedAsset?.sourcePath).toBe(renderedSlide);
      expect(created.importedAsset?.assetPath).toBe("Assets/UOS/Rendered/deck-slide-002.png");
      expect(created.intent.elements[0]).toMatchObject({
        clientHintId: "pptx_rendered_slide",
        type: "Image",
        props: { sprite: "Assets/UOS/Rendered/deck-slide-002.png" },
      });
      expect(specific.pptx).toMatchObject({
        path: deck,
        slideNumber: 2,
        renderer: "fake-pptx-renderer",
        total: 5,
      });
      expect(specific.renderedSlide.path).toBe(renderedSlide);
      expect(calls).toContain(`image-import:${renderedSlide}:Assets/UOS/Rendered/deck-slide-002.png`);
      expect(calls).toContain("create:RenderedDeck:1");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("extracts DOCX body text from Open XML package", async () => {
    const dir = await tmpMaterialDir("docx");
    const file = join(dir, "brief.docx");

    const zip = new JSZip();
    zip.file("word/document.xml", `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Project brief</w:t></w:r></w:p>
          <w:p><w:r><w:t>Generate Unity screens</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `);
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const extracted = await extractPlanningText(file);
      expect(extracted.ok).toBe(true);
      expect(extracted.kind).toBe("docx");
      expect(extracted.text).toContain("Project brief");
      expect(extracted.text).toContain("Generate Unity screens");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("drafts DOCX body text into a valid PlanningIntent", async () => {
    const dir = await tmpMaterialDir("docx-intent");
    const file = join(dir, "brief.docx");

    const zip = new JSZip();
    zip.file("word/document.xml", `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>Quest Hub</w:t></w:r></w:p>
          <w:p><w:r><w:t>- Active quest summary</w:t></w:r></w:p>
          <w:p><w:r><w:t>- Reward preview</w:t></w:r></w:p>
          <w:p><w:r><w:t>CTA: Start</w:t></w:r></w:p>
        </w:body>
      </w:document>
    `);
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const extracted = await extractPlanningText(file);
      expect(extracted.ok).toBe(true);
      const draft = draftPlanningIntentFromDocxText(
        { path: file, text: extracted.text ?? "" },
        { screenName: "QuestHub", referenceWidth: 1280, referenceHeight: 720 },
      );
      const validation = validatePlanningIntent(draft.intent);

      expect(validation.ok).toBe(true);
      expect(draft.intent.screenName).toBe("QuestHub");
      expect(draft.intent.referenceCanvas).toEqual({ width: 1280, height: 720 });
      expect(draft.detected).toMatchObject({
        title: "Quest Hub",
        buttons: ["Start"],
        omittedLines: 0,
      });
      expect(draft.intent.elements).toEqual(expect.arrayContaining([
        expect.objectContaining({
          clientHintId: "docx_title",
          type: "Text",
          props: expect.objectContaining({ text: "Quest Hub", fontStyle: "Bold" }),
        }),
        expect.objectContaining({
          clientHintId: "docx_body_1",
          type: "Text",
          props: expect.objectContaining({ text: "- Active quest summary" }),
        }),
        expect.objectContaining({
          clientHintId: "docx_button_1",
          type: "Button",
          props: expect.objectContaining({ text: "Start", fontStyle: "Bold" }),
        }),
      ]));
    } finally {
      await cleanupDir(dir);
    }
  });

  test("extracts embedded DOCX and PPTX images", async () => {
    const dir = await tmpMaterialDir("embedded-images");
    const docx = join(dir, "brief.docx");
    const pptx = join(dir, "deck.pptx");
    const pngBytes = await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 4,
        background: "#cc3344ff",
      },
    }).png().toBuffer();
    const jpegBytes = await sharp({
      create: {
        width: 24,
        height: 16,
        channels: 3,
        background: "#3366cc",
      },
    }).jpeg().toBuffer();

    const docxZip = new JSZip();
    docxZip.file("word/document.xml", "<w:document/>");
    docxZip.file("word/media/image1.png", pngBytes);
    docxZip.file("word/media/diagram.emf", Buffer.from("unsupported"));
    await writeFile(docx, await docxZip.generateAsync({ type: "nodebuffer" }));

    const pptxZip = new JSZip();
    pptxZip.file("ppt/slides/slide1.xml", slideXml("Screenshot slide"));
    pptxZip.file("ppt/media/image2.jpg", jpegBytes);
    await writeFile(pptx, await pptxZip.generateAsync({ type: "nodebuffer" }));

    try {
      const docxResult = await extractEmbeddedImages(docx, { outputDir: join(dir, "docx-images") });
      expect(docxResult.ok).toBe(true);
      expect(docxResult.images).toHaveLength(1);
      expect(docxResult.images[0].mimeType).toBe("image/png");
      expect(docxResult.images[0].width).toBe(32);
      expect(docxResult.images[0].height).toBe(18);
      expect(docxResult.skipped).toContain("word/media/diagram.emf");
      expect((await readFile(docxResult.images[0].path)).subarray(0, 8).toString("hex"))
        .toBe("89504e470d0a1a0a");

      const pptxResult = await extractEmbeddedImages(pptx, { outputDir: join(dir, "pptx-images") });
      expect(pptxResult.ok).toBe(true);
      expect(pptxResult.images).toHaveLength(1);
      expect(pptxResult.images[0].mimeType).toBe("image/jpeg");
      expect(pptxResult.images[0].width).toBe(24);
      expect(pptxResult.images[0].height).toBe(16);
      expect((await readFile(pptxResult.images[0].path)).subarray(0, 3).toString("hex"))
        .toBe("ffd8ff");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("preprocesses images with crop and max-size resize", async () => {
    const dir = await tmpMaterialDir("image");
    const input = join(dir, "source.png");
    const output = join(dir, "processed.webp");
    await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 4,
        background: "#336699ff",
      },
    }).png().toFile(input);

    try {
      const result = await preprocessImageFile(input, {
        crop: { x: 10, y: 10, width: 100, height: 60 },
        maxWidth: 50,
        maxHeight: 50,
        format: "webp",
        outputPath: output,
      });
      expect(result.width).toBe(50);
      expect(result.height).toBe(30);
      expect(result.mimeType).toBe("image/webp");
      expect(result.path).toBe(output);
      const metadata = await sharp(output).metadata();
      expect(metadata.format).toBe("webp");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("compares reference and candidate images with a diff attachment target", async () => {
    const dir = await tmpMaterialDir("image-compare");
    const reference = join(dir, "reference.png");
    const same = join(dir, "same.png");
    const different = join(dir, "different.png");
    const diffOutput = join(dir, "diff.png");
    const referenceBuffer = await sharp({
      create: {
        width: 80,
        height: 40,
        channels: 4,
        background: "#224466ff",
      },
    }).png().toBuffer();
    await writeFile(reference, referenceBuffer);
    await writeFile(same, referenceBuffer);
    await sharp({
      create: {
        width: 160,
        height: 80,
        channels: 4,
        background: "#ffcc00ff",
      },
    }).png().toFile(different);

    try {
      const identical = await compareImageFiles(reference, same, { outputPath: diffOutput });
      expect(identical.compareWidth).toBe(80);
      expect(identical.compareHeight).toBe(40);
      expect(identical.meanAbsoluteError).toBe(0);
      expect(identical.mismatchRatio).toBe(0);
      expect((await readFile(diffOutput)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

      const changed = await compareImageFiles(reference, different, { maxWidth: 40, maxHeight: 40 });
      expect(changed.compareWidth).toBe(40);
      expect(changed.compareHeight).toBe(20);
      expect(changed.meanAbsoluteError).toBeGreaterThan(0.1);
      expect(changed.mismatchRatio).toBeGreaterThan(0.9);
      expect(changed.aspectRatioDelta).toBe(0);
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("verifies a screen against a reference by capturing preview and diffing it", async () => {
    const dir = await tmpMaterialDir("screen-verify");
    const reference = join(dir, "reference.png");
    const diffOutput = join(dir, "verify-diff.png");
    const previewBuffer = await sharp({
      create: {
        width: 96,
        height: 54,
        channels: 4,
        background: "#224466ff",
      },
    }).png().toBuffer();
    await writeFile(reference, previewBuffer);

    try {
      const verified = await verifyScreenAgainstReference(
        {
          screenId: "MainMenu_ID",
          referencePath: "reference.png",
          outputPath: diffOutput,
        },
        {
          directory: dir,
          now: () => 1234,
          capturePreview: async (screenId) => ({
            screenId,
            mimeType: "image/png",
            width: 96,
            height: 54,
            base64Data: previewBuffer.toString("base64"),
            size: previewBuffer.byteLength,
          }),
        },
      );

      expect(verified.verdict).toBe("close");
      expect(verified.preview.savedPath).toContain("preview-MainMenu_ID-1234.png");
      expect((await readFile(verified.preview.savedPath)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(verified.comparison.diffPath).toBe(diffOutput);
      expect(verified.comparison.meanAbsoluteError).toBe(0);
      expect(verified.comparison.mismatchRatio).toBe(0);
      expect(verified.comparison.uri).toContain("verify-diff.png");
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("extracts PDF text", async () => {
    const dir = await tmpMaterialDir("pdf");
    const file = join(dir, "brief.pdf");
    await writeFile(file, minimalPdf("Unity PDF Brief"));

    try {
      const extracted = await extractPlanningText(file);
      expect(extracted.ok).toBe(true);
      expect(extracted.kind).toBe("pdf");
      expect(extracted.text).toContain("Unity PDF Brief");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("drafts extracted PDF text into a valid PlanningIntent", async () => {
    const dir = await tmpMaterialDir("pdf-intent");
    const file = join(dir, "brief.pdf");
    await writeFile(file, minimalPdf("Mission Board"));

    try {
      const extracted = await extractPlanningText(file);
      expect(extracted.ok).toBe(true);
      const draft = draftPlanningIntentFromDocumentText(
        { path: file, text: extracted.text ?? "", kind: "pdf" },
        { screenName: "MissionBoard" },
      );
      const validation = validatePlanningIntent(draft.intent);

      expect(validation.ok).toBe(true);
      expect(draft.intent.screenName).toBe("MissionBoard");
      expect(draft.source.kind).toBe("pdf");
      expect(draft.intent.elements).toEqual(expect.arrayContaining([
        expect.objectContaining({
          clientHintId: "pdf_title",
          type: "Text",
          props: expect.objectContaining({ text: "Mission Board", fontStyle: "Bold" }),
        }),
      ]));
    } finally {
      await cleanupDir(dir);
    }
  });

  test("creates a document screen from text material with source metadata", async () => {
    const dir = await tmpMaterialDir("document-screen");
    const file = join(dir, "brief.md");
    await writeFile(file, "# Quest Log\n\n- Active quest\n\nCTA: Continue");

    try {
      const created = await createDocumentScreen(
        file,
        { screenName: "QuestLog", referenceWidth: 1280, referenceHeight: 720 },
        async (intent) => ({
          screenId: `${intent.screenName}_ID`,
          elements: intent.elements.map((element, index) => ({
            clientHintId: element.clientHintId,
            elementId: `Element_${index + 1}`,
          })),
        }),
      );

      expect(created.created.screenId).toBe("QuestLog_ID");
      expect(created.source).toMatchObject({
        tool: "create_document_screen",
        kind: "md",
        path: file,
      });
      expect(created.draft.intent.elements).toEqual(expect.arrayContaining([
        expect.objectContaining({
          clientHintId: "md_title",
          type: "Text",
          props: expect.objectContaining({ text: "Quest Log" }),
        }),
        expect.objectContaining({
          clientHintId: "md_button_1",
          type: "Button",
          props: expect.objectContaining({ text: "Continue" }),
        }),
      ]));
      expect(validatePlanningIntent(created.draft.intent).ok).toBe(true);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("drafts document control specs into editable Unity controls", () => {
    const draft = draftPlanningIntentFromDocumentText(
      {
        path: "settings.md",
        kind: "md",
        text: [
          "# Settings Panel",
          "Players can tune session preferences before starting.",
          "Input: Player name",
          "Toggle: Remember me",
          "Slider: Music volume",
          "Dropdown: Difficulty",
          "CTA: Save",
        ].join("\n"),
      },
      { screenName: "SettingsPanel" },
    );

    expect(validatePlanningIntent(draft.intent).ok).toBe(true);
    expect(draft.detected.controls).toEqual([
      { type: "InputField", label: "Player name" },
      { type: "Toggle", label: "Remember me" },
      { type: "Slider", label: "Music volume" },
      { type: "Dropdown", label: "Difficulty" },
    ]);
    expect(draft.intent.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientHintId: "md_control_1",
        type: "InputField",
        props: expect.objectContaining({ text: "Player name", placeholder: "Player name" }),
      }),
      expect.objectContaining({
        clientHintId: "md_control_2",
        type: "Toggle",
        props: expect.objectContaining({ text: "Remember me", isOn: false }),
      }),
      expect.objectContaining({
        clientHintId: "md_control_3",
        type: "Slider",
        props: expect.objectContaining({ text: "Music volume", minValue: 0, maxValue: 1, value: 0.5 }),
      }),
      expect.objectContaining({
        clientHintId: "md_control_4",
        type: "Dropdown",
        props: expect.objectContaining({ text: "Difficulty", options: ["Difficulty"], value: 0 }),
      }),
      expect.objectContaining({
        clientHintId: "md_button_1",
        type: "Button",
        props: expect.objectContaining({ text: "Save" }),
      }),
    ]));
    expect(draft.intent.elements.some((element) => element.type === "Text" && element.props?.text === "Input: Player name"))
      .toBe(false);

    const dropdown = draft.intent.elements.find((element) => element.clientHintId === "md_control_4");
    const saveButton = draft.intent.elements.find((element) => element.clientHintId === "md_button_1");
    expect(dropdown).toBeDefined();
    expect(saveButton).toBeDefined();
    expect(dropdown!.rect.y + dropdown!.rect.h).toBeLessThanOrEqual(saveButton!.rect.y);
  });

  test("drafts document control defaults and dropdown options into props", () => {
    const draft = draftPlanningIntentFromDocumentText(
      {
        path: "settings.md",
        kind: "md",
        text: [
          "# Settings Panel",
          "Input: Player name = Lyx",
          "Toggle: Remember me = on",
          "Slider: Music volume [0-100] = 70",
          "Dropdown: Difficulty [Easy, Normal, Hard] = Normal",
        ].join("\n"),
      },
      { screenName: "SettingsPanel" },
    );

    expect(validatePlanningIntent(draft.intent).ok).toBe(true);
    expect(draft.detected.controls).toEqual([
      { type: "InputField", label: "Player name", inputText: "Lyx" },
      { type: "Toggle", label: "Remember me", isOn: true },
      { type: "Slider", label: "Music volume", minValue: 0, maxValue: 100, value: 70 },
      { type: "Dropdown", label: "Difficulty", options: ["Easy", "Normal", "Hard"], value: 1 },
    ]);
    expect(draft.intent.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientHintId: "md_control_1",
        type: "InputField",
        props: expect.objectContaining({ placeholder: "Player name", inputText: "Lyx" }),
      }),
      expect.objectContaining({
        clientHintId: "md_control_2",
        type: "Toggle",
        props: expect.objectContaining({ isOn: true }),
      }),
      expect.objectContaining({
        clientHintId: "md_control_3",
        type: "Slider",
        props: expect.objectContaining({ minValue: 0, maxValue: 100, value: 70 }),
      }),
      expect.objectContaining({
        clientHintId: "md_control_4",
        type: "Dropdown",
        props: expect.objectContaining({ options: ["Easy", "Normal", "Hard"], value: 1 }),
      }),
    ]));
  });

  test("drafts long document body into a scrollable text area", () => {
    const draft = draftPlanningIntentFromDocumentText(
      {
        path: "manual.md",
        kind: "md",
        text: [
          "# Long Manual",
          "Overview line",
          "Detail line 1",
          "Detail line 2",
          "Detail line 3",
          "Detail line 4",
          "Detail line 5",
          "CTA: Close",
        ].join("\n"),
      },
      { screenName: "LongManual", maxTextElements: 3 },
    );

    expect(validatePlanningIntent(draft.intent).ok).toBe(true);
    expect(draft.detected.omittedLines).toBe(0);
    expect(draft.warnings.join("\n")).toContain("body line(s) were placed in one ScrollView");
    const scroll = draft.intent.elements.find((element) => element.clientHintId === "md_body_scroll");
    expect(scroll).toMatchObject({
      type: "ScrollView",
      props: expect.objectContaining({
        text: expect.stringContaining("Detail line 5"),
        fontSize: 26,
        align: "UpperLeft",
      }),
    });
    expect(draft.intent.elements.some((element) => element.clientHintId === "md_body_1")).toBe(false);
    expect(draft.intent.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientHintId: "md_button_1",
        type: "Button",
        props: expect.objectContaining({ text: "Close" }),
      }),
    ]));
  });

  test("auto-routes text material into an editable document screen", async () => {
    const dir = await tmpMaterialDir("material-screen-document");
    const file = join(dir, "brief.md");
    await writeFile(file, "# Daily Rewards\n\n- Login streak\n\nCTA: Claim");

    try {
      const created = await createScreenFromMaterial(
        file,
        { mode: "auto", screenName: "DailyRewards" },
        async () => {
          throw new Error("image importer should not run for editable document route");
        },
        async () => {
          throw new Error("pptx importer should not run for editable document route");
        },
        async (intent) => ({
          screenId: `${intent.screenName}_ID`,
          elements: intent.elements.map((element, index) => ({
            clientHintId: element.clientHintId,
            elementId: `Element_${index + 1}`,
          })),
        }),
      );

      expect(created.kind).toBe("document");
      expect(created.mode).toBe("editable");
      expect(created.source).toMatchObject({
        tool: "create_screen_from_material",
        kind: "md",
        mode: "editable",
        path: file,
      });
      expect(created.intent.elements).toEqual(expect.arrayContaining([
        expect.objectContaining({
          clientHintId: "md_title",
          props: expect.objectContaining({ text: "Daily Rewards" }),
        }),
        expect.objectContaining({
          clientHintId: "md_button_1",
          type: "Button",
          props: expect.objectContaining({ text: "Claim" }),
        }),
      ]));
    } finally {
      await cleanupDir(dir);
    }
  });

  test("auto-routes video material into a playable Video screen without frame analysis", async () => {
    const dir = await tmpMaterialDir("material-screen-video");
    const file = join(dir, "intro-loop.mp4");
    await writeFile(file, Buffer.from("fake video bytes"));

    try {
      let importRequest: any;
      const created = await createScreenFromMaterial(
        file,
        { mode: "auto", screenName: "IntroVideo" },
        async (request) => {
          importRequest = request;
          return {
            sourcePath: request.sourcePath,
            assetPath: request.assetPath,
            importedAsSprite: false,
            assetType: "VideoClip",
          };
        },
        async () => {
          throw new Error("pptx importer should not run for video route");
        },
        async (intent) => ({
          screenId: `${intent.screenName}_ID`,
          elements: intent.elements.map((element, index) => ({
            clientHintId: element.clientHintId,
            elementId: `Element_${index + 1}`,
          })),
        }),
      );

      expect(importRequest).toMatchObject({
        sourcePath: file,
        importAsSprite: false,
      });
      expect(importRequest.assetPath).toBe("Assets/UOS/Videos/intro-loop.mp4");
      expect(created.kind).toBe("video");
      expect(created.mode).toBe("editable");
      expect(created.source).toMatchObject({
        tool: "create_screen_from_material",
        kind: "video",
        mode: "editable",
        path: file,
        assetPaths: ["Assets/UOS/Videos/intro-loop.mp4"],
      });
      expect(created.warnings.join("\n")).toContain("Video content is not semantically analyzed");
      expect(created.intent.referenceCanvas).toEqual({ width: 1920, height: 1080 });
      expect(created.intent.elements).toEqual([
        expect.objectContaining({
          clientHintId: "content_video",
          type: "Video",
          props: expect.objectContaining({
            video: "Assets/UOS/Videos/intro-loop.mp4",
            playOnAwake: false,
            loop: false,
            muted: false,
          }),
        }),
      ]);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("falls back to DOCX image reference when auto document text route has no text", async () => {
    const dir = await tmpMaterialDir("material-screen-docx-fallback");
    const file = join(dir, "brief.docx");
    const pngBytes = await sharp({
      create: {
        width: 64,
        height: 36,
        channels: 4,
        background: "#5588ccff",
      },
    }).png().toBuffer();
    const docxZip = new JSZip();
    docxZip.file("word/document.xml", "<w:document/>");
    docxZip.file("word/media/image1.png", pngBytes);
    await writeFile(file, await docxZip.generateAsync({ type: "nodebuffer" }));

    try {
      const created = await createScreenFromMaterial(
        file,
        { mode: "auto", screenName: "DocxFallback", outputDir: join(dir, "extracted") },
        async (request) => ({
          sourcePath: request.sourcePath,
          assetPath: request.assetPath,
          importedAsSprite: true,
          assetType: "Sprite",
        }),
        async () => {
          throw new Error("pptx importer should not run for DOCX fallback");
        },
        async (intent) => ({
          screenId: `${intent.screenName}_ID`,
          elements: intent.elements.map((element, index) => ({
            clientHintId: element.clientHintId,
            elementId: `Element_${index + 1}`,
          })),
        }),
      );

      expect(created.kind).toBe("docx");
      expect(created.mode).toBe("reference");
      expect(created.source).toMatchObject({
        tool: "create_screen_from_material",
        kind: "docx",
        mode: "reference",
        path: file,
        imageNumber: 1,
      });
      expect(created.warnings[0]).toContain("fell back to reference mode");
      expect(created.importedAsset?.assetPath).toContain("Assets/UOS/Imported");
      expect(created.intent.elements[0]).toMatchObject({
        type: "Image",
        props: { sprite: created.importedAsset?.assetPath },
      });
    } finally {
      sharp.cache(false);
      await cleanupDir(dir);
    }
  });

  test("renders PDF pages to PNG screenshots", async () => {
    const dir = await tmpMaterialDir("pdf-render");
    const file = join(dir, "brief.pdf");
    const outputDir = join(dir, "rendered");
    await writeFile(file, minimalPdf("Unity PDF Render"));

    try {
      const rendered = await renderPdfPages(file, { first: 1, desiredWidth: 300, outputDir });
      expect(rendered.ok).toBe(true);
      expect(rendered.rendered).toBe(true);
      expect(rendered.renderer).toBe("pdf-parse");
      expect(rendered.images).toHaveLength(1);
      expect(rendered.images[0].width).toBe(300);
      expect(rendered.images[0].height).toBe(144);
      expect(rendered.images[0].mimeType).toBe("image/png");

      const bytes = await readFile(rendered.images[0].path);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("reports PPTX text fallback when external renderers are disabled", async () => {
    const dir = await tmpMaterialDir("pptx-render-disabled");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml("Fallback slide", "No renderer"));
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const rendered = await renderPptxToImages(file, { disableExternal: true, outputDir: join(dir, "rendered") });
      expect(rendered.ok).toBe(false);
      expect(rendered.rendered).toBe(false);
      expect(rendered.images).toHaveLength(0);
      expect(rendered.error).toContain("disabled");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("pptx_to_images fallback attaches embedded PPTX images for vision", async () => {
    const dir = await tmpMaterialDir("pptx-tool-embedded-fallback");
    const file = join(dir, "deck.pptx");
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml("Fallback slide", "Screenshot reference"));
    zip.file("ppt/media/image1.png", await sharp({
      create: {
        width: 96,
        height: 54,
        channels: 4,
        background: "#335577ff",
      },
    }).png().toBuffer());
    await writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));

    try {
      const result = await pptxToImagesTool.execute({
        path: file,
        outputDir: join(dir, "rendered"),
        disableExternalRenderers: true,
        maxFallbackImages: 2,
      }, { directory: dir });

      expect(result.title).toContain("text fallback");
      expect(result.output).toContain("Extracted embedded PPTX image(s) for vision fallback");
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0]).toMatchObject({
        type: "file",
        mime: "image/png",
        filename: "001-image1.png",
      });
      expect((result.metadata as any).embeddedImages.images).toHaveLength(1);
      expect((result.metadata as any).embeddedImages.images[0]).toMatchObject({
        width: 96,
        height: 54,
      });
    } finally {
      await cleanupDir(dir);
    }
  });
});

async function tmpMaterialDir(name: string) {
  const dir = join(
    import.meta.dir,
    "..",
    ".omx",
    "tmp",
    `materials-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupDir(dir: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

function slideXml(...texts: string[]) {
  return `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree>
        ${texts.map((text) => `<p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`).join("\n")}
      </p:spTree></p:cSld>
    </p:sld>
  `;
}

function slideLayoutXml(options: {
  titleRunProps?: string;
  titleRunPrXml?: string;
  titleFillXml?: string;
  extraShapeXml?: string;
} = {}) {
  const titleRunProps = options.titleRunPrXml
    ?? (options.titleRunProps !== undefined ? `<a:rPr ${options.titleRunProps}/>` : "");
  const titleFillXml = options.titleFillXml ?? "";
  const extraShapeXml = options.extraShapeXml ?? "";
  return `
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:sp>
          <p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="685800"/></a:xfrm>${titleFillXml}</p:spPr>
          <p:txBody><a:p><a:r>${titleRunProps}<a:t>Hero Title</a:t></a:r></a:p></p:txBody>
        </p:sp>
        ${extraShapeXml}
        <p:pic>
          <p:nvPicPr><p:cNvPr id="3" name="Hero Image"/></p:nvPicPr>
          <p:blipFill><a:blip r:embed="rIdImage1"/></p:blipFill>
          <p:spPr><a:xfrm><a:off x="6096000" y="3429000"/><a:ext cx="3048000" cy="1714500"/></a:xfrm></p:spPr>
        </p:pic>
      </p:spTree></p:cSld>
    </p:sld>
  `;
}

function minimalPdf(text: string) {
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length 64 >> stream
BT /F1 18 Tf 50 90 Td (${text}) Tj ET
endstream endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer << /Root 1 0 R /Size 6 >>
startxref
425
%%EOF`);
}
