import { describe, expect, test } from "bun:test";
import { UosJournalPlugin } from "../.opencode/plugins/uos.ts";

const { applyToIndex, emptyIndex, sanitizeJournalValue, shouldAutoAllowUosPermission, permissionToolName } = UosJournalPlugin;

describe("UOS plugin screen index", () => {
  test("auto-allows only low-risk UOS permission prompts", () => {
    expect(shouldAutoAllowUosPermission({
      permission: "tool",
      patterns: ["get_uos_context"],
      metadata: {},
    })).toBe(true);
    expect(permissionToolName({
      permission: "tool",
      patterns: ["tool:read_planning_material"],
      metadata: {},
    })).toBe("read_planning_material");
    expect(shouldAutoAllowUosPermission({
      permission: "tool",
      patterns: ["create_ui_screen"],
      metadata: {},
    })).toBe(false);
    expect(shouldAutoAllowUosPermission({
      permission: "tool",
      patterns: ["save_scene"],
      metadata: {},
    })).toBe(false);
    expect(shouldAutoAllowUosPermission({
      permission: "tool",
      patterns: ["create_ui_screen"],
      metadata: { source: "read_planning_material" },
    })).toBe(false);
  });

  test("redacts bulky preview payloads before journaling", () => {
    const sanitized = sanitizeJournalValue({
      screenId: "Screen_ID",
      base64Data: "a".repeat(12000),
      nested: {
        dataUrl: `data:image/png;base64,${"b".repeat(9000)}`,
        safe: "small",
      },
    }) as any;

    expect(sanitized.screenId).toBe("Screen_ID");
    expect(sanitized.base64Data).toBe("[redacted base64Data, 12000 chars]");
    expect(sanitized.nested.dataUrl).toBe("[redacted dataUrl, 9022 chars]");
    expect(sanitized.nested.safe).toBe("small");
    expect(JSON.stringify(sanitized)).not.toContain("aaaaaaaa");
    expect(JSON.stringify(sanitized)).not.toContain("bbbbbbbb");
  });

  test("redacts bulky planning material payloads before journaling", () => {
    const sanitized = sanitizeJournalValue({
      ok: true,
      path: "C:\\Project\\Plans\\brief.md",
      base64Data: "c".repeat(12000),
      extractedText: {
        ok: true,
        kind: "markdown",
        text: "d".repeat(12000),
      },
      attachments: [
        {
          type: "file",
          mime: "text/markdown",
          url: "file:///C:/Project/Plans/brief.md",
          filename: "brief.md",
        },
      ],
    }) as any;

    expect(sanitized.path).toBe("C:\\Project\\Plans\\brief.md");
    expect(sanitized.base64Data).toBe("[redacted base64Data, 12000 chars]");
    expect(sanitized.extractedText.text).toBe("[redacted text, 12000 chars]");
    expect(sanitized.attachments[0].filename).toBe("brief.md");
    expect(JSON.stringify(sanitized)).not.toContain("cccccccc");
    expect(JSON.stringify(sanitized)).not.toContain("dddddddd");
  });

  test("tracks element state across create, update, move, and delete", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "panel",
              type: "Panel",
              rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
              anchor: "TopLeft",
              props: { color: "#111111" },
            },
            {
              clientHintId: "title",
              parentClientHintId: "panel",
              type: "Text",
              rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.12 },
              props: { text: "Main Menu", fontSize: 48, fontStyle: "Bold", color: "#ffffff" },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [
          { clientHintId: "panel", elementId: "Element_Panel" },
          { clientHintId: "title", elementId: "Element_Title" },
        ],
      },
      "2026-06-04T01:00:00.000Z",
    );

    const screen = idx.screens.MainMenu_ID;
    expect(screen.screenName).toBe("MainMenu");
    expect(screen.referenceCanvas?.width).toBe(1920);
    expect(screen.elements.Element_Title.type).toBe("Text");
    expect(screen.elements.Element_Title.parentElementId).toBe("Element_Panel");
    expect(screen.elements.Element_Title.props?.text).toBe("Main Menu");

    applyToIndex(
      idx,
      "update_ui_element",
      {
        elementId: "Element_Title",
        props: { text: "Play Now", fontStyle: "Italic", color: "#ffeeaa" },
      },
      {},
      "2026-06-04T01:01:00.000Z",
    );
    expect(screen.elements.Element_Title.props).toEqual({
      text: "Play Now",
      fontSize: 48,
      fontStyle: "Italic",
      color: "#ffeeaa",
    });

    applyToIndex(
      idx,
      "move_ui_element",
      {
        elementId: "Element_Title",
        rect: { x: 0.25, y: 0.18, w: 0.5, h: 0.1 },
        anchor: "MiddleCenter",
      },
      {},
      "2026-06-04T01:02:00.000Z",
    );
    expect(screen.elements.Element_Title.rect).toEqual({ x: 0.25, y: 0.18, w: 0.5, h: 0.1 });
    expect(screen.elements.Element_Title.anchor).toBe("MiddleCenter");

    applyToIndex(
      idx,
      "delete_ui_element",
      { elementId: "Element_Title" },
      {},
      "2026-06-04T01:03:00.000Z",
    );
    expect(screen.elements.Element_Title.deleted).toBe(true);
  });

  test("tracks scene object state across create, list, update, and delete", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_scene_object",
      { name: "Conversation Cube", type: "Cube" },
      {
        objectId: "SceneObject_Cube",
        name: "Conversation Cube",
        type: "Cube",
        path: "Conversation Cube",
        active: true,
        transform: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { x: 0, y: 45, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        },
        components: ["Transform", "MeshFilter", "MeshRenderer", "SceneObjectId"],
      },
      "2026-06-04T01:00:00.000Z",
    );

    expect(idx.sceneObjects.SceneObject_Cube).toMatchObject({
      objectId: "SceneObject_Cube",
      name: "Conversation Cube",
      type: "Cube",
      active: true,
      transform: { position: { x: 1, y: 2, z: 3 } },
      deleted: undefined,
    });

    applyToIndex(
      idx,
      "update_scene_object",
      { objectId: "SceneObject_Cube", name: "Moved Cube" },
      {
        objectId: "SceneObject_Cube",
        name: "Moved Cube",
        type: "Cube",
        path: "Moved Cube",
        active: false,
        transform: {
          position: { x: -1, y: 0, z: 2 },
          rotation: { x: 0, y: 90, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      "2026-06-04T01:01:00.000Z",
    );

    expect(idx.sceneObjects.SceneObject_Cube).toMatchObject({
      name: "Moved Cube",
      active: false,
      transform: { position: { x: -1, y: 0, z: 2 }, rotation: { x: 0, y: 90, z: 0 } },
      updatedAt: "2026-06-04T01:01:00.000Z",
    });

    applyToIndex(
      idx,
      "update_scene_object_from_context",
      { query: "moved cube", transform: { position: { x: 3, y: 0, z: 0 } } },
      {
        sceneObjectRefresh: {
          ok: true,
          objects: [{ objectId: "SceneObject_Cube", name: "Moved Cube", type: "Cube", active: false }],
        },
        updateArgs: { objectId: "SceneObject_Cube", transform: { position: { x: 3, y: 0, z: 0 } } },
        updated: {
          objectId: "SceneObject_Cube",
          name: "Context Moved Cube",
          type: "Cube",
          active: true,
          transform: { position: { x: 3, y: 0, z: 0 } },
        },
      },
      "2026-06-04T01:01:30.000Z",
    );
    expect(idx.sceneObjects.SceneObject_Cube).toMatchObject({
      name: "Context Moved Cube",
      active: true,
      transform: { position: { x: 3, y: 0, z: 0 } },
      deleted: undefined,
    });

    applyToIndex(
      idx,
      "create_scene_object",
      {},
      { objectId: "SceneObject_Stale", name: "Stale Sphere", type: "Sphere", active: true },
      "2026-06-04T01:01:30.000Z",
    );
    applyToIndex(
      idx,
      "list_scene_objects",
      {},
      { objects: [{ objectId: "SceneObject_Cube", name: "Moved Cube", type: "Cube", active: false }] },
      "2026-06-04T01:02:00.000Z",
    );
    expect(idx.sceneObjects.SceneObject_Cube.deleted).toBeUndefined();
    expect(idx.sceneObjects.SceneObject_Stale.deleted).toBe(true);

    applyToIndex(
      idx,
      "delete_scene_object_from_context",
      { query: "context moved cube" },
      {
        sceneObjectRefresh: {
          ok: true,
          objects: [{ objectId: "SceneObject_Cube", name: "Context Moved Cube", type: "Cube", active: true }],
        },
        deleteArgs: { objectId: "SceneObject_Cube" },
        deleted: { ok: true },
      },
      "2026-06-04T01:02:30.000Z",
    );
    expect(idx.sceneObjects.SceneObject_Cube.deleted).toBe(true);

    applyToIndex(
      idx,
      "delete_scene_object",
      { objectId: "SceneObject_Cube" },
      { ok: true },
      "2026-06-04T01:03:00.000Z",
    );
    expect(idx.sceneObjects.SceneObject_Cube.deleted).toBe(true);
  });

  test("tracks context-resolved element updates", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "cta_primary",
              type: "Button",
              rect: { x: 0.25, y: 0.7, w: 0.5, h: 0.12 },
              props: { text: "Play Now", fontSize: 28 },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "cta_primary", elementId: "Element_Play" }],
      },
      "2026-06-04T01:00:00.000Z",
    );

    applyToIndex(
      idx,
      "update_ui_element_from_context",
      {
        screenName: "MainMenu",
        clientHintId: "cta_primary",
        props: { text: "Start" },
      },
      {
        ok: true,
        matched: { screenId: "MainMenu_ID", elementId: "Element_Play" },
        updateArgs: {
          elementId: "Element_Play",
          props: { text: "Start", color: "#22c55e" },
        },
        updated: { ok: true },
      },
      "2026-06-04T01:05:00.000Z",
    );

    expect(idx.screens.MainMenu_ID.elements.Element_Play.props).toMatchObject({
      text: "Start",
      color: "#22c55e",
      fontSize: 28,
    });
    expect(idx.screens.MainMenu_ID.updatedAt).toBe("2026-06-04T01:05:00.000Z");
  });

  test("does not mutate the persisted index for dry-run context tools", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          elements: [
            {
              clientHintId: "cta_primary",
              type: "Button",
              props: { text: "Play" },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "cta_primary", elementId: "Element_Play" }],
      },
      "2026-06-04T01:00:00.000Z",
    );

    applyToIndex(
      idx,
      "update_ui_element_from_context",
      { screenName: "MainMenu", clientHintId: "cta_primary", props: { text: "Start" }, dryRun: true },
      {
        ok: true,
        dryRun: true,
        matched: { screenId: "MainMenu_ID", elementId: "Element_Play" },
        updateArgs: { elementId: "Element_Play", props: { text: "Start" } },
        contextRefresh: {
          ok: true,
          hierarchy: {
            nodes: [
              {
                elementId: "MainMenu_ID",
                rootScreenId: "MainMenu_ID",
                rootScreenName: "MainMenu",
                depth: 0,
                type: "Screen",
                active: true,
              },
              {
                elementId: "Element_Play",
                rootScreenId: "MainMenu_ID",
                rootScreenName: "MainMenu",
                depth: 1,
                type: "Button",
                props: { text: "Live Play" },
              },
            ],
          },
        },
      },
      "2026-06-04T01:05:00.000Z",
    );

    expect(idx.screens.MainMenu_ID.elements.Element_Play.props?.text).toBe("Play");
    expect(idx.screens.MainMenu_ID.updatedAt).toBe("2026-06-04T01:00:00.000Z");
    expect(idx.activeScreenId).toBeUndefined();
  });

  test("applies live hierarchy refresh before context mutation journaling", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          elements: [
            {
              clientHintId: "cta_primary",
              type: "Button",
              props: { text: "Play" },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "cta_primary", elementId: "Element_Play" }],
      },
      "2026-06-04T01:00:00.000Z",
    );

    applyToIndex(
      idx,
      "update_ui_element_from_context",
      { screenName: "MainMenu", query: "continue button", props: { color: "#44ff44" } },
      {
        ok: true,
        matched: { screenId: "MainMenu_ID", elementId: "Element_Play" },
        updateArgs: { elementId: "Element_Play", props: { color: "#44ff44" } },
        updated: { ok: true },
        contextRefresh: {
          ok: true,
          hierarchy: {
            nodes: [
              {
                elementId: "MainMenu_ID",
                rootScreenId: "MainMenu_ID",
                rootScreenName: "MainMenu",
                depth: 0,
                type: "Screen",
                active: true,
              },
              {
                elementId: "Element_Play",
                parentElementId: "MainMenu_ID",
                rootScreenId: "MainMenu_ID",
                rootScreenName: "MainMenu",
                depth: 1,
                type: "Button",
                props: { text: "Continue", fontSize: 32 },
                rect: { x: 0.3, y: 0.7, w: 0.4, h: 0.1 },
              },
            ],
          },
        },
      },
      "2026-06-04T01:05:00.000Z",
    );

    expect(idx.activeScreenId).toBe("MainMenu_ID");
    expect(idx.screens.MainMenu_ID.elements.Element_Play.props).toEqual({
      text: "Continue",
      fontSize: 32,
      color: "#44ff44",
    });
    expect(idx.screens.MainMenu_ID.elements.Element_Play.rect).toEqual({ x: 0.3, y: 0.7, w: 0.4, h: 0.1 });
  });

  test("tracks context-resolved element adds", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "panel",
              type: "Panel",
              rect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
              props: { color: "#111111" },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "panel", elementId: "Element_Panel" }],
      },
      "2026-06-04T01:00:00.000Z",
    );

    applyToIndex(
      idx,
      "add_ui_element_from_context",
      {
        screenName: "MainMenu",
        parentClientHintId: "panel",
        element: {
          clientHintId: "new_badge",
          type: "Text",
          rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.08 },
          props: { text: "New", fontSize: 20 },
        },
      },
      {
        ok: true,
        matched: {
          ok: true,
          screenId: "MainMenu_ID",
          screenName: "MainMenu",
          parent: { screenId: "MainMenu_ID", elementId: "Element_Panel" },
        },
        addArgs: {
          screenId: "MainMenu_ID",
          element: {
            clientHintId: "new_badge",
            parentElementId: "Element_Panel",
            type: "Text",
            rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.08 },
            props: { text: "New", fontSize: 20 },
          },
        },
        added: { elementId: "Element_NewBadge" },
      },
      "2026-06-04T01:04:00.000Z",
    );

    expect(idx.screens.MainMenu_ID.elements.Element_NewBadge).toMatchObject({
      elementId: "Element_NewBadge",
      clientHintId: "new_badge",
      parentElementId: "Element_Panel",
      type: "Text",
      props: { text: "New", fontSize: 20 },
    });
    expect(idx.screens.MainMenu_ID.updatedAt).toBe("2026-06-04T01:04:00.000Z");
  });

  test("tracks context-resolved element moves", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "cta_primary",
              type: "Button",
              rect: { x: 0.25, y: 0.7, w: 0.5, h: 0.12 },
              props: { text: "Play Now", fontSize: 28 },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "cta_primary", elementId: "Element_Play" }],
      },
      "2026-06-04T01:00:00.000Z",
    );

    applyToIndex(
      idx,
      "move_ui_element_from_context",
      {
        screenName: "MainMenu",
        textContains: "play",
        rect: { x: 0.3, y: 0.76, w: 0.4, h: 0.1 },
        anchor: "BottomCenter",
      },
      {
        ok: true,
        matched: { screenId: "MainMenu_ID", elementId: "Element_Play" },
        moveArgs: {
          elementId: "Element_Play",
          rect: { x: 0.3, y: 0.76, w: 0.4, h: 0.1 },
          anchor: "BottomCenter",
        },
        moved: { ok: true },
      },
      "2026-06-04T01:05:00.000Z",
    );

    expect(idx.screens.MainMenu_ID.elements.Element_Play).toMatchObject({
      rect: { x: 0.3, y: 0.76, w: 0.4, h: 0.1 },
      anchor: "BottomCenter",
      props: { text: "Play Now", fontSize: 28 },
    });
    expect(idx.screens.MainMenu_ID.updatedAt).toBe("2026-06-04T01:05:00.000Z");
  });

  test("tracks context-resolved element deletes", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "temporary_badge",
              type: "Text",
              rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.08 },
              props: { text: "Temporary" },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "temporary_badge", elementId: "Element_Temporary" }],
      },
      "2026-06-04T01:00:00.000Z",
    );

    applyToIndex(
      idx,
      "delete_ui_element_from_context",
      {
        screenName: "MainMenu",
        textContains: "temporary",
      },
      {
        ok: true,
        matched: { screenId: "MainMenu_ID", elementId: "Element_Temporary" },
        deleteArgs: { elementId: "Element_Temporary" },
        deleted: { ok: true },
      },
      "2026-06-04T01:06:00.000Z",
    );

    expect(idx.screens.MainMenu_ID.elements.Element_Temporary.deleted).toBe(true);
    expect(idx.screens.MainMenu_ID.elements.Element_Temporary.updatedAt).toBe("2026-06-04T01:06:00.000Z");
    expect(idx.screens.MainMenu_ID.updatedAt).toBe("2026-06-04T01:06:00.000Z");
  });

  test("tracks source metadata passed directly to create_ui_screen", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        source: {
          tool: "draft_planning_intent_from_document",
          kind: "pdf",
          path: "C:/plans/brief.pdf",
          pageNumber: 2,
        },
        intent: {
          version: "1.0.0",
          screenName: "BriefScreen",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "title",
              type: "Text",
              rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
              props: { text: "Brief" },
            },
          ],
        },
      },
      {
        screenId: "BriefScreen_ID",
        source: {
          tool: "draft_planning_intent_from_document",
          kind: "pdf",
          path: "C:/plans/brief.pdf",
          pageNumber: 2,
        },
        elements: [
          { clientHintId: "title", elementId: "Element_Title" },
        ],
      },
      "2026-06-04T01:30:00.000Z",
    );

    expect(idx.screens.BriefScreen_ID.source).toMatchObject({
      tool: "draft_planning_intent_from_document",
      kind: "pdf",
      path: "C:/plans/brief.pdf",
      pageNumber: 2,
      ts: "2026-06-04T01:30:00.000Z",
    });
  });

  test("tracks imported assets and scene saves", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "import_asset",
      {},
      {
        sourcePath: "C:/plans/logo.png",
        assetPath: "Assets/UOS/Imported/logo.png",
        importedAsSprite: true,
        assetType: "Sprite",
      },
      "2026-06-04T02:00:00.000Z",
    );
    applyToIndex(
      idx,
      "save_scene",
      { path: "Assets/UOS_Generated.unity" },
      { path: "Assets/UOS_Generated.unity" },
      "2026-06-04T02:01:00.000Z",
    );

    expect(idx.importedAssets).toHaveLength(1);
    expect(idx.importedAssets?.[0].assetPath).toBe("Assets/UOS/Imported/logo.png");
    expect(idx.importedAssets?.[0].importedAsSprite).toBe(true);
    expect(idx.lastSavedScenePath).toBe("Assets/UOS_Generated.unity");
    expect(idx.lastSavedAt).toBe("2026-06-04T02:01:00.000Z");
  });

  test("tracks screen transitions for conversational follow-up context", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_screen_transition",
      {
        fromId: "MainMenu_ID",
        toId: "Settings_ID",
        trigger: "Element_PlayButton",
      },
      { ok: true },
      "2026-06-04T02:30:00.000Z",
    );

    expect(idx.transitions).toEqual([{
      fromId: "MainMenu_ID",
      toId: "Settings_ID",
      trigger: "Element_PlayButton",
      ok: true,
      ts: "2026-06-04T02:30:00.000Z",
    }]);
  });

  test("tracks context-resolved screen transitions", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_screen_transition_from_context",
      {
        fromScreenName: "MainMenu",
        toScreenName: "Settings",
        triggerTextContains: "settings",
      },
      {
        ok: true,
        matched: {
          ok: true,
          fromId: "MainMenu_ID",
          fromScreenName: "MainMenu",
          toId: "Settings_ID",
          toScreenName: "Settings",
          trigger: "Element_SettingsButton",
          triggerElement: { screenId: "MainMenu_ID", elementId: "Element_SettingsButton" },
        },
        transitionArgs: {
          fromId: "MainMenu_ID",
          toId: "Settings_ID",
          trigger: "Element_SettingsButton",
        },
        created: { ok: true },
      },
      "2026-06-04T02:35:00.000Z",
    );

    expect(idx.transitions).toEqual([{
      fromId: "MainMenu_ID",
      toId: "Settings_ID",
      trigger: "Element_SettingsButton",
      ok: true,
      ts: "2026-06-04T02:35:00.000Z",
    }]);
  });

  test("tracks active screen changes for conversational context", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [],
        },
      },
      { screenId: "MainMenu_ID", elements: [] },
      "2026-06-04T02:40:00.000Z",
    );
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "Shop",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [],
        },
      },
      { screenId: "Shop_ID", elements: [] },
      "2026-06-04T02:41:00.000Z",
    );

    applyToIndex(
      idx,
      "set_active_screen",
      { screenId: "Shop_ID" },
      { ok: true, screenId: "Shop_ID", name: "Shop", active: true },
      "2026-06-04T02:42:00.000Z",
    );

    expect(idx.activeScreenId).toBe("Shop_ID");
    expect(idx.screens.Shop_ID.active).toBe(true);
    expect(idx.screens.Shop_ID.updatedAt).toBe("2026-06-04T02:42:00.000Z");
    expect(idx.screens.MainMenu_ID.active).toBeUndefined();

    applyToIndex(
      idx,
      "set_active_screen_from_context",
      { screenName: "MainMenu" },
      {
        ok: true,
        matched: { screenId: "MainMenu_ID", screenName: "MainMenu" },
        activateArgs: { screenId: "MainMenu_ID" },
        activated: { ok: true, screenId: "MainMenu_ID", name: "MainMenu", active: true },
      },
      "2026-06-04T02:43:00.000Z",
    );

    expect(idx.activeScreenId).toBe("MainMenu_ID");
    expect(idx.screens.MainMenu_ID.active).toBe(true);
    expect(idx.screens.Shop_ID.active).toBeUndefined();
  });

  test("syncs live screen list into conversational context", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "title",
              type: "Text",
              props: { text: "Main Menu" },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "title", elementId: "Element_Title" }],
      },
      "2026-06-04T02:44:00.000Z",
    );

    applyToIndex(
      idx,
      "list_screens",
      {},
      {
        ok: true,
        activeScreenId: "Shop_ID",
        screens: [
          { id: "MainMenu_ID", name: "Main Menu Live", active: false },
          { id: "Shop_ID", name: "Shop", active: true },
        ],
      },
      "2026-06-04T02:45:00.000Z",
    );

    expect(idx.activeScreenId).toBe("Shop_ID");
    expect(idx.screens.MainMenu_ID.screenName).toBe("Main Menu Live");
    expect(idx.screens.MainMenu_ID.active).toBeUndefined();
    expect(idx.screens.MainMenu_ID.elements.Element_Title.props?.text).toBe("Main Menu");
    expect(idx.screens.Shop_ID).toMatchObject({
      screenId: "Shop_ID",
      screenName: "Shop",
      active: true,
      updatedAt: "2026-06-04T02:45:00.000Z",
    });
  });

  test("syncs live hierarchy inspection into conversational context", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      {
        intent: {
          version: "1.0.0",
          screenName: "MainMenu",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "title",
              type: "Text",
              rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
              props: { text: "Old Title", fontSize: 40 },
            },
          ],
        },
      },
      {
        screenId: "MainMenu_ID",
        elements: [{ clientHintId: "title", elementId: "Element_Title" }],
      },
      "2026-06-04T02:50:00.000Z",
    );

    applyToIndex(
      idx,
      "get_scene_hierarchy",
      { screenId: "MainMenu_ID" },
      {
        ok: true,
        hierarchy: {
          nodes: [
            {
              name: "MainMenu",
              elementId: "MainMenu_ID",
              rootScreenId: "MainMenu_ID",
              rootScreenName: "MainMenu",
              depth: 0,
              type: "Screen",
              active: true,
              childCount: 2,
            },
            {
              name: "title",
              elementId: "Element_Title",
              parentElementId: "MainMenu_ID",
              rootScreenId: "MainMenu_ID",
              rootScreenName: "MainMenu",
              depth: 1,
              type: "Text",
              anchor: "MiddleCenter",
              rect: { x: 0.12, y: 0.14, w: 0.76, h: 0.12 },
              props: { text: "Live Title", fontSize: 48, color: "#ffffffff" },
            },
            {
              name: "manual_badge",
              elementId: "Element_ManualBadge",
              parentElementId: "MainMenu_ID",
              rootScreenId: "MainMenu_ID",
              rootScreenName: "MainMenu",
              depth: 1,
              type: "Button",
              rect: { x: 0.7, y: 0.82, w: 0.2, h: 0.08 },
              props: { text: "Manual" },
            },
          ],
        },
      },
      "2026-06-04T02:51:00.000Z",
    );

    expect(idx.activeScreenId).toBe("MainMenu_ID");
    expect(idx.screens.MainMenu_ID.active).toBe(true);
    expect(idx.screens.MainMenu_ID.updatedAt).toBe("2026-06-04T02:51:00.000Z");
    expect(idx.screens.MainMenu_ID.elements.Element_Title).toMatchObject({
      elementId: "Element_Title",
      clientHintId: "title",
      type: "Text",
      parentElementId: "MainMenu_ID",
      anchor: "MiddleCenter",
      rect: { x: 0.12, y: 0.14, w: 0.76, h: 0.12 },
      props: { text: "Live Title", fontSize: 48, color: "#ffffffff" },
    });
    expect(idx.screens.MainMenu_ID.elements.Element_ManualBadge).toMatchObject({
      elementId: "Element_ManualBadge",
      type: "Button",
      parentElementId: "MainMenu_ID",
      props: { text: "Manual" },
      deleted: false,
    });
  });

  test("tracks captured previews for conversational follow-up context", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "capture_preview",
      { screenId: "MainMenu_ID" },
      {
        ok: true,
        screenId: "MainMenu_ID",
        savedPath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-1.png",
        uri: "file:///C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-1.png",
        mimeType: "image/png",
        width: 1280,
        height: 720,
        size: 12345,
      },
      "2026-06-04T03:00:00.000Z",
    );

    const screen = idx.screens.MainMenu_ID;
    expect(screen.previews).toHaveLength(1);
    expect(screen.previews?.[0].savedPath).toContain("preview-MainMenu_ID-1.png");
    expect(screen.previews?.[0].width).toBe(1280);
    expect(screen.elements).toEqual({});

    applyToIndex(
      idx,
      "compare_images",
      {
        referencePath: "C:/plans/main-menu.png",
        candidatePath: "file:///C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-1.png",
        threshold: 0.08,
      },
      {
        ok: true,
        verdict: "needs review",
        referencePath: "C:/plans/main-menu.png",
        candidatePath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-1.png",
        diffPath: "C:/Temp/oh-my-unity/comparisons/diff-main-menu.png",
        uri: "file:///C:/Temp/oh-my-unity/comparisons/diff-main-menu.png",
        diffMimeType: "image/png",
        meanAbsoluteError: 0.1,
        rootMeanSquareError: 0.12,
        mismatchRatio: 0.2,
        maxChannelDelta: 180,
        aspectRatioDelta: 0,
        threshold: 0.08,
      },
      "2026-06-04T03:01:00.000Z",
    );

    expect(screen.comparisons).toHaveLength(1);
    expect(screen.comparisons?.[0]).toMatchObject({
      verdict: "needs review",
      referencePath: "C:/plans/main-menu.png",
      candidatePath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-1.png",
      diffPath: "C:/Temp/oh-my-unity/comparisons/diff-main-menu.png",
      meanAbsoluteError: 0.1,
      mismatchRatio: 0.2,
      threshold: 0.08,
    });
    expect(screen.updatedAt).toBe("2026-06-04T03:01:00.000Z");

    applyToIndex(
      idx,
      "capture_preview_from_context",
      { screenName: "MainMenu" },
      {
        ok: true,
        matched: { screenId: "MainMenu_ID", screenName: "MainMenu" },
        previewArgs: { screenId: "MainMenu_ID" },
        captured: {
          ok: true,
          screenId: "MainMenu_ID",
          savedPath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-context.png",
          uri: "file:///C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-context.png",
          mimeType: "image/png",
          width: 1024,
          height: 768,
          size: 34567,
        },
      },
      "2026-06-04T03:02:00.000Z",
    );

    expect(screen.previews).toHaveLength(2);
    expect(screen.previews?.[1]).toMatchObject({
      savedPath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-context.png",
      width: 1024,
      height: 768,
    });
  });

  test("tracks combined screen verification previews and comparisons", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "verify_screen_against_reference",
      {
        screenId: "MainMenu_ID",
        referencePath: "C:/plans/main-menu.png",
        threshold: 0.05,
      },
      {
        ok: true,
        screenId: "MainMenu_ID",
        verdict: "close",
        preview: {
          ok: true,
          screenId: "MainMenu_ID",
          savedPath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-2.png",
          uri: "file:///C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-2.png",
          mimeType: "image/png",
          width: 1280,
          height: 720,
          size: 23456,
        },
        comparison: {
          ok: true,
          verdict: "close",
          referencePath: "C:/plans/main-menu.png",
          candidatePath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-2.png",
          diffPath: "C:/Temp/oh-my-unity/comparisons/diff-main-menu-2.png",
          uri: "file:///C:/Temp/oh-my-unity/comparisons/diff-main-menu-2.png",
          diffMimeType: "image/png",
          meanAbsoluteError: 0.01,
          rootMeanSquareError: 0.02,
          mismatchRatio: 0.03,
          maxChannelDelta: 8,
          aspectRatioDelta: 0,
          threshold: 0.05,
        },
      },
      "2026-06-04T03:30:00.000Z",
    );

    const screen = idx.screens.MainMenu_ID;
    expect(screen.previews?.[0].savedPath).toContain("preview-MainMenu_ID-2.png");
    expect(screen.comparisons?.[0]).toMatchObject({
      verdict: "close",
      referencePath: "C:/plans/main-menu.png",
      candidatePath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-2.png",
      diffPath: "C:/Temp/oh-my-unity/comparisons/diff-main-menu-2.png",
      mismatchRatio: 0.03,
      threshold: 0.05,
    });

    applyToIndex(
      idx,
      "verify_screen_against_reference_from_context",
      {
        screenName: "MainMenu",
        threshold: 0.04,
      },
      {
        ok: true,
        matched: {
          ok: true,
          screenId: "MainMenu_ID",
          screenName: "MainMenu",
          referencePath: "C:/plans/main-menu.png",
          referenceSource: "persisted-source",
        },
        verifyArgs: {
          screenId: "MainMenu_ID",
          referencePath: "C:/plans/main-menu.png",
          threshold: 0.04,
        },
        contextRefresh: {
          ok: true,
          hierarchy: {
            nodes: [
              {
                elementId: "MainMenu_ID",
                rootScreenId: "MainMenu_ID",
                rootScreenName: "MainMenu",
                depth: 0,
                type: "Screen",
                active: true,
              },
              {
                elementId: "Element_LiveStatus",
                parentElementId: "MainMenu_ID",
                rootScreenId: "MainMenu_ID",
                rootScreenName: "MainMenu",
                depth: 1,
                type: "Text",
                props: { text: "Live Status" },
              },
            ],
          },
        },
        verified: {
          ok: true,
          screenId: "MainMenu_ID",
          verdict: "needs review",
          preview: {
            ok: true,
            screenId: "MainMenu_ID",
            savedPath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-context-verify.png",
            uri: "file:///C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-context-verify.png",
            mimeType: "image/png",
            width: 1280,
            height: 720,
            size: 45678,
          },
          comparison: {
            ok: true,
            verdict: "needs review",
            referencePath: "C:/plans/main-menu.png",
            candidatePath: "C:/Temp/oh-my-unity/previews/preview-MainMenu_ID-context-verify.png",
            diffPath: "C:/Temp/oh-my-unity/comparisons/diff-main-menu-context.png",
            uri: "file:///C:/Temp/oh-my-unity/comparisons/diff-main-menu-context.png",
            diffMimeType: "image/png",
            meanAbsoluteError: 0.08,
            rootMeanSquareError: 0.1,
            mismatchRatio: 0.14,
            maxChannelDelta: 64,
            aspectRatioDelta: 0,
            threshold: 0.04,
          },
        },
      },
      "2026-06-04T03:31:00.000Z",
    );

    expect(screen.previews).toHaveLength(2);
    expect(screen.previews?.[1].savedPath).toContain("preview-MainMenu_ID-context-verify.png");
    expect(idx.activeScreenId).toBe("MainMenu_ID");
    expect(screen.elements.Element_LiveStatus.props?.text).toBe("Live Status");
    expect(screen.comparisons).toHaveLength(2);
    expect(screen.comparisons?.[1]).toMatchObject({
      verdict: "needs review",
      diffPath: "C:/Temp/oh-my-unity/comparisons/diff-main-menu-context.png",
      threshold: 0.04,
    });
  });

  test("tracks batch screen verification previews and comparisons", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_ui_screen",
      { intent: { screenName: "Slide 1", elements: [] } },
      { screenId: "Slide_1", elements: [] },
      "2026-06-04T04:00:00.000Z",
    );
    applyToIndex(
      idx,
      "create_ui_screen",
      { intent: { screenName: "Slide 2", elements: [] } },
      { screenId: "Slide_2", elements: [] },
      "2026-06-04T04:00:01.000Z",
    );

    applyToIndex(
      idx,
      "verify_screens_against_references_from_context",
      { sourceKind: "pptx" },
      {
        ok: true,
        verdict: "needs review",
        verifiedScreens: [
          {
            screenId: "Slide_1",
            screenName: "Slide 1",
            referencePath: "C:/plans/deck-slide-001.png",
            referenceSource: "persisted-source",
            verifyArgs: {
              screenId: "Slide_1",
              referencePath: "C:/plans/deck-slide-001.png",
              threshold: 0.05,
            },
            verified: {
              ok: true,
              screenId: "Slide_1",
              verdict: "close",
              preview: {
                ok: true,
                screenId: "Slide_1",
                savedPath: "C:/Temp/oh-my-unity/previews/preview-Slide_1.png",
                uri: "file:///C:/Temp/oh-my-unity/previews/preview-Slide_1.png",
                mimeType: "image/png",
                width: 1280,
                height: 720,
              },
              comparison: {
                ok: true,
                verdict: "close",
                referencePath: "C:/plans/deck-slide-001.png",
                candidatePath: "C:/Temp/oh-my-unity/previews/preview-Slide_1.png",
                diffPath: "C:/Temp/oh-my-unity/comparisons/diff-Slide_1.png",
                uri: "file:///C:/Temp/oh-my-unity/comparisons/diff-Slide_1.png",
                diffMimeType: "image/png",
                meanAbsoluteError: 0.01,
                rootMeanSquareError: 0.02,
                mismatchRatio: 0.03,
                threshold: 0.05,
              },
            },
          },
          {
            screenId: "Slide_2",
            screenName: "Slide 2",
            referencePath: "C:/plans/deck-slide-002.png",
            referenceSource: "persisted-source",
            verifyArgs: {
              screenId: "Slide_2",
              referencePath: "C:/plans/deck-slide-002.png",
              threshold: 0.05,
            },
            verified: {
              ok: true,
              screenId: "Slide_2",
              verdict: "needs review",
              preview: {
                ok: true,
                screenId: "Slide_2",
                savedPath: "C:/Temp/oh-my-unity/previews/preview-Slide_2.png",
                uri: "file:///C:/Temp/oh-my-unity/previews/preview-Slide_2.png",
                mimeType: "image/png",
                width: 1280,
                height: 720,
              },
              comparison: {
                ok: true,
                verdict: "needs review",
                referencePath: "C:/plans/deck-slide-002.png",
                candidatePath: "C:/Temp/oh-my-unity/previews/preview-Slide_2.png",
                diffPath: "C:/Temp/oh-my-unity/comparisons/diff-Slide_2.png",
                uri: "file:///C:/Temp/oh-my-unity/comparisons/diff-Slide_2.png",
                diffMimeType: "image/png",
                meanAbsoluteError: 0.08,
                rootMeanSquareError: 0.1,
                mismatchRatio: 0.2,
                threshold: 0.05,
              },
            },
          },
        ],
      },
      "2026-06-04T04:01:00.000Z",
    );

    expect(idx.screens.Slide_1.previews?.[0].savedPath).toContain("preview-Slide_1.png");
    expect(idx.screens.Slide_1.comparisons?.[0]).toMatchObject({
      verdict: "close",
      diffPath: "C:/Temp/oh-my-unity/comparisons/diff-Slide_1.png",
    });
    expect(idx.screens.Slide_2.previews?.[0].savedPath).toContain("preview-Slide_2.png");
    expect(idx.screens.Slide_2.comparisons?.[0]).toMatchObject({
      verdict: "needs review",
      diffPath: "C:/Temp/oh-my-unity/comparisons/diff-Slide_2.png",
    });
  });

  test("tracks direct image reference screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_image_reference_screen",
      { path: "C:/plans/mockup.png" },
      {
        importedAsset: {
          sourcePath: "C:/plans/mockup.png",
          assetPath: "Assets/UOS/Refs/mockup.png",
          importedAsSprite: true,
          assetType: "Sprite",
        },
        intent: {
          version: "1.0.0",
          screenName: "MockupReference",
          referenceCanvas: { width: 1280, height: 720 },
          elements: [{
            clientHintId: "reference_image",
            type: "Image",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            anchor: "TopLeft",
            props: { sprite: "Assets/UOS/Refs/mockup.png" },
          }],
        },
        created: {
          screenId: "MockupReference_ID",
          elements: [{ clientHintId: "reference_image", elementId: "Element_Reference" }],
        },
      },
      "2026-06-04T04:00:00.000Z",
    );

    expect(idx.importedAssets?.[0]).toMatchObject({
      sourcePath: "C:/plans/mockup.png",
      assetPath: "Assets/UOS/Refs/mockup.png",
      importedAsSprite: true,
    });
    const screen = idx.screens.MockupReference_ID;
    expect(screen.screenName).toBe("MockupReference");
    expect(screen.elements.Element_Reference).toMatchObject({
      clientHintId: "reference_image",
      type: "Image",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      props: { sprite: "Assets/UOS/Refs/mockup.png" },
    });
  });

  test("tracks direct document screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_document_screen",
      { path: "C:/plans/brief.md" },
      {
        screenId: "BriefScreen_ID",
        source: {
          tool: "create_document_screen",
          kind: "md",
          path: "C:/plans/brief.md",
        },
        intent: {
          version: "1.0.0",
          screenName: "BriefScreen",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "md_title",
              type: "Text",
              rect: { x: 0.08, y: 0.07, w: 0.84, h: 0.095 },
              props: { text: "Brief" },
            },
          ],
        },
        created: {
          screenId: "BriefScreen_ID",
          elements: [{ clientHintId: "md_title", elementId: "Element_Title" }],
        },
      },
      "2026-06-04T05:20:00.000Z",
    );

    expect(idx.screens.BriefScreen_ID.source).toMatchObject({
      tool: "create_document_screen",
      kind: "md",
      path: "C:/plans/brief.md",
      ts: "2026-06-04T05:20:00.000Z",
    });
    expect(idx.screens.BriefScreen_ID.elements.Element_Title.props?.text).toBe("Brief");
  });

  test("tracks smart material screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_screen_from_material",
      { path: "C:/plans/brief.md", mode: "auto" },
      {
        screenId: "SmartBrief_ID",
        kind: "document",
        mode: "editable",
        source: {
          tool: "create_screen_from_material",
          kind: "md",
          mode: "editable",
          path: "C:/plans/brief.md",
        },
        intent: {
          version: "1.0.0",
          screenName: "SmartBrief",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [
            {
              clientHintId: "md_title",
              type: "Text",
              rect: { x: 0.08, y: 0.07, w: 0.84, h: 0.095 },
              props: { text: "Smart Brief" },
            },
          ],
        },
        created: {
          screenId: "SmartBrief_ID",
          elements: [{ clientHintId: "md_title", elementId: "Element_Title" }],
        },
      },
      "2026-06-04T05:40:00.000Z",
    );

    expect(idx.screens.SmartBrief_ID.source).toMatchObject({
      tool: "create_screen_from_material",
      kind: "md",
      mode: "editable",
      path: "C:/plans/brief.md",
      ts: "2026-06-04T05:40:00.000Z",
    });
    expect(idx.screens.SmartBrief_ID.elements.Element_Title.props?.text).toBe("Smart Brief");
  });

  test("tracks direct PPTX slide screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_pptx_slide_screen",
      { path: "C:/plans/deck.pptx", slideNumber: 1 },
      {
        importedAssets: [{
          sourcePath: "C:/tmp/deck/image1.png",
          assetPath: "Assets/UOS/PPTX/deck-slide1-image1.png",
          importedAsSprite: true,
          assetType: "Sprite",
        }],
        intent: {
          version: "1.0.0",
          screenName: "DeckSlide",
          referenceCanvas: { width: 1920, height: 1080 },
          elements: [{
            clientHintId: "slide1_image_hero",
            type: "Image",
            rect: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
            anchor: "TopLeft",
            props: { sprite: "Assets/UOS/PPTX/deck-slide1-image1.png" },
          }],
        },
        created: {
          screenId: "DeckSlide_ID",
          elements: [{ clientHintId: "slide1_image_hero", elementId: "Element_Hero" }],
        },
      },
      "2026-06-04T04:30:00.000Z",
    );

    expect(idx.importedAssets?.[0]).toMatchObject({
      sourcePath: "C:/tmp/deck/image1.png",
      assetPath: "Assets/UOS/PPTX/deck-slide1-image1.png",
      importedAsSprite: true,
    });
    expect(idx.screens.DeckSlide_ID.elements.Element_Hero).toMatchObject({
      clientHintId: "slide1_image_hero",
      type: "Image",
      props: { sprite: "Assets/UOS/PPTX/deck-slide1-image1.png" },
    });
  });

  test("tracks PPTX deck screen creation with transitions and active screen", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_pptx_deck_screens",
      { path: "C:/plans/deck.pptx", createTransitions: true, activateFirst: true },
      {
        path: "C:/plans/deck.pptx",
        screens: [
          {
            slideNumber: 1,
            screenId: "DeckSlide1_ID",
            screenName: "Deck Slide 1",
            source: {
              tool: "create_pptx_deck_screens",
              kind: "pptx",
              mode: "editable",
              path: "C:/plans/deck.pptx",
              slideNumber: 1,
              assetPaths: ["Assets/UOS/PPTX/deck-slide1-image1.png"],
            },
            importedAssets: [{
              sourcePath: "C:/tmp/deck/image1.png",
              assetPath: "Assets/UOS/PPTX/deck-slide1-image1.png",
              importedAsSprite: true,
              assetType: "Sprite",
            }],
            draft: {
              intent: {
                version: "1.0.0",
                screenName: "Deck Slide 1",
                referenceCanvas: { width: 1920, height: 1080 },
                elements: [{
                  clientHintId: "slide1_image_hero",
                  type: "Image",
                  rect: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 },
                  anchor: "TopLeft",
                  props: { sprite: "Assets/UOS/PPTX/deck-slide1-image1.png" },
                }],
              },
            },
            created: {
              screenId: "DeckSlide1_ID",
              elements: [{ clientHintId: "slide1_image_hero", elementId: "Element_Hero_1" }],
            },
          },
          {
            slideNumber: 2,
            screenId: "DeckSlide2_ID",
            screenName: "Deck Slide 2",
            source: {
              tool: "create_pptx_deck_screens",
              kind: "pptx",
              mode: "editable",
              path: "C:/plans/deck.pptx",
              slideNumber: 2,
              assetPaths: ["Assets/UOS/PPTX/deck-slide2-image1.png"],
            },
            importedAssets: [{
              sourcePath: "C:/tmp/deck/image2.png",
              assetPath: "Assets/UOS/PPTX/deck-slide2-image1.png",
              importedAsSprite: true,
              assetType: "Sprite",
            }],
            draft: {
              intent: {
                version: "1.0.0",
                screenName: "Deck Slide 2",
                referenceCanvas: { width: 1920, height: 1080 },
                elements: [{
                  clientHintId: "slide2_text_title",
                  type: "Text",
                  rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 },
                  anchor: "TopLeft",
                  props: { text: "Settings" },
                }],
              },
            },
            created: {
              screenId: "DeckSlide2_ID",
              elements: [{ clientHintId: "slide2_text_title", elementId: "Element_Title_2" }],
            },
          },
        ],
        transitions: [{
          fromId: "DeckSlide1_ID",
          toId: "DeckSlide2_ID",
          trigger: "next-slide-1",
          ok: true,
        }],
        activeScreenId: "DeckSlide1_ID",
      },
      "2026-06-04T04:45:00.000Z",
    );

    expect(idx.importedAssets?.map((asset) => asset.assetPath)).toEqual([
      "Assets/UOS/PPTX/deck-slide1-image1.png",
      "Assets/UOS/PPTX/deck-slide2-image1.png",
    ]);
    expect(idx.screens.DeckSlide1_ID.source).toMatchObject({
      tool: "create_pptx_deck_screens",
      kind: "pptx",
      mode: "editable",
      path: "C:/plans/deck.pptx",
      slideNumber: 1,
      assetPaths: ["Assets/UOS/PPTX/deck-slide1-image1.png"],
      ts: "2026-06-04T04:45:00.000Z",
    });
    expect(idx.screens.DeckSlide1_ID.elements.Element_Hero_1.props?.sprite)
      .toBe("Assets/UOS/PPTX/deck-slide1-image1.png");
    expect(idx.screens.DeckSlide2_ID.elements.Element_Title_2.props?.text).toBe("Settings");
    expect(idx.transitions[0]).toMatchObject({
      fromId: "DeckSlide1_ID",
      toId: "DeckSlide2_ID",
      trigger: "next-slide-1",
      ok: true,
    });
    expect(idx.activeScreenId).toBe("DeckSlide1_ID");
    expect(idx.screens.DeckSlide1_ID.active).toBe(true);
    expect(idx.screens.DeckSlide2_ID.active).toBeUndefined();
  });

  test("tracks direct PDF page reference screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_pdf_page_reference_screen",
      { path: "C:/plans/brief.pdf", pageNumber: 1 },
      {
        importedAsset: {
          sourcePath: "C:/tmp/brief-page-001.png",
          assetPath: "Assets/UOS/PDF/brief-page-001.png",
          importedAsSprite: true,
          assetType: "Sprite",
        },
        intent: {
          version: "1.0.0",
          screenName: "PdfReference",
          referenceCanvas: { width: 300, height: 144 },
          elements: [{
            clientHintId: "pdf_page_1",
            type: "Image",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            anchor: "TopLeft",
            props: { sprite: "Assets/UOS/PDF/brief-page-001.png" },
          }],
        },
        created: {
          screenId: "PdfReference_ID",
          elements: [{ clientHintId: "pdf_page_1", elementId: "Element_Pdf" }],
        },
      },
      "2026-06-04T05:00:00.000Z",
    );

    expect(idx.importedAssets?.[0]).toMatchObject({
      sourcePath: "C:/tmp/brief-page-001.png",
      assetPath: "Assets/UOS/PDF/brief-page-001.png",
      importedAsSprite: true,
    });
    expect(idx.screens.PdfReference_ID.elements.Element_Pdf).toMatchObject({
      clientHintId: "pdf_page_1",
      type: "Image",
      props: { sprite: "Assets/UOS/PDF/brief-page-001.png" },
    });
  });

  test("tracks direct DOCX image reference screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_docx_image_reference_screen",
      { path: "C:/plans/brief.docx", imageNumber: 1 },
      {
        importedAsset: {
          sourcePath: "C:/tmp/brief/001-image1.png",
          assetPath: "Assets/UOS/DOCX/brief-image-001.png",
          importedAsSprite: true,
          assetType: "Sprite",
        },
        intent: {
          version: "1.0.0",
          screenName: "DocxReference",
          referenceCanvas: { width: 640, height: 360 },
          elements: [{
            clientHintId: "docx_image_1",
            type: "Image",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            anchor: "TopLeft",
            props: { sprite: "Assets/UOS/DOCX/brief-image-001.png" },
          }],
        },
        created: {
          screenId: "DocxReference_ID",
          elements: [{ clientHintId: "docx_image_1", elementId: "Element_Docx" }],
        },
      },
      "2026-06-04T05:30:00.000Z",
    );

    expect(idx.importedAssets?.[0]).toMatchObject({
      sourcePath: "C:/tmp/brief/001-image1.png",
      assetPath: "Assets/UOS/DOCX/brief-image-001.png",
      importedAsSprite: true,
    });
    expect(idx.screens.DocxReference_ID.elements.Element_Docx).toMatchObject({
      clientHintId: "docx_image_1",
      type: "Image",
      props: { sprite: "Assets/UOS/DOCX/brief-image-001.png" },
    });
  });

  test("tracks auto-routed material reference screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_reference_screen_from_material",
      { path: "C:/plans/mockup.png" },
      {
        kind: "image",
        path: "C:/plans/mockup.png",
        importedAsset: {
          sourcePath: "C:/plans/mockup.png",
          assetPath: "Assets/UOS/Auto/mockup.png",
          importedAsSprite: true,
          assetType: "Sprite",
        },
        intent: {
          version: "1.0.0",
          screenName: "AutoMockup",
          referenceCanvas: { width: 320, height: 180 },
          elements: [{
            clientHintId: "reference_image",
            type: "Image",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            anchor: "TopLeft",
            props: { sprite: "Assets/UOS/Auto/mockup.png" },
          }],
        },
        created: {
          screenId: "AutoMockup_ID",
          elements: [{ clientHintId: "reference_image", elementId: "Element_Auto" }],
        },
      },
      "2026-06-04T06:00:00.000Z",
    );

    expect(idx.importedAssets?.[0].assetPath).toBe("Assets/UOS/Auto/mockup.png");
    expect(idx.screens.AutoMockup_ID.source).toMatchObject({
      tool: "create_reference_screen_from_material",
      kind: "image",
      path: "C:/plans/mockup.png",
      assetPaths: ["Assets/UOS/Auto/mockup.png"],
    });
    expect(idx.screens.AutoMockup_ID.elements.Element_Auto).toMatchObject({
      clientHintId: "reference_image",
      type: "Image",
      props: { sprite: "Assets/UOS/Auto/mockup.png" },
    });
  });

  test("tracks rendered PPTX material reference screen creation", () => {
    const idx = emptyIndex();
    applyToIndex(
      idx,
      "create_reference_screen_from_material",
      { path: "C:/plans/deck.pptx", pptxMode: "rendered", slideNumber: 2 },
      {
        kind: "pptx",
        pptxMode: "rendered",
        path: "C:/plans/deck.pptx",
        importedAsset: {
          sourcePath: "C:/tmp/deck-slide-002.png",
          assetPath: "Assets/UOS/Rendered/deck-slide-002.png",
          importedAsSprite: true,
          assetType: "Sprite",
        },
        intent: {
          version: "1.0.0",
          screenName: "RenderedDeck",
          referenceCanvas: { width: 640, height: 360 },
          elements: [{
            clientHintId: "pptx_rendered_slide",
            type: "Image",
            rect: { x: 0, y: 0, w: 1, h: 1 },
            anchor: "TopLeft",
            props: { sprite: "Assets/UOS/Rendered/deck-slide-002.png" },
          }],
        },
        created: {
          screenId: "RenderedDeck_ID",
          elements: [{ clientHintId: "pptx_rendered_slide", elementId: "Element_Rendered" }],
        },
        specific: {
          pptx: {
            path: "C:/plans/deck.pptx",
            slideNumber: 2,
            renderer: "powerpoint",
          },
          renderedSlide: {
            path: "C:/tmp/deck-slide-002.png",
            pageNumber: 2,
            width: 640,
            height: 360,
            size: 1234,
          },
        },
      },
      "2026-06-04T06:10:00.000Z",
    );

    expect(idx.importedAssets?.[0].assetPath).toBe("Assets/UOS/Rendered/deck-slide-002.png");
    expect(idx.screens.RenderedDeck_ID.source).toMatchObject({
      tool: "create_reference_screen_from_material",
      kind: "pptx",
      mode: "rendered",
      path: "C:/plans/deck.pptx",
      slideNumber: 2,
      renderedPath: "C:/tmp/deck-slide-002.png",
      assetPaths: ["Assets/UOS/Rendered/deck-slide-002.png"],
    });
    expect(idx.screens.RenderedDeck_ID.elements.Element_Rendered).toMatchObject({
      clientHintId: "pptx_rendered_slide",
      type: "Image",
      props: { sprite: "Assets/UOS/Rendered/deck-slide-002.png" },
    });
  });
});
