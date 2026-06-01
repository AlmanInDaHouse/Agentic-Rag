# TriForge Harness

The harness is development infrastructure for validating TriForge Agentic Lab behavior from outside the product runtime.

## Boundary

- Lives in `tooling/harness`.
- Does not import API repositories, services or private runtime classes.
- Talks to the API over HTTP.
- Imports shared Zod contracts from `@triforge/shared`.
- Uses fixtures from `tests/fixtures`.

## Running

```bash
pnpm test:harness
pnpm harness:mvp
```

The harness creates a temporary PostgreSQL schema per runtime, starts local API processes on dedicated ports, waits for `/health`, applies migrations through the API workspace script and then exercises public HTTP endpoints.

Each run logs:

- `runId`
- schema name
- API port
- cleanup status

## Schema Isolation

The harness uses the configured PostgreSQL database from `DATABASE_URL`, but creates a unique schema per runtime:

```text
harness_<timestamp>_<random>
```

The API and migration runner receive:

```text
TRIFORGE_DB_SCHEMA=<temporary schema>
```

Cleanup uses `DROP SCHEMA ... CASCADE` only after validating that the schema starts with `harness_`. The harness refuses to drop `public` or names with characters outside `[a-zA-Z0-9_]`.

## Future Target: Isolated Database Or Schema Per Run

Schema-per-run isolation is implemented. A future target is database-per-run isolation if schema isolation becomes insufficient.
