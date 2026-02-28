# Operations

Operational runbook for common local and integration issues.

## Local Git Workflow Issues

### `index.lock` blocks commit/stage

Symptoms:
- `Unable to create '.git/index.lock': File exists`

Recovery:
1. Check active Git processes:
   - `pgrep -fa git`
2. If no active Git process is operating on the repository:
   - `rm -f .git/index.lock`
3. Retry `git add` / `git commit`.
4. If lock reappears immediately, stop and close competing editor/terminal operations first.

## Dev Environment Validation

- Run: `npm run check:env`
- Validates:
  - core commands (`node`, `npm`, `npx`, `firefox`),
  - Firefox `profiles.ini`,
  - selected dev profile presence,
  - local `web-ext` availability.

## Extension Dev Runtime

- Default profile: `npm run dev`
- Steam profile: `npm run dev:steam`
- Steam profile without launching extra window: `npm run dev:steam:no-launch`

## Firefox DevTools MCP Issues

First-line actions:
1. `npm run mcp:doctor`
2. `npm run mcp:reset`
3. Reapply mode:
   - `npm run mcp:headless` or `npm run mcp:headful`
4. Restart Codex CLI.

If headful window fails to open:
- `npm run mcp:env-check`

Canonical MCP troubleshooting:
- `docs/ops/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`

## Steam Endpoint Instability

Guidelines:
- Treat `403/429` and transient failures as expected operational events.
- Keep local state authoritative for user intent.
- Prefer retries with backoff/cooldown behavior implemented in fetch wrappers.
- Use fallback/manual navigation when automation is unreliable.

Expected behavior during failures:
- No local-state corruption.
- Actions remain resumable.
- Status/error messaging remains visible to user.
