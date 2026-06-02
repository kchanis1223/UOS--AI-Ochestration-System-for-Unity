import type { IntentElement, PlanningIntent } from "./types.js";

export interface IntentValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Structural validation of a PlanningIntent's element tree, beyond what the JSON
 * Schema can express. Schema validation (shape/types/ranges) should run first;
 * this checks cross-element invariants:
 *   - clientHintId values are unique
 *   - every parentClientHintId resolves to a declared clientHintId
 *   - an element cannot be its own parent
 *   - the parent graph is acyclic
 */
export function validateIntentTree(intent: PlanningIntent): IntentValidationResult {
  const errors: string[] = [];
  const elements = intent.elements;

  const hintToIndex = new Map<string, number>();
  elements.forEach((el, i) => {
    if (el.clientHintId === undefined) return;
    if (hintToIndex.has(el.clientHintId)) {
      errors.push(
        `duplicate clientHintId "${el.clientHintId}" (elements[${hintToIndex.get(el.clientHintId)}] and elements[${i}])`,
      );
      return;
    }
    hintToIndex.set(el.clientHintId, i);
  });

  elements.forEach((el, i) => {
    const parent = el.parentClientHintId;
    if (parent === undefined) return;
    if (el.clientHintId !== undefined && parent === el.clientHintId) {
      errors.push(`elements[${i}] ("${el.clientHintId}") references itself as parent`);
      return;
    }
    if (!hintToIndex.has(parent)) {
      errors.push(
        `elements[${i}] parentClientHintId "${parent}" does not match any element's clientHintId`,
      );
    }
  });

  // Cycle detection over the parent graph (only meaningful once parents resolve).
  if (errors.length === 0) {
    const cyclic = findCyclicHint(elements, hintToIndex);
    if (cyclic !== null) {
      errors.push(`cycle detected in parent references involving "${cyclic}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function findCyclicHint(
  elements: IntentElement[],
  hintToIndex: Map<string, number>,
): string | null {
  // 0 = unvisited, 1 = in progress, 2 = done
  const state = new Map<number, number>();

  const visit = (index: number): string | null => {
    const phase = state.get(index) ?? 0;
    if (phase === 2) return null;
    if (phase === 1) {
      const hint = elements[index]?.clientHintId;
      return hint ?? `elements[${index}]`;
    }
    state.set(index, 1);
    const parentHint = elements[index]?.parentClientHintId;
    if (parentHint !== undefined) {
      const parentIndex = hintToIndex.get(parentHint);
      if (parentIndex !== undefined) {
        const found = visit(parentIndex);
        if (found !== null) return found;
      }
    }
    state.set(index, 2);
    return null;
  };

  for (let i = 0; i < elements.length; i++) {
    const found = visit(i);
    if (found !== null) return found;
  }
  return null;
}
