# ADR 0011: Safe Execution Policy

## Date

2026-06-02

## Status

Accepted

## Context

TriForge Agentic Lab now has a persisted mock runtime state machine. The next risk boundary is execution safety: future adapters may request code changes, shell commands, dependency installs, migrations, network calls or git operations.

## Problem

Without an explicit policy, the runtime has no durable way to distinguish safe mock actions from actions that require human review or must be blocked. Adding real adapters before this boundary would make dangerous side effects harder to reason about and test.

## Decision

Introduce a safe execution policy with four risk levels:

- `low`
- `medium`
- `high`
- `critical`

High risk actions create approval gates. Critical actions are blocked by default. The current milestone only classifies and gates mock actions; it does not execute real commands, mutate files, install dependencies, run migrations, call external networks or invoke real model adapters.

Approval gates persist the action type, payload and risk level. Approving a gate completes the waiting mock step without side effects. Rejecting a gate stops the run with `approval_rejected`.

## Alternatives Considered

### Permit unrestricted execution

Rejected. It would create a large safety and reliability risk before the runtime has sandboxing, authorization, audit policy or adapter constraints.

### Block all execution

Rejected. It is safe but too coarse. It prevents testing the approval workflow and makes future adapter integration harder to stage.

### Risk-based policy with approval gates

Selected. It lets low and medium mock actions proceed, requires human approval for high risk actions and blocks critical actions by default.

## Final Decision

Use a risk-based safe execution policy backed by shared contracts, SQL migration fields and runtime approval gates. Keep all execution mock-only in this milestone.

## Consequences

- The runtime now has an explicit approval boundary before real adapters.
- Dashboard and harness can exercise approval and rejection flows.
- Blocked actions fail deterministically without creating gates.
- The policy can evolve without changing the runtime state model.

## Pending Risks

- Approval authorization uses simulated roles but is not yet connected to authenticated users.
- Gate expiration is enforced on request paths but not by a background worker.
- Runtime advance concurrency is handled by ADR 0012.
- Future adapters will still need sandboxing, subprocess limits, secrets handling and dependency review enforcement.
