# ADR 0004: Harness Engineering

Status: Superseded by ADR 0006

## Date

2026-06-01

## Context

The project needs reproducible validation of agentic behavior before real model adapters exist.

## Decision

Originally, implement the MVP harness as API-owned harness helpers plus root-level fixtures and scenarios. This has been superseded because it mixed development tooling with product runtime code.

## Alternatives Considered

- Separate `packages/harness`: cleaner long-term boundary, but premature while the harness needs API internals and local PostgreSQL.
- Only unit tests: insufficient to validate persistence and endpoint recovery.

## Consequences

- `pnpm test:harness` now runs the external harness in `tooling/harness`.
- Harness currently uses the configured PostgreSQL database.
- A future milestone can extract `packages/harness` when the public harness API stabilizes.
