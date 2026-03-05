# Repository Guidelines

## Product Direction (Current)
Steam Wishlist Manager exists to turn very large wishlists into an actionable workflow.

Core goal:
- Keep discovery and support signals without forcing a binary decision.

Non-negotiable UX:
- Two independent axes per game: `Track` and `Buy`.
- Fast triage with minimal clicks.
- Graceful degradation: if a Steam action is unreliable, open the correct Steam page and keep local state consistent.

## Collections Contract (Do Not Break)
Keep the current `Collections` UI, labels, and behavior exactly as-is.

Required action semantics:
- `Buy`: `buy=2`, `bucket=BUY`.
- `Maybe`: `buy=1`, `bucket=MAYBE`.
- `Track`: toggle `track` independently (`track=1/0`), without changing `buy`.
- `Mute`: toggle local mute only (no Steam-side mutation).
- `Archive`: `owned=true`, `track=0`, `buy=0`, `bucket=ARCHIVE`.

Do not:
- Rename or repurpose existing buttons.
- Change current layout/flow in `Collections`.
- Change existing filter semantics (`Hide muted`, `At/under target`, etc.).
- Reintroduce `Promote`.

When adding features:
- Add them as optional pages/areas (for example, dedicated feed page), not as disruptive replacements.
- Preserve local-state consistency even when Steam integrations fail.
- Use assisted fallback (open Steam page for manual action) where automation is unreliable.
- Keep bucket/view classification derived from local intent state (`track`, `buy`, `owned`).

Acceptance criteria:
- Existing `Collections` workflow remains unchanged for current users.
- New features are additive and optional.
- `Mute` remains local.
- `Track` never clears `buy`.
- Failures in Steam integrations never break local state.

## Steam Feature Strategy
Use Steam resources as separate signals:
- Wishlist: purchase intent and discount signal.
- Follow: update/news intent.
- News Hub / My Games feed: tracking stream.
- Ignore and Store Preferences: noise reduction.
- Mute in feed: local mute is acceptable if remote mute is unstable.

Integration posture:
- Best effort for unstable/internal endpoints.
- Cache first, backoff on failures, avoid burst traffic.
- No credential storage; rely on browser session.

## Canonical Model
Primary unit: Game Entry (`appid` + local state).

Required fields:
- Identity: `appid`.
- Metadata cache: title, capsule/header, tags, release status.
- Steam-observed relations where available: wishlisted, followed, ignored.
- Local user state: bucket, track, buy, notes, target price, labels.
- Local signals: last seen news, last known discount, last review snapshot.

## MVP Delivery Plan
### Milestone 1: Base + Persistence + Wishlist Import
- Robust import and local persistence.
- Searchable list view.

### Milestone 2: Inbox/Triage + Classification
- Fast state transitions: Buy / Maybe / Track / Archive.
- Add high-impact actions:
  - Convert to Track (without losing item).
  - Promote to Buy.

### Milestone 3: Track Feed
- Feed/news sync with dedupe and cache.
- Last 7/30 day filters.
- Local mute and hide-muted filter.

### Milestone 4: Buy Radar
- Target price per game.
- "Reached target" and discount-aware ordering.
- Archive/owned flow out of active radar.

## Architecture Rules
- Keep `src/pages/collections.js` as orchestrator.
- Put business logic into focused modules under `src/pages/`.
- Separate concerns:
  - Sync/parsing
  - Local state
  - Rendering/UI actions
- Prefer resilient adapters around Steam endpoints.
- Keep range/filter interaction behavior shared between `Collections` and `Queue`; avoid duplicating slider/filter mechanics across pages.
- When fixing dual-range behavior (rating/discount/release year), update shared modules first, then page adapters.

## Shared Range/Filter Pattern
- Canonical dual-range interaction module: `src/pages/shared-range-controls.js`.
- `Collections` adapter: `src/pages/collections-range-controls.js`.
- `Queue` adapter/bindings: `src/pages/queue-run.js`.
- Canonical filtering engine: `src/pages/collections-filters.js` (reused by `Collections` and `Queue`).
- Rule: new fixes for range pointer/z-index/handle selection must land in shared logic before page-specific overrides.
- Rule: page-specific CSS may differ visually, but slider interaction semantics must stay equivalent in `Collections` and `Queue`.

## Performance and Reliability
- Must handle ~2000 items smoothly.
- Use virtualization/pagination or equivalent rendering strategy.
- Network failures must not corrupt local state.
- Sync operations must be resumable and status-visible.

## Commit and PR Standards
- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`).
- Small, focused commits.
- PR must include:
  - behavior summary,
  - test evidence,
  - screenshots/videos for UI changes,
  - noted risks/fallback behavior.

## External Baseline
Reference architecture and patterns from local SteamDB extension clone:
- `../BrowserExtension`

Use it for structure and resilience patterns when there is no strong reason to diverge.

## MCP and Native Bridge Notes
- MCP state DB default: `/tmp/steam-wishlist-manager-mcp-state.json`.
- Native bridge snapshot default: `/tmp/steam-wishlist-manager-extension-bridge-snapshot.json`.
- MCP should prioritize extension-origin local data.
- Non-update MCP queries should read local cache/DB, not call Steam directly.

## Firefox MCP Runbook
For Firefox DevTools MCP setup/troubleshooting, use:
- `docs/ops/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`

Automation scripts:
- `scripts/mcp/setup-firefox-devtools-mcp.sh`
- `scripts/mcp/use-firefox-devtools-mcp-headless.sh`
- `scripts/mcp/use-firefox-devtools-mcp-headful.sh`
- `scripts/mcp/reset-firefox-devtools-mcp-runtime.sh`
- `scripts/mcp/doctor-firefox-devtools-mcp.sh`

When MCP transport issues occur, prefer runbook flow over ad-hoc retries.

## Firefox Launch Rule (Repository Default)
- In this repository, always launch Firefox with the extension loaded.
- Default command: `npm run dev`
- Default launcher script: `scripts/dev/start-firefox-with-extension.sh`
- Under the hood this uses `scripts/dev/run-web-ext-steam-dev.sh` (profile `steam-dev`).
- Do not launch plain `firefox` as the default workflow, because it starts without the temporary add-on.

## README User Docs Rule
- Keep the user-facing section `User Screens and Features` in `README.md` always updated.
- Any change in page layout, screen names, entry points, or user-visible behavior must update this section in the same workstream/PR.
- Do not ship user-facing UI/flow changes without reflecting them in that README section.
- Any user-visible filter/range behavior change in `Collections` or `Queue` must document parity expectations between both pages.
