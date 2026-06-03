# Known Issues

## HARNESS-001: Isolate harness database/schema per execution

Status: resolved.

Resolution: the harness now creates a unique `harness_*` schema per runtime, runs migrations and API traffic against it with `TRIFORGE_DB_SCHEMA`, then drops the schema during cleanup.

## HARNESS-002: Consider database-per-run isolation if schema isolation is insufficient

Schema-per-run isolation still shares the same PostgreSQL instance and database. This is acceptable for the MVP, but database-per-run isolation may be useful if future tests require stronger guarantees around extensions, permissions or global database state.

Status: open.

## RUNTIME-001: advanceRunOneStep was not fully concurrency-safe

Status: resolved.

Resolution: `advanceRunOneStep` now runs inside a PostgreSQL transaction in the API runtime and locks the target `agent_runs` row with `SELECT ... FOR UPDATE NOWAIT`. Step creation, approval gate creation, run updates and timeline events occur in the same transaction. Concurrent advances against the same run are rejected with `409 Conflict` when the row is already locked or when the first request has already moved the run to a non-advanceable state.

## RUNTIME-002: Runtime is still synchronous and request-bound

The runtime has transactional state transitions, but it is still not a durable worker queue. This is acceptable while execution is mock-only.

Status: open.

Target resolution: introduce a worker/queue design only after adapter sandboxing and execution specs are accepted.

## APPROVAL-001: Approval resolution has no real user authorization yet

Approval and rejection payloads include `resolvedBy` and a simulated `actorRole`, and the API enforces the initial role policy. However, there is still no real authentication, identity proof or role binding.

Status: open.

Target resolution: add authentication/authorization requirements to the adapter and approval specs before real execution.

## APPROVAL-002: Gate expiration was stored but not enforced

Status: resolved.

Resolution: pending gates are checked for expiration before approve/reject and before advance on a waiting run. Expired gates are resolved by `system`, emit `approval_gate_expired` and stop the run with `approval_expired`. There is still no cron or worker-based background expiry.

## CONTEXT-001: Retrieval is lexical only

Context Engine v0 uses deterministic keyword scoring over source name, document title and chunk content. It does not use embeddings, pgvector or semantic ranking.

Status: open.

Target resolution: design embeddings and vector storage after lexical retrieval contracts, dashboard and harness flows are stable.

## CONTEXT-002: Context retention and redaction are undefined

Context chunks and retrieval snapshots are persisted without a retention, quota or redaction policy. This is acceptable for local MVP usage with manual/project/artifact sources only.

Status: open.

Target resolution: add retention and redaction requirements before external source adapters or sensitive data ingestion.

## RAG-001: No semantic retrieval yet

RAG v1 is specified, but the implementation still uses lexical Context Engine v0 retrieval only. There are no chunk embeddings or vector search yet.

Status: open.

Target resolution: implement deterministic mock embedding interfaces before adding pgvector or local models.

## RAG-002: No embedding redaction policy

There is no policy yet for redacting context before embedding generation. This matters before local models process sensitive data and is mandatory before external embedding providers are considered.

Status: open.

Target resolution: define redaction and data handling policy in the embedding implementation milestone.

## RAG-003: No vector index or pgvector support yet

The database does not enable pgvector and has no vector index. This is intentional until embedding interfaces and harness behavior are proven.

Status: open.

Target resolution: add pgvector only after a migration and CI plan is accepted.

## RAG-004: No external embedding provider policy

External embedding providers are not approved. Sending persisted context to a provider requires explicit approval policy, provider configuration, audit logging and redaction rules.

Status: open.

Target resolution: add external provider policy only after local/mock embedding paths are stable.
