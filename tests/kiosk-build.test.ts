import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error - shared pure-JS planner core (no type declarations).
import { planKioskStructure } from "../bin/kiosk-core.js";
// @ts-expect-error - shared pure-JS build core (no type declarations).
import { buildKioskEditorChangeSet, formatKioskBuildChangeSet } from "../bin/kiosk-build-core.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "uos-kiosk-build-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kiosk build command generation", () => {
  test("generates an EditorChangeSet for screens, material routes, nav buttons, and transitions", async () => {
    await mkdir(join(root, "장흥9경", "천관산", "랜드마크"), { recursive: true });
    await writeFile(join(root, "장흥9경", "천관산", "랜드마크", "화면 구성.png"), "fake-layout");
    await writeFile(join(root, "장흥9경", "천관산", "랜드마크", "내부사진.jpg"), "fake-photo");
    await writeFile(join(root, "장흥9경", "천관산", "랜드마크", "spec.md"), "# 억새능선\n본문\n");

    const plan = await planKioskStructure(root, {
      blueprintId: "blueprint-kiosk-main",
      blueprintPath: "D:/Unity/MyGame/.uos/ochestrator/blueprints/blueprint-kiosk-main.json",
    });
    expect(plan.source).toMatchObject({
      tool: "plan_kiosk_structure",
      blueprintId: "blueprint-kiosk-main",
      blueprintPath: "D:/Unity/MyGame/.uos/ochestrator/blueprints/blueprint-kiosk-main.json",
    });

    const result = buildKioskEditorChangeSet(plan, { planId: "kiosk-plan-test" });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.recipeCompliance?.warnings).toEqual([]);
    expect(result.changeSet!.source).toMatchObject({
      tool: "build_kiosk_from_plan",
      recipeId: "kiosk",
      recipeFile: ".opencode/recipes/kiosk.md",
      recipeGuardVersion: "1.0.0",
      blueprintId: "blueprint-kiosk-main",
      blueprintPath: "D:/Unity/MyGame/.uos/ochestrator/blueprints/blueprint-kiosk-main.json",
    });
    expect(result.changeSet!.batches[0].source).toMatchObject({
      tool: "build_kiosk_from_plan",
      recipeId: "kiosk",
      blueprintId: "blueprint-kiosk-main",
      blueprintPath: "D:/Unity/MyGame/.uos/ochestrator/blueprints/blueprint-kiosk-main.json",
    });
    const commands = result.changeSet!.batches[0].commands;
    expect(commands.every((command: any) => command.mutation === true)).toBe(true);
    expect(commands.every((command: any) => command.requiresApproval === true)).toBe(true);

    const menuCreates = commands.filter((command: any) => command.tool === "create_ui_screen");
    expect(menuCreates.length).toBe(3); // root, 장흥9경, 천관산
    expect(menuCreates[0].args.intent.elements.some((el: any) => el.clientHintId === "nav-to-장흥9경")).toBe(true);

    const materialCreates = commands.filter((command: any) => command.tool === "create_reference_screen_from_material");
    expect(materialCreates).toHaveLength(1);
    expect(materialCreates[0].args.path.replace(/\\/g, "/")).toEndWith("/랜드마크/화면 구성.png");
    expect(materialCreates[0].args.screenName).toBe("랜드마크");

    const navAdds = commands.filter((command: any) => command.tool === "add_ui_element_from_context");
    expect(navAdds.map((command: any) => command.args.element.clientHintId).sort()).toEqual(["nav-back", "nav-home"]);
    expect(navAdds[0].args.screenName).toBe("랜드마크");

    const transitions = commands.filter((command: any) => command.tool === "create_screen_transition_from_context");
    expect(transitions).toHaveLength(plan.navEdges.length);
    expect(transitions.some((command: any) =>
      command.args.fromScreenName === plan.nodes[0].screenName
      && command.args.triggerClientHintId === "nav-to-장흥9경"
    )).toBe(true);

    expect(result.summary).toMatchObject({
      screens: plan.nodes.length,
      menuScreens: 3,
      materialScreens: 1,
      transitions: plan.navEdges.length,
    });
  });

  test("uses content media when no layout reference exists and can request previews", async () => {
    await mkdir(join(root, "시설", "전시장"), { recursive: true });
    await writeFile(join(root, "시설", "전시장", "대표사진.jpg"), "fake-photo");

    const plan = await planKioskStructure(root);
    const result = buildKioskEditorChangeSet(plan, { includePreviews: true });
    expect(result.ok).toBe(true);

    const commands = result.changeSet!.batches[0].commands;
    const materialCreates = commands.filter((command: any) => command.tool === "create_screen_from_material");
    expect(materialCreates).toHaveLength(1);
    expect(materialCreates[0].args.path.replace(/\\/g, "/")).toEndWith("/전시장/대표사진.jpg");
    expect(materialCreates[0].args.mode).toBe("auto");

    const previews = commands.filter((command: any) => command.tool === "capture_preview_from_context");
    expect(previews).toHaveLength(plan.nodes.length);
    expect(formatKioskBuildChangeSet(result)).toContain("Kiosk build command batch ready.");
  });

  test("routes video-only kiosk detail folders as playable content media", async () => {
    await mkdir(join(root, "Exhibit", "Intro"), { recursive: true });
    await writeFile(join(root, "Exhibit", "Intro", "intro.mp4"), "fake-video");

    const plan = await planKioskStructure(root);
    const detail = plan.nodes.find((node: any) => node.screenName === "Intro");
    expect(detail.contentMedia[0]).toMatchObject({
      name: "intro.mp4",
      kind: "video",
      purpose: "content-media",
      isContentMedia: true,
    });

    const result = buildKioskEditorChangeSet(plan);
    expect(result.ok).toBe(true);
    const materialCreates = result.changeSet!.batches[0].commands
      .filter((command: any) => command.tool === "create_screen_from_material");
    expect(materialCreates).toHaveLength(1);
    expect(materialCreates[0].args.path.replace(/\\/g, "/")).toEndWith("/Exhibit/Intro/intro.mp4");
    expect(materialCreates[0].args.mode).toBe("auto");
  });
});
