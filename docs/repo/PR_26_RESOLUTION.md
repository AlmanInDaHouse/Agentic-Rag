# PR #26 resolution (A10.10)

**Decision:** superseded — **closed**, history preserved. **Date:** 2026-06-30.

## The PR

- **#26** "feat: ingest Code Graph context pack" (Milestone 1.6H), opened 2026-06-08,
  **draft**, `feat/code-graph-context-ingestion` → `main`, +1454/-1 over 6 files.
- Adds a manual path that ingests the Code Graph **context pack** into the RAG
  **Context Engine** (derived source/documents/chunks, metadata, idempotency, tests).
- Explicit non-goals in the PR: *no GraphRAG, no runtime `load_context`, no dashboard, no
  external providers, no real models, no mandatory pgvector, no LLM-as-judge, no
  execution of repository code.*

## Classification: superseded

TriForge reoriented from a mock-only **RAG / Context-Engine / Code-Graph lab** into a
**local multi-agent CLI orchestrator** (Codex CLI + Claude Code). The shipped **A1–A9
release candidate** and the in-progress **A10 real-provider closure** are the 1.0; they do
not use the Context-Engine *ingestion* path. The Code-Graph **scanner** remains on `main`
(the CI `Validate` job still gates it), but the **ingestion** surface in #26 belongs to the
pre-reorientation 1.x RAG product and is out of the 1.0 scope.

## What was done

- **Not merged.** Merging would graft a 1.x product surface onto the 1.0.
- **Closed with an explanation** comment on the PR (2026-06-30).
- **History preserved.** The branch `feat/code-graph-context-ingestion` and its commit are
  **not deleted**; the work is fully recoverable if the RAG surface is revived.
- Recorded in `docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json` (`pr_26_resolved` =
  `verified`).

## Reversal path

If the RAG/Context-Engine direction is revived: reopen #26 (or re-branch from the preserved
commit), rebase on `main`, add tests, and bring it through the current `Validate` gate as a
modern PR. Nothing here blocks that.
