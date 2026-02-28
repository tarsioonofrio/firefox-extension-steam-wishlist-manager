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
- Opens a dedicated **Feed / Acompanhar** page from the extension icon.
- Reads your wishlist rank from Steam API (`Your rank`), and enriches game metadata locally.
- Lets you add/remove a game to/from static collections from card and line views.
- Supports batch add/remove for multiple visible games.
- Supports batch triage actions (`Buy`, `Maybe`, `Track`, `Mute`, `Unmute`).
- Keyboard shortcuts:
  - Navigation: `j` / `k`
  - Triage focused item: `1` Track toggle, `2` Maybe, `3` Buy, `4` Archive
  - Batch triage on selected items: `Shift+1` Buy, `Shift+2` Maybe, `Shift+3` Track, `Shift+4` Mute, `Shift+5` Unmute
- When Batch mode is active, a top hint shows available batch shortcuts and selected count.
- Supports saved dynamic collections based on current filters/sort.
- Includes independent intent workflow (`Buy`, `Maybe`, `Track`, `Archive`) with local mute/unmute.
- Adds virtual views (`Inbox`, `Track`, `Buy radar`, `Archive`, `Owned`) in Collections.
- Track feed is available in a dedicated page (`Feed / Acompanhar`) focused on tracked games.
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
- UI binding smoke test: `npm run test:ui`
- End-to-end smoke test (collections page jsdom): `npm run test:e2e`
- Full test suite: `npm test`

Manual load alternative:
- `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...** -> `manifest.json`

### Dev Profile Workflow (`steam-dev`)

Use this flow when you need the extension in the dedicated Steam-logged developer profile.

1. Confirm profile name/path:
   - `cat ~/.mozilla/firefox/profiles.ini`
   - Expected profile entry:
     - `Name=steam-dev`
     - `Path=39ophcv1.steam-dev` (path can vary per machine)
2. Open Firefox with that profile as a separate instance:
   - `firefox --new-instance -P steam-dev --no-remote about:blank`
3. Load this extension as a temporary add-on into that same profile:
   - `npx web-ext run --source-dir . --target=firefox-desktop --firefox-profile ~/.mozilla/firefox/39ophcv1.steam-dev --keep-profile-changes`
4. Verify:
   - Open `about:debugging#/runtime/this-firefox`
   - Check `firefox-extension-steam-wishlist-manager` is listed

Notes:
- Keep `web-ext run` process alive while testing (it handles reload on source changes).
- If your profile directory is different, replace `39ophcv1.steam-dev` with your actual path from `profiles.ini`.

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

## Dynamic Collections UX

- `Menu -> New/Update dynamic` now shows a live preview before saving:
  - base source,
  - current sort mode,
  - number of active filters.
- If saving over an existing dynamic collection:
  - no-op if definition is unchanged,
  - otherwise explicit confirmation with old vs new base/sort/filter count.
- If a static collection uses the same name, save is blocked with a clear message.

## Sync Hardening

- Steam fetch wrapper now tracks endpoint telemetry locally:
  - requests/success/fail/retries,
  - throttling events (`403/429`),
  - cooldown remaining.
- Adaptive cooldown is applied on repeated throttling to reduce burst retries.
- Error status line includes a short network summary (`net ...`) to explain request state quickly.

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

Automated smoke coverage:
- `test:logic`: rank/sort/filter/actions + fetch telemetry sanity.
- `test:ui`: selector/menu/range/general bindings.
- `test:e2e`: collection load, source switch, reorder, batch add/remove, wishlist discount filter, dynamic update flow.

## Firefox DevTools MCP (Operational)

Complete process mapping, troubleshooting, and automation scripts are documented in:
- `docs/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`

Automation scripts:
- `bash scripts/setup-firefox-devtools-mcp.sh`
- `bash scripts/use-firefox-devtools-mcp-headless.sh`
- `bash scripts/use-firefox-devtools-mcp-headful.sh`
- `bash scripts/reset-firefox-devtools-mcp-runtime.sh`
- `bash scripts/doctor-firefox-devtools-mcp.sh`
- `bash scripts/firefox-devtools-mcp-env-check.sh`

Recommended flow:
1. Run setup script.
2. Choose mode (`headless` or `headful`).
3. Reset stale processes.
4. Restart Codex CLI.
5. Validate with `mcp__firefox-devtools__list_pages`.
6. Monitor `/tmp/firefox-devtools-mcp.stderr.log`.
7. If headful window does not open, run env check:
   - `bash scripts/firefox-devtools-mcp-env-check.sh`
