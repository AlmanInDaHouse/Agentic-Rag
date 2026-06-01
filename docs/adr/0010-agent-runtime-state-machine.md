# ADR 0010: Agent Runtime State Machine

## Date

2026-06-01

## Status

Accepted

## Context

TriForge Agentic Lab already supports goals, mock debate rounds, persisted proposals, a mock judge and timeline events. The next milestone needs a formal runtime boundary before adding RAG, code graph features or real model adapters.

## Problem

Debate rounds alone do not represent a long-lived agent execution. The system needs persisted run state, ordered steps, cancellation, stop conditions and timeline traceability so future adapters can be tested and monitored without changing the public runtime contract.

## Decision

Implement a minimal in-house state machine persisted in PostgreSQL:

- `agent_runs` stores run status, objective, definition of done and budgets.
- `agent_steps` stores ordered deterministic mock steps.
- `approval_gates` reserves a persisted boundary for future human approvals.
- Runtime transitions emit `timeline_events`.
- HTTP endpoints start, advance and cancel one run at a time.
- The default milestone flow is `load_context -> plan -> debate -> judge -> validate -> summarize`.

No external workflow engine is introduced in this milestone.

## Alternatives Considered

### Continue with loose debate rounds

Rejected. Debate rounds are useful but do not model run budgets, cancellation, ordered execution or future approval gates.

### Add an external workflow engine

Rejected for now. Temporal or a similar engine may become useful later, but it adds infrastructure, operational concepts and dependency surface before the runtime contract is proven.

### Build a minimal state machine

Selected. A small persisted state machine fits the MVP, keeps behavior inspectable through SQL and timeline events, and gives the harness a stable black-box target.

## Final Decision

Use a custom minimal state machine, persisted in PostgreSQL, with no Temporal or external workflow engine yet. The design is oriented to traceability, harness validation and future adapter replacement.

## Consequences

- The runtime can be validated locally and in CI without model access.
- Dashboard and harness now exercise formal run transitions.
- Real adapters can later plug into step execution without redefining run states.
- The system remains small and understandable for the MVP.

## Pending Risks

- The service is not yet a distributed worker or queue.
- Step execution is synchronous and mock-only.
- Retry policy is minimal and only counted by failure budget.
- Approval gates are persisted but not a complete approval product flow.
- A future workflow engine may still be needed for durable long-running adapters.
