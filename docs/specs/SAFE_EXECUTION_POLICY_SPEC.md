# Safe Execution Policy Spec

## Objective

Define what the mock runtime may classify as safe, what requires human approval, and what is blocked before real agent adapters, subprocesses or autonomous execution are introduced.

## Scope

Milestone 1.3 implements classification and approval gates only. It does not execute real commands, modify files, install packages, run migrations, call networks or connect real model adapters.

## Action Types

```text
read_context
plan
debate
judge
write_artifact
modify_code
run_command
install_dependency
db_migration
network_request
external_adapter_call
delete_file
git_operation
```

## Risk Levels

```text
low
medium
high
critical
```

## Policy Matrix

```text
low: can run automatically in the mock runtime.
medium: can run automatically with logging and existing runtime limits.
high: requires an approval gate.
critical: blocked by default.
```

## Initial Classification

- `read_context`: low, no approval.
- `plan`: low, no approval.
- `debate`: low, no approval.
- `judge`: low, no approval.
- `write_artifact`: medium, no approval in the mock runtime.
- `modify_code`: high, approval required.
- `run_command`: high, approval required.
- `install_dependency`: high with dependency review, approval required.
- `db_migration`: high when non-destructive, approval required.
- `network_request`: critical unless an approved adapter is declared.
- `external_adapter_call`: high, approval required.
- `delete_file`: critical, blocked by default.
- `git_operation`: high for normal operations, critical for dangerous operations.

## Actions Requiring Human Approval

At minimum:

```text
modify_code
run_command
install_dependency
db_migration
external_adapter_call
git_operation
```

`network_request` also requires approval when `adapterApproved` is true; otherwise it is blocked.

## Actions Blocked By Default

```text
delete_file
git_operation force push
git_operation delete branch
git_operation targeting main
db destructive migration
external network call without approved adapter
install_dependency without dependency review
```

Blocked actions do not create approval gates. They fail the mock step and fail the run with `ACTION_BLOCKED`.

## Approval Gate Creation

An approval gate is created when:

1. a run is `running`,
2. the runtime reaches `execute_mock_task`,
3. the action classification returns `requiresApproval = true`,
4. the action classification returns `blockedByDefault = false`.

The gate stores:

- `status = pending`
- `risk_level`
- `action_type`
- `action_payload`
- optional `reason`
- optional `expires_at`

The run becomes `waiting_for_approval`, and the step becomes `waiting_for_approval`.

## Approval

`POST /api/approval-gates/:gateId/approve` accepts:

```json
{
  "resolvedBy": "human",
  "reason": "Approved for mock execution"
}
```

Rules:

- missing gate returns `404`,
- non-pending gate returns `409`,
- terminal run returns `409`,
- invalid payload returns `400`.

Approval marks the gate `approved`, records `approval_gate_resolved`, completes the mock step without side effects and returns the run to `running` unless the run reaches completion or a stop condition.

## Rejection

`POST /api/approval-gates/:gateId/reject` accepts the same payload shape.

Rules:

- missing gate returns `404`,
- non-pending gate returns `409`,
- terminal run returns `409`,
- invalid payload returns `400`.

Rejection marks the gate `rejected`, records `approval_gate_resolved`, fails the waiting step and stops the run with stop condition `approval_rejected`.

## Events

- `approval_gate_created`
- `approval_gate_resolved`
- `agent_run_waiting_for_approval`
- `agent_run_stopped` on rejection
- `agent_step_failed` and `agent_run_failed` when an action is blocked

## Acceptance Criteria

- It is clear which action types exist.
- It is clear which risk levels exist.
- It is clear when an approval gate is created.
- It is clear when a run moves to `waiting_for_approval`.
- It is clear how a gate is approved.
- It is clear how a gate is rejected.
- It is clear which events are recorded.
- It is clear which actions are always blocked.
- No real external execution is introduced.
