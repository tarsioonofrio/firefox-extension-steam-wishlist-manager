# Dev Workflows

Operational workflows for local development and MCP runtime management.

## Extension Development

### Default profile

- `npm run dev`
- `npm run check:env`
- `npm run docs:check`
- `npm run test:smoke:dev`

Runs `web-ext` against your default Firefox profile/session.

### Steam developer profile (`steam-dev`)

- `npm run dev:steam`
- `npm run dev:steam:fresh` (force clean restart)

What it does:
1. Resolves the profile path from `~/.mozilla/firefox/profiles.ini`.
2. Opens Firefox as a separate instance with `--new-instance -P steam-dev --no-remote`.
3. Runs `web-ext` with `--firefox-profile <resolved-path>`.

Optional:
- Use a different profile name:
  - `SWM_FIREFOX_PROFILE_NAME=<profile-name> npm run dev:steam`
- Skip launching a new Firefox window:
  - `npm run dev:steam:no-launch`
- Force clean session if stale reload is suspected:
  - `npm run dev:steam:fresh`
  - Stops old `web-ext` + `steam-dev` Firefox processes before relaunching.

## Firefox DevTools MCP

### Repository rule (must follow)

In this repository, MCP usage must run with the extension loaded in the same Firefox instance controlled by `firefox-devtools`.

### Initial setup

- `npm run mcp:setup`

### Mode switch

- Headless: `npm run mcp:headless`
- Headful: `npm run mcp:headful`

### Runtime maintenance

- Reset stale runtime processes: `npm run mcp:reset`
- Environment diagnostics: `npm run mcp:env-check`
- Consolidated health report: `npm run mcp:doctor`

### Mandatory MCP + extension flow

1. Switch MCP to normal/headful mode:
   - `npm run mcp:headful`
2. Restart Codex CLI.
3. In the MCP Firefox window, open:
   - `about:debugging#/runtime/this-firefox`
4. Load temporary add-on:
   - **Load Temporary Add-on...** -> `<repo>/manifest.json`
5. Confirm extension is listed:
   - `firefox-extension-steam-wishlist-manager`

Important:
- `npm run dev:steam` is still valid for extension-only development in profile `steam-dev`.
- It is not the MCP runtime browser/profile, so do not use it as substitute for MCP validation.

For full operational details and troubleshooting, see:
- `docs/ops/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/ops/OPERATIONS.md`
