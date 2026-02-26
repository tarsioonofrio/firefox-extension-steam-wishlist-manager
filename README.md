# Steam Wishlist Manager (Firefox)

Firefox extension to organize Steam wishlist games into custom local collections with independent ordering and filters.

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
- Validate manifest: `npm run check:manifest`

Manual load alternative:
- `about:debugging` -> **This Firefox** -> **Load Temporary Add-on...** -> `manifest.json`

## Usage

1. Click extension icon -> `Open Collections Page`.
2. Select `Steam wishlist` or a custom collection.
3. Use search, sort, filters, and pagination.
4. Add/remove collection items from Steam app pages (where enabled).

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
