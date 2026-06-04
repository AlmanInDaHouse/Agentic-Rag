# ADR 0016: Context Data Redaction Policy

## Date

2026-06-04

## Status

Accepted

## Context

Context Engine v0 supports manual/project/artifact text ingestion and lexical retrieval. Milestone 1.5B added a deterministic mock embedding boundary and mock/hybrid search modes without pgvector or real providers. Before pgvector, local models or external embedding providers are introduced, the project needs a minimum data governance boundary for sensitive context.

## Problem

Context chunks are persisted and may be used for retrieval and embeddings. Without a policy, sensitive values such as emails, tokens, passwords or private keys could be stored in chunks, embedded, surfaced through API responses or later sent to a model/provider by accident. A full DLP system would be too large for the current milestone, but doing nothing would make future RAG work unsafe.

## Decision

Implement deterministic regex-based scanning and redaction in the API:

- no LLM classifier,
- no external service,
- no network calls,
- no provider integration,
- scan content before document persistence,
- block `restricted` content by default,
- chunk redacted content when findings exist,
- generate mock embeddings from persisted chunks, which are redacted when needed,
- keep lexical fallback and local-only behavior.

The policy records document classification, redaction status, sensitive finding metadata and an optional redacted content hash. Findings do not store matched secret values.

## Alternatives Considered

### No redaction policy yet

Rejected. The next RAG steps require stronger guarantees before adding vector storage or real embedding models.

### Block all context ingestion

Rejected. The current MVP depends on manual/project/artifact context. Blocking all input would stop useful local development without meaningfully proving data lifecycle behavior.

### Basic deterministic regex redaction

Selected. It is simple, reproducible, dependency-free and adequate for CI/harness validation of policy boundaries. It is not complete DLP.

### ML or LLM classifier

Rejected for now. Classifiers introduce model/runtime dependencies, non-determinism, privacy questions and possible external calls before the local policy boundary is stable.

## Final Decision

Milestone 1.5C-A implements basic regex redaction and context data policy metadata. Manual text is not blocked by default unless it contains restricted data. Redacted text is used for chunks, search and mock embeddings. pgvector, real models, Ollama, external providers, GraphRAG, Code Graph and external sources remain out of scope.

## Consequences

- Sensitive findings are traceable without storing matched values.
- API and dashboard can preview redaction before persistence.
- Mock embeddings run over redacted chunk text.
- CI can validate data policy behavior without model or provider access.
- The project has a safer precondition for later pgvector/local embedding work.

## Pending Risks

- Regex redaction is incomplete and can miss secrets.
- False positives can redact benign text.
- Original request content exists transiently in memory.
- There is still no tenant retention, quota or deletion policy.
- There is no user-controlled classification field yet.
- External providers remain blocked until a stronger data handling policy exists.
