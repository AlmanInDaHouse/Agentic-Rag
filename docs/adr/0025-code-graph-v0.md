# ADR 0025: Code Graph v0

## Date

2026-06-07

## Status

Accepted

## Context

TriForge Agentic Lab now has a mock agent runtime, approval gates, Context Engine, RAG retrieval modes, retrieval evaluation, answerability and abstention calibration. Future GraphRAG and code-aware context features need a stable representation of repository structure before implementation begins.

The repository already has TypeScript services, repositories, routes, tests, migrations, specs, ADRs and evaluation fixtures. Lexical search can find text, but it does not preserve structural relationships such as imports, exports, route-to-service usage, tests-to-source relationships or migration-to-repository boundaries.

## Problem

Jumping directly to GraphRAG or model-driven repository analysis would add complexity, non-determinism and safety concerns before the project has an auditable code structure layer. The project needs a conservative Code Graph design that can be reviewed before scanner, persistence, dashboard or runtime integration work begins.

## Decision

Adopt Code Graph v0 as a derived structural layer for the repository, starting with specification and ADR only.

Code Graph v0 will be designed around conceptual scan runs, files, symbols and edges:

- `code_scan_runs`,
- `code_files`,
- `code_symbols`,
- `code_edges`.

The future scanner must be deterministic, local and conservative. It must not execute code, read outside the repository, call providers, require real models, require pgvector or introduce runtime behavior. It should prefer lower coverage over aggressive false positives.

The Code Graph should complement RAG by providing structural context. It does not replace lexical retrieval, mock/vector retrieval, retrieval evaluation or existing Context Engine flows. GraphRAG remains a later milestone after Code Graph quality and safety boundaries are proven.

## Alternatives Considered

### Skip directly to GraphRAG

Rejected. GraphRAG without an auditable structural base would be over-engineered and hard to validate. The project needs deterministic graph entities and edge semantics first.

### Use only lexical search over files

Rejected as the complete strategy. Lexical search is useful and should remain a fallback, but it does not capture repository structure such as imports, exports, tests, routes, migrations or documentation ownership.

### Use an LLM to analyze the repository

Rejected. LLM analysis introduces cost, non-determinism, privacy risk and provider policy questions. The project has not approved external providers or real model dependencies for this purpose.

### Build a production scanner immediately

Rejected. A full scanner would expand scope and safety surface too quickly. The project follows incremental spec-driven milestones, so scanner implementation, persistence and evaluation should come after this design is accepted.

## Final Decision

Milestone 1.6A defines Code Graph v0 in documentation only. No scanner, migrations, shared contracts, endpoints, dashboard, runtime integration, GraphRAG or model/provider dependencies are added.

Future implementation should begin with a conservative scanner that extracts static TypeScript imports/exports, route/service/repository/test/migration/documentation relationships and confidence-scored edges from repository-local files only.

## Consequences

- The project gets a reviewable design for code-aware context before implementation.
- Future RAG can use structural code context without making GraphRAG immediate.
- Future GraphRAG has a safer foundation, but remains out of scope for this milestone.
- CI and runtime remain unchanged.
- Safe execution policy boundaries remain intact.
- Persistence, scanner implementation, dashboard visualization and runtime `load_context` integration are postponed to future milestones.

## Pending Risks

- Weak heuristics may create noisy edges if scanner confidence is not managed carefully.
- Mapping specs and ADRs to code can be ambiguous without explicit references.
- Persisted graph design may differ from artifact-first scan output once implementation starts.
- Large repositories may need file size limits, ignore rules and scan performance controls.
- Code Graph output will still not prove semantic correctness or generated answer faithfulness.
