# Project Spec

## Objective

Build TriForge Agentic Lab as an experimental system for coordinating AI agents with structured debate, traceability, memory, RAG/GraphRAG, code graph, task execution and monitoring.

## Scope

MVP scope is goals, mock debate rounds, persisted proposals, judge decision, timeline events, dashboard observation, mock runtime state transitions and Context Engine v0 lexical retrieval.

## Out of Scope

Real Codex, Claude, Gemini, Ollama, GraphRAG, code graph adapters, external embeddings and external source adapters are not part of this milestone.

## Main Entities

- Goal
- Debate round
- Agent proposal
- Judge decision
- Timeline event
- Context source
- Context document
- Context chunk
- Context retrieval

## Contracts

Contracts live in `packages/shared/src/index.ts` and are validated with Zod at API and web boundaries.

## Flows

- Create goal.
- Run one debate round with mock agents.
- Persist proposals and judge decision.
- Record timeline events.
- View latest round and timeline in dashboard.

## Acceptance Criteria

- pnpm is the only package manager.
- Postgres migrations are versioned and idempotent.
- API uses parametrized SQL and no ORM.
- Dashboard can recover persisted latest debate state.
- Harness validates MVP behavior against PostgreSQL.

## Risks

- Agent outputs will become untrusted when real adapters are introduced.
- Timeline payloads can grow without retention policy.
- Harness currently targets local PostgreSQL, not isolated ephemeral databases.

## Open Decisions

- Event retention and archival strategy.
- Adapter sandboxing model for CLI agents.
- Whether future harness should become a separate package.
