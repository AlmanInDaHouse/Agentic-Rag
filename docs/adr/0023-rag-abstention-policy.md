# ADR 0023: RAG Abstention Policy

## Date

2026-06-06

## Status

Accepted

## Context

TriForge Agentic Lab has deterministic lexical, mock-vector and hybrid retrieval, persisted retrieval traces, runtime `load_context` integration and synthetic retrieval evaluation. Milestone 1.5G added explicit no-answer evaluation fixtures, but no-answer evaluation did not yet influence product behavior.

## Problem

Search can return weak or irrelevant chunks when there is not enough useful context. Without an answerability decision, downstream runtime steps or future answer generation could treat any retrieved row as sufficient evidence. The project needs a deterministic boundary that says whether retrieved context is strong enough to support an answer before adding LLM generation, GraphRAG, Code Graph or LLM-as-judge.

## Decision

Add a deterministic RAG abstention policy based on retrieval metadata.

The policy returns structured answerability metadata:

```json
{
  "shouldAnswer": false,
  "reason": "insufficient_context",
  "confidence": 0.21,
  "topScore": 0.21,
  "minRequiredScore": 1,
  "supportingResultIds": [],
  "warnings": ["No retrieved chunk passed the minimum relevance threshold"]
}
```

Initial reasons:

```text
sufficient_context
insufficient_context
no_results
low_score
fallback_only
redacted_or_restricted
deleted_context_excluded
```

Rules:

- no results abstain,
- top score below the configured threshold abstains,
- zero supporting results abstains,
- fallback-only results abstain when fallback is not allowed,
- redacted chunks can support answers when they remain active and relevant,
- restricted, blocked or deleted context cannot support answers.

Do not add LLM-as-judge, external providers, real models, answer generation, GraphRAG or Code Graph.

## Alternatives Considered

### No abstention

Rejected. Treating every retrieval as answerable would hide insufficient-context cases and weaken future answer-generation safety.

### Abstention based only on empty results

Rejected. Weak low-score rows can still appear for unrelated queries, especially with lexical overlap.

### Abstention based on score threshold

Selected as part of the policy. Thresholds are simple, deterministic and configurable, but they are combined with fallback, deletion and redaction metadata.

### LLM-as-judge

Rejected for now. LLM judging adds non-determinism, provider/model policy work and data-handling risk before the project has approved judge models.

## Final Decision

Milestone 1.5H adds deterministic answerability evaluation to context search and runtime `load_context`. Retrieval evaluation records abstention metrics, but those metrics remain non-blocking initially. The policy is metadata-based and does not generate final answers.

## Consequences

- Search responses can tell clients whether retrieved context is sufficient.
- Runtime `load_context` records abstention without failing the run.
- No-answer evaluation starts connecting to real search behavior.
- Thresholds can be tightened later without introducing model dependencies.
- Existing retrieval storage remains compatible because answerability is computed at response time.

## Pending Risks

- Score thresholds are heuristic and mode-dependent.
- Mock-vector and hybrid scores still do not prove semantic relevance.
- Abstention is not answer generation and does not verify generated answer faithfulness.
- Synthetic no-answer fixtures can miss real-world ambiguity.
- Deleted or restricted context is excluded by search, but historical retrieval snapshots may still predate later deletion.
