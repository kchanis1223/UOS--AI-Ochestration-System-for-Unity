import JSZip from "jszip";
import { promises as fs } from "node:fs";
import { basename, dirname, normalize, posix } from "node:path";

const DEFAULT_SLIDE_WIDTH_EMU = 12_192_000;
const DEFAULT_SLIDE_HEIGHT_EMU = 6_858_000;

export interface PptxLayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
  xEmu: number;
  yEmu: number;
  wEmu: number;
  hEmu: number;
}

export interface PptxLayoutItem {
  kind: "text" | "picture" | "shape";
  name?: string;
  id?: string;
  text?: string;
  fontStyle?: "Bold" | "Italic" | "BoldAndItalic";
  color?: string;
  fillColor?: string;
  mediaPath?: string;
  relationshipId?: string;
  rect?: PptxLayoutRect;
  suggestedElementType: "Text" | "Image" | "Panel";
}

export interface PptxSlideLayout {
  slideNumber: number;
  slidePath: string;
  items: PptxLayoutItem[];
}

export interface PptxLayout {
  path: string;
  slideWidthEmu: number;
  slideHeightEmu: number;
  aspectRatio: number;
  slides: PptxSlideLayout[];
}

export interface ExtractPptxLayoutOptions {
  pages?: number[];
  first?: number;
  last?: number;
  maxItemsPerSlide?: number;
}

export async function extractPptxLayout(filePath: string, options: ExtractPptxLayoutOptions = {}): Promise<PptxLayout> {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const size = await readSlideSize(zip);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(naturalSort)
    .filter((name, index, all) => shouldKeepSlide(index + 1, all.length, options));

  const slides: PptxSlideLayout[] = [];
  const maxItemsPerSlide = clampInt(options.maxItemsPerSlide, 100, 1, 500);
  for (const slidePath of slideNames) {
    const file = zip.file(slidePath);
    if (file === null) continue;
    const rels = await readSlideRelationships(zip, slidePath);
    const xml = await file.async("string");
    const items = [
      ...extractTextShapes(xml, size),
      ...extractPictures(xml, size, rels),
    ].slice(0, maxItemsPerSlide);
    slides.push({
      slideNumber: Number.parseInt(slidePath.match(/slide(\d+)\.xml$/)?.[1] ?? String(slides.length + 1), 10),
      slidePath,
      items,
    });
  }

  return {
    path: filePath,
    slideWidthEmu: size.width,
    slideHeightEmu: size.height,
    aspectRatio: roundMetric(size.width / size.height),
    slides,
  };
}

export function formatPptxLayout(layout: PptxLayout): string {
  const lines = [
    `PPTX layout: ${layout.path}`,
    `slideSizeEmu: ${layout.slideWidthEmu}x${layout.slideHeightEmu} (aspect=${layout.aspectRatio})`,
    `slides: ${layout.slides.length}`,
  ];
  for (const slide of layout.slides) {
    lines.push("");
    lines.push(`Slide ${slide.slideNumber}: ${slide.items.length} item(s)`);
    if (slide.items.length === 0) {
      lines.push("  - no positioned text or picture items found");
      continue;
    }
    slide.items.forEach((item, index) => {
      const rect = item.rect !== undefined
        ? `rect=${item.rect.x},${item.rect.y},${item.rect.w},${item.rect.h}`
        : "rect=(unknown)";
      const style = item.fontStyle !== undefined ? ` fontStyle=${item.fontStyle}` : "";
      const color = item.color !== undefined ? ` color=${item.color}` : "";
      const fill = item.fillColor !== undefined ? ` fill=${item.fillColor}` : "";
      const label = item.text !== undefined
        ? `text="${truncate(item.text, 80)}"`
        : item.mediaPath !== undefined
          ? `media=${item.mediaPath}`
          : item.name !== undefined
            ? `name="${item.name}"`
            : "shape";
      lines.push(`  ${index + 1}. ${item.kind} -> ${item.suggestedElementType} ${rect}${style}${color}${fill} ${label}`);
    });
  }
  return lines.join("\n");
}

async function readSlideSize(zip: JSZip): Promise<{ width: number; height: number }> {
  const presentation = zip.file("ppt/presentation.xml");
  if (presentation === null) return { width: DEFAULT_SLIDE_WIDTH_EMU, height: DEFAULT_SLIDE_HEIGHT_EMU };
  const xml = await presentation.async("string");
  const tag = xml.match(/<p:sldSz\b[^>]*>/)?.[0] ?? "";
  const width = numberAttr(tag, "cx") ?? DEFAULT_SLIDE_WIDTH_EMU;
  const height = numberAttr(tag, "cy") ?? DEFAULT_SLIDE_HEIGHT_EMU;
  return { width, height };
}

async function readSlideRelationships(zip: JSZip, slidePath: string): Promise<Map<string, string>> {
  const relsPath = `${posix.dirname(slidePath)}/_rels/${basename(slidePath)}.rels`;
  const file = zip.file(relsPath);
  const rels = new Map<string, string>();
  if (file === null) return rels;
  const xml = await file.async("string");
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = stringAttr(tag, "Id");
    const target = stringAttr(tag, "Target");
    if (id === undefined || target === undefined) continue;
    rels.set(id, normalizePptxTarget(slidePath, target));
  }
  return rels;
}

function extractTextShapes(xml: string, slideSize: { width: number; height: number }): PptxLayoutItem[] {
  const items: PptxLayoutItem[] = [];
  for (const match of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const block = match[0];
    const text = textFromDrawingXml(block);
    const meta = extractCommonMeta(block, slideSize);
    if (text.length > 0) {
      items.push({
        kind: "text",
        ...meta,
        text,
        fontStyle: fontStyleFromDrawingXml(block),
        color: textColorFromDrawingXml(block),
        suggestedElementType: "Text",
      });
    } else if (meta.rect !== undefined) {
      items.push({ kind: "shape", ...meta, suggestedElementType: "Panel" });
    }
  }
  return items;
}

function extractPictures(
  xml: string,
  slideSize: { width: number; height: number },
  rels: Map<string, string>,
): PptxLayoutItem[] {
  const items: PptxLayoutItem[] = [];
  for (const match of xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
    const block = match[0];
    const meta = extractCommonMeta(block, slideSize);
    const relationshipId = block.match(/r:embed="([^"]+)"/)?.[1];
    items.push({
      kind: "picture",
      ...meta,
      relationshipId,
      mediaPath: relationshipId !== undefined ? rels.get(relationshipId) : undefined,
      suggestedElementType: "Image",
    });
  }
  return items;
}

function extractCommonMeta(block: string, slideSize: { width: number; height: number }): {
  name?: string;
  id?: string;
  rect?: PptxLayoutRect;
  fillColor?: string;
} {
  const cNvPr = block.match(/<p:cNvPr\b[^>]*>/)?.[0] ?? "";
  return {
    name: stringAttr(cNvPr, "name"),
    id: stringAttr(cNvPr, "id"),
    rect: extractRect(block, slideSize),
    fillColor: fillColorFromShapeXml(block),
  };
}

function extractRect(block: string, slideSize: { width: number; height: number }): PptxLayoutRect | undefined {
  const xfrm = block.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>/)?.[0];
  if (xfrm === undefined) return undefined;
  const off = xfrm.match(/<a:off\b[^>]*>/)?.[0] ?? "";
  const ext = xfrm.match(/<a:ext\b[^>]*>/)?.[0] ?? "";
  const x = numberAttr(off, "x");
  const y = numberAttr(off, "y");
  const w = numberAttr(ext, "cx");
  const h = numberAttr(ext, "cy");
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return {
    x: roundMetric(x / slideSize.width),
    y: roundMetric(y / slideSize.height),
    w: roundMetric(w / slideSize.width),
    h: roundMetric(h / slideSize.height),
    xEmu: x,
    yEmu: y,
    wEmu: w,
    hEmu: h,
  };
}

function shouldKeepSlide(slideNumber: number, total: number, options: ExtractPptxLayoutOptions): boolean {
  if (options.pages !== undefined && options.pages.length > 0) {
    return new Set(options.pages.map((page) => clampInt(page, 1, 1, Number.MAX_SAFE_INTEGER))).has(slideNumber);
  }
  const first = positiveInt(options.first);
  const last = positiveInt(options.last);
  if (first !== undefined && last !== undefined) return slideNumber >= first && slideNumber <= last;
  if (first !== undefined) return slideNumber <= first;
  if (last !== undefined) return slideNumber > total - last;
  return true;
}

function normalizePptxTarget(slidePath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = posix.dirname(slidePath);
  return normalize(`${base}/${target}`).replace(/\\/g, "/");
}

function stringAttr(tag: string, name: string): string | undefined {
  const value = tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  return value !== undefined ? decodeXmlEntities(value) : undefined;
}

function numberAttr(tag: string, name: string): number | undefined {
  const raw = stringAttr(tag, name);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function boolAttr(tag: string, name: string): boolean | undefined {
  const raw = stringAttr(tag, name);
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "t", "on"].includes(normalized)) return true;
  if (["0", "false", "f", "off"].includes(normalized)) return false;
  return undefined;
}

function textFromDrawingXml(xml: string): string {
  return [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXmlEntities(match[1]))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fontStyleFromDrawingXml(xml: string): "Bold" | "Italic" | "BoldAndItalic" | undefined {
  let bold = false;
  let italic = false;
  const styledRuns = [...xml.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)]
    .filter((run) => /<a:t\b/.test(run[0]));

  for (const run of styledRuns) {
    const rPr = run[0].match(/<a:rPr\b[^>]*>/)?.[0];
    if (rPr === undefined) continue;
    bold ||= boolAttr(rPr, "b") === true;
    italic ||= boolAttr(rPr, "i") === true;
  }

  if (!bold && !italic) {
    for (const match of xml.matchAll(/<a:(?:rPr|defRPr)\b[^>]*>/g)) {
      const tag = match[0];
      bold ||= boolAttr(tag, "b") === true;
      italic ||= boolAttr(tag, "i") === true;
    }
  }

  if (bold && italic) return "BoldAndItalic";
  if (bold) return "Bold";
  if (italic) return "Italic";
  return undefined;
}

function textColorFromDrawingXml(xml: string): string | undefined {
  const styledRuns = [...xml.matchAll(/<a:r\b[\s\S]*?<\/a:r>/g)]
    .filter((run) => /<a:t\b/.test(run[0]));

  for (const run of styledRuns) {
    for (const rPr of drawingPropertyBlocks(run[0], ["rPr"])) {
      const color = colorFromSolidFill(rPr);
      if (color !== undefined) return color;
    }
  }

  for (const propertyBlock of drawingPropertyBlocks(xml, ["rPr", "defRPr"])) {
    const color = colorFromSolidFill(propertyBlock);
    if (color !== undefined) return color;
  }
  return undefined;
}

function drawingPropertyBlocks(xml: string, names: string[]): string[] {
  const blocks: string[] = [];
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const closedPattern = new RegExp(`<a:${escapedName}\\b[^>]*>[\\s\\S]*?<\\/a:${escapedName}>`, "g");
    const selfClosingPattern = new RegExp(`<a:${escapedName}\\b[^>]*/>`, "g");
    blocks.push(...[...xml.matchAll(closedPattern)].map((match) => match[0]));
    blocks.push(...[...xml.matchAll(selfClosingPattern)].map((match) => match[0]));
  }
  return blocks;
}

function fillColorFromShapeXml(xml: string): string | undefined {
  const spPr = xml.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0];
  return colorFromSolidFill(spPr);
}

function colorFromSolidFill(xml: string | undefined): string | undefined {
  if (xml === undefined) return undefined;
  const solidFill = xml.match(/<a:solidFill\b[\s\S]*?<\/a:solidFill>/)?.[0];
  if (solidFill === undefined) return undefined;
  const srgb = solidFill.match(/<a:srgbClr\b[^>]*\bval="([0-9a-fA-F]{6})"[^>]*>/)?.[1];
  if (srgb !== undefined) return `#${srgb.toUpperCase()}`;
  const scheme = solidFill.match(/<a:schemeClr\b[^>]*\bval="([^"]+)"[^>]*>/)?.[1];
  return schemeColor(scheme);
}

function schemeColor(value: string | undefined): string | undefined {
  switch (value) {
    case "bg1":
    case "lt1":
      return "#FFFFFF";
    case "tx1":
    case "dk1":
      return "#000000";
    default:
      return undefined;
  }
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function naturalSort(a: string, b: string): number {
  const na = Number.parseInt(a.match(/(\d+)(?=\.xml$)/)?.[1] ?? "0", 10);
  const nb = Number.parseInt(b.match(/(\d+)(?=\.xml$)/)?.[1] ?? "0", 10);
  return na - nb || a.localeCompare(b);
}

function positiveInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.round(n));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function roundMetric(value: number): number {
  return Number.parseFloat(value.toFixed(6));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
