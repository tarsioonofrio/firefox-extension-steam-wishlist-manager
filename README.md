# Steam Wishlist Collections Manager (Firefox)

Firefox extension MVP to organize Steam wishlist entries into custom collections with independent ordering.

## Features (MVP)

- Add a game to a custom collection directly from a Steam app page.
- Choose insertion position when saving: beginning or end of collection.
- Optional toggle to also click native Steam "add to wishlist" action.
- Filter and reorder wishlist page by selected collection.
- Persistent local storage via `browser.storage.local`.

## Development with auto-reload (`web-ext`)

1. Install dependencies:
   - `npm install`
2. Run extension in Firefox development profile:
   - `npm run dev`

This keeps the extension temporarily installed and reloads it when files change.

Useful commands:
- `npm run check:manifest` (quick manifest syntax check)
- `npm run build` (creates zipped artifact in `web-ext-artifacts/`)

## Manual temporary load (without `web-ext`)

1. Open `about:debugging`.
2. Click **This Firefox**.
3. Click **Load Temporary Add-on...**.
4. Select `manifest.json` from this project.

## Current limitations

- Steam DOM changes may break selectors.
- Reordering is visual on the page; it does not modify Steam server-side order.
- Storage is local to your browser profile unless sync is implemented later.

## Next MVP+ ideas

- Collection management UI (rename/delete/reorder collections).
- Bulk assign from wishlist page.
- Optional `storage.sync` mode.
- Export/import JSON backup.
