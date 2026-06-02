# Install Guide

oh-my-unity has two install profiles — pick the one that matches your use case.

## Prerequisites (both profiles)

| Requirement | Check |
|---|---|
| Unity 6 (`6000.0+`) | `Unity Hub` shows 6000.x installed |
| Bun ≥ 1.3 | `bun --version` |
| opencode CLI ≥ 1.15 | `opencode --version` |
| Anthropic Claude account (Pro/Max subscription) | `opencode auth list` shows `Anthropic oauth` |
| Claude Code CLI installed once (for OAuth credentials) | `claude --version` (the `opencode-claude-auth` plugin reads Claude Code's stored credentials) |
| Node ≥ 18 (for the `uos` launcher) | `node --version` |

If `opencode auth list` is empty, run:
```bash
opencode providers login
# pick "anthropic", complete the OAuth flow in browser
```

### Why the `opencode-claude-auth` plugin

Since late 2025, Anthropic blocks third-party tools (including bare opencode) from spending Claude Pro/Max subscription quota — every `uos run` call would fail with `Anthropic API key is missing`. Our `opencode.json` registers the [`opencode-claude-auth`](https://github.com/griffinmartin/opencode-claude-auth) plugin, which bridges the credentials Claude Code CLI already stored on this machine into opencode's anthropic provider. No separate API key, no usage billing — your subscription quota is spent instead.

You only need Claude Code CLI installed and signed in once; the plugin discovers its credentials automatically.

---

## Profile A — Dev workspace (this repo IS your Unity project)

You'll run Unity directly on this repository. Everything is pre-wired.

1. Clone:
   ```bash
   git clone <repo-url> oh-my-unity
   cd oh-my-unity
   bun install
   bun link              # registers `uos` on PATH
   ```
2. Open Unity Hub → Add → select this `oh-my-unity` folder → Open.
3. Wait for Library/ to compile (first run only).
4. `Window > Oh My Unity > Monitor` → **Start** (listens on `ws://127.0.0.1:17801`).
5. In another terminal, anywhere:
   ```bash
   uos
   ```
6. The TUI loads `planner-to-screen` (Opus 4.8). Type:
   ```
   Assets/PlanningMaterials 폴더의 기획서로 화면을 만들어줘
   ```

---

## Profile B — Consumer (oh-my-unity overlay on YOUR Unity project)

You have your own Unity project (e.g. `D:/UnityProject/MyGame`) and want oh-my-unity to drive its UI authoring without touching your existing code.

### B1. Pull the Unity package

In `<your-project>/Packages/manifest.json`, add to `dependencies`:

**Local checkout (fastest, no git push needed):**
```json
"com.lyx.oh-my-unity": "file:///C:/Users/lyx/MCP_for_Unity_LYX/Packages/com.lyx.oh-my-unity"
```
- Adjust the path to wherever you cloned this repo.
- Unity watches the folder — edits in the source clone reflect immediately in your project.

**Git URL (once this repo is published):**
```json
"com.lyx.oh-my-unity": "https://github.com/<owner>/oh-my-unity.git?path=Packages/com.lyx.oh-my-unity"
```

Then reopen the Unity Editor — Package Manager shows **Oh My Unity (Unity Editor Bridge) 0.1.0** under *In Project*.

### B2. Wire up opencode

Two choices for where the agent/tool/config live:

**B2a. Run `uos` from this repo** (simplest — zero side effects on your other projects):
- Whenever you want to author UI, `cd C:/Users/lyx/MCP_for_Unity_LYX && uos`
- The Unity Editor in your project (`D:/UnityProject/...`) listens on `ws://127.0.0.1:17801`, so the bridge connects regardless of `uos`'s cwd
- For planning materials inside your project, use **absolute paths** (`D:/UnityProject/MyGame/Assets/Plans/intro.png`) or set the env var:
  ```powershell
  $env:UNITY_MCP_MATERIALS_DIR = "D:/UnityProject/MyGame/Assets/Plans"
  uos
  ```

**B2b. Make `uos` work from anywhere** (mirror config into global opencode):
```bash
# 1) ensure uos is on PATH
cd C:/Users/lyx/MCP_for_Unity_LYX && bun link

# 2) sync tools + agent into the global opencode config
mkdir -p ~/.config/opencode/tools ~/.config/opencode/agents
cp .opencode/tools/*.ts ~/.config/opencode/tools/
cp .opencode/agents/*.md ~/.config/opencode/agents/

# 3) declare model + default agent in the global config
cat > ~/.config/opencode/opencode.jsonc <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-8",
  "default_agent": "planner-to-screen",
  "provider": { "anthropic": {} }
}
EOF
```
After this, `uos` from any cwd (including inside your Unity project) loads the planner-to-screen agent.

### B3. Smoke test

1. Open your Unity Editor (`D:/UnityProject/MyGame`).
2. `Window > Oh My Unity > Monitor` → Start.
3. From any terminal: `uos run "show me a screen list"` → expect `list_screens` to return the current scene's screens.

---

## Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| Package Manager says "Online search 401" | Unity ID token expired; unrelated to file: link | Re-sign-in via Unity Hub, or ignore (local file: still works) |
| Package shows in "In Project" but namespace errors in Console | asmdef rename incomplete on consumer side | run Package Manager → `Refresh` and `Reimport All` |
| `bridge: not connected to Unity` | Editor Bridge not started | Open Monitor window in Editor and click Start |
| `uos: command not found` | `bun link` never ran or PATH not refreshed | `cd oh-my-unity && bun link`, then open a new shell |
| `opencode models anthropic` says "Provider not found" | Provider not declared in config | Add `"provider": { "anthropic": {} }` to `opencode.json` (already done in Profile A) |
| `Anthropic API key is missing` on `uos run` | `opencode-claude-auth` plugin not loaded or Claude Code CLI not signed in | Verify `"plugin": ["opencode-claude-auth@latest"]` in `opencode.json`; `claude --version` should work; if still broken `bun install` to refetch plugin |
| `UnknownError: Unexpected server error / ref: err_xxxxx` | Test or other non-tool .ts inside `.opencode/tools/` poisons the runtime | Keep only tool modules under `.opencode/tools/`; move tests to `tests/` |
| `list_planning_materials` returns empty | Wrong cwd or path | Pass `dir` arg explicitly, or set `UNITY_MCP_MATERIALS_DIR` |
| pptx_to_images throws "not implemented" | Intentional v1 stub | Export PPTX slides to PNG/JPG manually, then `list_planning_materials` |

---

## Verifying the install

```bash
# bun toolchain
bun test ./tests/bridge.test.ts          # → 6 pass

# tools syntax
bun build ./.opencode/tools/*.ts --target=bun --outdir=/tmp/check  # → 0 errors

# opencode picks up our agent
opencode agent list | grep planner-to-screen        # → "planner-to-screen (primary)"

# correct model resolved
opencode models anthropic | grep opus-4-8           # → "anthropic/claude-opus-4-8" listed
```

If all four pass, you can `uos`.
