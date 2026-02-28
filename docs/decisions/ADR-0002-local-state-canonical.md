# ADR-0002: Local Intent State Is Canonical

Status: Accepted

## Context
Steam endpoints can be unstable, rate-limited, or behaviorally inconsistent.

## Decision
Treat local intent state as canonical for classification and UI behavior:
- `track`, `buy`, `owned`, `mute`, target price, notes
- View/bucket derivation is computed from local intent first

Steam-observed signals are integrated as enrichment, not as authoritative state.

## Consequences
- Network failures do not corrupt user workflow state.
- Sync remains resumable with cache-first patterns.
