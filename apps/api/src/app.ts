import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { pool } from "./db/pool.js";
import { PgAgentRuntimeTransactionManager } from "./db/runtimeTransactionManager.js";
import { PgDebateRepository } from "./repositories/debateRepository.js";
import { PgGoalsRepository } from "./repositories/goalsRepository.js";
import { registerRoutes } from "./http/routes.js";
import { PgAgentRunRepository } from "./repositories/agentRunRepository.js";
import { PgAgentStepRepository } from "./repositories/agentStepRepository.js";
import { PgApprovalGateRepository } from "./repositories/approvalGateRepository.js";
import { PgContextChunkRepository } from "./repositories/contextChunkRepository.js";
import { PgContextDocumentRepository } from "./repositories/contextDocumentRepository.js";
import { PgContextRetrievalRepository } from "./repositories/contextRetrievalRepository.js";
import { PgContextSourceRepository } from "./repositories/contextSourceRepository.js";
import { PgContextAuditEventRepository } from "./repositories/contextAuditEventRepository.js";
import { PgChunkEmbeddingRepository } from "./repositories/chunkEmbeddingRepository.js";
import { PgEmbeddingModelRepository } from "./repositories/embeddingModelRepository.js";
import { AgentRuntimeService } from "./services/agentRuntimeService.js";
import { ContextEmbeddingService } from "./services/contextEmbeddingService.js";
import { ContextEngineService } from "./services/contextEngineService.js";
import { ContextRetentionPolicyService } from "./services/contextRetentionPolicyService.js";
import {
  JsonbEmbeddingStorage,
  PgvectorEmbeddingStorage
} from "./services/embeddings/embeddingStorage.js";
import { LocalEmbeddingAdapter } from "./services/embeddings/localEmbeddingAdapter.js";
import { MockEmbeddingAdapter } from "./services/embeddings/mockEmbeddingAdapter.js";
import { RagStatusService } from "./services/ragStatusService.js";
import { DebateService } from "./services/debateService.js";
import { createMockAgents } from "./services/mockAgents.js";
import { HighestConfidenceJudge } from "./services/mockJudge.js";
import { PgTimelineEventsRepository } from "./repositories/timelineEventsRepository.js";
import { env } from "./config/env.js";
import { ManualClock } from "./providers/clock.js";
import { WINDOWS_BASE_ENV_ALLOWLIST } from "./providers/real/index.js";
import { NodeGitRunner } from "./execution/worktree/index.js";
import { TrustedCommandRunner } from "./execution/command/trustedCommandRunner.js";
import { IntegratedRunService } from "./execution/integrated/index.js";
import { PgIntegratedRunStore } from "./execution/integrated/pgStore.js";
import { registerIntegratedRoutes } from "./http/integratedRoutes.js";

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
  const contextSourceRepository = new PgContextSourceRepository(pool);
  const contextDocumentRepository = new PgContextDocumentRepository(pool);
  const contextChunkRepository = new PgContextChunkRepository(pool);
  const contextRetrievalRepository = new PgContextRetrievalRepository(pool);
  const contextAuditEventRepository = new PgContextAuditEventRepository(pool);
  const embeddingModelRepository = new PgEmbeddingModelRepository(pool);
  const chunkEmbeddingRepository = new PgChunkEmbeddingRepository(pool);
  const agentRuntimeTransactionManager = new PgAgentRuntimeTransactionManager(pool);
  const mockEmbeddingAdapter = new MockEmbeddingAdapter();
  const localEmbeddingAdapter = new LocalEmbeddingAdapter({
    endpoint: env.TRIFORGE_LOCAL_EMBEDDING_ENDPOINT,
    dimension: env.TRIFORGE_LOCAL_EMBEDDING_DIMENSION
  });
  const jsonbEmbeddingStorage = new JsonbEmbeddingStorage(chunkEmbeddingRepository);
  const pgvectorEmbeddingStorage = new PgvectorEmbeddingStorage(pool);
  const ragStatusService = new RagStatusService(
    {
      embeddingProvider: env.TRIFORGE_EMBEDDING_PROVIDER,
      embeddingStorage: env.TRIFORGE_EMBEDDING_STORAGE
    },
    jsonbEmbeddingStorage,
    pgvectorEmbeddingStorage,
    localEmbeddingAdapter
  );
  const contextRetentionPolicyService = new ContextRetentionPolicyService(
    goalsRepository,
    contextSourceRepository,
    contextDocumentRepository,
    contextRetrievalRepository,
    contextAuditEventRepository
  );
  const contextEngineService = new ContextEngineService(
    goalsRepository,
    contextSourceRepository,
    contextDocumentRepository,
    contextChunkRepository,
    contextRetrievalRepository,
    undefined,
    embeddingModelRepository,
    chunkEmbeddingRepository,
    mockEmbeddingAdapter,
    undefined,
    contextRetentionPolicyService,
    contextAuditEventRepository,
    {
      configuredStorage: env.TRIFORGE_EMBEDDING_STORAGE
    },
    jsonbEmbeddingStorage,
    pgvectorEmbeddingStorage
  );
  const contextEmbeddingService = new ContextEmbeddingService(
    contextSourceRepository,
    contextDocumentRepository,
    contextChunkRepository,
    embeddingModelRepository,
    chunkEmbeddingRepository,
    mockEmbeddingAdapter,
    {
      configuredStorage: env.TRIFORGE_EMBEDDING_STORAGE
    },
    pgvectorEmbeddingStorage
  );
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
    timelineEventsRepository,
    undefined,
    undefined,
    agentRuntimeTransactionManager,
    contextEngineService
  );

  await registerRoutes(
    app,
    goalsRepository,
    debateRepository,
    timelineEventsRepository,
    debateService,
    agentRuntimeService,
    contextEngineService,
    contextEmbeddingService,
    ragStatusService
  );

  // A10-W.8b — integrated runtime (provider-mode-selected real/mock writable pipeline).
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const stateRoot =
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA && process.env.LOCALAPPDATA.trim() !== ""
            ? process.env.LOCALAPPDATA
            : path.join(os.homedir(), "AppData", "Local"),
          "TriForge"
        )
      : path.join(os.homedir(), ".triforge");
  const integratedRunService = new IntegratedRunService({
    store: new PgIntegratedRunStore(pool),
    gitRunner: new NodeGitRunner(),
    processRunner: new TrustedCommandRunner(),
    clock: new ManualClock(),
    stateRoot: path.join(stateRoot, "integrated"),
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    envAllowlist: [...WINDOWS_BASE_ENV_ALLOWLIST],
    commandConfig: { allowedCategories: ["read_only", "test", "build", "write_local"] }
  });
  registerIntegratedRoutes(app, integratedRunService, {
    repoRoot,
    defaultProviderMode: env.TRIFORGE_PROVIDER_MODE
  });

  return app;
}
