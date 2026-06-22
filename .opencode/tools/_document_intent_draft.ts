import { basename, extname } from "node:path";
import type { PlanningIntent } from "./_planning_intent";
import { validatePlanningIntent } from "./_planning_intent";

export interface DocumentIntentDraftOptions {
  screenName?: string;
  referenceWidth?: number;
  referenceHeight?: number;
  maxTextElements?: number;
  includeBackground?: boolean;
  includeButtons?: boolean;
  clientHintPrefix?: string;
}

export interface DocumentIntentDraft {
  intent: PlanningIntent;
  source: {
    path: string;
    kind: string;
    chars: number;
    lineCount: number;
  };
  detected: {
    title?: string;
    buttons: string[];
    controls: DocumentControl[];
    omittedLines: number;
  };
  warnings: string[];
}

type DocumentControlType = "InputField" | "Toggle" | "Slider" | "Dropdown";

interface DocumentControl {
  type: DocumentControlType;
  label: string;
  placeholder?: string;
  inputText?: string;
  isOn?: boolean;
  value?: number;
  minValue?: number;
  maxValue?: number;
  options?: string[];
}

interface NormalizedDocumentLine {
  text: string;
  displayText: string;
  bullet: boolean;
  control?: DocumentControl;
}

export function draftPlanningIntentFromDocumentText(
  source: { path: string; text: string; kind?: string },
  options: DocumentIntentDraftOptions = {},
): DocumentIntentDraft {
  const inferredKind = extname(source.path).replace(/^\./, "") || "document";
  const sourceKind = normalizeKind(source.kind ?? inferredKind);
  const prefix = clientHintPrefix(options.clientHintPrefix ?? sourceKind);
  const referenceWidth = clampInt(options.referenceWidth, 1920, 320, 8192);
  const referenceHeight = clampInt(options.referenceHeight, 1080, 240, 8192);
  const maxTextElements = clampInt(options.maxTextElements, 10, 1, 30);
  const includeBackground = options.includeBackground !== false;
  const includeButtons = options.includeButtons !== false;
  const warnings: string[] = [];
  const lines = normalizeDocumentLines(source.text);
  if (lines.length === 0) {
    throw new Error(`draft_planning_intent_from_document: no extractable text found in "${source.path}"`);
  }

  const title = lines[0].displayText;
  const rest = lines.slice(1);
  const buttons = includeButtons ? selectButtonLines(rest) : [];
  const buttonSet = new Set(buttons.map((line) => line));
  const controlCandidates = rest.filter((line) => line.control !== undefined && !buttonSet.has(line));
  const controlLines = controlCandidates.slice(0, 4);
  const controlSet = new Set(controlLines.map((line) => line));
  const bodyCandidates = rest.filter((line) => !buttonSet.has(line) && !controlSet.has(line) && line.control === undefined);
  const useScrollableBody = bodyCandidates.length > maxTextElements;
  const bodyLines = useScrollableBody ? [] : bodyCandidates.slice(0, maxTextElements);
  const omittedLines = useScrollableBody ? 0 : Math.max(0, bodyCandidates.length - bodyLines.length);
  if (useScrollableBody) {
    warnings.push(`${bodyCandidates.length} body line(s) were placed in one ScrollView instead of separate Text elements.`);
  } else if (omittedLines > 0) {
    warnings.push(`${omittedLines} body line(s) were omitted; raise maxTextElements or revise the draft manually.`);
  }
  if (controlCandidates.length > controlLines.length) {
    warnings.push(`${controlCandidates.length - controlLines.length} control candidate(s) were omitted; only the first 4 are drafted.`);
  }

  const elements: PlanningIntent["elements"] = [];
  if (includeBackground) {
    elements.push({
      clientHintId: `${prefix}_background`,
      type: "Panel",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      anchor: "TopLeft",
      props: { color: "#101820" },
    });
  }

  elements.push({
    clientHintId: `${prefix}_title`,
    type: "Text",
    rect: { x: 0.08, y: 0.07, w: 0.84, h: 0.095 },
    anchor: "TopLeft",
    props: {
      text: title,
      fontSize: 52,
      fontStyle: "Bold",
      color: "#f6f7f9",
      align: "MiddleLeft",
    },
  });

  const buttonLines = buttons.slice(0, 3);
  const bodyTop = 0.2;
  const bottomReserve = buttonLines.length > 0
    ? (controlLines.length > 0 ? 0.36 : 0.19)
    : (controlLines.length > 0 ? 0.22 : 0.08);
  const layout = bodyLayout(bodyLines.length, bodyTop, bottomReserve);
  if (useScrollableBody) {
    elements.push({
      clientHintId: `${prefix}_body_scroll`,
      type: "ScrollView",
      rect: {
        x: 0.1,
        y: bodyTop,
        w: 0.8,
        h: roundMetric(Math.max(0.16, 1 - bodyTop - bottomReserve)),
      },
      anchor: "TopLeft",
      props: {
        text: bodyCandidates.map((line) => line.displayText).join("\n"),
        fontSize: 26,
        color: "#f8fafc",
        align: "UpperLeft",
      },
    });
  }
  bodyLines.forEach((line, index) => {
    elements.push({
      clientHintId: `${prefix}_body_${index + 1}`,
      type: "Text",
      rect: {
        x: 0.1,
        y: roundMetric(bodyTop + index * layout.step),
        w: 0.8,
        h: layout.height,
      },
      anchor: "TopLeft",
      props: {
        text: line.displayText,
        fontSize: line.bullet ? layout.bulletFontSize : layout.fontSize,
        color: "#dbe1ea",
        align: "MiddleLeft",
      },
    });
  });

  controlLines.forEach((line, index) => {
    if (line.control === undefined) return;
    const rect = controlRect(index, controlLines.length, buttonLines.length > 0);
    elements.push({
      clientHintId: `${prefix}_control_${index + 1}`,
      type: line.control.type,
      rect,
      anchor: "TopLeft",
      props: {
        ...controlProps(line.control),
      },
    });
  });

  buttonLines.forEach((line, index) => {
    const rect = buttonRect(index, buttonLines.length);
    elements.push({
      clientHintId: `${prefix}_button_${index + 1}`,
      type: "Button",
      rect,
      anchor: "TopLeft",
      props: {
        text: stripButtonPrefix(line.displayText),
        fontSize: 28,
        fontStyle: "Bold",
        color: "#2f80ed",
        align: "MiddleCenter",
      },
    });
  });
  if (buttons.length > buttonLines.length) {
    warnings.push(`${buttons.length - buttonLines.length} button candidate(s) were omitted; only the first 3 are drafted.`);
  }

  const intent: PlanningIntent = {
    version: "1.0.0",
    screenName: options.screenName?.trim() || defaultScreenName(source.path, title, sourceKind),
    referenceCanvas: { width: referenceWidth, height: referenceHeight },
    elements,
  };
  const validation = validatePlanningIntent(intent);
  warnings.push(...validation.warnings);
  if (!validation.ok) {
    warnings.push(...validation.errors.map((error) => `draft validation: ${error}`));
  }

  return {
    intent,
    source: {
      path: source.path,
      kind: sourceKind,
      chars: source.text.length,
      lineCount: lines.length,
    },
    detected: {
      title,
      buttons: buttonLines.map((line) => stripButtonPrefix(line.displayText)),
      controls: controlLines
        .map((line) => line.control)
        .filter((control): control is DocumentControl => control !== undefined),
      omittedLines,
    },
    warnings,
  };
}

export function formatDocumentIntentDraft(draft: DocumentIntentDraft): string {
  const lines = [
    `Draft PlanningIntent from ${draft.source.path}`,
    `sourceKind: ${draft.source.kind}`,
    `screenName: ${draft.intent.screenName}`,
    `referenceCanvas: ${draft.intent.referenceCanvas.width}x${draft.intent.referenceCanvas.height}`,
    `sourceLines: ${draft.source.lineCount}`,
    `elements: ${draft.intent.elements.length}`,
  ];
  if (draft.detected.title !== undefined) {
    lines.push(`detectedTitle: ${draft.detected.title}`);
  }
  if (draft.detected.buttons.length > 0) {
    lines.push(`detectedButtons: ${draft.detected.buttons.join(", ")}`);
  }
  if (draft.detected.controls.length > 0) {
    lines.push(`detectedControls: ${draft.detected.controls.map((control) => `${control.type}:${control.label}`).join(", ")}`);
  }
  if (draft.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of draft.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  lines.push("PlanningIntent JSON:");
  lines.push(JSON.stringify(draft.intent, null, 2));
  return lines.join("\n");
}

function normalizeDocumentLines(text: string): NormalizedDocumentLine[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((raw) => normalizeLine(raw))
    .filter((line): line is NormalizedDocumentLine => line !== undefined);
}

function normalizeLine(raw: string): NormalizedDocumentLine | undefined {
  const trimmed = raw
    .replace(/\s+--\s+\d+\s+of\s+\d+\s+--\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (trimmed.length === 0 || /^--\s+\d+\s+of\s+\d+\s+--$/i.test(trimmed)) return undefined;
  const headingStripped = trimmed.replace(/^#{1,6}\s+/, "");
  const bullet = /^([-*]|\d+[.)])\s+/.test(headingStripped) || /^\u2022\s+/.test(headingStripped);
  const bulletText = headingStripped
    .replace(/^\u2022\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
  return {
    text: headingStripped,
    displayText: bullet ? `- ${bulletText}` : headingStripped,
    bullet,
    control: controlFromLine(bullet ? bulletText : headingStripped),
  };
}

function controlFromLine(line: string): NormalizedDocumentLine["control"] {
  const match = line.match(/^(input(?:\s*field)?|field|text\s*field|toggle|checkbox|check\s*box|slider|range|dropdown|drop\s*down|select)\s*[:\-]\s*(.+)$/i);
  if (match === null) return undefined;
  const rawType = match[1].toLowerCase().replace(/\s+/g, "");
  const spec = match[2].trim();
  if (spec.length === 0) return undefined;
  if (rawType === "toggle" || rawType === "checkbox") {
    return parseControlSpec("Toggle", spec);
  }
  if (rawType === "slider" || rawType === "range") {
    return parseControlSpec("Slider", spec);
  }
  if (rawType === "dropdown" || rawType === "select") {
    return parseControlSpec("Dropdown", spec);
  }
  return parseControlSpec("InputField", spec);
}

function parseControlSpec(type: DocumentControlType, spec: string): DocumentControl | undefined {
  const parsed = splitControlDefault(spec);
  const bracketed = extractBracketSpec(parsed.label);
  const label = bracketed.label.trim();
  if (label.length === 0) return undefined;
  const control: DocumentControl = { type, label };
  if (type === "InputField") {
    if (parsed.defaultValue !== undefined && parsed.defaultValue.length > 0) {
      control.inputText = parsed.defaultValue;
    }
    return control;
  }
  if (type === "Toggle") {
    const parsedToggle = parseToggleValue(parsed.defaultValue);
    if (parsedToggle !== undefined) control.isOn = parsedToggle;
    return control;
  }
  if (type === "Slider") {
    const range = parseRange(bracketed.bracket);
    if (range !== undefined) {
      control.minValue = range.min;
      control.maxValue = range.max;
    }
    const value = parseSliderValue(parsed.defaultValue, range);
    if (value !== undefined) control.value = value;
    return control;
  }
  const options = splitOptions(bracketed.bracket) ?? splitOptions(parsed.defaultValue);
  if (options !== undefined) {
    control.options = options;
    const selected = dropdownSelectedIndex(options, parsed.defaultValue);
    if (selected !== undefined) control.value = selected;
  } else if (parsed.defaultValue !== undefined && parsed.defaultValue.length > 0) {
    control.options = [parsed.defaultValue];
    control.value = 0;
  }
  return control;
}

function splitControlDefault(spec: string): { label: string; defaultValue?: string } {
  const match = spec.match(/^(.*?)\s*=\s*(.+)$/);
  if (match === null) return { label: spec.trim() };
  return { label: match[1].trim(), defaultValue: match[2].trim() };
}

function extractBracketSpec(value: string): { label: string; bracket?: string } {
  const match = value.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (match === null) return { label: value.trim() };
  return { label: match[1].trim(), bracket: match[2].trim() };
}

function parseToggleValue(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "on", "yes", "y", "checked", "enabled", "1"].includes(normalized)) return true;
  if (["false", "off", "no", "n", "unchecked", "disabled", "0"].includes(normalized)) return false;
  return undefined;
}

function parseRange(value: string | undefined): { min: number; max: number } | undefined {
  if (value === undefined) return undefined;
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:\.\.|-|to)\s*(-?\d+(?:\.\d+)?)\s*$/i);
  if (match === null) return undefined;
  const min = Number.parseFloat(match[1]);
  const max = Number.parseFloat(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return undefined;
  return { min, max };
}

function parseSliderValue(value: string | undefined, range: { min: number; max: number } | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const percent = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percent !== null) {
    const ratio = Number.parseFloat(percent[1]) / 100;
    if (!Number.isFinite(ratio)) return undefined;
    const min = range?.min ?? 0;
    const max = range?.max ?? 1;
    return roundMetric(min + (max - min) * ratio);
  }
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function splitOptions(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!/[|,]/.test(value)) return undefined;
  const options = value
    .split(/[|,]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return options.length > 0 ? options : undefined;
}

function dropdownSelectedIndex(options: string[], value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (splitOptions(value) !== undefined) return 0;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric < options.length) return numeric;
  const folded = value.trim().toLowerCase();
  const index = options.findIndex((option) => option.trim().toLowerCase() === folded);
  return index >= 0 ? index : undefined;
}

function selectButtonLines(lines: NormalizedDocumentLine[]): NormalizedDocumentLine[] {
  const eligible = lines.filter((line) => line.control === undefined);
  const prefixed = eligible.filter((line) => hasButtonPrefix(line.text));
  if (prefixed.length > 0) return prefixed;
  return eligible.filter((line) => looksLikeActionLabel(line.displayText));
}

function hasButtonPrefix(line: string): boolean {
  return /^(button|cta|primary action|secondary action)\s*[:\-]\s*/i.test(line);
}

function stripButtonPrefix(line: string): string {
  return line.replace(/^(button|cta|primary action|secondary action)\s*[:\-]\s*/i, "").trim();
}

function looksLikeActionLabel(line: string): boolean {
  const text = stripButtonPrefix(line).toLowerCase();
  if (text.length === 0 || text.length > 36) return false;
  if (/[.!?]$/.test(text)) return false;
  const actionWords = [
    "start",
    "continue",
    "next",
    "back",
    "cancel",
    "save",
    "submit",
    "login",
    "log in",
    "sign in",
    "play",
    "retry",
    "ok",
    "confirm",
    "apply",
    "close",
    "checkout",
    "\uC2DC\uC791",
    "\uACC4\uC18D",
    "\uB2E4\uC74C",
    "\uC774\uC804",
    "\uCDE8\uC18C",
    "\uC800\uC7A5",
    "\uD655\uC778",
    "\uB85C\uADF8\uC778",
    "\uB2EB\uAE30",
    "\uC801\uC6A9",
  ];
  return actionWords.some((word) => text.includes(word));
}

function bodyLayout(count: number, top: number, bottomReserve: number): { height: number; step: number; fontSize: number; bulletFontSize: number } {
  if (count <= 0) return { height: 0.06, step: 0.072, fontSize: 30, bulletFontSize: 28 };
  const available = Math.max(0.12, 1 - top - bottomReserve);
  const rawStep = available / count;
  const step = clampMetric(rawStep, 0.052, 0.096);
  const height = clampMetric(step * 0.82, 0.044, 0.082);
  const fontSize = step < 0.065 ? 24 : step < 0.082 ? 28 : 32;
  return { height, step, fontSize, bulletFontSize: Math.max(22, fontSize - 2) };
}

function buttonRect(index: number, count: number): PlanningIntent["elements"][number]["rect"] {
  const clampedCount = Math.min(Math.max(count, 1), 3);
  const width = clampedCount === 1 ? 0.32 : clampedCount === 2 ? 0.24 : 0.2;
  const gap = 0.03;
  const totalWidth = width * clampedCount + gap * (clampedCount - 1);
  const x = (1 - totalWidth) / 2 + index * (width + gap);
  return { x: roundMetric(x), y: 0.84, w: width, h: 0.075 };
}

function controlRect(index: number, count: number, hasButtons: boolean): PlanningIntent["elements"][number]["rect"] {
  const top = hasButtons ? 0.61 : 0.74;
  const step = count > 2 ? 0.056 : 0.074;
  return {
    x: 0.22,
    y: roundMetric(top + index * step),
    w: 0.56,
    h: count > 2 ? 0.048 : 0.06,
  };
}

function controlColor(type: DocumentControlType): string {
  switch (type) {
    case "InputField":
      return "#f8fafc";
    case "Toggle":
      return "#16a34a";
    case "Slider":
      return "#334155";
    case "Dropdown":
      return "#e0f2fe";
  }
}

function controlProps(control: DocumentControl): NonNullable<PlanningIntent["elements"][number]["props"]> {
  const common = {
    text: control.label,
    fontSize: 22,
    color: controlColor(control.type),
    align: control.type === "Slider" ? "MiddleCenter" : "MiddleLeft",
  };
  switch (control.type) {
    case "InputField":
      return {
        ...common,
        placeholder: control.placeholder ?? control.label,
        ...(control.inputText !== undefined ? { inputText: control.inputText } : {}),
      };
    case "Toggle":
      return { ...common, isOn: control.isOn ?? false };
    case "Slider":
      return {
        ...common,
        minValue: control.minValue ?? 0,
        maxValue: control.maxValue ?? 1,
        value: control.value ?? midpoint(control.minValue ?? 0, control.maxValue ?? 1),
      };
    case "Dropdown":
      return { ...common, options: control.options ?? [control.label], value: control.value ?? 0 };
  }
}

function midpoint(min: number, max: number): number {
  return roundMetric(min + (max - min) / 2);
}

function defaultScreenName(filePath: string, title: string, kind: string): string {
  const fromTitle = toPascalName(title);
  if (fromTitle.length > 0) return fromTitle;
  const stem = basename(filePath, extname(filePath));
  return toPascalName(stem) || `${toPascalName(kind) || "Document"}Draft`;
}

function toPascalName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, "");
}

function normalizeKind(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "document";
}

function clientHintPrefix(value: string): string {
  const normalized = normalizeKind(value).replace(/-/g, "_");
  return /^[a-z]/.test(normalized) ? normalized : `document_${normalized}`;
}

function clampMetric(value: number, min: number, max: number): number {
  return roundMetric(Math.min(max, Math.max(min, value)));
}

function roundMetric(value: number): number {
  return Number.parseFloat(value.toFixed(6));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
