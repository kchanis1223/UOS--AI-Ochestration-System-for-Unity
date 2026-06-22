# 2026-06-11 Response Language Setup Handoff

## Decision

UOS default assistant response language is a user preference, not an opencode
agent choice. It is stored in the UOS launcher config during setup and injected
into the Orchestrator startup prompt for every fresh or resumed UOS TUI launch.

## Implemented

- `uos setup --language <code|name>` saves `responseLanguage` in
  `~/.config/uos/config.json`.
- Supported aliases normalize common values:
  - `ko`, `ko-KR`, `한국어` -> `Korean`
  - `en`, `en-US`, `English` -> `English`
  - `ja`, `jp`, `Japanese`, `日本語` -> `Japanese`
  - `zh`, `Chinese`, `中文` -> `Chinese`
- `buildLaunchEnv` injects `UOS_RESPONSE_LANGUAGE` from config unless the
  environment already provides it.
- UOS startup prompts include a `Response Language` section when the language is
  configured.
- Dry-run and context environment summaries expose `UOS_RESPONSE_LANGUAGE`.

## Validation

- `node --check bin\uos-core.js`
- `node --check bin\uos-setup.js`
- `node --check bin\uos-config-core.js`
- `bun test .\tests\uos-setup.test.ts .\tests\uos-core.test.ts`

Targeted validation result: 126 pass, 0 fail.

## Next Live Check

Run:

```bash
uos setup --unity-projects D:/UnityProject --language ko --no-install-dependencies
uos --uos-dry-run
```

Confirm the forwarded startup prompt contains `## Response Language` and
`Use Korean as the default response language`.
