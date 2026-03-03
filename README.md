# Steam Wishlist Manager (Firefox)

Firefox extension to organize Steam wishlist games into custom local collections with independent ordering and filters.

## What This Extension Is For

If your Steam wishlist is very large, it becomes hard to track what is truly important.  
This extension helps you turn one huge wishlist into manageable views:

- Static collections: you manually pick games (for example: `Hype`, `Buy Soon`, `Indie Support`).
- Dynamic collections: saved views generated from current sort + filters.
- Fast filtering and sorting on a dedicated collections page.

Main goal: make prioritization practical while keeping local intent as the source of truth.

## What It Does (User View)

- Opens a dedicated **Collections** page from the extension icon.
- Opens a dedicated **Discover Queue** page from the extension icon (one game at a time workflow).
- Opens a dedicated **Feed / Acompanhar** page from the extension icon.
- Reads your wishlist rank from Steam API (`Your rank`), and enriches game metadata locally.
- Lets you add/remove a game to/from static collections from card and line views.
- Supports batch add/remove for multiple visible games.
- Supports batch triage actions (`Confirmed`, `Maybe`, `Follow`, `Mute`, `Unmute`).
- Keyboard shortcuts:
  - Navigation: `j` / `k`
  - Triage focused item: `1` Follow toggle, `2` Maybe, `3` Confirmed, `4` Archive
  - Batch triage on selected items: `Shift+1` Confirmed, `Shift+2` Maybe, `Shift+3` Follow, `Shift+4` Mute, `Shift+5` Unmute
- When Batch mode is active, a top hint shows available batch shortcuts and selected count.
- Supports saved dynamic collections based on current filters/sort.
- Includes independent intent workflow (`Confirmed`, `Maybe`, `Follow`, `Archive`) with local mute/unmute.
- Collections top selectors now separate concerns:
  - Collection selector shows `Wishlist (all games)` plus user collections.
  - State selector shows state counts in parentheses.
- Track feed is available in a dedicated page (`Feed / Acompanhar`) focused on tracked games.
- Supports per-game target price and filter for games at/under target.
- Highlights cards/rows when current price hits target.
- Media tooltips (Wishlist + Collections) auto-play videos sequentially and loop.
- Keeps all collection data local in your browser profile.

## User Screens and Features

This section is the user-facing map of current screens and capabilities.

### Extension Popup

- Opens key pages quickly: `Collections`, `Discover Queue`, `Feed / Acompanhar`, and `Configurations`.
- Acts as the main entry point while browsing Steam pages.

### Discover Queue Page

- Shows one game at a time in a triage flow.
- Includes media controls (videos/screenshots with previous/next navigation).
- Shows card-style metadata (price, discount, reviews, release, tags) and quick actions (`Confirm`, `Maybe`, `Follow`, `Archive`, target price).

### Collections Page

- Main workspace for triage and organization of large wishlists.
- Supports static collections (manual) and dynamic collections (saved filters + sort).
- Supports independent intent actions per game: `Confirmed`, `Maybe`, `Follow`, `Archive`.
- Supports mute/unmute, target price, and batch actions.
- Includes sorting, rich filters, pagination, and card/line style workflows.
- Right filters column is resizable and can be fully hidden/shown.

### Feed / Acompanhar Page

- Focused stream for tracked games and updates/news-related signals.
- Supports filtering and quick intent actions without leaving the feed workflow.

### Wishlist Page Integration (`store.steampowered.com/wishlist/...`)

- Adds extension controls to wishlist cards for faster actions.
- Adds filter UX through extension sidebar and wishlist integration points.
- Media tooltip previews now auto-advance to the next video and loop continuously across all available videos.
- Uses URL-based filters when possible (`tagids`, `sort`, etc.) and internal Steam
  service integration for advanced option filters where applicable.

### Configurations and Backup

- Allows export/import style flows for local state continuity.
- Supports diagnostics and operational checks used for troubleshooting.

### Data and Safety Behavior

- Local state is stored in browser local storage.
- Steam-side actions (for example wishlist/follow intents) are user-triggered and best-effort; they degrade gracefully when endpoints are unstable.
- Existing local intent state remains consistent even when Steam write operations fail.

## What It Does Not Do

- It does not run unattended or bulk account automation.
- It does not send your custom collections to Steam.
- It does not force server-side writes without user-triggered actions.

## States / Buckets Semantics

- `Inbox`:
  - Default triage state (no strong decision yet).
  - If you do nothing, it stays in Inbox and remains available for later triage.
- `Maybe` (`buy=1`, bucket `MAYBE`):
  - Marks a possible purchase candidate.
  - If you do nothing, it stays in Maybe; no automatic promotion or archive happens.
- `Confirmed` (`buy=2`, bucket `BUY`):
  - Marks confirmed purchase intent and keeps the game in active buy radar.
  - In practice, this confirms the game should remain in your Steam wishlist until you intentionally change state (for example to Archive/owned).
- `Follow` (`track=1`):
  - Enables tracking/news intent independently from buy intent.
  - If you do nothing, tracking stays enabled; it does not clear `Maybe`/`Confirmed`.
- `Archive` (`owned=true`, `track=0`, `buy=0`, bucket `ARCHIVE`):
  - Moves the game out of active triage/radar as done/owned.
  - If you do nothing, it stays archived.
- `Mute`:
  - Local visibility control only (not a bucket); used to hide noise in feed/list views.
  - It does not change `buy`, `track`, or `owned`.

## Queue Automation (Time-Based Rules)

Queue Automation is configured in **Configurations**:
- `Save Queue Timeouts`: saves timeout policy in days (`Inbox`, `Maybe`, `Archive`).
- `Run Queue Automation Now`: executes the sweep immediately (manual run with force).

Current automated transitions:
- `Inbox` (Steam-only signal: wishlisted, not followed, bucket `INBOX`, `buy=0`):
  - when due, removes wishlist and enables follow (`TRACK`).
- `Maybe`:
  - when due, clears to `INBOX` and removes both wishlist and follow.
- `Archive`:
  - when due *and* without recent activity/promotion signal, clears to `INBOX` and removes wishlist/follow.

Notes:
- These are Queue Automation rules, not baseline bucket behavior.
- Without a queue run (manual or scheduled), states remain as-is.

## Core Behavior

- Collection data is local-only (`browser.storage.local`).
- The extension can apply user-triggered Steam writes (for example wishlist/follow add or remove) on a best-effort basis.
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

## Wishlist URL Inputs (Non-Official Reference)

The section below documents what is publicly observable in
`https://store.steampowered.com/wishlist/profiles/*/` as URL input
(path + query string), without claiming official Valve support.

### Endpoint

`GET /wishlist/profiles/{steamid64}/`

Description:
- Renders the HTML wishlist page for a user.

Path parameter:
- `steamid64` (`string`/integer): SteamID64 of the profile (for example: `7656119...`).

### Query parameters (observed support)

#### `sort`

Controls the "Sort by" mode. Observed values:

- `sort=discount` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198095235304/?sort=discount&utm_source=chatgpt.com))
- `sort=price` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561199083473026/?sort=price&utm_source=chatgpt.com))
- `sort=name` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198366875031/?sort=name&utm_source=chatgpt.com))
- `sort=dateadded` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198045286731/?sort=dateadded&utm_source=chatgpt.com))
- `sort=topsellers` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561199831289568/?l=koreana&snr=1_25_4__globalheader&sort=topsellers&utm_source=chatgpt.com))
- `sort=releasedate` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198845968628/?sort=releasedate&utm_source=chatgpt.com))
- `sort=reviews` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561197989342514/?sort=reviews&utm_source=chatgpt.com))

Default behavior (without `sort`):
- UI shows `Sort by: Ranked Order` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561197961826099/?utm_source=chatgpt.com))

#### `min_discount`

Applies minimum discount filter (`Discount` menu).

Observed/supported values:
- `min_discount=any` (`All with discount`) ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198964535546/?min_discount=any&utm_source=chatgpt.com))

Notes:
- UI also exposes `50% or more` and `75% or more` tiers
  ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198865858080/?type_filters=games)).
- Public indexed URLs clearly confirm `any`; other tiers are treated as observed UI capability.

#### `type_filters`

Applies `Type` menu filter.

Observed/supported values:
- `type_filters=games` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198865858080/?type_filters=games))

Notes:
- UI also shows `Software` and `DLC`
  ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198865858080/?type_filters=games)).
- Strictly from public URL evidence, `games` is the confirmed value.

#### `l`

Steam Store UI language parameter.

Examples:
- `l=brazilian` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198211102183/?l=brazilian&snr=1_25_4__globalheader&sort=price&utm_source=chatgpt.com))
- `l=english` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198331600557/?l=english&utm_source=chatgpt.com))

#### `snr`

Steam Store referral/tracking parameter.

Notes:
- Not a wishlist filter.
- Commonly appears with `l=...` ([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198211102183/?l=brazilian&snr=1_25_4__globalheader&sort=price&utm_source=chatgpt.com)).

### Examples

```text
# Sort by discount
https://store.steampowered.com/wishlist/profiles/{steamid64}/?sort=discount
```

```text
# Any discount only, sorted by price
https://store.steampowered.com/wishlist/profiles/{steamid64}/?min_discount=any&sort=price
```

```text
# Games only, sorted by reviews
https://store.steampowered.com/wishlist/profiles/{steamid64}/?type_filters=games&sort=reviews
```

```text
# Force UI language (pt-BR)
https://store.steampowered.com/wishlist/profiles/{steamid64}/?l=brazilian
```

### Important note about `Options` menu

Although UI exposes `Platform`, `Price`, `Exclude`, and `Deck Compatibility`
([Steam Store](https://store.steampowered.com/wishlist/profiles/76561198865858080/?type_filters=games)),
there are no consistently documentable public query params for those filters in
`/wishlist/profiles/.../`. In many cases, those states are client-side
(local state/cookies/scripts) and do not map to simple query parameters.

### `input_protobuf_encoded` and internal wishlist service

Observed behavior in live tests:

- Changing `Platform` triggers a `fetch` to:
  - `https://api.steampowered.com/IWishlistService/GetWishlistSortedFiltered/v1`
- Changing `Deck Compatibility` triggers the same endpoint.
- Changing `Exclude` triggers the same endpoint.
- In all cases, filters were sent through:
  - `input_protobuf_encoded=<base64-protobuf-payload>`
- Page URL did not change (`search`/`hash` stayed empty) and no relevant
  `localStorage` changes were detected during these interactions.

Implementation guidance:

- Treat protobuf payload integration as non-official and version-sensitive.
- Keep a local fallback filter path so UX remains functional if Steam changes
  payload fields or endpoint behavior.

## Development

- Install: `npm install`
- Check local environment: `npm run check:env`
- Dev (auto-reload): `npm run dev`
- Dev (steam profile auto-detected): `npm run dev:steam`
- Dev (steam profile fresh restart): `npm run dev:steam:fresh`
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
- Centralized developer workflows:
  - `docs/dev/DEV_WORKFLOWS.md`

Manual load alternative:
- `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...** -> `manifest.json`

### Dev Profile Workflow (`steam-dev`)

Use this flow when you need the extension in the dedicated Steam-logged developer profile.

1. Run the one-command workflow:
   - `npm run dev:steam`
2. Confirm profile name/path (if needed for troubleshooting):
   - `cat ~/.mozilla/firefox/profiles.ini`
   - Expected profile entry:
     - `Name=steam-dev`
     - `Path=<varies-per-machine>`
3. Verify:
   - Open `about:debugging#/runtime/this-firefox`
   - Check `firefox-extension-steam-wishlist-manager` is listed

Notes:
- Keep `web-ext run` process alive while testing (it handles reload on source changes).
- Script used by `npm run dev:steam`: `scripts/dev/run-web-ext-steam-dev.sh`.
- If you suspect stale extension code, use:
  - `npm run dev:steam:fresh`
  - This command stops previous `web-ext` and Firefox `steam-dev` processes, then starts a clean session.
- Override profile name when needed:
  - `SWM_FIREFOX_PROFILE_NAME=another-profile npm run dev:steam`
- To verify reload on wishlist pages, open browser console and check:
  - `[SWM][wishlist] runtime boot=<id> at=<timestamp> version=<manifestVersion>`
  - `boot=<id>` must change after a full fresh restart.

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
2. In **Collection**, choose `Wishlist (all games)` or a custom collection.
3. In **State**, choose the intent slice (`All states`, `Inbox`, `Follow`, `Maybe`, `Confirmed`, `Archive`) with live counts.
4. Use search, sort, filters, and pagination.
5. Add/remove collection items from Steam app pages (where enabled).

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
2. Switch source between `Wishlist (all games)` and a custom collection.
3. Validate sort menu for `Your rank`, `Title`, `Price`, `Discount`.
4. Validate State selector counts and labels (`Follow`, `Confirmed`).
5. Exercise filters: tags, rating/reviews, price/discount, release year.
6. Resize and hide/show the right filters sidebar.
7. Create, rename, and delete a collection from menu actions.
8. Refresh one card and refresh page data.

Automated smoke coverage:
- `test:logic`: rank/sort/filter/actions + fetch telemetry sanity.
- `test:ui`: selector/menu/range/general bindings.
- `test:e2e`: collection load, source switch, reorder, batch add/remove, wishlist discount filter, dynamic update flow.

## Firefox DevTools MCP (Operational)

Complete process mapping, troubleshooting, and automation scripts are documented in:
- `docs/ops/FIREFOX_DEVTOOLS_MCP_RUNBOOK.md`
- `docs/dev/DEV_WORKFLOWS.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/ops/OPERATIONS.md`

### Required in This Repository: MCP Firefox With Extension Loaded

For this repository, when using Firefox DevTools MCP, always use the Firefox instance started by MCP with this extension loaded in that same instance.

Required flow:
1. Set MCP to normal window mode:
   - `npm run mcp:headful`
2. Restart Codex CLI (required after MCP mode/config changes).
3. Open the MCP Firefox window and go to:
   - `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on...** and select:
   - `<repo>/manifest.json`
5. Verify `firefox-extension-steam-wishlist-manager` appears in **This Firefox**.

Important:
- `npm run dev:steam` uses profile `steam-dev` and is a separate workflow from MCP.
- Loading the extension in `steam-dev` does not load it in the MCP runtime profile (`/tmp/firefox-devtools-mcp-profile`).

Automation scripts:
- `bash scripts/mcp/setup-firefox-devtools-mcp.sh`
- `bash scripts/mcp/use-firefox-devtools-mcp-headless.sh`
- `bash scripts/mcp/use-firefox-devtools-mcp-headful.sh`
- `bash scripts/mcp/reset-firefox-devtools-mcp-runtime.sh`
- `bash scripts/mcp/doctor-firefox-devtools-mcp.sh`
- `bash scripts/mcp/firefox-devtools-mcp-env-check.sh`

Recommended flow:
1. Run setup script.
2. Choose mode (`headless` or `headful`).
3. Reset stale processes.
4. Restart Codex CLI.
5. Validate with `mcp__firefox-devtools__list_pages`.
6. Monitor `/tmp/firefox-devtools-mcp.stderr.log`.
7. If headful window does not open, run env check:
   - `bash scripts/mcp/firefox-devtools-mcp-env-check.sh`
