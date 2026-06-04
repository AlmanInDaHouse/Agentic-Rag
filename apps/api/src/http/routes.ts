import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AgentRunSchema,
  AgentRunWithDetailsSchema,
  ApprovalGateSchema,
  ChunkEmbeddingSchema,
  ContextChunkSchema,
  ContextDocumentSchema,
  ContextRetrievalSchema,
  ContextSearchSchema,
  ContextSourceSchema,
  CreateAgentRunSchema,
  CreateContextDocumentSchema,
  CreateContextSourceSchema,
  EmbeddingModelSchema,
  GenerateEmbeddingsRequestSchema,
  ResolveApprovalGateSchema,
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
import type { ContextEmbeddingService } from "../services/contextEmbeddingService.js";
import type { ContextEngineService } from "../services/contextEngineService.js";

const goalParamsSchema = z.object({
  goalId: z.string().uuid()
});

const runParamsSchema = z.object({
  runId: z.string().uuid()
});

const gateParamsSchema = z.object({
  gateId: z.string().uuid()
});

const sourceParamsSchema = z.object({
  sourceId: z.string().uuid()
});

const documentParamsSchema = z.object({
  documentId: z.string().uuid()
});

const emptyBodySchema = z.union([z.undefined(), z.object({}).strict()]);

const embeddingGenerationResponseSchema = z.object({
  model: EmbeddingModelSchema,
  documentId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  generatedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  embeddings: z.array(ChunkEmbeddingSchema)
});

const documentEmbeddingCoverageResponseSchema = z.object({
  documentId: z.string().uuid(),
  model: EmbeddingModelSchema,
  chunkCount: z.number().int().nonnegative(),
  embeddedChunkCount: z.number().int().nonnegative(),
  coverage: z.number().min(0).max(1),
  embeddings: z.array(ChunkEmbeddingSchema)
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
  agentRuntimeService: AgentRuntimeService,
  contextEngineService: ContextEngineService,
  contextEmbeddingService: ContextEmbeddingService
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

  app.post(
    "/api/goals/:goalId/context/sources",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = goalParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = CreateContextSourceSchema.safeParse(request.body);
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const source = await contextEngineService.createSource(
          parsedParams.data.goalId,
          parsedBody.data
        );
        reply.status(201).send(ContextSourceSchema.parse(source));
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
    "/api/goals/:goalId/context/sources",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = goalParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const sources = await contextEngineService.listSources(parsedParams.data.goalId);
        reply.send(z.array(ContextSourceSchema).parse(sources));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/context/sources/:sourceId/documents",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = sourceParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = CreateContextDocumentSchema.safeParse(request.body);
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const result = await contextEngineService.addDocument(
          parsedParams.data.sourceId,
          parsedBody.data
        );
        reply.status(201).send({
          document: ContextDocumentSchema.parse(result.document),
          chunks: z.array(ContextChunkSchema).parse(result.chunks)
        });
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
    }
  );

  app.get(
    "/api/context/sources/:sourceId/documents",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = sourceParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const documents = await contextEngineService.listDocuments(parsedParams.data.sourceId);
        reply.send(z.array(ContextDocumentSchema).parse(documents));
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
    "/api/context/documents/:documentId/chunks",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = documentParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const chunks = await contextEngineService.listChunks(parsedParams.data.documentId);
        reply.send(z.array(ContextChunkSchema).parse(chunks));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  app.get("/api/embedding-models", async () => {
    const models = await contextEmbeddingService.listEmbeddingModels();
    return z.array(EmbeddingModelSchema).parse(models);
  });

  app.post(
    "/api/context/documents/:documentId/embeddings/mock",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = documentParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = GenerateEmbeddingsRequestSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const result = await contextEmbeddingService.generateEmbeddingsForDocument(
          parsedParams.data.documentId,
          parsedBody.data
        );
        reply.status(201).send(embeddingGenerationResponseSchema.parse(result));
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
    "/api/context/documents/:documentId/embeddings",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = documentParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const coverage = await contextEmbeddingService.getEmbeddingCoverageForDocument(
          parsedParams.data.documentId
        );
        reply.send(documentEmbeddingCoverageResponseSchema.parse(coverage));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/context/sources/:sourceId/embeddings/mock",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = sourceParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = GenerateEmbeddingsRequestSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const result = await contextEmbeddingService.generateEmbeddingsForSource(
          parsedParams.data.sourceId,
          parsedBody.data
        );
        reply.status(201).send(embeddingGenerationResponseSchema.parse(result));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  app.post(
    "/api/goals/:goalId/context/search",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = goalParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = ContextSearchSchema.safeParse(request.body);
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const retrieval = await contextEngineService.search(
          parsedParams.data.goalId,
          parsedBody.data
        );
        reply.status(201).send(ContextRetrievalSchema.parse(retrieval));
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
    "/api/goals/:goalId/context/retrievals",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = goalParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const retrievals = await contextEngineService.listRetrievals(parsedParams.data.goalId);
        reply.send(z.array(ContextRetrievalSchema).parse(retrievals));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

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
        parsedBody.data.requestedActions,
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

  app.get(
    "/api/runs/:runId/approval-gates",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = runParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }

      try {
        const gates = await agentRuntimeService.listApprovalGatesForRun(parsedParams.data.runId);
        reply.send(z.array(ApprovalGateSchema).parse(gates));
      } catch (error) {
        if (error instanceof NotFoundError) {
          reply.status(404).send({ error: "not_found", message: error.message });
          return;
        }
        throw error;
      }
    }
  );

  app.post("/api/runs/:runId/start", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = runParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      sendZodError(reply, parsedParams.error);
      return;
    }
    const parsedBody = emptyBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      sendZodError(reply, parsedBody.error);
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
    const parsedBody = emptyBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      sendZodError(reply, parsedBody.error);
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
    const parsedBody = emptyBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      sendZodError(reply, parsedBody.error);
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

  app.post(
    "/api/approval-gates/:gateId/approve",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = gateParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = ResolveApprovalGateSchema.safeParse(request.body);
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const run = await agentRuntimeService.approveGate(
          parsedParams.data.gateId,
          parsedBody.data
        );
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
    }
  );

  app.post(
    "/api/approval-gates/:gateId/reject",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsedParams = gateParamsSchema.safeParse(request.params);
      if (!parsedParams.success) {
        sendZodError(reply, parsedParams.error);
        return;
      }
      const parsedBody = ResolveApprovalGateSchema.safeParse(request.body);
      if (!parsedBody.success) {
        sendZodError(reply, parsedBody.error);
        return;
      }

      try {
        const run = await agentRuntimeService.rejectGate(
          parsedParams.data.gateId,
          parsedBody.data
        );
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
    }
  );
}
