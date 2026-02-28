# Firefox DevTools MCP Runbook

This runbook captures the full process used to stabilize `firefox-devtools` MCP with Codex CLI.

## Symptoms

- Tool call fails with `Transport closed`.
- `codex mcp list` shows server `enabled`, but tool calls still fail.
- Initial issue: `npx ...@latest` failed with DNS (`EAI_AGAIN registry.npmjs.org`).

## Root Causes Found

1. Runtime dependency on `npx @latest` (network/DNS sensitive).
2. Stale MCP client session after server reconfiguration.
3. Spawn/runtime environment mismatch in MCP host process.

## Final Stable Strategy

- Install `firefox-devtools-mcp` once in a fixed local path.
- Use a wrapper script for deterministic environment.
- Use `/tmp` for runtime profile/log (`/tmp/firefox-devtools-mcp-*`).
- Configure Codex MCP with explicit timeouts:
  - `startup_timeout_sec = 30`
  - `tool_timeout_sec = 180`

## Automated Scripts

- `scripts/setup-firefox-devtools-mcp.sh`
  - Installs local MCP binary in `~/.local/share/firefox-devtools-mcp`
  - Writes wrappers in `.mcp/` for both modes:
    - `firefox-devtools-mcp-wrapper-headless.sh`
    - `firefox-devtools-mcp-wrapper-headful.sh`
  - Sets active wrapper to headless by default
  - Registers `firefox-devtools` in Codex

- `scripts/use-firefox-devtools-mcp-headless.sh`
  - Switches active wrapper to headless and re-registers MCP

- `scripts/use-firefox-devtools-mcp-headful.sh`
  - Switches active wrapper to normal/headful and re-registers MCP

- `scripts/reset-firefox-devtools-mcp-runtime.sh`
  - Kills stale MCP/Firefox test processes

- `scripts/doctor-firefox-devtools-mcp.sh`
  - Prints MCP config status, active mode (headless/headful), log tail, and active processes

- `scripts/firefox-devtools-mcp-env-check.sh`
  - Prints GUI/session variables used by headful mode (`XDG_SESSION_TYPE`, `DISPLAY`, `WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`)

## Standard Recovery Flow

1. Run setup:
   - `bash scripts/setup-firefox-devtools-mcp.sh`
2. Pick mode:
   - Headless: `bash scripts/use-firefox-devtools-mcp-headless.sh`
   - Normal window: `bash scripts/use-firefox-devtools-mcp-headful.sh`
3. Reset stale processes:
   - `bash scripts/reset-firefox-devtools-mcp-runtime.sh`
4. Restart Codex CLI completely.
5. Validate:
   - `codex mcp list`
   - In Codex, call `mcp__firefox-devtools__list_pages`
6. If needed, inspect log:
   - `tail -f /tmp/firefox-devtools-mcp.stderr.log`
7. If headful mode does not open Firefox window, inspect GUI env:
   - `bash scripts/firefox-devtools-mcp-env-check.sh`

## Expected Healthy Output

On successful tool initialization, log should show:

- `Executing tool: list_pages`
- `Initializing Firefox DevTools connection...`
- `Launching Firefox via Selenium WebDriver BiDi...`
- `Firefox DevTools connection established`

## Notes

- If tool still fails but log shows full successful initialization, restart Codex CLI (stale session).
- Keep wrapper stderr-only logging; avoid writing protocol output to stdout.
