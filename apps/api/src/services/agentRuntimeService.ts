import type {
  AgentRun,
  AgentRunWithDetails,
  AgentStep,
  AgentStepType,
  CreateAgentRun,
  RunBudget
} from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  AgentRunRepository,
  AgentStepRepository,
  ApprovalGateRepository,
  GoalsRepository,
  TimelineEventsRepository
} from "../domain/ports.js";

const stepSequence: AgentStepType[] = [
  "load_context",
  "plan",
  "debate",
  "judge",
  "validate",
  "summarize"
];

const terminalRunStatuses = new Set<AgentRun["status"]>([
  "completed",
  "failed",
  "cancelled",
  "stopped"
]);

type StepExecutor = (run: AgentRun, step: AgentStep) => Promise<Record<string, unknown>>;

export class AgentRuntimeService {
  constructor(
    private readonly goalsRepository: GoalsRepository,
    private readonly agentRunRepository: AgentRunRepository,
    private readonly agentStepRepository: AgentStepRepository,
    private readonly approvalGateRepository: ApprovalGateRepository,
    private readonly timelineEventsRepository: TimelineEventsRepository,
    private readonly executeStep: StepExecutor = executeMockStep
  ) {}

  async createRun(
    goalId: string,
    objective: string,
    definitionOfDone: string[] = [],
    budget: Partial<RunBudget> = {}
  ): Promise<AgentRunWithDetails> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }

    const run = await this.agentRunRepository.create({
      goalId,
      objective,
      definitionOfDone,
      maxSteps: budget.maxSteps ?? 12,
      maxFailures: budget.maxFailures ?? 3
    });
    await this.timelineEventsRepository.create({
      goalId,
      type: "agent_run_created",
      message: "Agent run created.",
      payload: { runId: run.id, objective: run.objective }
    });

    return this.withDetails(run);
  }

  async getRun(runId: string): Promise<AgentRunWithDetails> {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} was not found`);
    }
    return this.withDetails(run);
  }

  async listRunsForGoal(goalId: string): Promise<AgentRun[]> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }
    return this.agentRunRepository.listByGoal(goalId);
  }

  async startRun(runId: string): Promise<AgentRunWithDetails> {
    const run = await this.requiredRun(runId);
    if (run.status !== "created" && run.status !== "queued") {
      throw new ConflictError(`Run ${runId} cannot be started from status ${run.status}`);
    }

    const started = await this.agentRunRepository.markStarted(runId);
    await this.timelineEventsRepository.create({
      goalId: started.goalId,
      type: "agent_run_started",
      message: "Agent run started.",
      payload: { runId: started.id }
    });
    return this.withDetails(started);
  }

  async advanceRunOneStep(runId: string): Promise<AgentRunWithDetails> {
    const run = await this.requiredRun(runId);
    if (terminalRunStatuses.has(run.status)) {
      throw new ConflictError(`Run ${runId} is terminal and cannot advance`);
    }
    if (run.status !== "running") {
      throw new ConflictError(`Run ${runId} must be running before it can advance`);
    }

    if (run.currentStepIndex >= stepSequence.length) {
      return this.completeRun(run);
    }
    if (run.currentStepIndex >= run.maxSteps) {
      return this.stopRun(run, "max_steps");
    }

    const step = await this.agentStepRepository.create({
      runId: run.id,
      stepIndex: run.currentStepIndex,
      type: stepSequence[run.currentStepIndex],
      input: {
        objective: run.objective,
        definitionOfDone: run.definitionOfDone
      }
    });
    const runningStep = await this.agentStepRepository.updateStatus(step.id, "running");
    await this.timelineEventsRepository.create({
      goalId: run.goalId,
      type: "agent_step_started",
      message: `Agent step ${runningStep.type} started.`,
      payload: { runId: run.id, stepId: runningStep.id, stepIndex: runningStep.stepIndex }
    });

    try {
      const output = await this.executeStep(run, runningStep);
      const succeededStep = await this.agentStepRepository.complete({
        stepId: runningStep.id,
        output
      });
      await this.timelineEventsRepository.create({
        goalId: run.goalId,
        type: "agent_step_succeeded",
        message: `Agent step ${succeededStep.type} succeeded.`,
        payload: { runId: run.id, stepId: succeededStep.id, stepIndex: succeededStep.stepIndex }
      });

      const advanced = await this.agentRunRepository.advanceIndex(run.id, run.currentStepIndex + 1);
      if (advanced.currentStepIndex >= stepSequence.length) {
        return this.completeRun(advanced);
      }
      if (advanced.currentStepIndex >= advanced.maxSteps) {
        return this.stopRun(advanced, "max_steps");
      }
      return this.withDetails(advanced);
    } catch (error) {
      await this.agentStepRepository.fail({
        stepId: runningStep.id,
        error: { message: error instanceof Error ? error.message : "Unknown step error" }
      });
      await this.timelineEventsRepository.create({
        goalId: run.goalId,
        type: "agent_step_failed",
        message: `Agent step ${runningStep.type} failed.`,
        payload: {
          runId: run.id,
          stepId: runningStep.id,
          stepIndex: runningStep.stepIndex,
          error: error instanceof Error ? error.message : "Unknown step error"
        }
      });

      const failedRun = await this.agentRunRepository.incrementFailure(run.id);
      if (failedRun.failureCount >= failedRun.maxFailures) {
        const terminal = await this.agentRunRepository.updateStatus(failedRun.id, "failed");
        await this.timelineEventsRepository.create({
          goalId: terminal.goalId,
          type: "agent_run_failed",
          message: "Agent run failed after reaching the failure budget.",
          payload: { runId: terminal.id, stopCondition: "max_failures" }
        });
        return this.withDetails(terminal);
      }

      return this.withDetails(failedRun);
    }
  }

  async cancelRun(runId: string): Promise<AgentRunWithDetails> {
    const run = await this.requiredRun(runId);
    if (terminalRunStatuses.has(run.status)) {
      throw new ConflictError(`Run ${runId} is terminal and cannot be cancelled`);
    }

    const cancelled = await this.agentRunRepository.updateStatus(run.id, "cancelled");
    await this.timelineEventsRepository.create({
      goalId: cancelled.goalId,
      type: "agent_run_cancelled",
      message: "Agent run cancelled.",
      payload: { runId: cancelled.id, stopCondition: "manual_stop" }
    });
    return this.withDetails(cancelled);
  }

  private async requiredRun(runId: string): Promise<AgentRun> {
    const run = await this.agentRunRepository.findById(runId);
    if (!run) {
      throw new NotFoundError(`Run ${runId} was not found`);
    }
    return run;
  }

  private async completeRun(run: AgentRun): Promise<AgentRunWithDetails> {
    const completed = await this.agentRunRepository.markCompleted(run.id);
    await this.timelineEventsRepository.create({
      goalId: completed.goalId,
      type: "agent_run_completed",
      message: "Agent run completed.",
      payload: { runId: completed.id, stopCondition: "definition_of_done_met" }
    });
    return this.withDetails(completed);
  }

  private async stopRun(run: AgentRun, stopCondition: "max_steps"): Promise<AgentRunWithDetails> {
    const stopped = await this.agentRunRepository.updateStatus(run.id, "stopped");
    await this.timelineEventsRepository.create({
      goalId: stopped.goalId,
      type: "agent_run_stopped",
      message: "Agent run stopped by stop condition.",
      payload: { runId: stopped.id, stopCondition }
    });
    return this.withDetails(stopped);
  }

  private async withDetails(run: AgentRun): Promise<AgentRunWithDetails> {
    const [steps, approvalGates] = await Promise.all([
      this.agentStepRepository.listByRun(run.id),
      this.approvalGateRepository.listByRun(run.id)
    ]);
    return { ...run, steps, approvalGates };
  }
}

async function executeMockStep(run: AgentRun, step: AgentStep): Promise<Record<string, unknown>> {
  return {
    runId: run.id,
    stepType: step.type,
    summary: mockStepSummary(step.type),
    deterministic: true
  };
}

function mockStepSummary(type: AgentStepType): string {
  switch (type) {
    case "load_context":
      return "Loaded goal context and current runtime state.";
    case "plan":
      return "Created a minimal execution plan.";
    case "debate":
      return "Collected mock debate considerations.";
    case "judge":
      return "Selected a deterministic mock direction.";
    case "execute_mock_task":
      return "Executed a mock task without side effects.";
    case "validate":
      return "Validated mocked outputs against the runtime contract.";
    case "summarize":
      return "Summarized the run outcome.";
  }
}
