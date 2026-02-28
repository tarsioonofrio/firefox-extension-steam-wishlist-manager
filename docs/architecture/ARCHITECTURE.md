# Architecture

## High-Level Structure

- `src/popup/*`: browser action entrypoint and navigation actions.
- `src/background.js`: extension background orchestration.
- `src/content/*`: Steam page integrations (app and wishlist pages).
- `src/pages/*`: internal extension pages (`Collections`, `Feed`, `Configurations`).
- `mcp/*`: MCP server and native-bridge host runtime.
- `scripts/dev/*`, `scripts/mcp/*`, `scripts/native/*`: local operational automation.

## Collections Page Boundaries

`src/pages/collections.js` is the orchestrator and should remain the integration point for:
- lifecycle/bootstrap wiring,
- module coordination,
- state-to-UI flow.

Business logic stays in focused modules:
- Fetch/retry/cooldown: `steam-fetch.js`
- Rank ingestion/readiness: `wishlist-rank.js`
- Sorting: `wishlist-sort.js`
- Filter predicates and assembled lists: `collections-filters.js`
- Collection transitions and intent rules: `collections-actions.js`
- Collection CRUD flows: `collections-crud.js`
- Metadata parsing helpers: `meta-parsers.js`

UI wiring modules:
- Controls rendering: `collections-ui-controls.js`
- Panels/dropdowns behavior: `collections-panels.js`
- Range inputs and bindings: `collections-range-controls.js`
- Filter reset/clear state: `collections-filter-state.js`
- Selection bindings: `collections-selection-bindings.js`
- General bindings: `collections-general-bindings.js`
- Menu bindings: `collections-menu-bindings.js`
- Card rendering/hydration: `collections-card-render.js`
- Bootstrap sequence: `collections-init.js`

## Data and State Principles

- Treat local intent as canonical for view classification (`track`, `buy`, `owned`, `mute`).
- Keep Steam integration adapters resilient and best-effort.
- Preserve local state even when Steam requests fail.
- Prefer cache-first hydration when available.

## Operational Surfaces

- Native Messaging host: `mcp/native-bridge-host.mjs`
- MCP server: `mcp/server.mjs`
- Primary operations docs:
  - `docs/dev/DEV_WORKFLOWS.md`
  - `docs/ops/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`
  - `docs/ops/OPERATIONS.md`
