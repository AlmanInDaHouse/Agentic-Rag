import { createHash } from "node:crypto";
import type {
  ContextChunk,
  ContextDocument,
  ContextRetrieval,
  ContextSearch,
  ContextSearchResult,
  ContextQuotaStatus,
  ContextAuditEvent,
  DeleteContextDocument,
  RagSearchMode,
  RestoreContextDocument,
  RedactionResult,
  ContextSource,
  CreateContextDocument,
  CreateContextSource,
  EmbeddingModel
} from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  ContextAuditEventRepository,
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextRetrievalRepository,
  ContextSourceRepository,
  ChunkEmbeddingRepository,
  EmbeddingModelRepository,
  GoalsRepository
} from "../domain/ports.js";
import { ContextChunkingService, normalizeText } from "./contextChunkingService.js";
import type { EmbeddingAdapter } from "./embeddings/embeddingAdapter.js";
import {
  cosineSimilarity,
  MockEmbeddingAdapter,
  normalizeCosineScore
} from "./embeddings/mockEmbeddingAdapter.js";
import type { EmbeddingStorage, EmbeddingStorageSearchResult } from "./embeddings/embeddingStorage.js";
import { ContextRedactionService } from "./contextRedactionService.js";
import { ContextRetentionPolicyService } from "./contextRetentionPolicyService.js";

const candidateLimit = 500;

export type ContextEngineVectorStorageConfig = {
  configuredStorage: "jsonb" | "pgvector";
};

export class ContextEngineService {
  constructor(
    private readonly goalsRepository: GoalsRepository,
    private readonly contextSourceRepository: ContextSourceRepository,
    private readonly contextDocumentRepository: ContextDocumentRepository,
    private readonly contextChunkRepository: ContextChunkRepository,
    private readonly contextRetrievalRepository: ContextRetrievalRepository,
    private readonly chunkingService = new ContextChunkingService(),
    private readonly embeddingModelRepository?: EmbeddingModelRepository,
    private readonly chunkEmbeddingRepository?: ChunkEmbeddingRepository,
    private readonly embeddingAdapter: EmbeddingAdapter = new MockEmbeddingAdapter(),
    private readonly contextRedactionService = new ContextRedactionService(),
    private readonly contextRetentionPolicyService?: ContextRetentionPolicyService,
    private readonly contextAuditEventRepository?: ContextAuditEventRepository,
    private readonly vectorStorageConfig: ContextEngineVectorStorageConfig = {
      configuredStorage: "jsonb"
    },
    private readonly jsonbEmbeddingStorage?: EmbeddingStorage,
    private readonly pgvectorEmbeddingStorage?: EmbeddingStorage
  ) {}

  async createSource(
    goalId: string,
    input: CreateContextSource
  ): Promise<ContextSource> {
    await this.requiredGoal(goalId);
    return this.contextSourceRepository.create({
      goalId,
      ...input
    });
  }

  async listSources(goalId: string): Promise<ContextSource[]> {
    await this.requiredGoal(goalId);
    return this.contextSourceRepository.listByGoal(goalId);
  }

  async addDocument(
    sourceId: string,
    input: CreateContextDocument
  ): Promise<{ document: ContextDocument; chunks: ContextChunk[] }> {
    const source = await this.requiredSource(sourceId);
    if (source.deletedAt) {
      throw new ConflictError(`Context source ${source.id} is deleted`);
    }
    if (!source.goalId) {
      throw new ConflictError(`Context source ${source.id} is detached from a goal`);
    }
    const normalizedContent = normalizeText(input.content);
    await this.contextRetentionPolicyService?.validateDocumentIngestion(
      source.goalId,
      normalizedContent
    );
    const contentHash = stableContentHash(normalizedContent);
    const existing = await this.contextDocumentRepository.findBySourceAndHash(source.id, contentHash);
    if (existing) {
      throw new ConflictError("Context document already exists for this source");
    }
    const redaction = this.contextRedactionService.redactText(normalizedContent);
    if (redaction.classification === "restricted" || redaction.redactionStatus === "blocked") {
      throw new ConflictError("Context document contains restricted data and was blocked by policy");
    }
    const contentForChunks =
      redaction.redactionStatus === "redacted"
        ? normalizeText(redaction.redactedContent)
        : normalizedContent;
    const drafts = this.chunkingService.chunk(contentForChunks);
    await this.contextRetentionPolicyService?.validateChunkingForSource(source.id, drafts);
    const redactedContentHash =
      redaction.redactionStatus === "redacted"
        ? stableContentHash(contentForChunks)
        : null;

    const document = await this.contextDocumentRepository.create({
      sourceId: source.id,
      title: input.title,
      contentHash,
      classification: redaction.classification,
      redactionStatus: redaction.redactionStatus,
      sensitiveFindings: redaction.findings,
      redactedContentHash,
      contentSize: normalizedContent.length,
      metadata: input.metadata
    });
    const chunks = await this.contextChunkRepository.createMany(
      drafts.map((chunk) => ({
        documentId: document.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        contentSize: chunk.content.length,
        tokenEstimate: chunk.tokenEstimate,
        redactionStatus: redaction.redactionStatus,
        metadata: {
          sourceType: source.type,
          classification: redaction.classification,
          redactionStatus: redaction.redactionStatus
        }
      }))
    );
    return { document, chunks };
  }

  previewRedaction(content: string): RedactionResult {
    return this.contextRedactionService.redactText(normalizeText(content));
  }

  async getQuotaStatus(goalId: string): Promise<ContextQuotaStatus> {
    if (!this.contextRetentionPolicyService) {
      throw new ConflictError("Context retention policy service is unavailable");
    }
    return this.contextRetentionPolicyService.getQuotaStatus(goalId);
  }

  async listAuditEvents(goalId: string): Promise<ContextAuditEvent[]> {
    if (!this.contextRetentionPolicyService) {
      throw new ConflictError("Context retention policy service is unavailable");
    }
    return this.contextRetentionPolicyService.listAuditEvents(goalId);
  }

  async listDocuments(sourceId: string): Promise<ContextDocument[]> {
    await this.requiredSource(sourceId);
    return this.contextDocumentRepository.listBySource(sourceId);
  }

  async listChunks(documentId: string) {
    const document = await this.contextDocumentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundError(`Context document ${documentId} was not found`);
    }
    return this.contextChunkRepository.listByDocument(document.id);
  }

  async deleteDocument(
    documentId: string,
    input: DeleteContextDocument
  ): Promise<ContextDocument | null> {
    const document = await this.contextDocumentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundError(`Context document ${documentId} was not found`);
    }
    const source = await this.requiredSource(document.sourceId);
    if (input.hardDelete) {
      const policy = this.contextRetentionPolicyService?.getDefaultPolicy();
      if (!policy?.hardDeleteAllowed) {
        throw new ConflictError("Hard delete is not allowed by the active retention policy");
      }
      await this.contextAuditEventRepository?.create({
        goalId: source.goalId,
        sourceId: source.id,
        documentId: document.id,
        eventType: "context_hard_deleted",
        actor: input.actor,
        reason: input.reason ?? null,
        payload: {
          title: document.title,
          contentSize: document.contentSize
        }
      });
      await this.contextDocumentRepository.hardDelete(document.id);
      return null;
    }
    if (document.deletedAt) {
      throw new ConflictError(`Context document ${document.id} is already deleted`);
    }
    const reason = input.reason ?? null;
    await this.contextChunkRepository.softDeleteByDocument(document.id, reason);
    await this.chunkEmbeddingRepository?.softDeleteByDocument(document.id);
    const deleted = await this.contextDocumentRepository.softDelete(document.id, reason);
    await this.contextAuditEventRepository?.create({
      goalId: source.goalId,
      sourceId: source.id,
      documentId: document.id,
      eventType: "context_document_deleted",
      actor: input.actor,
      reason,
      payload: {
        hardDelete: false,
        title: document.title,
        contentSize: document.contentSize
      }
    });
    return deleted;
  }

  async restoreDocument(
    documentId: string,
    input: RestoreContextDocument
  ): Promise<ContextDocument> {
    const document = await this.contextDocumentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundError(`Context document ${documentId} was not found`);
    }
    if (!document.deletedAt) {
      throw new ConflictError(`Context document ${document.id} is not deleted`);
    }
    const source = await this.requiredSource(document.sourceId);
    if (source.deletedAt) {
      throw new ConflictError(`Context source ${source.id} is deleted`);
    }
    const reason = input.reason ?? null;
    await this.contextChunkRepository.restoreByDocument(document.id);
    await this.chunkEmbeddingRepository?.restoreByDocument(document.id);
    const restored = await this.contextDocumentRepository.restore(document.id, reason);
    await this.contextAuditEventRepository?.create({
      goalId: source.goalId,
      sourceId: source.id,
      documentId: document.id,
      eventType: "context_document_restored",
      actor: input.actor,
      reason,
      payload: {
        title: document.title,
        embeddingsRestored: Boolean(this.chunkEmbeddingRepository)
      }
    });
    return restored;
  }

  async search(goalId: string, input: ContextSearch): Promise<ContextRetrieval> {
    await this.requiredGoal(goalId);
    const terms = tokenizeQuery(input.query);
    const candidates = await this.contextChunkRepository.listCandidatesByGoal(
      goalId,
      candidateLimit
    );
    const results = await this.rankCandidates(input, candidates, terms);

    return this.contextRetrievalRepository.create({
      goalId,
      query: input.query,
      results
    });
  }

  private async rankCandidates(
    input: ContextSearch,
    candidates: ContextSearchResult[],
    terms: string[]
  ): Promise<ContextSearchResult[]> {
    const mode = input.mode ?? "lexical";
    const lexicalRanked = candidates
      .map((candidate) => withLexicalScore(candidate, terms))
      .filter((candidate) => candidate.lexicalScore > 0);

    if (mode === "lexical") {
      return sortResults(lexicalRanked, "lexical").slice(0, input.limit);
    }

    const vectorScored = await this.tryVectorScores(input, candidates);
    if (!vectorScored || vectorScored.availableCount === 0) {
      return sortResults(
        lexicalRanked.map((candidate) => ({
          ...candidate,
          searchMode: "lexical" as RagSearchMode,
          vectorStorageUsed: "none" as const,
          fallbackUsed: true,
          fallbackReason: vectorScored?.fallbackReason ?? "mock_embeddings_unavailable"
        })),
        "lexical"
      ).slice(0, input.limit);
    }

    if (mode === "mock_vector") {
      return sortResults(
        vectorScored.results.filter((candidate) => candidate.vectorScore !== null),
        "mock_vector"
      ).slice(0, input.limit);
    }

    const maxLexicalScore = Math.max(
      ...vectorScored.results.map((candidate) => candidate.lexicalScore),
      1
    );
    return sortResults(
      vectorScored.results
        .map((candidate) => {
          const vectorScore = candidate.vectorScore ?? 0;
          const normalizedLexicalScore = candidate.lexicalScore / maxLexicalScore;
          return {
            ...candidate,
            score: 0.4 * normalizedLexicalScore + 0.6 * vectorScore,
            finalScore: 0.4 * normalizedLexicalScore + 0.6 * vectorScore,
            mode: "hybrid" as RagSearchMode,
            searchMode: "hybrid" as RagSearchMode
          };
        })
        .filter((candidate) => candidate.score > 0),
      "hybrid"
    ).slice(0, input.limit);
  }

  private async tryVectorScores(
    input: ContextSearch,
    candidates: ContextSearchResult[]
  ): Promise<{
    results: ContextSearchResult[];
    availableCount: number;
    fallbackReason: string | null;
    vectorStorageUsed: "jsonb" | "pgvector" | "none";
  } | null> {
    if (!this.embeddingModelRepository || !this.chunkEmbeddingRepository) {
      return {
        results: [],
        availableCount: 0,
        fallbackReason: "embedding_repository_unavailable",
        vectorStorageUsed: "none"
      };
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingAdapter.embedText(input.query);
    } catch {
      return {
        results: [],
        availableCount: 0,
        fallbackReason: "query_embedding_failed",
        vectorStorageUsed: "none"
      };
    }

    const model = await this.getOrCreateActiveModel();
    const chunkIds = candidates.map((candidate) => candidate.chunk.id);
    const {
      scores,
      vectorStorageUsed,
      fallbackReason
    } = await this.searchBestVectorStorage({
      queryEmbedding,
      chunkIds,
      modelId: model.id
    });

    if (scores.length === 0) {
      return {
        results: [],
        availableCount: 0,
        fallbackReason,
        vectorStorageUsed: "none"
      };
    }

    const scoresByChunkId = new Map(
      scores.map((score) => [score.chunkId, score.vectorScore])
    );
    const results = candidates.map((candidate) => {
      const lexical = lexicalScore(candidate, tokenizeQuery(input.query));
      const vectorScore = scoresByChunkId.get(candidate.chunk.id) ?? null;
      return {
        ...candidate,
        lexicalScore: lexical,
        vectorScore,
        score: vectorScore ?? 0,
        finalScore: vectorScore ?? 0,
        mode: "mock_vector" as RagSearchMode,
        searchMode: "mock_vector" as RagSearchMode,
        vectorStorageUsed,
        fallbackUsed: fallbackReason !== null,
        fallbackReason
      };
    });

    return {
      results,
      availableCount: scores.length,
      fallbackReason,
      vectorStorageUsed
    };
  }

  private async searchBestVectorStorage(input: {
    queryEmbedding: number[];
    chunkIds: string[];
    modelId: string;
  }): Promise<{
    scores: EmbeddingStorageSearchResult[];
    vectorStorageUsed: "jsonb" | "pgvector" | "none";
    fallbackReason: string | null;
  }> {
    const pgvectorRequested = this.vectorStorageConfig.configuredStorage === "pgvector";
    if (pgvectorRequested && this.pgvectorEmbeddingStorage) {
      const pgvectorAvailable = await this.pgvectorEmbeddingStorage.isAvailable().catch(() => false);
      if (pgvectorAvailable) {
        const pgvectorScores = await this.pgvectorEmbeddingStorage.searchSimilarChunks(input);
        if (pgvectorScores.length > 0) {
          return {
            scores: pgvectorScores,
            vectorStorageUsed: "pgvector",
            fallbackReason: null
          };
        }
        const jsonbScores = await this.searchJsonbSimilarChunks(input);
        return {
          scores: jsonbScores,
          vectorStorageUsed: jsonbScores.length > 0 ? "jsonb" : "none",
          fallbackReason: jsonbScores.length > 0
            ? "pgvector_embeddings_unavailable_using_jsonb"
            : "pgvector_embeddings_unavailable"
        };
      }
      const jsonbScores = await this.searchJsonbSimilarChunks(input);
      return {
        scores: jsonbScores,
        vectorStorageUsed: jsonbScores.length > 0 ? "jsonb" : "none",
        fallbackReason: jsonbScores.length > 0
          ? "pgvector_unavailable_using_jsonb"
          : "pgvector_unavailable"
      };
    }

    const jsonbScores = await this.searchJsonbSimilarChunks(input);
    return {
      scores: jsonbScores,
      vectorStorageUsed: jsonbScores.length > 0 ? "jsonb" : "none",
      fallbackReason: jsonbScores.length > 0 ? null : "mock_embeddings_unavailable"
    };
  }

  private async searchJsonbSimilarChunks(input: {
    queryEmbedding: number[];
    chunkIds: string[];
    modelId: string;
  }): Promise<EmbeddingStorageSearchResult[]> {
    if (this.jsonbEmbeddingStorage) {
      return this.jsonbEmbeddingStorage.searchSimilarChunks(input);
    }
    if (!this.chunkEmbeddingRepository) {
      return [];
    }
    const embeddings = await this.chunkEmbeddingRepository.getEmbeddingsByChunkIds(
      input.chunkIds,
      input.modelId
    );
    return embeddings.map((embedding) => ({
      chunkId: embedding.chunkId,
      vectorScore: normalizeCosineScore(
        cosineSimilarity(input.queryEmbedding, embedding.embedding)
      )
    }));
  }

  private async getOrCreateActiveModel(): Promise<EmbeddingModel> {
    if (!this.embeddingModelRepository) {
      throw new Error("Embedding model repository is unavailable");
    }
    return this.embeddingModelRepository.getOrCreateModel({
      name: this.embeddingAdapter.name,
      provider: this.embeddingAdapter.provider as EmbeddingModel["provider"],
      dimension: this.embeddingAdapter.dimension,
      storageKind: this.vectorStorageConfig.configuredStorage,
      metadata: {
        deterministic: this.embeddingAdapter.provider === "mock",
        semantic: this.embeddingAdapter.provider !== "mock"
      }
    });
  }

  async listRetrievals(goalId: string): Promise<ContextRetrieval[]> {
    await this.requiredGoal(goalId);
    return this.contextRetrievalRepository.listByGoal(goalId);
  }

  private async requiredGoal(goalId: string) {
    const goal = await this.goalsRepository.findById(goalId);
    if (!goal) {
      throw new NotFoundError(`Goal ${goalId} was not found`);
    }
    return goal;
  }

  private async requiredSource(sourceId: string): Promise<ContextSource> {
    const source = await this.contextSourceRepository.findById(sourceId);
    if (!source) {
      throw new NotFoundError(`Context source ${sourceId} was not found`);
    }
    return source;
  }
}

export function stableContentHash(content: string): string {
  return createHash("sha256").update(normalizeText(content)).digest("hex");
}

export function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      normalizeText(query)
        .toLowerCase()
        .split(/[^a-z0-9_]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
    )
  );
}

export function lexicalScore(candidate: ContextSearchResult, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const content = candidate.chunk.content.toLowerCase();
  const title = candidate.document.title.toLowerCase();
  const sourceName = candidate.source.name.toLowerCase();
  return terms.reduce((score, term) => {
    const contentMatches = countOccurrences(content, term);
    const titleMatches = countOccurrences(title, term);
    const sourceMatches = countOccurrences(sourceName, term);
    return score + contentMatches + titleMatches * 2 + sourceMatches;
  }, 0);
}

function withLexicalScore(
  candidate: ContextSearchResult,
  terms: string[]
): ContextSearchResult {
  const score = lexicalScore(candidate, terms);
  return {
    ...candidate,
    score,
    finalScore: score,
    lexicalScore: score,
    vectorScore: null,
    mode: "lexical",
    searchMode: "lexical",
    vectorStorageUsed: "none",
    fallbackUsed: false,
    fallbackReason: null
  };
}

function sortResults(
  candidates: ContextSearchResult[],
  mode: RagSearchMode
): ContextSearchResult[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      finalScore: candidate.score,
      mode,
      searchMode: mode
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.lexicalScore !== left.lexicalScore) {
        return right.lexicalScore - left.lexicalScore;
      }
      if ((right.vectorScore ?? 0) !== (left.vectorScore ?? 0)) {
        return (right.vectorScore ?? 0) - (left.vectorScore ?? 0);
      }
      if (left.chunk.chunkIndex !== right.chunk.chunkIndex) {
        return left.chunk.chunkIndex - right.chunk.chunkIndex;
      }
      return left.chunk.id.localeCompare(right.chunk.id);
    });
}

function countOccurrences(input: string, term: string): number {
  let count = 0;
  let index = input.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = input.indexOf(term, index + term.length);
  }
  return count;
}
