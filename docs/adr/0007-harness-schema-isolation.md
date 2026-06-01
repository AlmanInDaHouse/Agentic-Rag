# ADR 0007: Harness Schema Isolation

## Date

2026-06-01

## Context

The external harness validates the API as a black box but previously used the configured PostgreSQL schema. That left test data in shared tables and made repeated harness runs less reproducible.

## Problem

The harness must be able to fail without leaving persistent rows in the product schema. It also needs isolation without introducing heavy infrastructure too early.

## Decision

Use one temporary PostgreSQL schema per harness runtime. The harness generates a schema name like `harness_<timestamp>_<random>`, validates it with `^harness_[a-zA-Z0-9_]+$`, creates it, runs migrations with `TRIFORGE_DB_SCHEMA`, starts the API with the same schema and drops the schema in cleanup.

The API supports `TRIFORGE_DB_SCHEMA` through PostgreSQL `search_path`. If the variable is absent, the API uses `public`.

## Alternatives Considered

- Shared DB/schema: simplest, but leaves data behind and makes runs interfere.
- Schema per execution: selected because it is lightweight and isolates tables/data well enough for MVP.
- Database per execution: stronger isolation, but more setup and permissions complexity.
- Testcontainers: robust for CI, but too heavy for the current local MVP milestone.

## Consequences

- Harness runs are cleaner and safer.
- The API and migration runner now have controlled schema support.
- Cleanup refuses to drop `public` or unsafe schema names.
- The same PostgreSQL database is still shared; extensions and global DB settings are not isolated.

## Pending Risks

- Database-per-run isolation may still be needed if future tests mutate global database state.
- A killed process can still interrupt cleanup; stale `harness_*` schemas may need manual pruning.
