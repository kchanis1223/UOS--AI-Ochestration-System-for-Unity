# oh-my-unity

**Conversational UI authoring for Unity 6** — let an opencode.ai agent read your planning materials (PPTX/PNG/PDF) and generate Unity Editor screens for you.

Status: **alpha** · single-user dev (본인 사용 1차 타깃, OSS 정형화는 진행 중)

## What it does

A primary [opencode](https://opencode.ai) agent (`planner-to-screen`, Claude Opus 4.8) takes a folder of planning materials → analyzes them with multimodal vision → emits `PlanningIntent` objects → calls our 13 native tools → the Unity Editor renders the Canvas + UI element tree in real time over a WebSocket bridge.

```
┌───────────────┐    PlanningIntent       ┌──────────────────────┐
│ opencode      │  ─────────────────►     │ Unity Editor (D:)    │
│ Opus 4.8      │                         │   ↑ EditorBridge     │
│ planner-      │  WebSocket :17801       │   ↑ UGUI backend     │
│ to-screen     │  ◄─────────────────     │   ↑ ScreenFlow       │
└───────────────┘     elementId map       └──────────────────────┘
       │
       │ .opencode/tools/*.ts (Bun, 13 tools)
       └── _bridge.ts (4-axis verified, ADR-0001)
```

## Components

| Path | Role |
|---|---|
| `Packages/com.lyx.oh-my-unity/` | Unity 6 Editor package (UGUI backend + WebSocket listener) |
| `.opencode/tools/` | 13 Bun-native opencode tools (bridge proxy + planning material handlers) |
| `.opencode/agents/planner-to-screen.md` | Primary agent system prompt |
| `opencode.json` | Project-local opencode config (model, default_agent, permission) |
| `bin/uos*` | `uos` launcher (Unity Orchestration System) — forwards to `opencode` |

## Quick start

See [INSTALL.md](./INSTALL.md). Two paths:

- **Dev (this repo as workspace):** open this folder in Unity Hub. Everything is wired.
- **Consumer (another Unity project):** add via UPM file: link or git URL, copy `.opencode/` to that project, install `uos` globally.

## Workflow

```bash
# 1) start the Unity Editor with the package loaded
# 2) Window > Oh My Unity > Monitor → Start (listens on ws://127.0.0.1:17801)
# 3) drop planning materials anywhere; remember the path
# 4) launch the agent
uos
> "Assets/PlanningMaterials 폴더의 기획서로 Unity 화면을 만들어줘"
# 5) the agent reads → analyzes → creates ≥3 screens in your scene
```

## Tools (13)

| Category | Tools |
|---|---|
| Planning material I/O (localHandler) | `list_planning_materials`, `read_planning_material`, `pptx_to_images` (stub), `preprocess_image` (stub) |
| Screen generation (bridge) | `create_ui_screen`, `add_ui_element`, `update_ui_element`, `delete_ui_element`, `move_ui_element` |
| Flow (bridge) | `create_screen_transition`, `list_screens` |
| Inspection (bridge) | `get_scene_hierarchy`, `capture_preview` |

## Acceptance / dev verification

- 4-axis bridge smoke: `bun test ./.opencode/tools/_bridge.test.ts` → 6 pass
- Tool surface: `bun build ./.opencode/tools/*.ts --target=bun --outdir=/tmp/check` → 0 errors
- Plan: [`.omc/plans/plan-oh-my-unity-rebrand.md`](./.omc/plans/plan-oh-my-unity-rebrand.md) (consensus-approved)
- Spec: [`.omc/specs/deep-interview-oh-my-unity-rebrand.md`](./.omc/specs/deep-interview-oh-my-unity-rebrand.md) (ambiguity 17%)
- ADR: [`docs/adr/0001-bridge-implementation.md`](./docs/adr/0001-bridge-implementation.md)

## Non-goals (v1)

- Other MCP hosts (Claude Code, Cursor) — opencode.ai only
- Unity Asset Store distribution
- Multi-language README
- CI/CD pipeline
- PPTX rasterization (use pre-rendered PNGs)

## License

TBD (likely MIT — repo not yet public).

## Why "Oh My Unity"?

Inspired by `oh-my-zsh` / `oh-my-claudecode` — a curated overlay of tools + agents + config that turns a host into a domain-specialized companion. Here, opencode.ai becomes the conversational UI co-author for Unity Editor.
