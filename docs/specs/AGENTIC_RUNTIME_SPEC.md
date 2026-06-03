# Agentic Runtime Spec

## Objective

Define a persisted, traceable state machine for mock agent execution runs. The runtime remains mock-only, but now includes safe execution policy checks and real approval gate transitions before any real adapters or subprocess execution are introduced.

## Scope

Milestone 1.3.1 supports deterministic mock runs over a goal, persisted steps, stop conditions, cancellation, approval gates, safe execution classification, transactional advance locking and timeline events.

## Out of Scope

Real Codex, Claude, Gemini or Ollama adapters, RAG, GraphRAG, code graph analysis, subprocess execution, worker queues, secrets, model rate limits and autonomous multi-cycle planning are not part of this milestone.

## Entities

- `agent_runs`: one runtime execution attached to a goal.
- `agent_steps`: ordered state transitions inside a run.
- `timeline_events`: shared event log reused for runtime traceability.
- `approval_gates`: persisted human approval boundary for high risk mock actions.
- `execution_policies`: initial policy seed describing action risk, approval and blocking defaults.
- `run_budgets`: represented on `agent_runs` as `max_steps`, `max_failures` and `failure_count`.
- `requested_actions`: optional mock action requests stored on `agent_runs` and evaluated by `execute_mock_task`.

## Run States

- `created`
- `queued`
- `running`
- `waiting_for_approval`
- `completed`
- `failed`
- `cancelled`
- `stopped`

Terminal states are `completed`, `failed`, `cancelled` and `stopped`.

## Step States

- `pending`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `waiting_for_approval`
- `cancelled`

## Step Types

- `load_context`
- `plan`
- `debate`
- `judge`
- `execute_mock_task`
- `validate`
- `summarize`

The default milestone flow is:

```text
load_context -> plan -> debate -> judge -> execute_mock_task -> validate -> summarize
```

`execute_mock_task` simulates one configured action from `requestedActions[0]`. If no action is provided, it uses a safe mock `write_artifact` action.

## Stop Conditions

- `max_steps`
- `max_failures`
- `manual_stop`
- `approval_rejected`
- `approval_expired`
- `definition_of_done_met`

`max_steps` means the maximum number of steps that may be executed. For example, `max_steps = 1` allows `load_context` to run and then stops the run with `agent_run_stopped`.

## Approval Flow

1. Runtime reaches `execute_mock_task`.
2. The requested action is classified by the safe execution policy.
3. If the action is blocked by default:
   - no approval gate is created,
   - the step is marked `failed`,
   - the run is marked `failed`,
   - `agent_step_failed` and `agent_run_failed` are recorded with `ACTION_BLOCKED`.
4. If the action requires approval:
   - an `approval_gates` row is created with status `pending`,
   - the gate stores `risk_level`, `action_type` and `action_payload`,
   - the step is marked `waiting_for_approval`,
   - the run is marked `waiting_for_approval`,
   - `approval_gate_created` and `agent_run_waiting_for_approval` are recorded.
5. `POST /api/runs/:runId/advance` returns `409 Conflict` while a run is `waiting_for_approval`.
6. Approving a pending gate:
   - marks the gate `approved`,
   - records `approval_gate_resolved`,
   - completes the waiting mock step without side effects,
   - advances the run to the next step and returns it to `running` unless a stop/completion condition applies.
7. Rejecting a pending gate:
   - marks the gate `rejected`,
   - records `approval_gate_resolved`,
   - marks the waiting step failed,
   - stops the run with stop condition `approval_rejected`,
   - records `agent_run_stopped`.
8. Expiring a pending gate:
   - occurs before approve/reject or before advance on a waiting run,
   - marks the gate `expired`,
   - records `approval_gate_expired`,
   - fails the waiting step with `APPROVAL_EXPIRED`,
   - stops the run with stop condition `approval_expired`.

## Concurrency

`POST /api/runs/:runId/advance` is serialized per run in the PostgreSQL-backed API runtime:

1. The service opens a transaction.
2. It locks the target `agent_runs` row with `SELECT ... FOR UPDATE NOWAIT`.
3. It validates run state, creates or updates the step, creates any approval gate, updates the run and writes timeline events inside the same transaction.
4. A concurrent advance that cannot acquire the row lock returns `409 Conflict`.
5. A later advance that observes a terminal or waiting run also returns `409 Conflict`.

This resolves duplicate step and duplicate terminal-event races for request-bound mock execution.

## Simulated Approval Actors

Approve/reject payloads require:

```json
{
  "resolvedBy": "human",
  "actorRole": "human_operator",
  "reason": "Approved for mock execution"
}
```

Allowed `actorRole` values:

- `human_operator`
- `admin`
- `system`

`human_operator` and `admin` can approve or reject high risk gates. `system` cannot manually approve or reject high or critical gates. Critical gates remain blocked by default and cannot be approved manually.

## Events

Runtime events reuse `timeline_events`:

- `agent_run_created`
- `agent_run_started`
- `agent_step_started`
- `agent_step_succeeded`
- `agent_step_failed`
- `agent_run_completed`
- `agent_run_failed`
- `agent_run_cancelled`
- `agent_run_stopped`
- `agent_run_waiting_for_approval`
- `approval_gate_created`
- `approval_gate_expired`
- `approval_gate_resolved`

## Contracts

Shared Zod contracts live in `packages/shared/src/index.ts`:

- `ActionTypeSchema`
- `RiskLevelSchema`
- `ExecutionPolicySchema`
- `ApprovalDecisionSchema`
- `CreateApprovalGateSchema`
- `ResolveApprovalGateSchema`
- `AgentRunStatusSchema`
- `AgentStepStatusSchema`
- `AgentStepTypeSchema`
- `CreateAgentRunSchema`
- `AgentRunSchema`
- `AgentStepSchema`
- `ApprovalGateSchema`
- `RunBudgetSchema`
- `StopConditionSchema`

All input schemas are strict.

## HTTP API

- `POST /api/goals/:goalId/runs`
- `GET /api/goals/:goalId/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/start`
- `POST /api/runs/:runId/advance`
- `POST /api/runs/:runId/cancel`
- `GET /api/runs/:runId/approval-gates`
- `POST /api/approval-gates/:gateId/approve`
- `POST /api/approval-gates/:gateId/reject`

Approve/reject payload:

```json
{
  "resolvedBy": "human",
  "actorRole": "human_operator",
  "reason": "Approved for mock execution"
}
```

## Error Rules

- `400` for invalid payloads or params.
- `404` when a goal, run or gate does not exist.
- `409` when starting from an invalid state.
- `409` when advancing terminal or non-running runs.
- `409` when advancing a run waiting for approval.
- `409` when cancelling terminal runs.
- `409` when resolving a non-pending gate.
- `409` when resolving a gate for a terminal run.
- `409` when the actor role cannot resolve the gate risk level.
- `400` when action endpoints receive unexpected payload fields.

## Acceptance Criteria

- Runtime schema is versioned in SQL migrations.
- No ORM is introduced; all SQL remains parametrized.
- Runs, steps and approval gates have shared Zod contracts.
- Creating a run records `agent_run_created`.
- Starting a run records `agent_run_started`.
- Advancing a run records step start/success events.
- A happy path run reaches `completed` after the default step sequence.
- A run with a low `max_steps` reaches `stopped`.
- A high risk mock action creates a pending approval gate.
- A run with a pending gate cannot advance.
- Approving a gate lets the run continue.
- Rejecting a gate stops the run with `approval_rejected`.
- Expiring a gate stops the run with `approval_expired`.
- Concurrent advance calls do not duplicate steps or terminal events.
- A blocked action creates no gate and fails the run with `ACTION_BLOCKED`.
- Unit tests cover critical service transitions and policy classification.
- Harness validates runtime behavior through public HTTP endpoints only.
- Dashboard can inspect gates, approve, reject and see `waiting_for_approval`.

## Risks

- The state machine is intentionally minimal and not a durable workflow engine.
- There is no retry delay, exponential backoff or worker queue yet.
- Approval gate authorization uses simulated actor roles but is not backed by real auth middleware.
- Timeline retention remains undefined.
