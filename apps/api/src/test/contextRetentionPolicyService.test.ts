import { describe, expect, it } from "vitest";
import type {
  ContextAuditEvent,
  ContextDocument,
  ContextRetrieval,
  ContextSource,
  Goal
} from "@triforge/shared";
import type {
  ContextAuditEventRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  CreateContextAuditEventInput,
  CreateContextDocumentInput,
  GoalsRepository
} from "../domain/ports.js";
import { ConflictError, PayloadTooLargeError } from "../domain/errors.js";
import {
  ContextRetentionPolicyService,
  getDefaultPolicy
} from "../services/contextRetentionPolicyService.js";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
const firstGoal: Goal = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "First goal",
  description: "First retention goal.",
  status: "open",
  createdAt: now,
  updatedAt: now
};
const secondGoal: Goal = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "Second goal",
  description: "Second retention goal.",
  status: "open",
  createdAt: now,
  updatedAt: now
};

describe("ContextRetentionPolicyService", () => {
  it("uses conservative local defaults", () => {
    expect(getDefaultPolicy()).toMatchObject({
      maxDocumentsPerGoal: 100,
      maxDocumentCharacters: 200_000,
      maxChunksPerDocument: 500,
      maxChunkCharacters: 2_000,
      maxRetrievalsPerGoal: 1_000,
      maxEmbeddingRowsPerDocument: 500,
      softDeleteDefault: true
    });
  });

  it("allows content exactly at maxDocumentCharacters without audit", async () => {
    const fixture = createRetentionFixture({ maxDocumentCharacters: 12 });

    await expect(
      fixture.service.validateDocumentIngestion(firstGoal.id, "a".repeat(12))
    ).resolves.toBeUndefined();

    expect(fixture.auditEventRepository.events).toEqual([]);
  });

  it("rejects content above maxDocumentCharacters and audits metadata only", async () => {
    const fixture = createRetentionFixture({ maxDocumentCharacters: 12 });

    await expect(
      fixture.service.validateDocumentIngestion(firstGoal.id, "secret-value-over-limit")
    ).rejects.toBeInstanceOf(PayloadTooLargeError);

    expect(fixture.auditEventRepository.events[0]).toMatchObject({
      eventType: "context_quota_rejected",
      reason: "max_document_characters_exceeded",
      payload: {
        contentSize: "secret-value-over-limit".length,
        maxDocumentCharacters: 12
      }
    });
    expect(JSON.stringify(fixture.auditEventRepository.events[0].payload)).not.toContain("secret-value");
  });

  it("enforces maxDocumentsPerGoal per goal and ignores deleted documents", async () => {
    const fixture = createRetentionFixture({ maxDocumentsPerGoal: 1 });
    fixture.documentRepository.seed(firstGoal.id, { deletedAt: null });
    fixture.documentRepository.seed(secondGoal.id, { deletedAt: null });

    await expect(
      fixture.service.validateDocumentIngestion(firstGoal.id, "new first goal content")
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      fixture.service.validateDocumentIngestion(secondGoal.id, "new second goal content")
    ).rejects.toBeInstanceOf(ConflictError);

    fixture.documentRepository.documents = fixture.documentRepository.documents.map((document) => (
      document.sourceId === firstGoal.id ? { ...document, deletedAt: now } : document
    ));

    await expect(
      fixture.service.validateDocumentIngestion(firstGoal.id, "new first goal content")
    ).resolves.toBeUndefined();
    await expect(
      fixture.service.validateDocumentIngestion(secondGoal.id, "new second goal content")
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

function createRetentionFixture(policy: Partial<ReturnType<typeof getDefaultPolicy>> = {}) {
  const goalsRepository = new InMemoryGoalsRepository();
  const sourceRepository = new InMemoryContextSourceRepository();
  const documentRepository = new InMemoryContextDocumentRepository();
  const retrievalRepository = new InMemoryContextRetrievalRepository();
  const auditEventRepository = new InMemoryContextAuditEventRepository();
  return {
    documentRepository,
    auditEventRepository,
    service: new ContextRetentionPolicyService(
      goalsRepository,
      sourceRepository,
      documentRepository,
      retrievalRepository,
      auditEventRepository,
      { ...getDefaultPolicy(), ...policy }
    )
  };
}

class InMemoryGoalsRepository implements GoalsRepository {
  async create() {
    return firstGoal;
  }
  async list() {
    return [firstGoal, secondGoal];
  }
  async findById(id: string) {
    return [firstGoal, secondGoal].find((goal) => goal.id === id) ?? null;
  }
  async updateStatus() {}
}

class InMemoryContextSourceRepository implements ContextSourceRepository {
  sources: ContextSource[] = [];
  async create(input: Parameters<ContextSourceRepository["create"]>[0]) {
    const source: ContextSource = {
      id: `00000000-0000-4000-8000-${String(this.sources.length + 500).padStart(12, "0")}`,
      goalId: input.goalId,
      name: input.name,
      type: input.type,
      metadata: input.metadata,
      deletedAt: null,
      deletedReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.sources.push(source);
    return source;
  }
  async findById(id: string) {
    return this.sources.find((source) => source.id === id) ?? null;
  }
  async listByGoal(goalId: string) {
    return this.sources.filter((source) => source.goalId === goalId);
  }
}

class InMemoryContextDocumentRepository implements ContextDocumentRepository {
  documents: ContextDocument[] = [];
  seed(goalId: string, input: { deletedAt: string | null }) {
    this.documents.push({
      id: `00000000-0000-4000-8000-${String(this.documents.length + 100).padStart(12, "0")}`,
      sourceId: goalId,
      title: "Seed",
      contentHash: "hash",
      classification: "internal",
      redactionStatus: "clean",
      sensitiveFindings: [],
      redactedContentHash: null,
      contentSize: 10,
      deletedAt: input.deletedAt,
      deletedReason: input.deletedAt ? "cleanup" : null,
      metadata: {},
      createdAt: now,
      updatedAt: now
    });
  }
  async create(input: CreateContextDocumentInput) {
    const document: ContextDocument = {
      id: `00000000-0000-4000-8000-${String(this.documents.length + 200).padStart(12, "0")}`,
      sourceId: input.sourceId,
      title: input.title,
      contentHash: input.contentHash,
      classification: input.classification,
      redactionStatus: input.redactionStatus,
      sensitiveFindings: input.sensitiveFindings,
      redactedContentHash: input.redactedContentHash,
      contentSize: input.contentSize,
      deletedAt: null,
      deletedReason: null,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now
    };
    this.documents.push(document);
    return document;
  }
  async findById(id: string) {
    return this.documents.find((document) => document.id === id) ?? null;
  }
  async findBySourceAndHash(sourceId: string, contentHash: string) {
    return this.documents.find((document) => (
      document.sourceId === sourceId && document.contentHash === contentHash
    )) ?? null;
  }
  async listBySource(sourceId: string) {
    return this.documents.filter((document) => document.sourceId === sourceId);
  }
  async countActiveByGoal(goalId: string) {
    return this.documents.filter((document) => (
      document.sourceId === goalId && !document.deletedAt
    )).length;
  }
  async softDelete(id: string, reason: string | null) {
    const document = this.documents.find((candidate) => candidate.id === id);
    if (!document) {
      throw new Error("missing document");
    }
    const deleted = { ...document, deletedAt: now, deletedReason: reason, updatedAt: now };
    this.documents = this.documents.map((candidate) => candidate.id === id ? deleted : candidate);
    return deleted;
  }
  async restore(id: string, reason: string | null) {
    const document = this.documents.find((candidate) => candidate.id === id);
    if (!document) {
      throw new Error("missing document");
    }
    const restored = { ...document, deletedAt: null, deletedReason: reason, updatedAt: now };
    this.documents = this.documents.map((candidate) => candidate.id === id ? restored : candidate);
    return restored;
  }
  async hardDelete(id: string) {
    this.documents = this.documents.filter((document) => document.id !== id);
  }
}

class InMemoryContextRetrievalRepository implements ContextRetrievalRepository {
  retrievals: ContextRetrieval[] = [];
  async create(input: { goalId: string; query: string; results: ContextRetrieval["results"] }) {
    const retrieval: ContextRetrieval = {
      id: `00000000-0000-4000-8000-${String(this.retrievals.length + 300).padStart(12, "0")}`,
      goalId: input.goalId,
      query: input.query,
      results: input.results,
      createdAt: now
    };
    this.retrievals.push(retrieval);
    return retrieval;
  }
  async listByGoal(goalId: string) {
    return this.retrievals.filter((retrieval) => retrieval.goalId === goalId);
  }
  async countByGoal(goalId: string) {
    return this.retrievals.filter((retrieval) => retrieval.goalId === goalId).length;
  }
}

class InMemoryContextAuditEventRepository implements ContextAuditEventRepository {
  events: ContextAuditEvent[] = [];
  async create(input: CreateContextAuditEventInput) {
    const event: ContextAuditEvent = {
      id: `00000000-0000-4000-8000-${String(this.events.length + 400).padStart(12, "0")}`,
      goalId: input.goalId ?? null,
      sourceId: input.sourceId ?? null,
      documentId: input.documentId ?? null,
      chunkId: input.chunkId ?? null,
      eventType: input.eventType,
      actor: input.actor ?? "system",
      reason: input.reason ?? null,
      payload: input.payload ?? {},
      createdAt: now
    };
    this.events.push(event);
    return event;
  }
  async listByGoal(goalId: string) {
    return this.events.filter((event) => event.goalId === goalId);
  }
}
