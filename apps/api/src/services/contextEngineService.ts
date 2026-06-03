import { createHash } from "node:crypto";
import type {
  ContextChunk,
  ContextDocument,
  ContextRetrieval,
  ContextSearch,
  ContextSearchResult,
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
  GoalsRepository
} from "../domain/ports.js";
import { ContextChunkingService, normalizeText } from "./contextChunkingService.js";

const candidateLimit = 500;

export class ContextEngineService {
  constructor(
    private readonly goalsRepository: GoalsRepository,
    private readonly contextSourceRepository: ContextSourceRepository,
    private readonly contextDocumentRepository: ContextDocumentRepository,
    private readonly contextChunkRepository: ContextChunkRepository,
    private readonly contextRetrievalRepository: ContextRetrievalRepository,
    private readonly chunkingService = new ContextChunkingService()
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
    const results = candidates
      .map((candidate) => ({
        ...candidate,
        score: lexicalScore(candidate, terms)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.chunk.chunkIndex - right.chunk.chunkIndex;
      })
      .slice(0, input.limit);

    return this.contextRetrievalRepository.create({
      goalId,
      query: input.query,
      results
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

function countOccurrences(input: string, term: string): number {
  let count = 0;
  let index = input.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = input.indexOf(term, index + term.length);
  }
  return count;
}
