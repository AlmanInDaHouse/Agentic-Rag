# Agentic Runtime Spec

## Objective

Define the runtime boundary for invoking agents and judging results.

## Scope

Current runtime supports mock agents behind an `Agent` interface and a mock judge behind a `Judge` interface.

## Out of Scope

Real model adapters, subprocess management, secrets, rate limits and sandboxing.

## Main Entities

- Agent
- Proposal draft
- Judge
- Judge decision
- Runtime event

## Contracts

Agent outputs must satisfy the proposal contract before persistence. Invalid outputs are recorded as `agent_proposal_failed`.

## Flows

- Load participating agents.
- Ask each agent for a proposal.
- Validate each proposal.
- Persist valid proposals.
- Judge valid proposals.
- Mark round completed or failed.

## Acceptance Criteria

- One invalid agent output does not break the whole debate if valid proposals remain.
- A round with no valid proposals fails and cannot complete.
- Every meaningful runtime transition emits a timeline event.

## Risks

- Real adapters may hang, emit malformed data or leak secrets.
- Confidence scores from mock agents are not meaningful ranking signals.

## Open Decisions

- Adapter timeout defaults.
- Structured error taxonomy for real agent failures.
