# ADR-0001: Preserve Collections Contract

Status: Accepted

## Context
Current users depend on the existing `Collections` flow, labels, and action semantics.

## Decision
Preserve current Collections behavior as a compatibility contract:
- `Buy` => `buy=2`, `bucket=BUY`
- `Maybe` => `buy=1`, `bucket=MAYBE`
- `Track` toggles only `track`
- `Mute` remains local-only
- `Archive` => `owned=true`, `track=0`, `buy=0`, `bucket=ARCHIVE`

## Consequences
- New features are additive and should not replace Collections UX.
- Existing filters and layout semantics remain stable.
