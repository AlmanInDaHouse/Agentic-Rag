# Known Issues

## HARNESS-001: Isolate harness database/schema per execution

Status: resolved.

Resolution: the harness now creates a unique `harness_*` schema per runtime, runs migrations and API traffic against it with `TRIFORGE_DB_SCHEMA`, then drops the schema during cleanup.

## HARNESS-002: Consider database-per-run isolation if schema isolation is insufficient

Schema-per-run isolation still shares the same PostgreSQL instance and database. This is acceptable for the MVP, but database-per-run isolation may be useful if future tests require stronger guarantees around extensions, permissions or global database state.

Status: open.
