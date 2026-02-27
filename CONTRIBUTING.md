# Contributing Guide

## Scope
This project is a Firefox extension that organizes Steam wishlist data into useful local workflows (`Track` and `Buy`) for large lists.

Contributions should improve:
- triage speed,
- signal quality (news/discount/priorities),
- robustness under endpoint/rate-limit instability.

## Development Setup
- `npm install`
- `npm run dev` for Firefox dev run (auto-reload)
- `npm run build` to create package artifact
- `npm run check:manifest`
- `npm run test:logic`

Load temporary add-on manually:
- `about:debugging` -> This Firefox -> Load Temporary Add-on -> `manifest.json`

## Branch and Commit Rules
- Use focused branches per change set.
- Follow Conventional Commits:
  - `feat:` new capability
  - `fix:` behavior correction
  - `refactor:` structural change without behavior change
  - `chore:` tooling/docs/maintenance

Keep commits atomic and reviewable.

## Design and Product Rules
Required UX behavior:
- Never force "support vs buy" binary decisions.
- Keep `Track` and `Buy` independent.
- One-click transitions for common actions.
- Provide graceful fallback for unreliable Steam automation.

State model assumptions:
- `INBOX` for unclassified,
- `TRACK` when tracking and not buying,
- `BUY/MAYBE` when buy intent exists,
- `ARCHIVE` for out-of-radar items.

## Network and API Safety
- Cache aggressively.
- Backoff and retry conservatively.
- Avoid high-concurrency scraping.
- Respect Steam session boundaries and platform limitations.
- If write automation is unstable, use assisted navigation fallback.

## Testing Checklist (Minimum)
For every behavior change, validate:
1. Wishlist import and persistence survive reload.
2. Triage actions update local state correctly.
3. Track feed filters and mute behavior work.
4. Buy radar ordering and target-price logic behave as expected.
5. Large-list behavior remains responsive.
6. Error states show clear status and do not corrupt local data.

## Pull Request Checklist
Include in PR description:
- Problem being solved.
- Behavioral change summary.
- Before/after screenshots or short recordings for UI changes.
- Manual test steps and outcomes.
- Risks, fallbacks, and known limitations.

## Definition of Done
A contribution is done when:
- implementation matches intended behavior,
- edge/failure paths are handled,
- manual checklist passes,
- docs are updated (`README.md`, `AGENTS.md`, `CONTRIBUTING.md` if needed).
