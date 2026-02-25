# Steam Wishlist Collections Manager (Firefox)

Firefox extension MVP to organize Steam wishlist games into local custom collections with independent ordering.

## Security Model

- Sandbox-only behavior: the extension never writes to Steam wishlist.
- Collection data is stored only in `browser.storage.local`.
- A game can be added to a collection only if it is already in Steam wishlist.
- Host scope is limited to Steam app and wishlist pages.

## Compatibility

- Firefox `109+` (see `manifest.json` `strict_min_version`).
- Recommended dev profile: `steam-dev` (isolates login/session and extension state).

## Development (Auto-Reload)

1. Install deps:
   - `npm install`
2. Run in Firefox with auto-reload:
   - `npm run dev -- --firefox-profile steam-dev --keep-profile-changes`

Useful commands:
- `npm run check:manifest` validates `manifest.json`.
- `npm run build` creates a package in `web-ext-artifacts/`.

## Usage Flow

1. Open a Steam app page (`/app/...`).
2. If the game is in your Steam wishlist, `Add to Collection` is enabled.
3. Choose collection and position (start/end), then save.
4. Open Steam wishlist page (`/wishlist/...`) and use the `Collections` filter panel.

## Wishlist Validation Strategy

- Primary source: `https://store.steampowered.com/dynamicstore/userdata/` (`rgWishlist`) from current logged-in session.
- 60s local cache to reduce requests/CPU.
- Cache is invalidated when wishlist UI state changes on app page.
- Fallback: conservative UI-based check if `dynamicstore/userdata` is unavailable.

## Troubleshooting

- `steam-dev profile cannot be resolved`: create it first (`about:profiles` or `firefox -CreateProfile "steam-dev"`).
- Button stays disabled after adding to wishlist: wait up to ~1s for UI/API refresh.
- Extension not updating in dev: ensure `npm run dev` process is still running.

## Known Limitations

- `dynamicstore/userdata` is an internal Steam endpoint and may change.
- Reordering/filtering is visual/local only; it does not modify Steam server-side order.
- Storage is per Firefox profile unless sync/export is implemented.
