/**
 * registry-dedupe - collapse duplicate live Unity Editor registry entries.
 *
 * Unity locks a project to a single Editor instance, so multiple LIVE registry
 * entries for the same project path are always duplicates — e.g. stale files
 * from prior sessions/domain reloads that still answer a handshake, leaked
 * listeners bound by the current process, or OS PID reuse. The launcher should
 * present ONE entry per project: the freshest, most complete bridge.
 *
 * Pure ESM (no deps) so it is unit-testable in isolation.
 */

export function normalizeProjectKey(projectPath) {
  return String(projectPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function parseTime(value) {
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? t : -Infinity;
}

/** True when entry `a` is a better representative of its project than `b`. */
export function isPreferredEditor(a, b) {
  // 1) Prefer an entry launched by the GUI session when present.
  const ga = a?.uosGuiSessionId ? 1 : 0;
  const gb = b?.uosGuiSessionId ? 1 : 0;
  if (ga !== gb) return ga > gb;
  // 2) Prefer an entry that reports a UOS package version (a fully loaded bridge).
  const ua = a?.uosPackageVersion ? 1 : 0;
  const ub = b?.uosPackageVersion ? 1 : 0;
  if (ua !== ub) return ua > ub;
  // 3) Prefer the most recently published entry.
  const ta = parseTime(a?.updatedAtUtc);
  const tb = parseTime(b?.updatedAtUtc);
  if (ta !== tb) return ta > tb;
  // 4) Stable: keep the first one seen.
  return false;
}

/**
 * Collapse editors that share a normalized project path, keeping the preferred
 * representative. Entries without a project path are never merged. The order of
 * first occurrence is preserved.
 *
 * @param {Array<object>} editors live registry entry objects
 * @returns {Array<object>} deduped editors
 */
export function dedupeEditorsByProject(editors) {
  if (!Array.isArray(editors)) return [];
  const winners = new Map();
  const order = [];
  editors.forEach((entry, index) => {
    const projectKey = normalizeProjectKey(entry?.projectPath);
    const key = projectKey.length > 0 ? `path:${projectKey}` : `idx:${index}`;
    if (!winners.has(key)) {
      winners.set(key, entry);
      order.push(key);
      return;
    }
    if (isPreferredEditor(entry, winners.get(key))) {
      winners.set(key, entry);
    }
  });
  return order.map((key) => winners.get(key));
}
