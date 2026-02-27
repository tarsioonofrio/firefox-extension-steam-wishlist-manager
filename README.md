# Steam Wishlist Manager (Firefox)

Firefox extension to organize Steam wishlist games into custom local collections with independent ordering and filters.

## What This Extension Is For

If your Steam wishlist is very large, it becomes hard to track what is truly important.  
This extension helps you turn one huge wishlist into manageable views:

- Static collections: you manually pick games (for example: `Hype`, `Buy Soon`, `Indie Support`).
- Dynamic collections: saved views generated from current sort + filters.
- Fast filtering and sorting on a dedicated collections page.

Main goal: make prioritization practical without changing your Steam account data.

## What It Does (User View)

- Opens a dedicated **Collections** page from the extension icon.
- Reads your wishlist rank from Steam API (`Your rank`), and enriches game metadata locally.
- Lets you add/remove a game to/from static collections from card and line views.
- Supports batch add/remove for multiple visible games.
- Supports batch triage actions (`Promote`, `Track`, `Bought`, `Mute`, `Unmute`).
- Keyboard shortcuts:
  - Navigation: `j` / `k`
  - Triage focused item: `1` Track, `2` Maybe, `3` Buy, `4` Archive
  - Batch triage on selected items: `Shift+1` Promote, `Shift+2` Track, `Shift+3` Bought, `Shift+4` Mute, `Shift+5` Unmute
- When Batch mode is active, a top hint shows available batch shortcuts and selected count.
- Supports saved dynamic collections based on current filters/sort.
- Includes triage workflow (`Promote`, `Track`, `Bought`) with local mute/unmute.
- Adds virtual views (`Inbox`, `Track`, `Buy radar`, `Archive`, `Owned`) and Track time window (`7d`, `30d`, `all`).
- Supports per-game target price and filter for games at/under target.
- Highlights cards/rows when current price hits target.
- Supports local per-game notes (saved in browser storage); search matches title, appid, and notes.
- Keeps all collection data local in your browser profile.

## What It Does Not Do

- It does not rewrite Steam server-side wishlist order.
- It does not send your custom collections to Steam.
- It does not perform automated account actions.

## Core Behavior

- Collection data is local-only (`browser.storage.local`).
- The extension does **not** modify Steam server-side wishlist ordering.
- Primary rank source ("Your rank"):
  - `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid={steamId}`
  - Uses `appid`, `priority`, `date_added`.
- `date_added` is used in card line `Wishlist: ...`.

## Data Sources

Primary:
- `IWishlistService/GetWishlist/v1` for wishlist rank/base snapshot.

Secondary/metadata (optional):
- `dynamicstore/userdata` for account context and wishlist membership checks.
- `wishlistdata/?p={page}` when available for batch metadata.
- `api/appdetails` and `appreviews` fallback for per-item enrichment.

Notes:
- `wishlistdata` and `dynamicstore/userdata` are internal Store endpoints and may be rate-limited/blocked.
- Rank ordering should remain available from `GetWishlist/v1` even when metadata endpoints fail.

## Development

- Install: `npm install`
- Dev (auto-reload): `npm run dev`
- Build package: `npm run build`
- Start MCP server (local JSON DB): `npm run mcp:server`
- MCP direct CLI (debug/easier local use):
  - `node mcp/server.mjs --list-tools`
  - `node mcp/server.mjs --run-tool swm_get_sync_status '{}'`
- Install Firefox Native Messaging bridge host:
  - `npm run native:host:install`
  - `npm run native:host:ping` (self-test)
  - Why the host manifest is required:
    - Firefox only allows Native Messaging to hosts explicitly registered in `~/.mozilla/native-messaging-hosts/*.json`.
    - The manifest also restricts which extension ID can talk to the host (`allowed_extensions`).
- Validate manifest: `npm run check:manifest`
- Logic smoke test: `npm run test:logic`

Manual load alternative:
- `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...** -> `manifest.json`

## Collections Page Architecture

`src/pages/collections.js` is primarily an orchestrator. Core logic is split into focused modules:

- `steam-fetch.js`: retry/backoff wrappers for Steam requests.
- `wishlist-rank.js`: rank normalization and readiness checks from `GetWishlist/v1`.
- `wishlist-sort.js`: sorting strategies (`position`, `title`, `price`, etc.).
- `meta-parsers.js`: metadata parsing helpers (type, languages, price text).
- `collections-filters.js`: filter predicates plus filtered/sorted list assembly.
- `collections-ui-controls.js`: renderers for collection selector, sort menu, pager.
- `collections-panels.js`: dropdown/panel toggle and outside-click close behavior.
- `collections-range-controls.js`: rating/review/discount/price control rendering and bindings.
- `collections-filter-state.js`: reset/clear helpers for filter UI state.
- `collections-actions.js`: pure transition rules for source/sort selection.
- `collections-crud.js`: create/rename/delete collection flows.
- `collections-init.js`: page bootstrap/initialization sequence.
- `collections-selection-bindings.js`: source/sort selector event bindings.
- `collections-general-bindings.js`: search, pagination, textual filter, refresh bindings.
- `collections-menu-bindings.js`: collection menu and form submit bindings.
- `collections-card-render.js`: card node creation, static render, card actions, async hydration.

Script load order is declared at the bottom of `src/pages/collections.html`.

## Usage

1. Click extension icon -> `Open Collections Page`.
2. Select `Steam wishlist` or a custom collection.
3. Use search, sort, filters, and pagination.
4. Add/remove collection items from Steam app pages (where enabled).

## MCP Server (Initial)

This repository now includes an initial MCP server implementation at:
- `mcp/server.mjs`

Persistence:
- Local JSON DB (default): `/tmp/steam-wishlist-manager-mcp-state.json`
  (override with `SWM_MCP_DB_PATH`)
- Override path with env var: `SWM_MCP_DB_PATH=/path/to/state.json`

Available tools (v0.2):
- `swm_list_collections`
- `swm_create_static_collection`
- `swm_create_or_update_dynamic_collection`
- `swm_add_item_to_collection`
- `swm_remove_item_from_collection`
- `swm_get_collection_items`
- `swm_import_extension_backup_json`
- `swm_import_extension_backup_file`
- `swm_sync_extension_state_incremental`
- `swm_query_games_with_codex`
- `swm_refresh_wishlist_rank`
- `swm_refresh_wishlist_data`
- `swm_refresh_appdetails`
- `swm_refresh_frequencies`
- `swm_get_sync_status`
- `swm_get_wishlist_snapshot`
- `swm_refresh_all`
- `swm_refresh_all_resume`
- `swm_refresh_all_status_verbose`

Notes:
- This is an initial MCP layer to start external automation/workflows.
- It currently uses its own local DB and supports bridge import from extension backup JSON.
- Refresh tools prioritize extension-exported caches (`steamWishlistAddedMapV3`, meta/filter caches) before any direct Steam request.
- Native bridge mode:
  - Extension publishes local storage snapshot via Native Messaging.
  - Default path: `/tmp/steam-wishlist-manager-extension-bridge-snapshot.json`
    (override with `SWM_NATIVE_BRIDGE_SNAPSHOT_PATH`).
  - MCP auto-hydrates from this snapshot before tool execution.
- For best results:
  - Export backup from Configurations page.
  - Import with `swm_import_extension_backup_file` (`mode=replace` first sync).
  - Use `swm_sync_extension_state_incremental` for upsert/incremental updates.

Codex query setup:
- Set API key before starting MCP server:
  - `export OPENAI_API_KEY=...`
- Optional model override:
  - `export SWM_CODEX_MODEL=gpt-5.1-codex-mini`
- Then use `swm_query_games_with_codex` with:
  - `query`: natural-language request (for example: `jogos coop com desconto e boa review`)
  - `limit`: max results

Expected output:
- `appIds`: selected games from local catalog only.
- `suggestedCollectionName`: short suggested collection name.
- `reason`: short explanation.

## Security / Compliance

- Keep request volume conservative (cache first, avoid bursts).
- Do not automate bulk account actions.
- Prefer official/public API surfaces when possible.
- Follow Steam Subscriber Agreement:
  - `https://store.steampowered.com/subscriber_agreement/`

## Known Limitations

- Store internal endpoints may change without notice.
- Metadata enrichment can be partial under temporary blocking (`403/429`).
- Storage is profile-local unless export/sync is added.

## Smoke Checklist (Post-Refactor)

1. Open collections page from extension popup.
2. Switch source between `Steam wishlist` and a custom collection.
3. Validate sort menu for `Your rank`, `Title`, `Price`, `Discount`.
4. Exercise filters: tags, rating/reviews, price/discount, release year.
5. Create, rename, and delete a collection from menu actions.
6. Refresh one card and refresh page data.
