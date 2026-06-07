# ADR 0026: Code Graph Artifact Ingestion

## Date

2026-06-08

## Status

Accepted

## Context

TriForge Agentic Lab now has Context Engine ingestion, lexical retrieval, deterministic mock embeddings, optional pgvector retrieval, retrieval evaluation, answerability calibration and a deterministic Code Graph scanner artifact.

Milestone 1.6C added a local scanner that writes `artifacts/code-graph/code-graph.json`. Milestone 1.6D added fixture quality gates through `pnpm code-graph:check`. The artifact contains `scanRun`, `files`, `symbols`, `edges` and `warnings`, but it is not yet ingested into the Context Engine or used by RAG.

The next architectural question is how that artifact should eventually become retrievable context without turning derived scanner output into the source of truth, weakening data policy, bypassing retention/deletion rules or jumping prematurely to GraphRAG.

## Problem

The current RAG path can retrieve text chunks from accepted context sources, but it does not yet expose code structure such as route definitions, imports, test relationships, migration table operations or docs/spec/ADR relationships.

Ingesting the Code Graph artifact too aggressively would create risk:

- full source chunks could add noise and sensitive content,
- low-confidence scanner edges could contaminate answers,
- stale artifacts could contradict current code,
- warnings could be mistaken for positive evidence,
- persistence could be designed before the ingestion contract is validated,
- GraphRAG could add complexity before normal retrieval over derived graph summaries is evaluated.

The project needs a design-only decision for future artifact ingestion before any runtime, database or API implementation.

## Decision

Adopt a future ingestion design where the Code Graph artifact is transformed into derived, traceable and retrievable Context Engine context.

The conceptual source type is:

```text
code_graph
```

The future source should represent one validated local artifact for one repository state. Derived documents and chunks should summarize structural facts from the artifact, such as:

- file summaries,
- symbol summaries,
- edge summaries,
- route summaries,
- migration summaries,
- test coverage summaries,
- doc/spec/ADR relationship summaries.

Chunks should be small, deterministic and traceable back to repository-relative paths, symbols, edges, scanner version, scan run, artifact path and confidence. They must not contain full source files and must not present warnings or low-confidence observations as strong facts.

Code Graph context must complement existing RAG. It does not replace code, specs, ADRs, lexical retrieval, mock/vector retrieval, retrieval evaluation or answerability policy. If derived Code Graph context conflicts with newer primary sources, the primary sources should win and answerability should remain conservative.

No persistence, migrations, endpoints, runtime integration, dashboard changes, Context Engine changes or GraphRAG are implemented in Milestone 1.6E.

## Consequences

- Future ingestion has a reviewable design before implementation.
- The Code Graph artifact remains derived and auditable.
- Milestones stay small by separating design from persistence and runtime integration.
- Existing lexical fallback remains mandatory.
- Data policy, redaction, retention, deletion and quota rules remain part of the future ingestion contract.
- Evaluation can be designed before Code Graph context reaches runtime `load_context`.
- GraphRAG remains deferred until ordinary retrieval over Code Graph-derived chunks is proven useful and safe.

## Alternatives Considered

### Ingest full source code as chunks

Rejected. Full source chunks would add noise, cost, large chunks and higher risk of secrets or sensitive implementation details entering retrieval and embeddings. They would also weaken answerability because retrieval could match broad code text without a precise structural fact.

### Skip directly to GraphRAG

Rejected. GraphRAG would be over-engineered before the project has stable artifact ingestion, retrieval evaluation coverage and confidence handling. It could contaminate responses with weak graph edges before normal RAG behavior over derived graph summaries is understood.

### Persist Code Graph directly in PostgreSQL now

Rejected. Direct persistence is premature because the ingestion contract, chunking strategy, stale artifact handling and evaluation fixtures are not validated yet. Adding migrations now would expand retention/deletion and schema surface before the design is reviewed.

### Treat the artifact as the primary source of truth

Rejected. The artifact is derived and can be stale. Repository code, specs and ADRs remain the primary sources. The artifact should improve traceability and retrieval, not override source documents.

### Keep Code Graph completely outside RAG

Rejected as the long-term strategy. The artifact contains useful structural relationships that can help answer repository-structure questions, provided ingestion stays conservative, traceable and policy-governed.

## Final Decision

Milestone 1.6E records the design for future Code Graph artifact ingestion only.

The accepted direction is to transform a validated local Code Graph JSON artifact into derived Context Engine context with small, traceable chunks and explicit metadata. Future implementation must preserve lexical fallback, answerability conservatism, data policy, retention, deletion and quota behavior.

No code, tests, scanner changes, migrations, endpoints, dashboard changes, runtime integration, provider integration, pgvector requirement or GraphRAG implementation are added in this milestone.

## Pending Risks

- The best document grouping is not yet proven by retrieval evaluation.
- Scanner confidence may need calibration before it can affect answerability.
- Stale artifact detection needs a concrete commit/versioning rule.
- Warnings may be useful for auditability but risky as retrievable chunks.
- Synthetic fixtures may not capture larger repository ambiguity.
- Future persistence must avoid duplicating large derived context across scans.
