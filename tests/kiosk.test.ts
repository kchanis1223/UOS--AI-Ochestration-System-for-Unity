import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - shared pure-JS planner core (no type declarations).
import {
  planKioskStructure,
  formatKioskPlanOutline,
  parseKioskPlanOptions,
  naturalCompare,
} from "../bin/kiosk-core.js";

// Use the OS temp dir (not the mounted repo) so recursive rm works everywhere.
let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "uos-kiosk-"));
  // tmp/2_early (leaf), tmp/10_late (leaf)            -> natural-sort ordering
  // tmp/cat1/랜드마크 (leaf, with materials)
  // tmp/cat2/랜드마크 (leaf, no materials)             -> duplicate-name dedup
  await mkdir(join(root, "2_early"), { recursive: true });
  await mkdir(join(root, "10_late"), { recursive: true });
  await mkdir(join(root, "cat1", "랜드마크"), { recursive: true });
  await mkdir(join(root, "cat2", "랜드마크"), { recursive: true });
  await writeFile(join(root, "cat1", "랜드마크", "spec.md"), "# 억새능선\n본문\n");
  await writeFile(join(root, "cat1", "랜드마크", "photo.png"), "fake-png-bytes");
  await writeFile(join(root, "cat1", "랜드마크", "화면 구성.png"), "fake-layout-reference");
  await writeFile(join(root, "cat2", "랜드마크", "내부사진.jpg"), "fake-content-photo");
  await writeFile(join(root, "cat2", "랜드마크", "화면구성.png"), "fake-layout-reference-no-space");
  // an ignored Unity dir that must never become a screen
  await mkdir(join(root, "Library", "ScriptAssemblies"), { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kiosk planner", () => {
  test("every folder becomes a screen; menus vs details by children", async () => {
    const plan = await planKioskStructure(root);
    expect(plan.rootId).toBe("root");
    // root, 2_early, 10_late, cat1, cat1/랜드마크, cat2, cat2/랜드마크 = 7
    expect(plan.counts.screens).toBe(7);
    expect(plan.counts.menus).toBe(3); // root, cat1, cat2
    expect(plan.counts.details).toBe(4); // 2_early, 10_late, two 랜드마크
  });

  test("ignored Unity folders are skipped", async () => {
    const plan = await planKioskStructure(root);
    expect(plan.nodes.some((n: any) => n.name === "Library")).toBe(false);
    expect(plan.nodes.some((n: any) => n.relPath.includes("Library"))).toBe(false);
  });

  test("natural sort orders numeric folder prefixes (2 before 10)", async () => {
    const plan = await planKioskStructure(root);
    const rootNode = plan.nodes.find((n: any) => n.id === "root");
    expect(rootNode.childIds).toEqual(["2_early", "10_late", "cat1", "cat2"]);
  });

  test("duplicate folder names get unique screen names", async () => {
    const plan = await planKioskStructure(root);
    const names = plan.nodes.map((n: any) => n.screenName);
    expect(new Set(names).size).toBe(names.length);
    const dup = plan.nodes.filter((n: any) => n.name === "랜드마크").map((n: any) => n.screenName);
    expect(dup).toContain("랜드마크");
    expect(dup).toContain("랜드마크 (cat2)");
  });

  test("node materials and spec detection", async () => {
    const plan = await planKioskStructure(root);
    const detail = plan.nodes.find((n: any) => n.relPath === "cat1/랜드마크");
    expect(detail.role).toBe("detail");
    expect(detail.parentId).toBe("cat1");
    expect(detail.materials.map((m: any) => m.name).sort()).toEqual(["photo.png", "spec.md", "화면 구성.png"]);
    expect(detail.hasSpec).toBe(true);
  });

  test("korean layout references are separated from content media and specs", async () => {
    const plan = await planKioskStructure(root);
    const detail = plan.nodes.find((n: any) => n.relPath === "cat1/랜드마크");
    expect(detail.layoutReference.name).toBe("화면 구성.png");
    expect(detail.layoutReference.purpose).toBe("layout-reference");
    expect(detail.contentMedia.map((m: any) => m.name)).toEqual(["photo.png"]);
    expect(detail.specSources.map((m: any) => m.name)).toEqual(["spec.md"]);
    expect(detail.materials.find((m: any) => m.name === "photo.png").isContentMedia).toBe(true);
    expect(detail.materials.find((m: any) => m.name === "화면 구성.png").isLayoutReference).toBe(true);
    expect(plan.counts.layoutReferences).toBe(2);
    expect(plan.counts.contentMedia).toBe(2);
    expect(plan.counts.specSources).toBe(1);
  });

  test("korean layout reference detection accepts no-space filename variant", async () => {
    const plan = await planKioskStructure(root);
    const detail = plan.nodes.find((n: any) => n.relPath === "cat2/랜드마크");
    expect(detail.layoutReference.name).toBe("화면구성.png");
    expect(detail.contentMedia.map((m: any) => m.name)).toEqual(["내부사진.jpg"]);
    expect(detail.materials.find((m: any) => m.name === "화면구성.png").isLayoutReference).toBe(true);
  });

  test("drilldown + back + home navigation edges", async () => {
    const plan = await planKioskStructure(root);
    const byKind = (k: string) => plan.navEdges.filter((e: any) => e.kind === k).length;
    expect(byKind("drilldown")).toBe(6); // 4 from root + 1 each from cat1, cat2
    expect(byKind("back")).toBe(6); // every non-root node
    expect(byKind("home")).toBe(6); // every non-root node
    // each drilldown carries a stable trigger hint id
    const drill = plan.navEdges.find((e: any) => e.kind === "drilldown" && e.toId === "cat1");
    expect(drill.triggerClientHintId).toBe("nav-to-cat1");
  });

  test("includeHome:false removes home edges; back stays", async () => {
    const plan = await planKioskStructure(root, { includeHome: false });
    expect(plan.navEdges.some((e: any) => e.kind === "home")).toBe(false);
    expect(plan.navEdges.some((e: any) => e.kind === "back")).toBe(true);
  });

  test("plan is deterministic across runs (ignoring timestamp)", async () => {
    const a = await planKioskStructure(root);
    const b = await planKioskStructure(root);
    const strip = (p: any) =>
      JSON.stringify({ rootId: p.rootId, mode: p.mode, nodes: p.nodes, navEdges: p.navEdges, counts: p.counts });
    expect(strip(a)).toBe(strip(b));
  });

  test("outline renders menu/detail tags and screen names", async () => {
    const plan = await planKioskStructure(root);
    const outline = formatKioskPlanOutline(plan);
    expect(outline).toContain("[menu]");
    expect(outline).toContain("[detail]");
    expect(outline).toContain("랜드마크");
    expect(outline).toContain("Navigation: drilldown 6, back 6, home 6");
  });

  test("linear mode wires sequential prev/next", async () => {
    const plan = await planKioskStructure(root, { mode: "linear" });
    expect(plan.mode).toBe("linear");
    expect(plan.navEdges.some((e: any) => e.triggerClientHintId === "nav-next")).toBe(true);
    expect(plan.navEdges.some((e: any) => e.triggerClientHintId === "nav-prev")).toBe(true);
  });
});

describe("kiosk CLI option parsing", () => {
  test("positional dir + flags", () => {
    const opts = parseKioskPlanOptions(["/some/Ref/main", "--json", "--no-home", "--max-depth", "3"]);
    expect(opts.dir).toBe("/some/Ref/main");
    expect(opts.json).toBe(true);
    expect(opts.includeHome).toBe(false);
    expect(opts.maxDepth).toBe(3);
    expect(opts.mode).toBe("tree");
  });

  test("--linear and labels", () => {
    const opts = parseKioskPlanOptions(["--dir", "/r", "--linear", "--back-label", "뒤로", "--home-label", "홈"]);
    expect(opts.dir).toBe("/r");
    expect(opts.mode).toBe("linear");
    expect(opts.backLabel).toBe("뒤로");
    expect(opts.homeLabel).toBe("홈");
  });

  test("unknown option throws", () => {
    expect(() => parseKioskPlanOptions(["--nope"])).toThrow();
  });
});

describe("naturalCompare", () => {
  test("orders numeric chunks numerically", () => {
    const arr = ["10_b", "2_a", "1_c"];
    arr.sort(naturalCompare);
    expect(arr).toEqual(["1_c", "2_a", "10_b"]);
  });
});
