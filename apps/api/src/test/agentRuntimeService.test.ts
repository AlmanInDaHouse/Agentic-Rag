import { describe, expect, it } from "vitest";
import type {
  AgentRun,
  AgentRunStatus,
  AgentStep,
  AgentStepStatus,
  AgentStepType,
  ApprovalGate,
  CreateGoalRequest,
  Goal,
  GoalStatus
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
  async listByRun(): Promise<ApprovalGate[]> {
    return [];
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
  const timelineRepository = new MemoryTimelineEventsRepository();
  const service = new AgentRuntimeService(
    new MemoryGoalsRepository(),
    runRepository,
    stepRepository,
    new MemoryApprovalGateRepository(),
    timelineRepository,
    executeStep
  );
  return { service, runRepository, stepRepository, timelineRepository };
}

async function createStartedRun(
  service: AgentRuntimeService,
  budget: { maxSteps?: number; maxFailures?: number } = {}
) {
  const run = await service.createRun(goal.id, "Create a traceable mock runtime.", [], budget);
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

    for (let index = 0; index < 6; index += 1) {
      run = await service.advanceRunOneStep(run.id);
    }

    expect(run.status).toBe("completed");
    expect(run.steps.map((step) => step.type satisfies AgentStepType)).toEqual([
      "load_context",
      "plan",
      "debate",
      "judge",
      "validate",
      "summarize"
    ]);
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
