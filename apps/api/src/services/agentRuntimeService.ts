import type {
  ActionType,
  AgentRun,
  AgentRunWithDetails,
  AgentStep,
  AgentStepType,
  ApprovalGate,
  CreateAgentRun,
  ResolveApprovalGate,
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
import { SafeExecutionPolicyService } from "./safeExecutionPolicyService.js";

const stepSequence: AgentStepType[] = [
  "load_context",
  "plan",
  "debate",
  "judge",
  "execute_mock_task",
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
    private readonly executeStep: StepExecutor = executeMockStep,
    private readonly safeExecutionPolicyService = new SafeExecutionPolicyService()
  ) {}

  async createRun(
    goalId: string,
    objective: string,
    definitionOfDone: string[] = [],
    requestedActions: CreateAgentRun["requestedActions"] = [],
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
      requestedActions,
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
      input: stepInput(run, stepSequence[run.currentStepIndex])
    });
    const runningStep = await this.agentStepRepository.updateStatus(step.id, "running");
    await this.timelineEventsRepository.create({
      goalId: run.goalId,
      type: "agent_step_started",
      message: `Agent step ${runningStep.type} started.`,
      payload: { runId: run.id, stepId: runningStep.id, stepIndex: runningStep.stepIndex }
    });

    if (runningStep.type === "execute_mock_task") {
      const action = selectRequestedAction(run);
      const policy = this.safeExecutionPolicyService.classifyAction(
        action.actionType,
        action.payload
      );

      if (policy.blockedByDefault) {
        await this.agentStepRepository.fail({
          stepId: runningStep.id,
          error: {
            code: "ACTION_BLOCKED",
            actionType: action.actionType,
            riskLevel: policy.riskLevel,
            reason: policy.reason
          }
        });
        await this.timelineEventsRepository.create({
          goalId: run.goalId,
          type: "agent_step_failed",
          message: `Agent step ${runningStep.type} failed because the action is blocked.`,
          payload: {
            runId: run.id,
            stepId: runningStep.id,
            stepIndex: runningStep.stepIndex,
            code: "ACTION_BLOCKED",
            actionType: action.actionType,
            riskLevel: policy.riskLevel
          }
        });
        const failed = await this.agentRunRepository.updateStatus(run.id, "failed");
        await this.timelineEventsRepository.create({
          goalId: failed.goalId,
          type: "agent_run_failed",
          message: "Agent run failed because the requested action is blocked.",
          payload: {
            runId: failed.id,
            code: "ACTION_BLOCKED",
            actionType: action.actionType,
            riskLevel: policy.riskLevel
          }
        });
        return this.withDetails(failed);
      }

      if (policy.requiresApproval) {
        const waitingStep = await this.agentStepRepository.updateStatus(
          runningStep.id,
          "waiting_for_approval"
        );
        const gate = await this.approvalGateRepository.create({
          runId: run.id,
          stepId: waitingStep.id,
          riskLevel: policy.riskLevel,
          actionType: action.actionType,
          actionPayload: action.payload,
          reason: policy.reason,
          expiresAt: null
        });
        await this.timelineEventsRepository.create({
          goalId: run.goalId,
          type: "approval_gate_created",
          message: "Approval gate created for a high risk mock action.",
          payload: {
            runId: run.id,
            stepId: waitingStep.id,
            gateId: gate.id,
            actionType: gate.actionType,
            riskLevel: gate.riskLevel
          }
        });
        const waitingRun = await this.agentRunRepository.updateStatus(
          run.id,
          "waiting_for_approval"
        );
        await this.timelineEventsRepository.create({
          goalId: waitingRun.goalId,
          type: "agent_run_waiting_for_approval",
          message: "Agent run is waiting for human approval.",
          payload: { runId: waitingRun.id, gateId: gate.id }
        });
        return this.withDetails(waitingRun);
      }
    }

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

  async listApprovalGatesForRun(runId: string) {
    const run = await this.requiredRun(runId);
    return this.approvalGateRepository.listByRun(run.id);
  }

  async approveGate(
    gateId: string,
    input: ResolveApprovalGate
  ): Promise<AgentRunWithDetails> {
    const { gate, run } = await this.resolveGatePreconditions(gateId);
    const resolved = await this.approvalGateRepository.resolve(gate.id, {
      ...input,
      decision: "approved"
    });
    await this.timelineEventsRepository.create({
      goalId: run.goalId,
      type: "approval_gate_resolved",
      message: "Approval gate approved.",
      payload: {
        runId: run.id,
        gateId: resolved.id,
        decision: resolved.decision,
        resolvedBy: resolved.resolvedBy
      }
    });

    const waitingStep = await this.requiredGateStep(resolved);
    const succeededStep = await this.agentStepRepository.complete({
      stepId: waitingStep.id,
      output: {
        runId: run.id,
        stepType: waitingStep.type,
        summary: "Approved mock action completed without side effects.",
        actionType: resolved.actionType,
        riskLevel: resolved.riskLevel,
        deterministic: true,
        approved: true
      }
    });
    await this.timelineEventsRepository.create({
      goalId: run.goalId,
      type: "agent_step_succeeded",
      message: `Agent step ${succeededStep.type} succeeded after approval.`,
      payload: {
        runId: run.id,
        stepId: succeededStep.id,
        stepIndex: succeededStep.stepIndex,
        gateId: resolved.id
      }
    });

    const advanced = await this.agentRunRepository.advanceIndex(
      run.id,
      waitingStep.stepIndex + 1
    );
    const running = await this.agentRunRepository.updateStatus(advanced.id, "running");
    if (running.currentStepIndex >= stepSequence.length) {
      return this.completeRun(running);
    }
    if (running.currentStepIndex >= running.maxSteps) {
      return this.stopRun(running, "max_steps");
    }
    return this.withDetails(running);
  }

  async rejectGate(
    gateId: string,
    input: ResolveApprovalGate
  ): Promise<AgentRunWithDetails> {
    const { gate, run } = await this.resolveGatePreconditions(gateId);
    const resolved = await this.approvalGateRepository.resolve(gate.id, {
      ...input,
      decision: "rejected"
    });
    await this.timelineEventsRepository.create({
      goalId: run.goalId,
      type: "approval_gate_resolved",
      message: "Approval gate rejected.",
      payload: {
        runId: run.id,
        gateId: resolved.id,
        decision: resolved.decision,
        resolvedBy: resolved.resolvedBy
      }
    });

    if (resolved.stepId) {
      await this.agentStepRepository.fail({
        stepId: resolved.stepId,
        error: {
          code: "APPROVAL_REJECTED",
          actionType: resolved.actionType,
          reason: input.reason
        }
      });
    }

    const stopped = await this.agentRunRepository.updateStatus(run.id, "stopped");
    await this.timelineEventsRepository.create({
      goalId: stopped.goalId,
      type: "agent_run_stopped",
      message: "Agent run stopped because approval was rejected.",
      payload: {
        runId: stopped.id,
        gateId: resolved.id,
        stopCondition: "approval_rejected"
      }
    });
    return this.withDetails(stopped);
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

  private async resolveGatePreconditions(
    gateId: string
  ): Promise<{ gate: ApprovalGate; run: AgentRun }> {
    const gate = await this.approvalGateRepository.findById(gateId);
    if (!gate) {
      throw new NotFoundError(`Approval gate ${gateId} was not found`);
    }
    if (gate.status !== "pending") {
      throw new ConflictError(`Approval gate ${gateId} is not pending`);
    }

    const run = await this.requiredRun(gate.runId);
    if (terminalRunStatuses.has(run.status)) {
      throw new ConflictError(`Run ${run.id} is terminal and cannot resolve approval gates`);
    }
    return { gate, run };
  }

  private async requiredGateStep(gate: { runId: string; stepId: string | null }): Promise<AgentStep> {
    if (!gate.stepId) {
      throw new ConflictError("Approval gate is not attached to a step");
    }
    const steps = await this.agentStepRepository.listByRun(gate.runId);
    const step = steps.find((candidate) => candidate.id === gate.stepId);
    if (!step) {
      throw new NotFoundError(`Step ${gate.stepId} was not found`);
    }
    return step;
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

function stepInput(run: AgentRun, type: AgentStepType): Record<string, unknown> {
  const base = {
    objective: run.objective,
    definitionOfDone: run.definitionOfDone
  };
  if (type !== "execute_mock_task") {
    return base;
  }

  return {
    ...base,
    action: selectRequestedAction(run)
  };
}

function selectRequestedAction(run: AgentRun): { actionType: ActionType; payload: Record<string, unknown> } {
  const requested = run.requestedActions[0];
  if (requested) {
    return requested;
  }

  return {
    actionType: "write_artifact",
    payload: {
      artifactType: "mock_summary",
      sideEffects: false
    }
  };
}
