# Debate Engine Spec

## Objective

Coordinate debate rounds over a goal and produce a persisted judge decision.

## Scope

The MVP supports one API call that starts a round, runs three mock agents, judges valid proposals and returns the round with proposals.

## Out of Scope

Multi-round strategies, rebuttals, voting, human approval and model-based judging.

## Main Entities

- Goal
- Debate round
- Agent proposal
- Judge decision
- Timeline event

## Contracts

`DebateRoundWithProposals` is the response contract for debate creation and latest-round retrieval.

## Flows

- Validate goal exists.
- Set goal to debating.
- Create next debate round.
- Persist proposals from valid agents.
- Select winning proposal.
- Complete or fail the round.

## Acceptance Criteria

- Exactly three mock agents are attempted in the MVP.
- Valid proposals are persisted with agent id and confidence.
- Judge decision references an existing proposal id.
- Failed proposals produce timeline events.

## Risks

- Current judge uses highest confidence and is intentionally simplistic.
- No transaction currently spans the entire orchestration.

## Open Decisions

- Whether debate orchestration should become transactional or event-sourced.
