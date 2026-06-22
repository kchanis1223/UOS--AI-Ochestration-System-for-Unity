/**
 * get_scene_hierarchy - bridge proxy. Returns the GameObject hierarchy plus
 * inspectable UI details (element id, type, rect, anchor, props) for a screen or scene.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { call } from "./_bridge";

export default tool({
  description: "Return the GameObject hierarchy of a screen or scene, including UI element ids, inferred type, normalized rect, anchor preset, and inspectable props when available.",
  args: {
    screenId: z.string().optional().describe("If omitted, returns the whole scene hierarchy."),
  },
  async execute(args) {
    const data = (await call("get_scene_hierarchy", args)) as Record<string, unknown>;
    const summary = summarizeHierarchy(data);
    const raw = JSON.stringify(data, null, 2);
    return {
      title: args.screenId !== undefined ? `get_scene_hierarchy: ${args.screenId}` : "get_scene_hierarchy: scene",
      output: `${summary}\n\nRaw hierarchy JSON:\n${raw}`,
      metadata: { ok: true, hierarchy: data },
    };
  },
});

export function summarizeHierarchy(data: Record<string, unknown>): string {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const roots = Array.isArray(data.roots) ? data.roots : [];
  const lines = [
    `Hierarchy roots: ${roots.length}`,
    `Hierarchy nodes: ${nodes.length}`,
  ];
  if (nodes.length === 0) {
    lines.push("No hierarchy nodes returned.");
    return lines.join("\n");
  }

  for (const rawNode of nodes.slice(0, 80)) {
    const node = rawNode as Record<string, unknown>;
    const depth = numberValue(node.depth) ?? 0;
    const indent = "  ".repeat(Math.max(0, Math.min(depth, 12)));
    const root = rootLabel(node);
    const id = stringValue(node.elementId) ?? "(no element id)";
    const name = stringValue(node.name) ?? "(unnamed)";
    const type = stringValue(node.type) ?? "(unknown)";
    const parent = stringValue(node.parentElementId);
    const anchor = stringValue(node.anchor);
    const rect = rectSummary(node.rect);
    const props = propsSummary(node.props);
    const active = node.active === true ? " active" : node.active === false ? " inactive" : "";
    const truncated = node.truncated === true ? " truncated" : "";
    const childCount = numberValue(node.childCount);
    lines.push(
      `${indent}- ${root}${id} type=${type} name="${name}"` +
      active +
      (parent !== undefined ? ` parent=${parent}` : "") +
      (childCount !== undefined ? ` children=${childCount}` : "") +
      (anchor !== undefined ? ` anchor=${anchor}` : "") +
      (rect !== undefined ? ` ${rect}` : "") +
      (props !== undefined ? ` ${props}` : "") +
      truncated,
    );
  }
  if (nodes.length > 80) {
    lines.push(`... ${nodes.length - 80} more node(s) omitted from summary; see raw JSON below.`);
  }
  return lines.join("\n");
}

function rootLabel(node: Record<string, unknown>): string {
  const rootName = stringValue(node.rootScreenName);
  const rootId = stringValue(node.rootScreenId);
  if (rootName !== undefined && rootId !== undefined) return `[${rootName}/${rootId}] `;
  if (rootId !== undefined) return `[${rootId}] `;
  return "";
}

function rectSummary(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== "object") return undefined;
  const rect = value as Record<string, unknown>;
  const x = numberValue(rect.x);
  const y = numberValue(rect.y);
  const w = numberValue(rect.w);
  const h = numberValue(rect.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return `rect=${fmt(x)},${fmt(y)},${fmt(w)},${fmt(h)}`;
}

function propsSummary(value: unknown): string | undefined {
  if (value === null || value === undefined || typeof value !== "object") return undefined;
  const props = value as Record<string, unknown>;
  const options = Array.isArray(props.options)
    ? props.options.filter((item): item is string => typeof item === "string")
    : [];
  const parts = [
    stringValue(props.text) !== undefined ? `text="${truncate(stringValue(props.text)!, 40)}"` : undefined,
    stringValue(props.placeholder) !== undefined ? `placeholder="${truncate(stringValue(props.placeholder)!, 40)}"` : undefined,
    stringValue(props.inputText) !== undefined ? `inputText="${truncate(stringValue(props.inputText)!, 40)}"` : undefined,
    stringValue(props.color) !== undefined ? `color=${props.color}` : undefined,
    numberValue(props.fontSize) !== undefined ? `fontSize=${props.fontSize}` : undefined,
    stringValue(props.fontStyle) !== undefined ? `fontStyle=${props.fontStyle}` : undefined,
    stringValue(props.sprite) !== undefined ? `sprite=${props.sprite}` : undefined,
    stringValue(props.video) !== undefined ? `video=${props.video}` : undefined,
    stringValue(props.align) !== undefined ? `align=${props.align}` : undefined,
    numberValue(props.value) !== undefined ? `value=${props.value}` : undefined,
    numberValue(props.minValue) !== undefined ? `min=${props.minValue}` : undefined,
    numberValue(props.maxValue) !== undefined ? `max=${props.maxValue}` : undefined,
    typeof props.isOn === "boolean" ? `isOn=${props.isOn}` : undefined,
    typeof props.interactable === "boolean" ? `interactable=${props.interactable}` : undefined,
    typeof props.loop === "boolean" ? `loop=${props.loop}` : undefined,
    typeof props.playOnAwake === "boolean" ? `playOnAwake=${props.playOnAwake}` : undefined,
    typeof props.muted === "boolean" ? `muted=${props.muted}` : undefined,
    options.length > 0 ? `options=${options.slice(0, 5).map((option) => `"${truncate(option, 24)}"`).join("|")}${options.length > 5 ? `+${options.length - 5}` : ""}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? `props(${parts.join(", ")})` : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
