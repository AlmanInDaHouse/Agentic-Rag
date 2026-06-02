# Known Issues

## HARNESS-001: Isolate harness database/schema per execution

Status: resolved.

Resolution: the harness now creates a unique `harness_*` schema per runtime, runs migrations and API traffic against it with `TRIFORGE_DB_SCHEMA`, then drops the schema during cleanup.

## HARNESS-002: Consider database-per-run isolation if schema isolation is insufficient

Schema-per-run isolation still shares the same PostgreSQL instance and database. This is acceptable for the MVP, but database-per-run isolation may be useful if future tests require stronger guarantees around extensions, permissions or global database state.

Status: open.

## RUNTIME-001: advanceRunOneStep is not fully concurrency-safe

The runtime has a unique constraint on `(run_id, step_index)` and maps duplicate step creation to `409 Conflict`, so parallel advances should not create duplicate steps. However, `advanceRunOneStep` is not yet wrapped in a transaction or `SELECT ... FOR UPDATE`. A narrow race can still emit duplicate terminal timeline events around completion or stop transitions.

Status: open.

Target resolution: add row-level locking or a small transactional unit before real adapters, queues or long-running execution are introduced.
