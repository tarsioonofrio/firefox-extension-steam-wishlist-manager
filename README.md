# Steam Wishlist Collections Manager (Firefox)

Firefox extension MVP to organize Steam wishlist games into local custom collections with independent ordering.

## Reference Codebase

For upcoming development, this project uses the SteamDB browser extension as architectural reference:

- Local clone: `../BrowserExtension`
- Upstream: `https://github.com/SteamDatabase/BrowserExtension`

What we reuse as guidance:
- content script split by route/domain,
- background messaging and cache invalidation patterns,
- resilient Steam DOM handling conventions,
- packaging/dev workflow with `web-ext`.

Scope note: this repository remains focused on wishlist collection management, but implementation patterns should
prefer the SteamDB baseline unless there is a clear project-specific reason to diverge.

## Official Steam API References (instead of SteamDB API)

SteamDB does not provide a public API (see SteamDB FAQ: `https://steamdb.info/faq/`), so this project should rely on
official Steam endpoints when API data is needed.

Recommended official references:

- `IStoreService/GetAppList/v1` (catalog/app list)  
  Docs: `https://partner.steamgames.com/doc/webapi/IStoreService`

- `IPlayerService/GetOwnedGames/v1` (owned games)  
  Docs: `https://partner.steamgames.com/doc/webapi/IPlayerService`

- `ISteamUser` interface (profile/public user data such as `GetPlayerSummaries`)  
  Docs index: `https://partner.steamgames.com/doc/webapi`

- `ISteamNews/GetNewsForApp/v2` (app news)  
  Docs: `https://partner.steamgames.com/doc/webapi/isteamnews`

- `ISteamUserStats/GetNumberOfCurrentPlayers/v1` (current player count)  
  Docs: `https://partner.steamgames.com/doc/webapi/ISteamUserStats`

Notes:
- `ISteamApps/GetAppList/v2` is marked deprecated in official docs localization; prefer `IStoreService/GetAppList/v1`.
- Avoid building critical flows on undocumented or unofficial endpoints.

## API Risk & Compliance

- Using official Steam APIs/endpoints with normal user-like traffic is generally low risk.
- Main practical risk is technical (`rate limiting`, temporary blocking, endpoint changes), not VAC-style anti-cheat.
- Keep integrations conservative:
  - cache responses and avoid request bursts,
  - avoid mass automation of account actions,
  - do not bypass authentication/session controls.
- Follow Steam terms and Steam Subscriber Agreement:
  - `https://store.steampowered.com/subscriber_agreement/`

## Security Model

- Sandbox-only behavior: the extension never writes to Steam wishlist.
- Collection data is stored only in `browser.storage.local`.
- A game can be added to a collection only if it is already in Steam wishlist.
- If a game leaves your Steam wishlist, it is automatically removed from all local collections.
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
5. Use `Manage Collections` (next to wishlist counter) to create/remove collections.

## Wishlist Validation Strategy

- Primary source: `https://store.steampowered.com/dynamicstore/userdata/` (`rgWishlist`) from current logged-in session.
- 60s local cache to reduce requests/CPU.
- Cache is invalidated when wishlist UI state changes on app page.
- Fallback: conservative UI-based check if `dynamicstore/userdata` is unavailable.
- Collection pruning runs on wishlist page to remove any app no longer present in Steam wishlist.

## Troubleshooting

- `steam-dev profile cannot be resolved`: create it first (`about:profiles` or `firefox -CreateProfile "steam-dev"`).
- Button stays disabled after adding to wishlist: wait up to ~1s for UI/API refresh.
- Extension not updating in dev: ensure `npm run dev` process is still running.

## Known Limitations

- `dynamicstore/userdata` is an internal Steam endpoint and may change.
- Reordering/filtering is visual/local only; it does not modify Steam server-side order.
- Storage is per Firefox profile unless sync/export is implemented.
