# ADR 0012: Runtime Concurrency and Approval Hardening

## Date

2026-06-02

## Status

Accepted

## Context

The mock agent runtime supports persisted runs, steps, approval gates and a safe execution policy. Before introducing RAG, code graph work, real adapters or worker queues, the request-bound runtime needs stronger consistency for concurrent advance calls and stricter approval resolution rules.

## Problem

`advanceRunOneStep` previously relied on a unique `(run_id, step_index)` constraint to avoid duplicate steps. That prevented one class of race, but a narrow concurrent advance could still duplicate terminal timeline events or observe stale run state. Approval gates also persisted `expires_at` and `resolvedBy`, but expiration and role policy were not enforced.

## Decision

Use a small PostgreSQL transaction boundary for runtime state transitions:

- `advanceRunOneStep` runs inside a transaction in the API runtime.
- The target `agent_runs` row is locked with `SELECT ... FOR UPDATE NOWAIT`.
- Step writes, approval gate writes, run updates and timeline events for the advance happen inside the same transaction.
- Concurrent advances that cannot acquire the row lock return `409 Conflict`.

Approval resolution is also hardened:

- approve/reject locks the gate and run rows transactionally,
- `actorRole` is required in approval payloads,
- `human_operator` and `admin` may resolve high risk gates,
- `system` cannot manually approve or reject high or critical gates,
- critical gates remain blocked by default,
- expired pending gates resolve as `expired` by `system` and stop the run.

No real authentication or external execution is introduced.

## Alternatives Considered

### Keep relying on unique constraints

Rejected. Unique step constraints are still useful, but they do not serialize terminal run transitions or timeline events.

### Introduce a worker queue now

Rejected. A queue may be needed later, but it would expand infrastructure before real adapter execution exists.

### Add a small transaction and row lock

Selected. It resolves the current consistency issue while keeping the runtime simple and PostgreSQL-backed.

## Consequences

- `RUNTIME-001` is resolved for the request-bound API runtime.
- Concurrent requests receive deterministic `409 Conflict` behavior when they race on the same run or gate.
- Approval gates now enforce strict payloads, simulated roles and expiration.
- Real auth, worker queues and adapter sandboxing remain future work.

## Pending Risks

- Simulated roles are not proof of identity.
- Long-running real adapter execution must not happen inside this transaction model without a worker/sandbox design.
- Background gate expiration is not implemented; expiration is applied on request paths.
