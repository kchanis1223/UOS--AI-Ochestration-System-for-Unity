import type { IntentElement } from "./types.js";

export interface HintCanonicalPair {
  clientHintId: string;
  elementId: string;
}

/**
 * Two-way map between advisory client hint ids and server-minted canonical ids.
 *
 * Authority note (decision: server is canonical ID authority): the canonical
 * elementId values are MINTED BY the Unity Editor server, never by the sidecar.
 * This map only *resolves* and *retains* the pairing the server returns, mirroring
 * the in-call hint->canonical resolution the C# UguiBackend performs so that:
 *   - parentClientHintId forward-references inside one create_ui_screen call can
 *     be linked to parent canonical ids, and
 *   - the client can keep a durable hint->canonical map across the conversation
 *     (the server does not re-accept hints for later edits).
 */
export class HintCanonicalMap {
  private readonly hintToCanonical = new Map<string, string>();
  private readonly canonicalToHint = new Map<string, string>();

  /** Record a hint<->canonical pairing. Throws on a conflicting re-binding. */
  set(clientHintId: string, elementId: string): void {
    const existingCanonical = this.hintToCanonical.get(clientHintId);
    if (existingCanonical !== undefined && existingCanonical !== elementId) {
      throw new Error(
        `clientHintId "${clientHintId}" already bound to "${existingCanonical}", cannot rebind to "${elementId}"`,
      );
    }
    const existingHint = this.canonicalToHint.get(elementId);
    if (existingHint !== undefined && existingHint !== clientHintId) {
      throw new Error(
        `elementId "${elementId}" already bound to hint "${existingHint}", cannot rebind to "${clientHintId}"`,
      );
    }
    this.hintToCanonical.set(clientHintId, elementId);
    this.canonicalToHint.set(elementId, clientHintId);
  }

  canonicalFor(clientHintId: string): string | undefined {
    return this.hintToCanonical.get(clientHintId);
  }

  hintFor(elementId: string): string | undefined {
    return this.canonicalToHint.get(elementId);
  }

  /**
   * Resolve an element's parentClientHintId to the parent's canonical id.
   * Returns undefined for a root element (no parent hint). Throws if the parent
   * hint was never declared/bound (unresolved forward-reference).
   */
  resolveParentCanonical(element: IntentElement): string | undefined {
    if (element.parentClientHintId === undefined) return undefined;
    const canonical = this.hintToCanonical.get(element.parentClientHintId);
    if (canonical === undefined) {
      throw new Error(
        `parentClientHintId "${element.parentClientHintId}" does not resolve to any known element`,
      );
    }
    return canonical;
  }

  get size(): number {
    return this.hintToCanonical.size;
  }

  /** Snapshot the current pairings (insertion order). */
  toPairs(): HintCanonicalPair[] {
    return [...this.hintToCanonical.entries()].map(([clientHintId, elementId]) => ({
      clientHintId,
      elementId,
    }));
  }

  /** Build a map from the server's returned {clientHintId, elementId} pairs. */
  static fromPairs(pairs: readonly HintCanonicalPair[]): HintCanonicalMap {
    const map = new HintCanonicalMap();
    for (const pair of pairs) {
      map.set(pair.clientHintId, pair.elementId);
    }
    return map;
  }
}
