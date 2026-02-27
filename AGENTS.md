# Repository Guidelines

## Product Direction (Current)
Steam Wishlist Manager exists to turn very large wishlists into an actionable workflow.

Core goal:
- Keep discovery and support signals without forcing a binary decision.

Non-negotiable UX:
- Two independent axes per game: `Track` and `Buy`.
- Fast triage with minimal clicks.
- Graceful degradation: if a Steam action is unreliable, open the correct Steam page and keep local state consistent.

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
- "Bought/Owned" flow to archive.

## Architecture Rules
- Keep `src/pages/collections.js` as orchestrator.
- Put business logic into focused modules under `src/pages/`.
- Separate concerns:
  - Sync/parsing
  - Local state
  - Rendering/UI actions
- Prefer resilient adapters around Steam endpoints.

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
