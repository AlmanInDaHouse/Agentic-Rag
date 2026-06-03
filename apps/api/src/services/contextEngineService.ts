import { createHash } from "node:crypto";
import type {
  ContextChunk,
  ContextDocument,
  ContextRetrieval,
  ContextSearch,
  ContextSearchResult,
  RagSearchMode,
  ContextSource,
  CreateContextDocument,
  CreateContextSource
} from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
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

const candidateLimit = 500;

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
    private readonly embeddingAdapter: EmbeddingAdapter = new MockEmbeddingAdapter()
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
    const normalizedContent = normalizeText(input.content);
    const contentHash = stableContentHash(normalizedContent);
    const existing = await this.contextDocumentRepository.findBySourceAndHash(source.id, contentHash);
    if (existing) {
      throw new ConflictError("Context document already exists for this source");
    }

    const document = await this.contextDocumentRepository.create({
      sourceId: source.id,
      title: input.title,
      contentHash,
      metadata: input.metadata
    });
    const drafts = this.chunkingService.chunk(normalizedContent);
    const chunks = await this.contextChunkRepository.createMany(
      drafts.map((chunk) => ({
        documentId: document.id,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenEstimate: chunk.tokenEstimate,
        metadata: { sourceType: source.type }
      }))
    );
    return { document, chunks };
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
            mode: "hybrid" as RagSearchMode
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
  } | null> {
    if (!this.embeddingModelRepository || !this.chunkEmbeddingRepository) {
      return {
        results: [],
        availableCount: 0,
        fallbackReason: "embedding_repository_unavailable"
      };
    }

    const model = await this.embeddingModelRepository.getOrCreateMockModel();
    const embeddings = await this.chunkEmbeddingRepository.getEmbeddingsByChunkIds(
      candidates.map((candidate) => candidate.chunk.id),
      model.id
    );
    if (embeddings.length === 0) {
      return {
        results: [],
        availableCount: 0,
        fallbackReason: "mock_embeddings_unavailable"
      };
    }

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.embeddingAdapter.embedText(input.query);
    } catch {
      return {
        results: [],
        availableCount: 0,
        fallbackReason: "query_embedding_failed"
      };
    }
    const embeddingsByChunkId = new Map(
      embeddings.map((embedding) => [embedding.chunkId, embedding])
    );
    const results = candidates.map((candidate) => {
      const embedding = embeddingsByChunkId.get(candidate.chunk.id);
      const lexical = lexicalScore(candidate, tokenizeQuery(input.query));
      const vectorScore = embedding
        ? normalizeCosineScore(cosineSimilarity(queryEmbedding, embedding.embedding))
        : null;
      return {
        ...candidate,
        lexicalScore: lexical,
        vectorScore,
        score: vectorScore ?? 0,
        mode: "mock_vector" as RagSearchMode,
        fallbackReason: null
      };
    });

    return {
      results,
      availableCount: embeddings.length,
      fallbackReason: null
    };
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
    lexicalScore: score,
    vectorScore: null,
    mode: "lexical",
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
      mode
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
