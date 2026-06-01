import cors from "@fastify/cors";
import Fastify from "fastify";
import { pool } from "./db/pool.js";
import { PgDebateRepository } from "./repositories/debateRepository.js";
import { PgGoalsRepository } from "./repositories/goalsRepository.js";
import { registerRoutes } from "./http/routes.js";
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
  const debateService = new DebateService(
    goalsRepository,
    debateRepository,
    createMockAgents(env.TRIFORGE_MOCK_AGENT_FAILURE_MODE),
    new HighestConfidenceJudge(),
    timelineEventsRepository
  );

  await registerRoutes(
    app,
    goalsRepository,
    debateRepository,
    timelineEventsRepository,
    debateService
  );
  return app;
}
