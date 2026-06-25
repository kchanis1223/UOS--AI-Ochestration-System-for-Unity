# 2026-06-11 UOS Launcher UX Handoff

## Scope

User requested the default `uos` command to open a UOS/opencode launcher flow
that discovers configured Unity projects, shows UOS connection state, supports
connect/disconnect, and enters the selected project with keyboard or mouse input.

## Implemented

- Added UOS config storage at `~/.config/uos/config.json`.
- Added `uos setup --unity-projects <dir>` aliases to save Unity project roots.
- Added configured-root scanning for Unity projects by
  `ProjectSettings/ProjectVersion.txt`.
- Added project catalog merge with:
  - UOS package installed/missing/needs-attention status.
  - live Unity Editor bridge status.
  - token-redacted live editor metadata.
- Changed no-argument `uos` to show the configured project catalog before
  starting opencode.
- Improved the launcher list from repeated two-line rows into an aligned table
  with a selected-project detail panel in the raw-mode TUI.
- Added launcher TUI input:
  - Up/Down to move.
  - Enter to enter the selected project.
  - `c` to connect/update UOS package.
  - `d` to disconnect UOS package.
  - `q` to quit.
  - mouse row click to enter where xterm SGR mouse events are supported.
  - mouse click in the status/action column to connect/disconnect.
- Selecting a project with no UOS package now automatically installs the UOS
  Unity package before opencode opens.
- Added plain prompt fallback via `UOS_SIMPLE_PROJECT_SELECT=1`.
- Added project-only opencode entry for disconnected projects. The Ochestrator
  startup prompt receives project status, UOS package status, and bridge-live
  status so it can avoid Unity mutation until connected.
- Added `uninstallUnityPackage()` to remove UOS manifest dependency and embedded
  `Packages/com.lyx.oh-my-unity` safely.

## Main Files

- `bin/uos.js`
- `bin/uos-core.js`
- `bin/uos-config-core.js`
- `bin/uos-setup.js`
- `tests/uos-core.test.ts`
- `tests/uos-setup.test.ts`
- `docs/uos-ochestrator-tasks.md`
- `README.md`
- `INSTALL.md`

## Verification Completed

- `node --check bin\uos.js`
- `node --check bin\uos-core.js`
- `node --check bin\uos-setup.js`
- `node --check bin\uos-config-core.js`
- `bun test .\tests\uos-setup.test.ts`
- `bun test .\tests\uos-core.test.ts`
- `bun run test`

Latest full result: 282 pass, 0 fail, across 17 test files.

## User-Led Validation Next

1. Save the Unity projects parent folder:

   ```powershell
   uos setup --unity-projects D:\UnityProject --no-install-dependencies
   ```

2. Open a new terminal and run:

   ```powershell
   uos
   ```

3. Confirm the project list shows every expected Unity project and status:
   `connected`, `installed`, `not-installed`, or `needs-attention`.

4. Validate keyboard UX:
   - Up/Down changes selection.
   - Enter opens opencode for the selected project.
   - `c` installs/updates UOS package.
   - `d` disconnects UOS package.
   - `q` quits.

5. Validate automatic install on entry:
   - Press `d` on a safe test project to disconnect it.
   - Press Enter on the same project.
   - Confirm UOS installs the package automatically before opencode opens.
   - Refresh/reopen Unity if the bridge is not live immediately after install.

6. Validate mouse UX in Windows Terminal or another terminal with SGR mouse
   support:
   - Click project row to enter.
   - Click status/action column to connect/disconnect.

7. If mouse/raw terminal behavior is unstable, test fallback:

   ```powershell
   $env:UOS_SIMPLE_PROJECT_SELECT = "1"
   uos
   ```

## Notes / Risks

- Mouse support depends on terminal escape-sequence support. Keyboard fallback is
  the compatibility path.
- Connect/disconnect changes Unity package wiring. Unity may need refresh or
  reopen after package changes.
- Automatic install on Enter updates `Packages/manifest.json` before opencode
  opens; if Unity is already open, it may need to refresh before the bridge is
  live.
- Disconnect removes the manifest dependency and embedded
  `Packages/com.lyx.oh-my-unity` folder when present.
- This session did not perform live interactive opencode/Unity validation,
  because it requires the user's real Unity project roots and terminal session.
