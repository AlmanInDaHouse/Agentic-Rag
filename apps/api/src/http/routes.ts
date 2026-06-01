import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AgentRunSchema,
  AgentRunWithDetailsSchema,
  CreateAgentRunSchema,
  createGoalRequestSchema,
  debateRoundWithProposalsSchema,
  goalSchema,
  timelineEventSchema
} from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  DebateRepository,
  GoalsRepository,
  TimelineEventsRepository
} from "../domain/ports.js";
import type { DebateService } from "../services/debateService.js";
import type { AgentRuntimeService } from "../services/agentRuntimeService.js";

const goalParamsSchema = z.object({
  goalId: z.string().uuid()
});

const runParamsSchema = z.object({
  runId: z.string().uuid()
});

function sendZodError(reply: FastifyReply, error: z.ZodError): void {
  reply.status(400).send({
    error: "bad_request",
    message: error.issues.map((issue) => issue.message).join("; ")
  });
}

export async function registerRoutes(
  app: FastifyInstance,
  goalsRepository: GoalsRepository,
  debateRepository: DebateRepository,
  timelineEventsRepository: TimelineEventsRepository,
  debateService: DebateService,
  agentRuntimeService: AgentRuntimeService
): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/api/goals", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createGoalRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      sendZodError(reply, parsed.error);
      return;
    }

    const goal = await goalsRepository.create(parsed.data);
    await timelineEventsRepository.create({
      goalId: goal.id,
      type: "goal_created",
      message: `Goal "${goal.title}" created.`,
      payload: { title: goal.title }
    });
    reply.status(201).send(goalSchema.parse(goal));
  });

  app.get("/api/goals", async () => {
    const goals = await goalsRepository.list();
    return z.array(goalSchema).parse(goals);
  });

  app.post(
    "/api/goals/:goalId/debate-rounds",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = goalParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const round = await debateService.runDebateRound(parsedParams.data.goalId);
        reply.status(201).send(debateRoundWithProposalsSchema.parse(round));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  app.get(
    "/api/goals/:goalId/debate-rounds/latest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = goalParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      const round = await debateRepository.latestRoundWithProposals(parsedParams.data.goalId);
      if (!round) {
        reply.status(404).send({
          error: "not_found",
          message: "No debate round found for this goal"
        });
        return;
      }

      reply.send(debateRoundWithProposalsSchema.parse(round));
    }
  );

  app.get("/api/goals/:goalId/timeline", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = goalParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    const goal = await goalsRepository.findById(parsedParams.data.goalId);
    if (!goal) {
      reply.status(404).send({
        error: "not_found",
        message: `Goal ${parsedParams.data.goalId} was not found`
      });
      return;
    }

    const events = await timelineEventsRepository.listByGoal(parsedParams.data.goalId);
    reply.send(z.array(timelineEventSchema).parse(events));
  });

  app.post("/api/goals/:goalId/runs", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = goalParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    const parsedBody = CreateAgentRunSchema.safeParse(request.body);
    if (!parsedBody.success) {
      sendZodError(reply, parsedBody.error);
      return;
    }

    try {
      const run = await agentRuntimeService.createRun(
        parsedParams.data.goalId,
        parsedBody.data.objective,
        parsedBody.data.definitionOfDone,
        parsedBody.data.budget
      );
      reply.status(201).send(AgentRunWithDetailsSchema.parse(run));
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.status(404).send({ error: "not_found", message: error.message });
        return;
      }
      throw error;
    }
  });

  app.get("/api/goals/:goalId/runs", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = goalParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    try {
      const runs = await agentRuntimeService.listRunsForGoal(parsedParams.data.goalId);
      reply.send(z.array(AgentRunSchema).parse(runs));
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.status(404).send({ error: "not_found", message: error.message });
        return;
      }
      throw error;
    }
  });

  app.get("/api/runs/:runId", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = runParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    try {
      const run = await agentRuntimeService.getRun(parsedParams.data.runId);
      reply.send(AgentRunWithDetailsSchema.parse(run));
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.status(404).send({ error: "not_found", message: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/runs/:runId/start", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = runParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    try {
      const run = await agentRuntimeService.startRun(parsedParams.data.runId);
      reply.send(AgentRunWithDetailsSchema.parse(run));
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.status(404).send({ error: "not_found", message: error.message });
        return;
      }
      if (error instanceof ConflictError) {
        reply.status(409).send({ error: "conflict", message: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/runs/:runId/advance", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = runParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    try {
      const run = await agentRuntimeService.advanceRunOneStep(parsedParams.data.runId);
      reply.send(AgentRunWithDetailsSchema.parse(run));
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.status(404).send({ error: "not_found", message: error.message });
        return;
      }
      if (error instanceof ConflictError) {
        reply.status(409).send({ error: "conflict", message: error.message });
        return;
      }
      throw error;
    }
  });

  app.post("/api/runs/:runId/cancel", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = runParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }

    try {
      const run = await agentRuntimeService.cancelRun(parsedParams.data.runId);
      reply.send(AgentRunWithDetailsSchema.parse(run));
    } catch (error) {
      if (error instanceof NotFoundError) {
        reply.status(404).send({ error: "not_found", message: error.message });
        return;
      }
      if (error instanceof ConflictError) {
        reply.status(409).send({ error: "conflict", message: error.message });
        return;
      }
      throw error;
    }
  });
}
