# Agentic Runtime Spec

## Objective

Define a persisted, traceable state machine for mock agent execution runs. This milestone turns the system from isolated debate rounds into a formal runtime skeleton that can later host real adapters.

## Scope

Milestone 1.2 supports deterministic mock runs over a goal, persisted steps, stop conditions, cancellation and timeline events.

## Out of Scope

Real Codex, Claude, Gemini or Ollama adapters, RAG, GraphRAG, code graph analysis, subprocess execution, secrets, model rate limits and autonomous multi-cycle planning are not part of this milestone.

## Entities

- `agent_runs`: one runtime execution attached to a goal.
- `agent_steps`: ordered state transitions inside a run.
- `timeline_events`: shared event log reused for runtime traceability.
- `approval_gates`: persisted placeholder for future human approval flow.
- `run_budgets`: represented on `agent_runs` as `max_steps`, `max_failures` and `failure_count`.
- `retry_policy`: intentionally not configurable yet; failed steps count against the failure budget.
- `stop_conditions`: documented reasons for terminal runtime stop.

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

## Initial Step Types

- `load_context`
- `plan`
- `debate`
- `judge`
- `execute_mock_task`
- `validate`
- `summarize`

The milestone flow is:

```text
load_context -> plan -> debate -> judge -> validate -> summarize
```

`execute_mock_task` is reserved in the contract for near-term mock task execution but is not part of the default flow yet.

## Stop Conditions

- `max_steps`
- `max_failures`
- `manual_stop`
- `approval_rejected`
- `definition_of_done_met`

`max_steps` means the maximum number of steps that may be executed. For example, `max_steps = 1` allows `load_context` to run and then stops the run with `agent_run_stopped`.

## Runtime Flow

1. Create a run for an existing goal.
2. Persist `agent_run_created`.
3. Start the run from `created` or `queued`.
4. Persist `agent_run_started`.
5. Advance one step per API call.
6. For each step, create it as `pending`, move it to `running`, produce deterministic mock output, then move it to `succeeded`.
7. Persist `agent_step_started` and `agent_step_succeeded`.
8. Complete after the milestone step sequence or stop when the step budget is consumed.
9. Reject advancing terminal runs with HTTP 409.
10. Reject cancelling terminal runs with HTTP 409. Cancellation is not idempotent in this milestone.

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
- `approval_gate_created`
- `approval_gate_resolved`

## Contracts

Shared Zod contracts live in `packages/shared/src/index.ts`:

- `AgentRunStatusSchema`
- `AgentStepStatusSchema`
- `AgentStepTypeSchema`
- `CreateAgentRunSchema`
- `AgentRunSchema`
- `AgentStepSchema`
- `ApprovalGateSchema`
- `RunBudgetSchema`
- `StopConditionSchema`

## HTTP API

- `POST /api/goals/:goalId/runs`
- `GET /api/goals/:goalId/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/start`
- `POST /api/runs/:runId/advance`
- `POST /api/runs/:runId/cancel`

## Error Rules

- `400` for invalid payloads or params.
- `404` when a goal or run does not exist.
- `409` when starting from an invalid state.
- `409` when advancing terminal or non-running runs.
- `409` when cancelling terminal runs.
- `400` when run action endpoints receive unexpected payload fields.

## Acceptance Criteria

- Runtime schema is versioned in SQL migrations.
- No ORM is introduced; all SQL remains parametrized.
- Runs, steps and approval gates have shared Zod contracts.
- Creating a run records `agent_run_created`.
- Starting a run records `agent_run_started`.
- Advancing a run records step start/success events.
- A happy path run reaches `completed` after the initial step sequence.
- A run with a low `max_steps` reaches `stopped`.
- `max_steps = 1` executes exactly one step and then reaches `stopped`.
- A cancelled run cannot advance.
- Terminal runs cannot be cancelled again.
- Failed step execution increments `failure_count`, marks the step `failed` and marks the run `failed` when `failure_count >= max_failures`.
- Unit tests cover critical service transitions.
- Harness validates runtime behavior through public HTTP endpoints only.
- Dashboard can create, start, advance, cancel and inspect runs.

## Risks

- The state machine is intentionally minimal and not a durable workflow engine.
- There is no retry delay, exponential backoff or worker queue yet.
- Approval gates are persisted but not yet exposed as a full human approval workflow.
- Timeline retention remains undefined.

## Open Decisions

- Whether to introduce a queue when real adapters arrive.
- Retry policy shape for model/subprocess failures.
- Approval gate UX and authorization model.
