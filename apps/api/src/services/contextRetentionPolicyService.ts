import type {
  ContextAuditEvent,
  ContextChunk,
  ContextQuotaStatus,
  ContextRetentionPolicy
} from "@triforge/shared";
import { ConflictError, NotFoundError, PayloadTooLargeError } from "../domain/errors.js";
import type {
  ContextAuditEventRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  GoalsRepository
} from "../domain/ports.js";

export class ContextRetentionPolicyService {
  constructor(
    private readonly goalsRepository: GoalsRepository,
    private readonly contextSourceRepository: ContextSourceRepository,
    private readonly contextDocumentRepository: ContextDocumentRepository,
    private readonly contextRetrievalRepository: ContextRetrievalRepository,
    private readonly contextAuditEventRepository: ContextAuditEventRepository,
    private readonly policy: ContextRetentionPolicy = getDefaultPolicy()
  ) {}

  getDefaultPolicy(): ContextRetentionPolicy {
    return this.policy;
  }

  async validateDocumentIngestion(goalId: string, content: string): Promise<void> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }

    if (content.length > this.policy.maxDocumentCharacters) {
      await this.contextAuditEventRepository.create({
        goalId,
        eventType: "context_quota_rejected",
        actor: "system",
        reason: "max_document_characters_exceeded",
        payload: {
          contentSize: content.length,
          maxDocumentCharacters: this.policy.maxDocumentCharacters
        }
      });
      throw new PayloadTooLargeError(
        `Context document exceeds maxDocumentCharacters (${this.policy.maxDocumentCharacters})`
      );
    }

    const activeDocuments = await this.contextDocumentRepository.countActiveByGoal(goalId);
    if (activeDocuments >= this.policy.maxDocumentsPerGoal) {
      await this.contextAuditEventRepository.create({
        goalId,
        eventType: "context_quota_rejected",
        actor: "system",
        reason: "max_documents_per_goal_exceeded",
        payload: {
          activeDocuments,
          maxDocumentsPerGoal: this.policy.maxDocumentsPerGoal
        }
      });
      throw new ConflictError(
        `Goal has reached maxDocumentsPerGoal (${this.policy.maxDocumentsPerGoal})`
      );
    }
  }

  async validateChunking(documentId: string, chunks: Pick<ContextChunk, "content">[]): Promise<void> {
    const document = await this.contextDocumentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundError(`Context document ${documentId} was not found`);
    }
    const source = await this.contextSourceRepository.findById(document.sourceId);
    if (!source) {
      throw new NotFoundError(`Context source ${document.sourceId} was not found`);
    }

    await this.validateChunkingForSource(source.id, chunks, document.id);
  }

  async validateChunkingForSource(
    sourceId: string,
    chunks: Pick<ContextChunk, "content">[],
    documentId: string | null = null
  ): Promise<void> {
    const source = await this.contextSourceRepository.findById(sourceId);
    if (!source) {
      throw new NotFoundError(`Context source ${sourceId} was not found`);
    }

    const oversizedChunk = chunks.find(
      (chunk) => chunk.content.length > this.policy.maxChunkCharacters
    );
    if (oversizedChunk) {
      await this.contextAuditEventRepository.create({
        goalId: source.goalId,
        sourceId: source.id,
        documentId,
        eventType: "context_quota_rejected",
        actor: "system",
        reason: "max_chunk_characters_exceeded",
        payload: {
          chunkContentSize: oversizedChunk.content.length,
          maxChunkCharacters: this.policy.maxChunkCharacters
        }
      });
      throw new ConflictError(
        `Context chunk exceeds maxChunkCharacters (${this.policy.maxChunkCharacters})`
      );
    }

    if (chunks.length > this.policy.maxChunksPerDocument) {
      await this.contextAuditEventRepository.create({
        goalId: source.goalId,
        sourceId: source.id,
        documentId,
        eventType: "context_quota_rejected",
        actor: "system",
        reason: "max_chunks_per_document_exceeded",
        payload: {
          chunks: chunks.length,
          maxChunksPerDocument: this.policy.maxChunksPerDocument
        }
      });
      throw new ConflictError(
        `Context document exceeds maxChunksPerDocument (${this.policy.maxChunksPerDocument})`
      );
    }
  }

  async getQuotaStatus(goalId: string): Promise<ContextQuotaStatus> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }
    const activeDocuments = await this.contextDocumentRepository.countActiveByGoal(goalId);
    const retrievals = await this.contextRetrievalRepository.countByGoal(goalId);
    return {
      goalId,
      policy: this.policy,
      activeDocuments,
      maxDocumentsPerGoal: this.policy.maxDocumentsPerGoal,
      remainingDocuments: Math.max(0, this.policy.maxDocumentsPerGoal - activeDocuments),
      retrievals,
      maxRetrievalsPerGoal: this.policy.maxRetrievalsPerGoal,
      shouldPruneRetrievals: retrievals > this.policy.maxRetrievalsPerGoal
    };
  }

  async shouldPruneRetrievals(goalId: string): Promise<boolean> {
    const status = await this.getQuotaStatus(goalId);
    return status.shouldPruneRetrievals;
  }

  async listAuditEvents(goalId: string): Promise<ContextAuditEvent[]> {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }
    return this.contextAuditEventRepository.listByGoal(goalId);
  }
}

export function getDefaultPolicy(): ContextRetentionPolicy {
  return {
    maxDocumentsPerGoal: 100,
    maxDocumentCharacters: 200_000,
    maxChunksPerDocument: 500,
    maxChunkCharacters: 2_000,
    maxRetrievalsPerGoal: 1_000,
    maxEmbeddingRowsPerDocument: 500,
    hardDeleteAllowed: process.env.NODE_ENV !== "production",
    softDeleteDefault: true
  };
}
