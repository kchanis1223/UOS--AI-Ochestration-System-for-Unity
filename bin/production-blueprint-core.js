/**
 * production-blueprint-core - persisted ProductionBlueprint artifacts.
 *
 * ProductionBlueprint is the user-approved source of truth for broad UOS
 * creation work. This module only validates and persists JSON artifacts; it
 * never mutates Unity.
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { uosArtifactPaths, validateProductionBlueprint } from "./artifact-core.js";

export function productionBlueprintFileName(id) {
  const value = nonBlank(id);
  if (value === undefined) throw new Error("blueprint.id: must be a non-empty string");
  const safe = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (safe.length === 0) throw new Error("blueprint.id: must contain a filesystem-safe character");
  return `${safe}.json`;
}

export function productionBlueprintPath(projectDir, id) {
  return join(uosArtifactPaths(projectDir).blueprintsDir, productionBlueprintFileName(id));
}

export async function writeProductionBlueprint(projectDir, blueprint) {
  const validation = validateProductionBlueprint(blueprint);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
      blueprint: undefined,
      path: undefined,
    };
  }

  const paths = uosArtifactPaths(projectDir);
  const file = productionBlueprintPath(projectDir, blueprint.id);
  await fs.mkdir(paths.blueprintsDir, { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  return {
    ok: true,
    errors: [],
    warnings: validation.warnings,
    blueprint,
    path: file,
  };
}

export async function readProductionBlueprint(projectDir, id) {
  const file = productionBlueprintPath(projectDir, id);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    return {
      ok: false,
      errors: [`blueprint.file: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
      blueprint: undefined,
      path: file,
    };
  }

  const validation = validateProductionBlueprint(parsed);
  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    blueprint: validation.ok ? parsed : undefined,
    path: file,
  };
}

export async function listProductionBlueprints(projectDir) {
  const dir = uosArtifactPaths(projectDir).blueprintsDir;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = join(dir, entry.name);
    let stat;
    let parsed;
    try {
      stat = await fs.stat(file);
      parsed = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (err) {
      results.push({
        ok: false,
        errors: [`blueprint.file: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`],
        warnings: [],
        blueprint: undefined,
        path: file,
        updatedAt: stat?.mtime.toISOString(),
      });
      continue;
    }

    const validation = validateProductionBlueprint(parsed);
    results.push({
      ok: validation.ok,
      errors: validation.errors,
      warnings: validation.warnings,
      blueprint: validation.ok ? parsed : undefined,
      path: file,
      updatedAt: stat.mtime.toISOString(),
    });
  }

  return results.sort((a, b) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))
      || String(a.path).localeCompare(String(b.path))
  );
}

export async function readLatestProductionBlueprint(projectDir) {
  const blueprints = await listProductionBlueprints(projectDir);
  return blueprints[0];
}

export async function summarizeProductionBlueprints(projectDir) {
  const blueprints = await listProductionBlueprints(projectDir);
  const latest = blueprints[0];
  const active = blueprints.find((item) =>
    item.ok
      && item.blueprint !== undefined
      && item.blueprint.status !== "cancelled"
      && item.blueprint.status !== "blocked"
  );
  const invalid = blueprints.filter((item) => !item.ok);
  return {
    count: blueprints.length,
    latest: summarizeBlueprintResult(latest),
    active: summarizeBlueprintResult(active),
    invalid: invalid.map((item) => ({
      path: item.path,
      errors: item.errors,
      updatedAt: item.updatedAt,
    })),
  };
}

export function summarizeBlueprintResult(item) {
  if (item === undefined) return undefined;
  if (!item.ok || item.blueprint === undefined) {
    return {
      ok: false,
      path: item.path,
      errors: item.errors,
      warnings: item.warnings,
      updatedAt: item.updatedAt,
    };
  }
  const blueprint = item.blueprint;
  return {
    ok: true,
    id: blueprint.id,
    kind: blueprint.kind,
    modeId: blueprint.modeId,
    recipeId: blueprint.recipeId,
    title: blueprint.title,
    status: blueprint.status,
    approvalStatus: blueprint.approval?.status,
    ambiguityEstimate: blueprint.ambiguity?.estimate,
    path: item.path,
    updatedAt: item.updatedAt,
  };
}

function nonBlank(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
