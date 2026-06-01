# Dashboard Spec

## Objective

Provide a simple operational dashboard for observing goals, debate output, judge decisions and timeline events.

## Scope

React + Vite dashboard for local MVP use.

## Out of Scope

Authentication, multi-user collaboration, charts, live streaming and advanced filtering.

## Main Entities

- Goal list item
- Goal detail
- Debate proposal
- Judge decision
- Timeline event

## Contracts

The dashboard consumes shared Zod contracts from `@triforge/shared`.

## Flows

- Load goals.
- Create goal.
- Select goal.
- Load latest debate round.
- Launch debate.
- Load timeline events.

## Acceptance Criteria

- User can create and select goals.
- User can launch debate.
- User can see proposals and final decision.
- User can see timeline events for the selected goal.
- State recovers from persisted API responses after reload.

## Risks

- Polling/live updates are not implemented.
- Timeline payload details are not deeply formatted.

## Open Decisions

- Whether to add live event streaming through SSE or WebSocket.
