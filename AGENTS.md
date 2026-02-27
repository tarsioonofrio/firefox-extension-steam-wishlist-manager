# Repository Guidelines

## Project Structure & Module Organization
- `manifest.json`: Firefox WebExtension manifest (MV3) with permissions and content script mappings.
- `src/background.js`: central state management (`browser.storage.local`) and message handlers.
- `src/content/app-page.js`: UI/actions on Steam app pages (`/app/...`) for collection assignment.
- `src/content/wishlist-page.js`: filtering and visual ordering logic on wishlist pages (`/wishlist/...`).
- `src/pages/collections.html|css|js`: dedicated collections management page and Steam-like card list.
- `src/pages/steam-fetch.js`: shared Steam fetch with retry/cooldown behavior.
- `src/pages/wishlist-rank.js`: wishlist rank normalization/readiness (`GetWishlist/v1`).
- `src/pages/wishlist-sort.js`: deterministic sort strategies for wishlist/collections.
- `src/pages/meta-parsers.js`: app metadata normalization/parsers.
- `src/pages/collections-filters.js`: filter engine and filtered/sorted list output.
- `src/pages/collections-ui-controls.js`: collection select/sort menu/pager rendering.
- `src/pages/collections-panels.js`: panel toggles and outside-click close behavior.
- `src/pages/collections-range-controls.js`: rating/review/discount/price range UI bindings.
- `src/pages/collections-filter-state.js`: filter reset and search input clear helpers.
- `src/pages/collections-actions.js`: source/sort transition rules.
- `src/pages/collections-crud.js`: create/rename/delete collection flows.
- `src/pages/collections-init.js`: bootstrap initializer for collections page.
- `src/pages/collections-selection-bindings.js`: collection and sort selector bindings.
- `src/pages/collections-general-bindings.js`: search/pagination/text-filter/refresh bindings.
- `src/pages/collections-menu-bindings.js`: collection menu/form bindings.
- `src/pages/collections-card-render.js`: card rendering/actions/hydration helpers.
- `src/popup/popup.html|css|js`: browser action popup that opens the collections page.
- `src/styles/content.css`: shared styles for injected UI.
- `README.md`: MVP usage notes and current limitations.
- `logs/`: local runtime logs; ignored in git.

### Collections Page Layering
- `collections.js` should stay as orchestrator/composition layer.
- Prefer placing new business logic in one of the focused modules above.
- When adding a new page module, register it in `collections.html` script order and document it in `README.md`.

## Build, Test, and Development Commands
This repository uses `web-ext` via npm scripts.

- `npm install`
- `npm run dev`
  - Runs extension in Firefox desktop with auto-reload.
- `npm run build`
  - Builds extension artifact in `web-ext-artifacts/`.
- `npm run check:manifest`
  - Validates `manifest.json` JSON syntax.
- `npm run test:logic`
  - Runs smoke checks for rank/sort/filter logic modules.
- `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...** -> select `manifest.json`.

## Coding Style & Naming Conventions
- JavaScript/CSS only; use 2-space indentation and semicolons.
- Prefer small, single-purpose functions and explicit guard clauses.
- Naming:
  - `camelCase` for variables/functions.
  - `UPPER_SNAKE_CASE` for constants (e.g., `STORAGE_KEY`).
  - Kebab-case filenames for content scripts (e.g., `wishlist-page.js`).
- Keep selectors and Steam DOM assumptions centralized and easy to update.

## Testing Guidelines
- Automated tests are not set up yet; rely on manual integration checks.
- Minimum manual checklist for each change:
  1. On a Steam app page, save game to an existing/new collection.
  2. Validate insertion at beginning/end.
  3. Confirm optional native wishlist click still works.
  4. On wishlist page, filter by collection and verify visual ordering.
  5. On collections page, verify source switch, sort, filters, CRUD menu, and refresh actions.
- If adding test infrastructure later, place tests under `tests/` with `*.test.js` naming.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`), consistent with existing history.
- Keep commits focused and atomic.
- PRs should include:
  - clear summary of behavior changes,
  - manual test evidence (steps + result),
  - screenshots/GIFs for UI changes,
  - linked issue when applicable.

## Security & Configuration Notes
- Do not expand `host_permissions` beyond required Steam routes.
- Do not commit personal Steam data or browser profile artifacts.
- Treat stored wishlist metadata as local user data; avoid unnecessary collection of fields.
- API/compliance posture:
  - Prefer official Steam Web API/documented endpoints whenever possible.
  - Keep request volume low (cache aggressively; avoid polling bursts and mass parallel requests).
  - Do not implement abusive automation (bulk account actions, bot-like behavior, bypassing auth flows).
  - Treat risk primarily as access throttling/integration breakage; still avoid patterns that could violate Steam terms.

## Wishlist Rank Strategy
- Source of truth for wishlist rank is `IWishlistService/GetWishlist/v1`.
- Use `priority` for ranking and `date_added` for wishlist-added date display.
- Persist rank snapshot in `steamWishlistAddedMapV3`.
- Refresh rank snapshot:
  - once per day, or
  - when wishlist membership changes.
- Metadata enrichment (`wishlistdata`, `appdetails`, `appreviews`) must not block or override rank ordering.

## External Reference Baseline (SteamDB)
- Primary implementation reference for upcoming work is the local clone at `../BrowserExtension`
  (upstream: `https://github.com/SteamDatabase/BrowserExtension`).
- Use this baseline for:
  - content script organization and route segmentation,
  - background message patterns and caching approach,
  - UI injection conventions and DOM resilience patterns,
  - build/test conventions (`web-ext`, lint/type-check flow).
- Before introducing a new pattern in this repository, check whether an equivalent pattern already exists in
  `../BrowserExtension/scripts`, `../BrowserExtension/styles`, or `../BrowserExtension/manifest.json`.
- Keep this project scoped to Steam wishlist collections, but prefer SteamDB extension architecture/style decisions
  whenever there is no strong reason to diverge.

## MCP + Codex Guidance
- MCP server entrypoint: `mcp/server.mjs` (run with `npm run mcp:server`).
- Local MCP state file: `mcp/data/state.json` (or `SWM_MCP_DB_PATH` override).
- Codex-powered query tool:
  - `swm_query_games_with_codex`
  - Requires `OPENAI_API_KEY`.
  - Optional model override: `SWM_CODEX_MODEL` (default `gpt-5.1-codex-mini`).
- Codex queries must only return `appIds` that exist in local MCP catalog (no external app insertion).
- Keep prompts strict JSON-oriented and fail closed on invalid/non-JSON model output.
