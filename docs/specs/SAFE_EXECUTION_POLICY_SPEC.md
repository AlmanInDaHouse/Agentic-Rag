# Safe Execution Policy Spec

## Objective

Define what the mock runtime may classify as safe, what requires human approval, and what is blocked before real agent adapters, subprocesses or autonomous execution are introduced.

## Scope

Milestone 1.3.1 implements classification, approval gates, simulated actor-role enforcement and request-time gate expiration. It does not execute real commands, modify files, install packages, run migrations, call networks or connect real model adapters.

Context Engine v0 is limited to user-provided text through `manual_text`, `project_note` and `artifact` sources. Filesystem, web, GitHub, Gmail and Calendar context sources are out of scope and require future approval policy and adapter specs.

Context data policy now scans and redacts manual/project/artifact text before chunk persistence. RAG v1 planning treats embeddings over already persisted redacted chunks as medium risk when handled by an approved local or mock embedding adapter. Calls to external embedding providers are `external_adapter_call` and require future approval, stronger redaction/data handling policy and audit logging. Local model adapters must be explicitly registered before use. Context must not be sent to an external provider by default.

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

## Simulated Actor Roles

No real authentication is implemented yet. Approval requests must still provide an explicit simulated actor:

```json
{
  "resolvedBy": "human",
  "actorRole": "human_operator",
  "reason": "Approved for mock execution"
}
```

Allowed `actorRole` values:

```text
human_operator
admin
system
```

Role policy:

- `human_operator`: can approve or reject high risk gates.
- `admin`: can approve or reject high risk gates. Critical gates remain blocked in this milestone.
- `system`: cannot manually approve or reject high or critical gates. It is reserved for automatic expiration and blocking outcomes.
- `critical`: blocked by default and cannot be approved manually.

## Approval

`POST /api/approval-gates/:gateId/approve` accepts:

```json
{
  "resolvedBy": "human",
  "actorRole": "human_operator",
  "reason": "Approved for mock execution"
}
```

Rules:

- missing gate returns `404`,
- non-pending gate returns `409`,
- terminal run returns `409`,
- actor role not allowed for the gate risk returns `409`,
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

## Expiration

If `expires_at < now()` and the gate is still `pending`, the runtime resolves the gate automatically as expired:

- `status = expired`
- `decision = expired`
- `resolved_by = system`
- `actor_role = system`
- `reason = approval_expired`

Expiration is checked:

- before approve,
- before reject,
- before advance when a run is `waiting_for_approval`.

Expired gates emit `approval_gate_expired` and stop the run with stop condition `approval_expired`. There is no background cron or worker yet.

## Approval Concurrency

Approve/reject operations lock the approval gate and run rows inside a transaction in the PostgreSQL-backed API runtime. If two approval resolutions race, one wins and the other receives `409 Conflict` because the gate is locked or no longer pending.

## Terminal Runs

Approval resolution is rejected with `409 Conflict` when the attached run is terminal:

```text
completed
failed
cancelled
stopped
```

## Events

- `approval_gate_created`
- `approval_gate_expired`
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
- It is clear how a gate expires.
- It is clear how simulated actor roles are enforced.
- It is clear that terminal runs cannot resolve gates.
- It is clear which events are recorded.
- It is clear which actions are always blocked.
- No real external execution is introduced.
