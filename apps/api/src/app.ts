import cors from "@fastify/cors";
import Fastify from "fastify";
import { pool } from "./db/pool.js";
import { PgDebateRepository } from "./repositories/debateRepository.js";
import { PgGoalsRepository } from "./repositories/goalsRepository.js";
import { registerRoutes } from "./http/routes.js";
import { PgAgentRunRepository } from "./repositories/agentRunRepository.js";
import { PgAgentStepRepository } from "./repositories/agentStepRepository.js";
import { PgApprovalGateRepository } from "./repositories/approvalGateRepository.js";
import { AgentRuntimeService } from "./services/agentRuntimeService.js";
import { DebateService } from "./services/debateService.js";
import { createMockAgents } from "./services/mockAgents.js";
import { HighestConfidenceJudge } from "./services/mockJudge.js";
import { PgTimelineEventsRepository } from "./repositories/timelineEventsRepository.js";
import { env } from "./config/env.js";

export async function buildApp() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true
  });

  const goalsRepository = new PgGoalsRepository(pool);
  const debateRepository = new PgDebateRepository(pool);
  const timelineEventsRepository = new PgTimelineEventsRepository(pool);
  const agentRunRepository = new PgAgentRunRepository(pool);
  const agentStepRepository = new PgAgentStepRepository(pool);
  const approvalGateRepository = new PgApprovalGateRepository(pool);
  const debateService = new DebateService(
    goalsRepository,
    debateRepository,
    createMockAgents(env.TRIFORGE_MOCK_AGENT_FAILURE_MODE),
    new HighestConfidenceJudge(),
    timelineEventsRepository
  );
  const agentRuntimeService = new AgentRuntimeService(
    goalsRepository,
    agentRunRepository,
    agentStepRepository,
    approvalGateRepository,
    timelineEventsRepository
  );

  await registerRoutes(
    app,
    goalsRepository,
    debateRepository,
    timelineEventsRepository,
    debateService,
    agentRuntimeService
  );
  return app;
}
