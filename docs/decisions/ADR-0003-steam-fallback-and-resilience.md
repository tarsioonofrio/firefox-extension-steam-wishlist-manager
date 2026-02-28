# ADR-0003: Best-Effort Steam Integration With Assisted Fallback

Status: Accepted

## Context
Some Steam write or metadata surfaces are unofficial or operationally unstable.

## Decision
Use resilient adapters and assisted fallback:
- cache-first hydration,
- conservative retry/backoff,
- avoid burst traffic,
- when automation is unreliable, open the correct Steam page and keep local state consistent.

## Consequences
- UX continuity is prioritized over brittle automation.
- Operational failures become visible but non-destructive.
