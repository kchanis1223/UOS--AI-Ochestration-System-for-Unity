/**
 * kiosk-core - deterministic "folder tree -> kiosk screen structure" planner.
 *
 * Pure ESM (node:fs/node:path only) so it runs from both the node CLI
 * (`uos kiosk-plan`) and the bun-run opencode tool (`plan_kiosk_structure`).
 * It performs NO Unity mutation and NO image/office parsing; it only walks the
 * folder tree and builds a normalized KioskPlan (sitemap + navigation plan).
 *
 * Mapping rules (chosen 2026-06-08):
 *  - Every folder under the kiosk root becomes one screen ("모든 폴더 = 화면").
 *  - A folder with child folders => "menu" screen (drills into its children).
 *  - A leaf folder => "detail" screen (generated from its own materials).
 *  - Navigation: drilldown (parent -> child), back (child -> parent),
 *    home (any non-root -> root). Each edge carries a stable trigger
 *    clientHintId so the builder can wire the matching button deterministically.
 *
 * Keep SUPPORTED_MATERIAL_EXTENSIONS in sync with .opencode/tools/_materials.ts.
 */
import { promises as fs } from "node:fs";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

export const SUPPORTED_MATERIAL_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
  ".mp4", ".mov", ".webm", ".m4v",
  ".pdf", ".pptx", ".docx", ".txt", ".md", ".markdown", ".csv", ".json",
]);

export const IGNORED_DIRS = new Set([
  ".git", ".omx", ".opencode", ".uos",
  "Library", "Temp", "Obj", "Logs", "UserSettings",
  "node_modules", "Build", "Builds",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const TEXT_DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf", ".docx", ".pptx", ".csv", ".json"]);
const LAYOUT_REFERENCE_NAME_NORMALIZED = "화면구성";

function materialKind(ext) {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  if (ext === ".pptx") return "pptx";
  if (ext === ".docx") return "docx";
  if ([".txt", ".md", ".markdown", ".csv", ".json"].includes(ext)) return "text";
  return "unknown";
}

function materialPurpose(name, ext) {
  if (isLayoutReferenceMaterial(name, ext)) return "layout-reference";
  if (TEXT_DOC_EXTENSIONS.has(ext)) return "spec-source";
  return "content-media";
}

function isLayoutReferenceMaterial(name, ext) {
  if (!IMAGE_EXTENSIONS.has(ext)) return false;
  const base = name.slice(0, name.length - ext.length);
  return base.replace(/\s+/g, "").toLowerCase() === LAYOUT_REFERENCE_NAME_NORMALIZED;
}

function clampInt(value, fallback, min, max) {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Natural compare so "2_x" sorts before "10_x" and numeric prefixes order the
 * kiosk screens the way a human numbered them. Falls back to locale compare.
 */
export function naturalCompare(a, b) {
  const ax = String(a).match(/(\d+|\D+)/g) ?? [String(a)];
  const bx = String(b).match(/(\d+|\D+)/g) ?? [String(b)];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const as = ax[i];
    const bs = bx[i];
    const aIsNum = /^\d+$/.test(as);
    const bIsNum = /^\d+$/.test(bs);
    if (aIsNum && bIsNum) {
      const d = Number.parseInt(as, 10) - Number.parseInt(bs, 10);
      if (d !== 0) return d;
    } else {
      const c = as.localeCompare(bs);
      if (c !== 0) return c;
    }
  }
  return ax.length - bx.length;
}

function slugSegment(segment) {
  return String(segment).trim().replace(/\s+/g, "-").replace(/[/\\]+/g, "-");
}

function makeId(relPath) {
  if (relPath === "") return "root";
  return relPath.split("/").map(slugSegment).join("__");
}

function uniqueScreenName(base, parentSegment, taken) {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  if (parentSegment) {
    const qualified = `${base} (${parentSegment})`;
    if (!taken.has(qualified)) {
      taken.add(qualified);
      return qualified;
    }
  }
  let i = 2;
  while (taken.has(`${base} ${i}`)) i++;
  const numbered = `${base} ${i}`;
  taken.add(numbered);
  return numbered;
}

async function listNodeMaterials(dirAbs) {
  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const materials = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!SUPPORTED_MATERIAL_EXTENSIONS.has(ext)) continue;
    let size = 0;
    try {
      size = (await fs.stat(join(dirAbs, entry.name))).size;
    } catch {
      // keep the entry usable even if stat fails
    }
    const purpose = materialPurpose(entry.name, ext);
    materials.push({
      name: entry.name,
      ext,
      kind: materialKind(ext),
      size,
      purpose,
      isLayoutReference: purpose === "layout-reference",
      isSpecSource: purpose === "spec-source",
      isContentMedia: purpose === "content-media",
    });
  }
  materials.sort((a, b) => naturalCompare(a.name, b.name));
  return materials;
}

async function listChildDirNames(dirAbs) {
  let entries;
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => e.name);
  dirs.sort(naturalCompare);
  return dirs;
}

/**
 * Walk the kiosk root folder and produce a deterministic KioskPlan.
 * @param {string} refRoot absolute or relative path to the kiosk root folder
 * @param {object} [options]
 * @returns {Promise<object>} KioskPlan
 */
export async function planKioskStructure(refRoot, options = {}) {
  const root = resolve(refRoot);
  const maxDepth = clampInt(options.maxDepth, 8, 0, 32);
  const maxNodes = clampInt(options.maxNodes, 500, 1, 5000);
  const includeBack = options.includeBack !== false;
  const includeHome = options.includeHome !== false;
  const backLabel = (options.backLabel ?? "이전").toString();
  const homeLabel = (options.homeLabel ?? "처음으로").toString();
  const mode = options.mode === "linear" ? "linear" : "tree";

  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error(`kiosk plan: not a directory: ${root}`);
  }

  const nodes = [];
  const warnings = [];
  const takenNames = new Set();
  let truncated = false;

  async function walk(dirAbs, relPath, depth, parentId) {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return null;
    }
    const id = makeId(relPath);
    const name = relPath === "" ? basename(root) : basename(dirAbs);
    const childNames = depth < maxDepth ? await listChildDirNames(dirAbs) : [];
    const role = childNames.length > 0 ? "menu" : "detail";
    const materials = await listNodeMaterials(dirAbs);
    const layoutReference = materials.find((m) => m.isLayoutReference) ?? null;
    const contentMedia = materials.filter((m) => m.isContentMedia);
    const specSources = materials.filter((m) => m.isSpecSource);
    const hasSpec = specSources.length > 0;
    const parentSegment = relPath.includes("/") ? relPath.split("/").slice(-2, -1)[0] : undefined;
    const screenName = uniqueScreenName(name, parentSegment, takenNames);

    const node = {
      id,
      name,
      screenName,
      relPath: relPath === "" ? "." : relPath,
      absPath: dirAbs,
      depth,
      role,
      parentId,
      childIds: [],
      materials,
      layoutReference,
      contentMedia,
      specSources,
      hasSpec,
    };
    nodes.push(node);

    for (const childName of childNames) {
      const childRel = relPath === "" ? childName : `${relPath}/${childName}`;
      const childId = await walk(join(dirAbs, childName), childRel, depth + 1, id);
      if (childId !== null) node.childIds.push(childId);
    }
    return id;
  }

  const rootId = await walk(root, "", 0, null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const navEdges = [];

  if (mode === "linear") {
    const order = nodes.map((n) => n.id);
    for (let i = 0; i < order.length; i++) {
      if (i > 0) {
        navEdges.push(edge(order[i], order[i - 1], "back", "nav-prev", options.backLabel ?? "이전"));
      }
      if (i < order.length - 1) {
        navEdges.push(edge(order[i], order[i + 1], "drilldown", "nav-next", "다음"));
      }
      if (includeHome && i !== 0) {
        navEdges.push(edge(order[i], rootId, "home", "nav-home", homeLabel));
      }
    }
  } else {
    for (const node of nodes) {
      for (const childId of node.childIds) {
        const child = byId.get(childId);
        navEdges.push(edge(node.id, childId, "drilldown", `nav-to-${childId}`, child ? child.name : childId));
      }
      if (node.parentId !== null && includeBack) {
        navEdges.push(edge(node.id, node.parentId, "back", "nav-back", backLabel));
      }
      if (node.id !== rootId && includeHome) {
        navEdges.push(edge(node.id, rootId, "home", "nav-home", homeLabel));
      }
    }
  }

  const counts = {
    screens: nodes.length,
    menus: nodes.filter((n) => n.role === "menu").length,
    details: nodes.filter((n) => n.role === "detail").length,
    edges: navEdges.length,
    layoutReferences: nodes.filter((n) => n.layoutReference !== null).length,
    contentMedia: nodes.reduce((sum, n) => sum + n.contentMedia.length, 0),
    specSources: nodes.reduce((sum, n) => sum + n.specSources.length, 0),
  };

  if (nodes.length === 0) warnings.push("No folders found under the kiosk root.");
  if (nodes.length === 1) warnings.push("Only the root folder was found; add subfolders for child screens.");
  if (truncated) warnings.push(`Node limit ${maxNodes} reached; tree truncated. Raise maxNodes or narrow the root.`);
  for (const node of nodes) {
    if (node.role === "detail" && node.materials.length === 0) {
      warnings.push(`Detail screen "${node.screenName}" has no planning materials (${node.relPath}).`);
    }
  }

  return {
    refRoot: root,
    generatedAt: new Date().toISOString(),
    mode,
    source: kioskPlanSource(options),
    rootId,
    nodes,
    navEdges,
    counts,
    warnings,
    options: { maxDepth, maxNodes, includeBack, includeHome, backLabel, homeLabel },
  };
}

function kioskPlanSource(options) {
  const blueprintId = nonBlank(options.blueprintId);
  const blueprintPath = nonBlank(options.blueprintPath);
  if (blueprintId === undefined && blueprintPath === undefined) return undefined;
  const source = { tool: "plan_kiosk_structure" };
  if (blueprintId !== undefined) source.blueprintId = blueprintId;
  if (blueprintPath !== undefined) source.blueprintPath = blueprintPath;
  return source;
}

function edge(fromId, toId, kind, triggerClientHintId, triggerLabel) {
  return { fromId, toId, kind, triggerClientHintId, triggerLabel: String(triggerLabel) };
}

/**
 * Render a human-readable outline of the KioskPlan (tree + navigation summary).
 * @param {object} plan KioskPlan from planKioskStructure
 * @returns {string}
 */
export function formatKioskPlanOutline(plan) {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const lines = [];
  lines.push(`Kiosk plan: ${plan.refRoot}`);
  lines.push(
    `Screens: ${plan.counts.screens} (menu ${plan.counts.menus}, detail ${plan.counts.details}) · ` +
      `Navigation edges: ${plan.counts.edges} · mode: ${plan.mode}`,
  );
  lines.push("");

  function render(id, prefix, isLast, isRoot) {
    const node = byId.get(id);
    if (node === undefined) return;
    const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const tag = node.role === "menu" ? "[menu]  " : "[detail]";
    let materialNote = "";
    if (node.materials.length > 0) {
      materialNote = `  · 자료: ${node.materials.map((m) => m.name).join(", ")}`;
    } else if (node.role === "detail") {
      materialNote = "  · (자료 없음)";
    }
    lines.push(`${prefix}${connector}${tag} ${node.screenName}${materialNote}`);
    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    node.childIds.forEach((childId, index) => {
      render(childId, childPrefix, index === node.childIds.length - 1, false);
    });
  }
  render(plan.rootId, "", true, true);

  const byKind = plan.navEdges.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  lines.push("");
  lines.push(
    `Navigation: drilldown ${byKind.drilldown ?? 0}, back ${byKind.back ?? 0}, home ${byKind.home ?? 0}`,
  );

  if (plan.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of plan.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join("\n");
}

/**
 * Parse `uos kiosk-plan` CLI arguments (everything after the subcommand).
 * @param {string[]} args
 * @returns {object}
 */
export function parseKioskPlanOptions(args) {
  const options = {
    dir: undefined,
    json: false,
    maxDepth: undefined,
    includeBack: true,
    includeHome: true,
    backLabel: undefined,
    homeLabel: undefined,
    mode: "tree",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-back") {
      options.includeBack = false;
    } else if (arg === "--no-home") {
      options.includeHome = false;
    } else if (arg === "--linear") {
      options.mode = "linear";
    } else if (arg === "--max-depth") {
      options.maxDepth = Number.parseInt(args[++i], 10);
    } else if (arg === "--back-label") {
      options.backLabel = args[++i];
    } else if (arg === "--home-label") {
      options.homeLabel = args[++i];
    } else if (arg === "--dir") {
      options.dir = args[++i];
    } else if (!arg.startsWith("-") && options.dir === undefined) {
      options.dir = arg;
    } else {
      throw new Error(`kiosk-plan: unknown option "${arg}"`);
    }
  }
  return options;
}

/**
 * Resolve a kiosk root folder from a tool argument, honoring an absolute path
 * or resolving relative paths against the provided root (materials dir / cwd).
 */
export function resolveKioskRoot(input, fallbackRoot) {
  if (input === undefined || String(input).trim().length === 0) return fallbackRoot;
  const trimmed = String(input).trim();
  return isAbsolute(trimmed) ? trimmed : resolve(fallbackRoot, trimmed);
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
