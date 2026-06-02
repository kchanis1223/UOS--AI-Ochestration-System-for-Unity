import { describe, it, expect } from "vitest";
import { HintCanonicalMap } from "../src/core/idMap.js";
import type { IntentElement } from "../src/core/types.js";

function el(partial: Partial<IntentElement>): IntentElement {
  return { type: "Panel", rect: { x: 0, y: 0, w: 1, h: 1 }, ...partial };
}

describe("HintCanonicalMap", () => {
  it("stores and resolves both directions", () => {
    const map = new HintCanonicalMap();
    map.set("hint-a", "elem-1");
    expect(map.canonicalFor("hint-a")).toBe("elem-1");
    expect(map.hintFor("elem-1")).toBe("hint-a");
    expect(map.size).toBe(1);
  });

  it("is idempotent for the same pairing", () => {
    const map = new HintCanonicalMap();
    map.set("h", "e");
    expect(() => map.set("h", "e")).not.toThrow();
    expect(map.size).toBe(1);
  });

  it("rejects rebinding a hint to a different canonical", () => {
    const map = new HintCanonicalMap();
    map.set("h", "e1");
    expect(() => map.set("h", "e2")).toThrow(/already bound/);
  });

  it("rejects rebinding a canonical to a different hint", () => {
    const map = new HintCanonicalMap();
    map.set("h1", "e");
    expect(() => map.set("h2", "e")).toThrow(/already bound/);
  });

  it("resolves a parent hint to its canonical id", () => {
    const map = new HintCanonicalMap();
    map.set("parent", "elem-parent");
    const child = el({ clientHintId: "child", parentClientHintId: "parent" });
    expect(map.resolveParentCanonical(child)).toBe("elem-parent");
  });

  it("returns undefined for a root element", () => {
    const map = new HintCanonicalMap();
    expect(map.resolveParentCanonical(el({ clientHintId: "root" }))).toBeUndefined();
  });

  it("throws on an unresolved parent hint", () => {
    const map = new HintCanonicalMap();
    const child = el({ clientHintId: "child", parentClientHintId: "ghost" });
    expect(() => map.resolveParentCanonical(child)).toThrow(/does not resolve/);
  });

  it("round-trips through pairs", () => {
    const pairs = [
      { clientHintId: "a", elementId: "1" },
      { clientHintId: "b", elementId: "2" },
    ];
    const map = HintCanonicalMap.fromPairs(pairs);
    expect(map.toPairs()).toEqual(pairs);
  });
});
