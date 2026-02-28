# Dev Workflows

Operational workflows for local development and MCP runtime management.

## Extension Development

### Default profile

- `npm run dev`

Runs `web-ext` against your default Firefox profile/session.

### Steam developer profile (`steam-dev`)

- `npm run dev:steam`

What it does:
1. Resolves the profile path from `~/.mozilla/firefox/profiles.ini`.
2. Opens Firefox as a separate instance with `--new-instance -P steam-dev --no-remote`.
3. Runs `web-ext` with `--firefox-profile <resolved-path>`.

Optional:
- Use a different profile name:
  - `SWM_FIREFOX_PROFILE_NAME=<profile-name> npm run dev:steam`
- Skip launching a new Firefox window:
  - `npm run dev:steam:no-launch`

## Firefox DevTools MCP

### Initial setup

- `npm run mcp:setup`

### Mode switch

- Headless: `npm run mcp:headless`
- Headful: `npm run mcp:headful`

### Runtime maintenance

- Reset stale runtime processes: `npm run mcp:reset`
- Environment diagnostics: `npm run mcp:env-check`
- Consolidated health report: `npm run mcp:doctor`

For full operational details and troubleshooting, see:
- `docs/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`

