/**
 * kiosk-build-core - deterministic KioskPlan -> EditorCommandBatch builder.
 *
 * This layer still performs no Unity mutation. It converts an approved
 * KioskPlan into ordered Editor commands that can be reviewed, then applied by
 * the Editor execution boundary.
 */

import { basename, join } from "node:path";
import { validateEditorChangeSet } from "./artifact-core.js";
import { RECIPE_GUARD_VERSION, validateRecipeCompliance } from "./recipe-core.js";

export const KIOSK_BUILD_VERSION = "1.0.0";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

export function buildKioskEditorChangeSet(plan, options = {}) {
  const errors = validateKioskPlanInput(plan);
  if (errors.length > 0) {
    return { ok: false, errors, warnings: [], changeSet: undefined };
  }

  const warnings = [];
  const planId = nonBlank(options.planId) ?? nonBlank(plan.id) ?? stableId("kiosk-plan", plan.refRoot ?? "root");
  const batchId = nonBlank(options.batchId) ?? `${planId}-editor-batch-1`;
  const changeSetId = nonBlank(options.changeSetId) ?? `${planId}-changes`;
  const includePreviews = options.includePreviews === true;
  const modeId = "kiosk-content";
  const blueprintSource = blueprintSourceRef(options, plan);
  const commands = [];

  for (const node of plan.nodes) {
    const screenCommand = screenCreationCommand(plan, node, { modeId, planId });
    commands.push(screenCommand);
    if (screenCommand.route === "material") {
      commands.push(...navigationAddCommands(plan, node, { modeId, planId }));
    }
    if (includePreviews) {
      commands.push(previewCommand(node, { modeId, planId }));
    }
  }

  for (const edge of plan.navEdges ?? []) {
    const from = nodeById(plan, edge.fromId);
    const to = nodeById(plan, edge.toId);
    if (from === undefined || to === undefined) {
      warnings.push(`navEdges: skipped transition ${edge.fromId} -> ${edge.toId}; missing node`);
      continue;
    }
    commands.push(transitionCommand(edge, from, to, { modeId, planId }));
  }

  const changeSet = {
    version: KIOSK_BUILD_VERSION,
    kind: "EditorChangeSet",
    id: changeSetId,
    modeId,
    planId,
    batches: [
      {
        version: KIOSK_BUILD_VERSION,
        kind: "EditorCommandBatch",
        id: batchId,
        modeId,
        planId,
        source: {
          tool: "build_kiosk_from_plan",
          recipeId: "kiosk",
          ...blueprintSource,
        },
        commands: commands.map(({ route, ...command }) => command),
      },
    ],
    evidence: [],
    source: {
      tool: "build_kiosk_from_plan",
      recipeId: "kiosk",
      recipeFile: ".opencode/recipes/kiosk.md",
      recipeGuardVersion: RECIPE_GUARD_VERSION,
      refRoot: plan.refRoot,
      mode: plan.mode,
      counts: plan.counts,
      ...blueprintSource,
    },
  };

  const validation = validateEditorChangeSet(changeSet);
  const recipeCompliance = validateRecipeCompliance(changeSet, { recipeId: "kiosk" });
  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: [...warnings, ...validation.warnings, ...recipeCompliance.warnings],
    changeSet: validation.ok ? changeSet : undefined,
    summary: summarizeKioskBuild(plan, commands),
    recipeCompliance,
  };
}

export function formatKioskBuildChangeSet(result) {
  if (!result.ok) {
    return `Kiosk build plan is invalid:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`;
  }
  const summary = result.summary;
  const lines = [
    "Kiosk build command batch ready.",
    `Screens: ${summary.screens} (${summary.menuScreens} menu, ${summary.materialScreens} material, ${summary.placeholderScreens} placeholder)`,
    `Navigation buttons to add: ${summary.navigationButtons}`,
    `Transitions: ${summary.transitions}`,
    `Previews: ${summary.previews}`,
    `Total Editor commands: ${summary.commands}`,
  ];
  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join("\n");
}

function screenCreationCommand(plan, node, context) {
  if (node.role === "menu") {
    return {
      route: "menu",
      id: `create-screen-${node.id}`,
      tool: "create_ui_screen",
      args: {
        intent: menuIntent(plan, node),
        source: screenSource(node, "kiosk-menu", "menu"),
      },
      mutation: true,
      requiresApproval: true,
    };
  }

  const routed = routedMaterial(node);
  if (routed !== undefined) {
    return {
      route: "material",
      id: `create-screen-${node.id}`,
      tool: routed.layoutReference ? "create_reference_screen_from_material" : "create_screen_from_material",
      args: {
        path: materialPath(node, routed.material),
        screenName: node.screenName,
        ...(routed.layoutReference ? { kind: "image", clientHintId: "layout-reference" } : { mode: "auto" }),
      },
      mutation: true,
      requiresApproval: true,
    };
  }

  return {
    route: "placeholder",
    id: `create-screen-${node.id}`,
    tool: "create_ui_screen",
    args: {
      intent: detailPlaceholderIntent(plan, node),
      source: screenSource(node, "kiosk-detail", "placeholder"),
    },
    mutation: true,
    requiresApproval: true,
  };
}

function navigationAddCommands(plan, node, context) {
  return navigationEdgesForNode(plan, node)
    .map((edge, index) => ({
      id: `add-nav-${node.id}-${index + 1}-${edge.kind}`,
      tool: "add_ui_element_from_context",
      args: {
        screenName: node.screenName,
        latest: true,
        refreshHierarchy: true,
        element: navigationButtonElement(edge, index),
      },
      mutation: true,
      requiresApproval: true,
    }));
}

function transitionCommand(edge, from, to, context) {
  return {
    id: `transition-${edge.kind}-${edge.fromId}-to-${edge.toId}`,
    tool: "create_screen_transition_from_context",
    args: {
      fromScreenName: from.screenName,
      toScreenName: to.screenName,
      triggerClientHintId: edge.triggerClientHintId,
      triggerType: "Button",
      refreshHierarchy: true,
    },
    mutation: true,
    requiresApproval: true,
  };
}

function previewCommand(node, context) {
  return {
    route: "preview",
    id: `capture-preview-${node.id}`,
    tool: "capture_preview_from_context",
    args: {
      screenName: node.screenName,
      latest: true,
      refreshHierarchy: true,
    },
    mutation: true,
    requiresApproval: true,
  };
}

function menuIntent(plan, node) {
  const childEdges = childDrilldownEdges(plan, node);
  const navEdges = navigationEdgesForNode(plan, node);
  const elements = baseScreenElements(node.screenName);
  const buttonCount = Math.max(1, childEdges.length);
  const buttonH = Math.min(0.11, 0.56 / buttonCount);
  const gap = Math.min(0.025, buttonH * 0.25);

  childEdges.forEach((edge, index) => {
    const child = nodeById(plan, edge.toId);
    elements.push({
      clientHintId: edge.triggerClientHintId,
      type: "Button",
      rect: { x: 0.24, y: 0.28 + index * (buttonH + gap), w: 0.52, h: buttonH },
      props: {
        text: edge.triggerLabel ?? child?.name ?? child?.screenName ?? edge.toId,
        fontSize: 30,
        color: "#2f6f73",
      },
    });
  });

  navEdges.forEach((edge, index) => {
    elements.push(navigationButtonElement(edge, index));
  });

  return {
    version: KIOSK_BUILD_VERSION,
    screenName: node.screenName,
    referenceCanvas: DEFAULT_CANVAS,
    elements,
  };
}

function detailPlaceholderIntent(plan, node) {
  const elements = baseScreenElements(node.screenName);
  const materialNames = (node.materials ?? []).map((m) => m.name);
  elements.push({
    clientHintId: "detail-material-summary",
    type: "Text",
    rect: { x: 0.16, y: 0.3, w: 0.68, h: 0.28 },
    props: {
      text: materialNames.length > 0
        ? `Materials:\n${materialNames.join("\n")}`
        : "No planning materials found for this detail screen.",
      fontSize: 26,
      color: "#2d3440",
      align: "MiddleCenter",
    },
  });
  navigationEdgesForNode(plan, node).forEach((edge, index) => {
    elements.push(navigationButtonElement(edge, index));
  });
  return {
    version: KIOSK_BUILD_VERSION,
    screenName: node.screenName,
    referenceCanvas: DEFAULT_CANVAS,
    elements,
  };
}

function baseScreenElements(screenName) {
  return [
    {
      clientHintId: "screen-background",
      type: "Panel",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      props: { color: "#f7f4ed" },
    },
    {
      clientHintId: "screen-title",
      type: "Text",
      rect: { x: 0.1, y: 0.08, w: 0.8, h: 0.12 },
      props: {
        text: screenName,
        fontSize: 44,
        fontStyle: "Bold",
        color: "#1c2b34",
        align: "MiddleCenter",
      },
    },
  ];
}

function navigationButtonElement(edge, index) {
  const width = 0.14;
  const height = 0.07;
  const gap = 0.015;
  return {
    clientHintId: edge.triggerClientHintId,
    type: "Button",
    rect: { x: 0.04 + index * (width + gap), y: 0.89, w: width, h: height },
    props: {
      text: edge.triggerLabel,
      fontSize: 22,
      color: navButtonColor(edge.kind),
    },
  };
}

function childDrilldownEdges(plan, node) {
  const childIds = new Set(node.childIds ?? []);
  return (plan.navEdges ?? []).filter((edge) =>
    edge.fromId === node.id
    && edge.kind === "drilldown"
    && childIds.has(edge.toId)
  );
}

function navigationEdgesForNode(plan, node) {
  const childIds = new Set(node.childIds ?? []);
  return (plan.navEdges ?? []).filter((edge) =>
    edge.fromId === node.id
    && (edge.kind !== "drilldown" || !childIds.has(edge.toId))
  );
}

function routedMaterial(node) {
  if (node.layoutReference !== undefined && node.layoutReference !== null) {
    return { material: node.layoutReference, layoutReference: true };
  }
  const firstContent = firstArrayItem(node.contentMedia);
  if (firstContent !== undefined) return { material: firstContent, layoutReference: false };
  const firstSpec = firstArrayItem(node.specSources);
  if (firstSpec !== undefined) return { material: firstSpec, layoutReference: false };
  const firstMaterial = firstArrayItem(node.materials);
  if (firstMaterial !== undefined) return { material: firstMaterial, layoutReference: false };
  return undefined;
}

function materialPath(node, material) {
  return join(node.absPath, material.name);
}

function screenSource(node, kind, mode) {
  return {
    tool: "build_kiosk_from_plan",
    kind,
    mode,
    path: node.absPath,
  };
}

function summarizeKioskBuild(plan, commands) {
  return {
    screens: plan.nodes.length,
    menuScreens: commands.filter((c) => c.route === "menu").length,
    materialScreens: commands.filter((c) => c.route === "material").length,
    placeholderScreens: commands.filter((c) => c.route === "placeholder").length,
    navigationButtons: commands.filter((c) => c.tool === "add_ui_element_from_context").length,
    transitions: commands.filter((c) => c.tool === "create_screen_transition_from_context").length,
    previews: commands.filter((c) => c.route === "preview").length,
    commands: commands.length,
  };
}

function validateKioskPlanInput(plan) {
  const errors = [];
  if (plan === undefined || plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    return ["plan: must be an object"];
  }
  if (!Array.isArray(plan.nodes)) errors.push("plan.nodes: must be an array");
  if (!Array.isArray(plan.navEdges)) errors.push("plan.navEdges: must be an array");
  if (typeof plan.rootId !== "string" || plan.rootId.length === 0) errors.push("plan.rootId: must be a non-empty string");
  if (Array.isArray(plan.nodes)) {
    for (const [index, node] of plan.nodes.entries()) {
      if (node === undefined || node === null || typeof node !== "object" || Array.isArray(node)) {
        errors.push(`plan.nodes[${index}]: must be an object`);
        continue;
      }
      for (const key of ["id", "screenName", "role", "absPath"]) {
        if (typeof node[key] !== "string" || node[key].length === 0) {
          errors.push(`plan.nodes[${index}].${key}: must be a non-empty string`);
        }
      }
      if (!Array.isArray(node.childIds)) errors.push(`plan.nodes[${index}].childIds: must be an array`);
      if (!Array.isArray(node.materials)) errors.push(`plan.nodes[${index}].materials: must be an array`);
    }
  }
  return errors;
}

function nodeById(plan, id) {
  return (plan.nodes ?? []).find((node) => node.id === id);
}

function navButtonColor(kind) {
  if (kind === "home") return "#53666f";
  if (kind === "back") return "#6f5d45";
  return "#2f6f73";
}

function stableId(prefix, value) {
  const base = basename(String(value)).trim() || "root";
  return `${prefix}-${base.replace(/[^0-9a-zA-Z가-힣_-]+/g, "-")}`;
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function blueprintSourceRef(options, plan) {
  const blueprintId = nonBlank(options.blueprintId) ?? nonBlank(plan?.source?.blueprintId);
  const blueprintPath = nonBlank(options.blueprintPath) ?? nonBlank(plan?.source?.blueprintPath);
  const source = {};
  if (blueprintId !== undefined) source.blueprintId = blueprintId;
  if (blueprintPath !== undefined) source.blueprintPath = blueprintPath;
  return source;
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}
