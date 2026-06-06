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

## CONTEXT-002: Basic context retention policy exists

Context documents now have basic service-layer quota checks, soft delete/restore and audit events. Retrieval snapshots are still retained as historical logs.

Status: resolved.

Resolution: Milestone 1.5C-B adds retention/quota contracts, migration `0009_context_retention_deletion.sql`, document lifecycle endpoints and harness coverage.

## RAG-001: Semantic retrieval is still not real

RAG v1 now has deterministic mock embeddings, `mock_vector` and `hybrid` modes. This partially addresses the retrieval boundary and lifecycle, but it is not real semantic retrieval because `mock_embedding_v1` is hash-based and not trained on language semantics.

Status: open.

Target resolution: add a real local embedding adapter and semantic/vector storage after redaction, adapter policy and pgvector migration design are accepted.

## RAG-002: Embedding redaction policy is basic regex only

Context ingestion now applies deterministic regex redaction before chunk persistence, and mock embeddings run over persisted chunks. This is a minimum boundary, not complete DLP, and it is not sufficient to approve external embedding providers.

Status: open.

Target resolution: strengthen redaction, data handling, audit logging and review policy before real local models or external embedding providers are considered.

## RAG-003: pgvector optional active path exists

The project now has optional pgvector capability reporting, an optional Docker Compose pgvector service and an active pgvector retrieval path when `TRIFORGE_EMBEDDING_STORAGE=pgvector` is configured and the extension/table are available. Standard CI/harness still uses PostgreSQL without requiring the extension. JSONB/mock/lexical fallback remains mandatory.

Status: open.

Target resolution: add opt-in pgvector CI coverage and production vector tuning only after local vector setup is stable.

## RAG-005: Mock embeddings are not semantically meaningful

`mock_embedding_v1` is deterministic, local and useful for CI/harness coverage, but hash-derived vectors do not encode semantic similarity. Search quality from `mock_vector` and `hybrid` modes should not be interpreted as production RAG quality.

Status: open.

Target resolution: replace or complement mock embeddings with an approved local embedding adapter, then validate retrieval behavior with real semantic vectors.

## RAG-004: No external embedding provider policy

External embedding providers are not approved. Sending persisted context to a provider requires explicit approval policy, provider configuration, audit logging and redaction rules.

Status: open.

Target resolution: add external provider policy only after local/mock embedding paths are stable.

## RAG-006: Local embedding endpoint is optional and not production hardened

`TRIFORGE_LOCAL_EMBEDDING_ENDPOINT` can point to a local embedding service, but the adapter contract is minimal and intended for controlled local experiments. It has a short timeout and no retries, but no production health model, authentication or capacity management.

Status: open.

Target resolution: define a local model operations policy before relying on local embeddings for production retrieval.

## RAG-007: pgvector is not required in CI

CI intentionally validates mock/jsonb/lexical behavior and does not require pgvector. This protects baseline reproducibility but means pgvector-specific behavior still needs future opt-in CI coverage.

Status: open.

Target resolution: add a separate optional pgvector CI job only after vector schema and index design are accepted.

## RAG-008: Vector search quality depends on configured model

Real vector search quality will depend on the configured local model, output dimension, language coverage and chunking strategy. The current mock vectors are deterministic but not semantic.

Status: open.

Target resolution: add retrieval evaluation fixtures once a real local embedding model path is accepted.

## RAG-009: pgvector active retrieval requires explicit vector database setup

`TRIFORGE_EMBEDDING_STORAGE=pgvector` only becomes effective when the database has the installed `vector` extension and the optional `context_chunk_vector_embeddings` table. Standard migration is safe without pgvector and does not force extension creation.

Status: open.

Target resolution: add a documented opt-in local/CI vector profile once the setup is stable enough to maintain.

## RAG-010: No production-grade vector tuning yet

The active pgvector path uses exact cosine distance over 32-dimensional mock/local vectors. There is no retrieval evaluation set, model quality benchmark, tuned weighting policy or production capacity model yet.

Status: open.

Target resolution: define retrieval evaluation fixtures and model operations policy before relying on vector quality.

## RAG-011: Approximate pgvector indexes are not configured yet

The optional vector table has only a basic model/chunk index. It does not configure HNSW, IVFFlat or any approximate nearest-neighbor index.

Status: open.

Target resolution: add index strategy after vector volume, model dimension and latency requirements are known.

## RAG-012: Retrieval evaluation fixtures are synthetic

Milestone 1.5E adds deterministic retrieval evaluation fixtures, metrics and reports. Milestone 1.5F adds compact baselines and quality gates. Milestone 1.5G expands the corpus with ambiguous, overlapping-keyword, redaction, no-answer and runtime-domain fixtures. The fixtures are synthetic, so they still do not prove production semantic quality.

Status: open.

Target resolution: add larger and more realistic evaluation sets once real local model evaluation is approved.

## RAG-013: Retrieval quality thresholds are intentionally minimal

The initial quality gate blocks on `hitAtK`, `expectedChunkFound` and `meanReciprocalRank` only. `precisionAtK`, `recallAtK` and `fallbackUsedRate` are reported but non-blocking while the fixture set is small.

Status: open.

Target resolution: add stronger thresholds and mode-specific baselines after fixture coverage grows and real local model evaluation is approved.

## RAG-014: No-answer retrieval eval is not answer abstention

No-answer fixtures use empty expected arrays and prevent the evaluator from inventing expected matches. They do not prove that a future answer generator will abstain or that search will return zero rows.

Status: open.

Target resolution: define answer-generation abstention evaluation only after answer generation and judge policy exist.

## DATA-001: Regex redaction is not complete DLP

The current redaction service uses deterministic regex patterns for common secrets and identifiers. It can miss sensitive values and can redact benign text.

Status: open.

Target resolution: evaluate stronger local classification and human-review workflows before real providers or external sources.

## DATA-002: Basic retention/quota/deletion policy is not tenant-specific

Context documents now have basic quota, soft delete/restore and audit events. The policy is static and service-layer only; it is not configured per tenant, project or goal.

Status: open.

Target resolution: add tenant/project-specific quota configuration only after auth and tenancy boundaries are defined.

## DATA-003: Original content storage policy is local-only

The API no longer stores a separate full document body, but original submitted text exists transiently in request memory and duplicate hashes are derived from original normalized content. The policy assumes local-only operation.

Status: open.

Target resolution: add request logging guarantees, stronger data handling rules and audit policy before real adapters or external providers.

## DATA-004: No background retention worker yet

Retention policy reports when retrieval history should be pruned, but there is no background worker or scheduled cleanup process.

Status: open.

Target resolution: add a worker/queue design after runtime worker requirements are accepted.

## DATA-005: Hard delete audit is best-effort before cascade

Hard delete writes `context_hard_deleted` before deleting the document. Existing foreign keys use `ON DELETE SET NULL` for audit references, so the audit row can lose the document reference after cascade.

Status: open.

Target resolution: add immutable audit payload snapshots if hard delete becomes part of normal production workflows.

## DATA-006: No tenant-specific quota config yet

Initial retention quotas are static defaults in the service layer. They cannot yet vary by tenant, user, project or goal.

Status: open.

Target resolution: define auth/tenancy first, then add persisted quota configuration.
