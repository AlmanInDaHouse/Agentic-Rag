import { describe, expect, it } from "vitest";
import { ResolveApprovalGateSchema } from "@triforge/shared";
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentStepStatus,
  AgentStepType,
  ApprovalGate,
  CreateApprovalGate,
  CreateGoalRequest,
  Goal,
  GoalStatus,
  ResolveApprovalGate
} from "@triforge/shared";
import { ConflictError } from "../domain/errors.js";
import type {
  AgentRunRepository,
  AgentStepRepository,
  ApprovalGateRepository,
  CompleteStepInput,
  CreateRunInput,
  CreateStepInput,
  FailStepInput,
  GoalsRepository,
  TimelineEventInput,
  TimelineEventsRepository
} from "../domain/ports.js";
import { AgentRuntimeService } from "../services/agentRuntimeService.js";

const now = new Date("2026-06-01T10:00:00.000Z").toISOString();
const goal: Goal = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Build runtime state machine",
  description: "Create the first deterministic agent runtime loop.",
  status: "open",
  createdAt: now,
  updatedAt: now
};

let idCounter = 0;

type TestStepExecutor = (run: AgentRun, step: AgentStep) => Promise<Record<string, unknown>>;

function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

class MemoryGoalsRepository implements GoalsRepository {
  async create(input: CreateGoalRequest): Promise<Goal> {
    return { ...goal, ...input };
  }

  async list(): Promise<Goal[]> {
    return [goal];
  }

  async findById(id: string): Promise<Goal | null> {
    return id === goal.id ? goal : null;
  }

  async updateStatus(_id: string, _status: GoalStatus): Promise<void> {}
}

class MemoryAgentRunRepository implements AgentRunRepository {
  public runs = new Map<string, AgentRun>();

  async create(input: CreateRunInput): Promise<AgentRun> {
    const run: AgentRun = {
      id: nextId(),
      goalId: input.goalId,
      status: "created",
      objective: input.objective,
      definitionOfDone: input.definitionOfDone,
      requestedActions: input.requestedActions,
      currentStepIndex: 0,
      maxSteps: input.maxSteps,
      maxFailures: input.maxFailures,
      failureCount: 0,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now
    };
    this.runs.set(run.id, run);
    return run;
  }

  async findById(id: string): Promise<AgentRun | null> {
    return this.runs.get(id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<AgentRun | null> {
    return this.findById(id);
  }

  async listByGoal(goalId: string): Promise<AgentRun[]> {
    return [...this.runs.values()].filter((run) => run.goalId === goalId);
  }

  async updateStatus(id: string, status: AgentRunStatus): Promise<AgentRun> {
    const current = this.required(id);
    const next = {
      ...current,
      status,
      completedAt: ["completed", "failed", "cancelled", "stopped"].includes(status)
        ? now
        : current.completedAt,
      updatedAt: now
    };
    this.runs.set(id, next);
    return next;
  }

  async markStarted(id: string): Promise<AgentRun> {
    const current = this.required(id);
    const next = { ...current, status: "running" as const, startedAt: now, updatedAt: now };
    this.runs.set(id, next);
    return next;
  }

  async markCompleted(id: string): Promise<AgentRun> {
    const current = this.required(id);
    const next = { ...current, status: "completed" as const, completedAt: now, updatedAt: now };
    this.runs.set(id, next);
    return next;
  }

  async advanceIndex(id: string, nextStepIndex: number): Promise<AgentRun> {
    const current = this.required(id);
    const next = { ...current, currentStepIndex: nextStepIndex, updatedAt: now };
    this.runs.set(id, next);
    return next;
  }

  async incrementFailure(id: string): Promise<AgentRun> {
    const current = this.required(id);
    const next = { ...current, failureCount: current.failureCount + 1, updatedAt: now };
    this.runs.set(id, next);
    return next;
  }

  private required(id: string): AgentRun {
    const run = this.runs.get(id);
    if (!run) {
      throw new Error(`Missing run ${id}`);
    }
    return run;
  }
}

class MemoryAgentStepRepository implements AgentStepRepository {
  public steps: AgentStep[] = [];

  async create(input: CreateStepInput): Promise<AgentStep> {
    if (
      this.steps.some(
        (step) => step.runId === input.runId && step.stepIndex === input.stepIndex
      )
    ) {
      throw new ConflictError(`Run ${input.runId} already has a step at index ${input.stepIndex}`);
    }

    const step: AgentStep = {
      id: nextId(),
      runId: input.runId,
      stepIndex: input.stepIndex,
      type: input.type,
      status: "pending",
      input: input.input ?? {},
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.steps.push(step);
    return step;
  }

  async updateStatus(id: string, status: AgentStepStatus): Promise<AgentStep> {
    return this.replace(id, (step) => ({
      ...step,
      status,
      startedAt: status === "running" ? now : step.startedAt,
      updatedAt: now
    }));
  }

  async complete(input: CompleteStepInput): Promise<AgentStep> {
    return this.replace(input.stepId, (step) => ({
      ...step,
      status: "succeeded",
      output: input.output,
      completedAt: now,
      updatedAt: now
    }));
  }

  async fail(input: FailStepInput): Promise<AgentStep> {
    return this.replace(input.stepId, (step) => ({
      ...step,
      status: "failed",
      error: input.error,
      completedAt: now,
      updatedAt: now
    }));
  }

  async listByRun(runId: string): Promise<AgentStep[]> {
    return this.steps.filter((step) => step.runId === runId).sort((a, b) => a.stepIndex - b.stepIndex);
  }

  private replace(id: string, mapper: (step: AgentStep) => AgentStep): AgentStep {
    const index = this.steps.findIndex((step) => step.id === id);
    if (index === -1) {
      throw new Error(`Missing step ${id}`);
    }
    const next = mapper(this.steps[index]);
    this.steps[index] = next;
    return next;
  }
}

class MemoryApprovalGateRepository implements ApprovalGateRepository {
  public gates: ApprovalGate[] = [];

  async create(input: CreateApprovalGate): Promise<ApprovalGate> {
    const gate: ApprovalGate = {
      id: nextId(),
      runId: input.runId,
      stepId: input.stepId,
      status: "pending",
      riskLevel: input.riskLevel,
      actionType: input.actionType,
      actionPayload: input.actionPayload,
      reason: input.reason,
      requestedAt: now,
      resolvedAt: null,
      resolvedBy: null,
      actorRole: null,
      decision: null,
      expiresAt: input.expiresAt
    };
    this.gates.push(gate);
    return gate;
  }

  async findById(id: string): Promise<ApprovalGate | null> {
    return this.gates.find((gate) => gate.id === id) ?? null;
  }

  async findByIdForUpdate(id: string): Promise<ApprovalGate | null> {
    return this.findById(id);
  }

  async listByRun(runId: string): Promise<ApprovalGate[]> {
    return this.gates.filter((gate) => gate.runId === runId);
  }

  async listPendingByRunForUpdate(runId: string): Promise<ApprovalGate[]> {
    return this.gates.filter((gate) => gate.runId === runId && gate.status === "pending");
  }

  async resolve(
    id: string,
    input: ResolveApprovalGate & { decision: "approved" | "rejected" | "expired" }
  ): Promise<ApprovalGate> {
    const index = this.gates.findIndex((gate) => gate.id === id);
    if (index === -1) {
      throw new Error(`Missing gate ${id}`);
    }
    const next: ApprovalGate = {
      ...this.gates[index],
      status: input.decision,
      decision: input.decision,
      reason: input.reason,
      resolvedBy: input.resolvedBy,
      actorRole: input.actorRole,
      resolvedAt: now
    };
    this.gates[index] = next;
    return next;
  }
}

class MemoryTimelineEventsRepository implements TimelineEventsRepository {
  public events: TimelineEventInput[] = [];

  async create(input: TimelineEventInput) {
    this.events.push(input);
    return {
      id: nextId(),
      goalId: input.goalId,
      type: input.type,
      message: input.message,
      payload: input.payload ?? {},
      createdAt: now
    };
  }

  async listByGoal(): Promise<never[]> {
    return [];
  }
}

function createService(executeStep?: TestStepExecutor) {
  idCounter = 0;
  const runRepository = new MemoryAgentRunRepository();
  const stepRepository = new MemoryAgentStepRepository();
  const approvalGateRepository = new MemoryApprovalGateRepository();
  const timelineRepository = new MemoryTimelineEventsRepository();
  const service = new AgentRuntimeService(
    new MemoryGoalsRepository(),
    runRepository,
    stepRepository,
    approvalGateRepository,
    timelineRepository,
    executeStep
  );
  return { service, runRepository, stepRepository, approvalGateRepository, timelineRepository };
}

async function createStartedRun(
  service: AgentRuntimeService,
  budget: { maxSteps?: number; maxFailures?: number } = {}
) {
  const run = await service.createRun(goal.id, "Create a traceable mock runtime.", [], [], budget);
  return service.startRun(run.id);
}

describe("AgentRuntimeService", () => {
  it("creates a run and emits a timeline event", async () => {
    const { service, timelineRepository } = createService();

    const run = await service.createRun(goal.id, "Create a traceable mock runtime.");

    expect(run.status).toBe("created");
    expect(run.steps).toEqual([]);
    expect(timelineRepository.events.map((event) => event.type)).toEqual(["agent_run_created"]);
  });

  it("starts a created run", async () => {
    const { service } = createService();
    const run = await service.createRun(goal.id, "Create a traceable mock runtime.");

    const started = await service.startRun(run.id);

    expect(started.status).toBe("running");
    expect(started.startedAt).toBe(now);
  });

  it("advances one deterministic step", async () => {
    const { service } = createService();
    const run = await createStartedRun(service);

    const advanced = await service.advanceRunOneStep(run.id);

    expect(advanced.status).toBe("running");
    expect(advanced.currentStepIndex).toBe(1);
    expect(advanced.steps).toHaveLength(1);
    expect(advanced.steps[0].type).toBe("load_context");
    expect(advanced.steps[0].status).toBe("succeeded");
  });

  it("completes the run after the initial step sequence", async () => {
    const { service } = createService();
    let run = await createStartedRun(service);

    for (let index = 0; index < 7; index += 1) {
      run = await service.advanceRunOneStep(run.id);
    }

    expect(run.status).toBe("completed");
    expect(run.steps.map((step) => step.type satisfies AgentStepType)).toEqual([
      "load_context",
      "plan",
      "debate",
      "judge",
      "execute_mock_task",
      "validate",
      "summarize"
    ]);
  });

  it("creates an approval gate for high risk mock actions", async () => {
    const { service, timelineRepository } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "run_command", payload: { command: "pnpm test" } }]
    );
    run = await service.startRun(run.id);

    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    expect(run.status).toBe("waiting_for_approval");
    expect(run.approvalGates).toHaveLength(1);
    expect(run.approvalGates[0]).toMatchObject({
      status: "pending",
      riskLevel: "high",
      actionType: "run_command"
    });
    expect(run.steps.at(-1)).toMatchObject({
      type: "execute_mock_task",
      status: "waiting_for_approval"
    });
    expect(timelineRepository.events.map((event) => event.type)).toContain(
      "agent_run_waiting_for_approval"
    );
  });

  it("rejects advance while a run is waiting for approval", async () => {
    const { service } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "modify_code", payload: { path: "src/index.ts" } }]
    );
    run = await service.startRun(run.id);

    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    await expect(service.advanceRunOneStep(run.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("approves a gate and continues the run", async () => {
    const { service } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "run_command", payload: { command: "pnpm test" } }]
    );
    run = await service.startRun(run.id);
    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    run = await service.approveGate(run.approvalGates[0].id, {
      resolvedBy: "human",
      actorRole: "human_operator",
      reason: "Approved for mock execution"
    });

    expect(run.status).toBe("running");
    expect(run.currentStepIndex).toBe(5);
    expect(run.approvalGates[0].status).toBe("approved");
    expect(run.steps.find((step) => step.type === "execute_mock_task")?.status).toBe("succeeded");
  });

  it("rejects a gate and stops the run", async () => {
    const { service, timelineRepository } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "run_command", payload: { command: "pnpm test" } }]
    );
    run = await service.startRun(run.id);
    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    run = await service.rejectGate(run.approvalGates[0].id, {
      resolvedBy: "human",
      actorRole: "human_operator",
      reason: "Rejected for test"
    });

    expect(run.status).toBe("stopped");
    expect(run.approvalGates[0].status).toBe("rejected");
    expect(timelineRepository.events.map((event) => event.type)).toContain("agent_run_stopped");
  });

  it("fails blocked actions without creating a gate", async () => {
    const { service } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "delete_file", payload: { path: "important.ts" } }]
    );
    run = await service.startRun(run.id);

    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    expect(run.status).toBe("failed");
    expect(run.approvalGates).toEqual([]);
    expect(run.steps.find((step) => step.type === "execute_mock_task")?.error).toMatchObject({
      code: "ACTION_BLOCKED"
    });
  });

  it("rejects system approval for high risk gates", async () => {
    const { service } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "run_command", payload: { command: "pnpm test" } }]
    );
    run = await service.startRun(run.id);
    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    await expect(
      service.approveGate(run.approvalGates[0].id, {
        resolvedBy: "system",
        actorRole: "system",
        reason: "System cannot approve high risk"
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("expires pending gates and stops the run before approval", async () => {
    const { service, timelineRepository } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [
        {
          actionType: "run_command",
          payload: {
            command: "pnpm test",
            approvalExpiresAt: "2026-06-01T09:59:59.000Z"
          }
        }
      ]
    );
    run = await service.startRun(run.id);
    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }

    run = await service.approveGate(run.approvalGates[0].id, {
      resolvedBy: "human",
      actorRole: "human_operator",
      reason: "Too late"
    });

    expect(run.status).toBe("stopped");
    expect(run.approvalGates[0]).toMatchObject({
      status: "expired",
      decision: "expired",
      actorRole: "system"
    });
    expect(timelineRepository.events.map((event) => event.type)).toContain(
      "approval_gate_expired"
    );
  });

  it("rejects resolving gates when the run is terminal", async () => {
    const { service, runRepository } = createService();
    let run = await service.createRun(
      goal.id,
      "Create a traceable mock runtime.",
      [],
      [{ actionType: "run_command", payload: { command: "pnpm test" } }]
    );
    run = await service.startRun(run.id);
    while (run.status === "running") {
      run = await service.advanceRunOneStep(run.id);
    }
    await runRepository.updateStatus(run.id, "cancelled");

    await expect(
      service.rejectGate(run.approvalGates[0].id, {
        resolvedBy: "human",
        actorRole: "human_operator",
        reason: "Terminal run"
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps approval resolution payloads strict", () => {
    expect(
      ResolveApprovalGateSchema.safeParse({
        resolvedBy: "human",
        actorRole: "human_operator",
        reason: "ok",
        unexpected: true
      }).success
    ).toBe(false);
  });

  it("cancels a non-terminal run", async () => {
    const { service, timelineRepository } = createService();
    const run = await service.createRun(goal.id, "Create a traceable mock runtime.");

    const cancelled = await service.cancelRun(run.id);

    expect(cancelled.status).toBe("cancelled");
    expect(timelineRepository.events.map((event) => event.type)).toContain("agent_run_cancelled");
  });

  it("stops by max_steps after consuming the step budget", async () => {
    const { service } = createService();
    let run = await createStartedRun(service, { maxSteps: 2 });

    run = await service.advanceRunOneStep(run.id);
    run = await service.advanceRunOneStep(run.id);

    expect(run.status).toBe("stopped");
    expect(run.currentStepIndex).toBe(2);
    expect(run.steps.map((step) => step.type)).toEqual(["load_context", "plan"]);
  });

  it("treats max_steps as the maximum number of executed steps", async () => {
    const { service } = createService();
    let run = await createStartedRun(service, { maxSteps: 1 });

    run = await service.advanceRunOneStep(run.id);

    expect(run.status).toBe("stopped");
    expect(run.currentStepIndex).toBe(1);
    expect(run.steps.map((step) => step.type)).toEqual(["load_context"]);
  });

  it("fails a run when the failure budget is reached", async () => {
    const { service, timelineRepository } = createService(async () => {
      throw new Error("mock step failure");
    });
    const run = await createStartedRun(service, { maxFailures: 1 });

    const failed = await service.advanceRunOneStep(run.id);

    expect(failed.status).toBe("failed");
    expect(failed.failureCount).toBe(1);
    expect(failed.steps).toHaveLength(1);
    expect(failed.steps[0].status).toBe("failed");
    expect(failed.steps[0].error).toEqual({ message: "mock step failure" });
    expect(failed.steps.some((step) => step.status === "running")).toBe(false);
    expect(timelineRepository.events.map((event) => event.type)).toEqual([
      "agent_run_created",
      "agent_run_started",
      "agent_step_started",
      "agent_step_failed",
      "agent_run_failed"
    ]);
  });

  it("rejects advancing a terminal run", async () => {
    const { service } = createService();
    const run = await service.createRun(goal.id, "Create a traceable mock runtime.");
    const cancelled = await service.cancelRun(run.id);

    await expect(service.advanceRunOneStep(cancelled.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects starting a run from an invalid status", async () => {
    const { service } = createService();
    const started = await createStartedRun(service);

    await expect(service.startRun(started.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
