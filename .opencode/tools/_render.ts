import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  delimiter,
  dirname,
  extname,
  join,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export interface RenderImage {
  path: string;
  pageNumber: number;
  width: number;
  height: number;
  size: number;
  mimeType: "image/png";
}

export interface RenderResult {
  ok: boolean;
  rendered: boolean;
  renderer: string;
  images: RenderImage[];
  total?: number;
  outputDir: string;
  error?: string;
}

export interface RenderPagesOptions {
  outputDir?: string;
  desiredWidth?: number;
  scale?: number;
  pages?: number[];
  first?: number;
  last?: number;
  prefix?: string;
}

export interface RenderPptxOptions extends RenderPagesOptions {
  disableExternal?: boolean;
}

export async function renderPdfPages(filePath: string, options: RenderPagesOptions = {}): Promise<RenderResult> {
  const { PDFParse } = await import("pdf-parse");
  const outputDir = options.outputDir ?? await defaultRenderDir(filePath, "pdf");
  await fs.mkdir(outputDir, { recursive: true });

  const parser = new PDFParse({ data: await fs.readFile(filePath) });
  try {
    const screenshot = await parser.getScreenshot({
      ...pageParams(options),
      desiredWidth: positiveInt(options.desiredWidth),
      scale: positiveNumber(options.scale),
      imageBuffer: true,
      imageDataUrl: false,
    });

    const prefix = safeStem(options.prefix ?? basename(filePath, extname(filePath)));
    const images: RenderImage[] = [];
    for (const page of screenshot.pages) {
      const outputPath = join(outputDir, `${prefix}-page-${String(page.pageNumber).padStart(3, "0")}.png`);
      await fs.writeFile(outputPath, page.data);
      const stat = await fs.stat(outputPath);
      images.push({
        path: outputPath,
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        size: stat.size,
        mimeType: "image/png",
      });
    }

    return {
      ok: images.length > 0,
      rendered: images.length > 0,
      renderer: "pdf-parse",
      images,
      total: screenshot.total,
      outputDir,
    };
  } finally {
    await parser.destroy();
  }
}

export async function renderPptxToImages(filePath: string, options: RenderPptxOptions = {}): Promise<RenderResult> {
  const outputDir = options.outputDir ?? await defaultRenderDir(filePath, "pptx");
  await fs.mkdir(outputDir, { recursive: true });

  if (options.disableExternal === true) {
    return fallbackRenderResult("external PPTX renderers disabled", outputDir);
  }

  const errors: string[] = [];
  const office = await findSoffice();
  if (office !== undefined) {
    try {
      const pdf = await convertPptxToPdfWithSoffice(office, filePath);
      const result = await renderPdfPages(pdf, {
        ...options,
        outputDir,
        prefix: basename(filePath, extname(filePath)),
      });
      return { ...result, renderer: `libreoffice+${result.renderer}` };
    } catch (err) {
      errors.push(`LibreOffice: ${errorMessage(err)}`);
    }
  } else {
    errors.push("LibreOffice not found");
  }

  if (process.platform === "win32") {
    try {
      return await renderPptxWithPowerPoint(filePath, outputDir, options);
    } catch (err) {
      errors.push(`PowerPoint: ${errorMessage(err)}`);
    }
  }

  return fallbackRenderResult(errors.join("; "), outputDir);
}

function pageParams(options: RenderPagesOptions) {
  const pages = options.pages
    ?.map((n) => positiveInt(n))
    .filter((n): n is number => n !== undefined);
  if (pages !== undefined && pages.length > 0) return { partial: pages };

  const first = positiveInt(options.first);
  const last = positiveInt(options.last);
  if (first !== undefined && last !== undefined) return { first, last };
  if (last !== undefined) return { last };
  return { first: first ?? 8 };
}

async function defaultRenderDir(filePath: string, kind: string): Promise<string> {
  const stem = safeStem(basename(filePath, extname(filePath)));
  const dir = join(tmpdir(), "oh-my-unity", "rendered", `${stem}-${kind}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function findSoffice(): Promise<string | undefined> {
  const envPath = process.env.UOS_SOFFICE_PATH?.trim();
  if (envPath !== undefined && envPath.length > 0 && await fileExists(envPath)) return envPath;

  const names = process.platform === "win32"
    ? ["soffice.com", "soffice.exe", "soffice", "libreoffice.exe", "libreoffice"]
    : ["soffice", "libreoffice"];
  const pathDirs = (process.env.PATH ?? "").split(delimiter).filter((p) => p.length > 0);
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (await fileExists(candidate)) return candidate;
    }
  }

  if (process.platform === "win32") {
    for (const candidate of [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ]) {
      if (await fileExists(candidate)) return candidate;
    }
  }

  return undefined;
}

async function convertPptxToPdfWithSoffice(sofficePath: string, pptxPath: string): Promise<string> {
  const outDir = await defaultRenderDir(pptxPath, "soffice-pdf");
  const { stdout, stderr } = await execFileAsync(
    sofficePath,
    ["--headless", "--convert-to", "pdf", "--outdir", outDir, pptxPath],
    { timeout: 120_000, windowsHide: true },
  );
  const expected = join(outDir, `${basename(pptxPath, extname(pptxPath))}.pdf`);
  if (await fileExists(expected)) return expected;

  const pdfs = (await fs.readdir(outDir)).filter((name) => extname(name).toLowerCase() === ".pdf");
  if (pdfs.length > 0) return join(outDir, pdfs[0]);
  throw new Error(`PDF conversion did not produce output. stdout=${stdout.trim()} stderr=${stderr.trim()}`);
}

async function renderPptxWithPowerPoint(
  pptxPath: string,
  outputDir: string,
  options: RenderPagesOptions,
): Promise<RenderResult> {
  const script = `
param([string]$InputPath, [string]$OutputDir)
$ErrorActionPreference = "Stop"
$ppt = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
  $presentation = $ppt.Presentations.Open($InputPath, $true, $false, $false)
  $presentation.Export($OutputDir, "PNG")
} finally {
  if ($presentation -ne $null) { $presentation.Close() }
  if ($ppt -ne $null) { $ppt.Quit() }
}
`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, resolve(pptxPath), resolve(outputDir)],
    { timeout: 120_000, windowsHide: true },
  );

  const files = (await fs.readdir(outputDir))
    .filter((name) => extname(name).toLowerCase() === ".png")
    .map((name) => join(outputDir, name))
    .sort(naturalFileSort);

  const images: RenderImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const pageNumber = i + 1;
    if (!shouldKeepRenderedPage(pageNumber, files.length, options)) continue;
    const metadata = await sharp(files[i]).metadata();
    const stat = await fs.stat(files[i]);
    images.push({
      path: files[i],
      pageNumber,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      size: stat.size,
      mimeType: "image/png",
    });
  }

  return {
    ok: images.length > 0,
    rendered: images.length > 0,
    renderer: "powerpoint",
    images,
    total: files.length,
    outputDir,
  };
}

function shouldKeepRenderedPage(pageNumber: number, total: number, options: RenderPagesOptions): boolean {
  if (options.pages !== undefined && options.pages.length > 0) {
    const selected = new Set(options.pages.map((n) => positiveInt(n)).filter((n): n is number => n !== undefined));
    return selected.has(pageNumber);
  }
  const first = positiveInt(options.first);
  const last = positiveInt(options.last);
  if (first !== undefined && last !== undefined) return pageNumber >= first && pageNumber <= last;
  if (first !== undefined) return pageNumber <= first;
  if (last !== undefined) return pageNumber > total - last;
  return true;
}

function fallbackRenderResult(error: string, outputDir: string): RenderResult {
  return { ok: false, rendered: false, renderer: "none", images: [], outputDir, error };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function positiveInt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.round(n));
}

function positiveNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function safeStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_") || "material";
}

function naturalFileSort(a: string, b: string): number {
  const na = Number.parseInt(basename(a).match(/(\d+)/)?.[1] ?? "0", 10);
  const nb = Number.parseInt(basename(b).match(/(\d+)/)?.[1] ?? "0", 10);
  return na - nb || a.localeCompare(b);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
