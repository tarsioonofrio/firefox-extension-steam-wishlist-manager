# Repository Guidelines

## Project Structure & Module Organization
- `manifest.json`: Firefox WebExtension manifest (MV3) with permissions and content script mappings.
- `src/background.js`: central state management (`browser.storage.local`) and message handlers.
- `src/content/app-page.js`: UI/actions on Steam app pages (`/app/...`) for collection assignment.
- `src/content/wishlist-page.js`: filtering and visual ordering logic on wishlist pages (`/wishlist/...`).
- `src/styles/content.css`: shared styles for injected UI.
- `README.md`: MVP usage notes and current limitations.
- `logs/`: local runtime logs; ignored in git.

## Build, Test, and Development Commands
This repository currently has no Node build pipeline. Use direct Firefox loading for development.

- `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...** -> select `manifest.json`.
- `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
  - Quick manifest syntax validation.
- `zip -r extension.zip manifest.json src`
  - Optional: package files for manual distribution/testing.

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
