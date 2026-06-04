import type { ChunkEmbedding, ContextDocument, EmbeddingModel } from "@triforge/shared";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  ChunkEmbeddingRepository,
  ContextChunkRepository,
  ContextDocumentRepository,
  ContextSourceRepository,
  EmbeddingModelRepository
} from "../domain/ports.js";
import type { EmbeddingAdapter } from "./embeddings/embeddingAdapter.js";
import { embeddingHash, MockEmbeddingAdapter } from "./embeddings/mockEmbeddingAdapter.js";

export type GenerateEmbeddingsOptions = {
  force?: boolean;
};

export type EmbeddingGenerationResult = {
  model: EmbeddingModel;
  documentId?: string;
  sourceId?: string;
  generatedCount: number;
  skippedCount: number;
  embeddings: ChunkEmbedding[];
};

export type DocumentEmbeddingCoverage = {
  documentId: string;
  model: EmbeddingModel;
  chunkCount: number;
  embeddedChunkCount: number;
  coverage: number;
  embeddings: ChunkEmbedding[];
};

export class ContextEmbeddingService {
  constructor(
    private readonly contextSourceRepository: ContextSourceRepository,
    private readonly contextDocumentRepository: ContextDocumentRepository,
    private readonly contextChunkRepository: ContextChunkRepository,
    private readonly embeddingModelRepository: EmbeddingModelRepository,
    private readonly chunkEmbeddingRepository: ChunkEmbeddingRepository,
    private readonly embeddingAdapter: EmbeddingAdapter = new MockEmbeddingAdapter()
  ) {}

  async listEmbeddingModels(): Promise<EmbeddingModel[]> {
    return this.embeddingModelRepository.listEmbeddingModels();
  }

  async generateEmbeddingsForDocument(
    documentId: string,
    options: GenerateEmbeddingsOptions = {}
  ): Promise<EmbeddingGenerationResult> {
    const document = await this.requiredDocument(documentId);
    const result = await this.generateForDocument(document, options);
    return {
      ...result,
      documentId: document.id
    };
  }

  async generateEmbeddingsForSource(
    sourceId: string,
    options: GenerateEmbeddingsOptions = {}
  ): Promise<EmbeddingGenerationResult> {
    const source = await this.contextSourceRepository.findById(sourceId);
    if (!source) {
      throw new NotFoundError(`Context source ${sourceId} was not found`);
    }
    if (source.deletedAt) {
      throw new ConflictError(`Context source ${source.id} is deleted`);
    }

    const documents = (await this.contextDocumentRepository.listBySource(source.id))
      .filter((document) => !document.deletedAt);
    let generatedCount = 0;
    let skippedCount = 0;
    const embeddings: ChunkEmbedding[] = [];
    const model = await this.embeddingModelRepository.getOrCreateMockModel();
    for (const document of documents) {
      const result = await this.generateForDocument(document, options, model);
      generatedCount += result.generatedCount;
      skippedCount += result.skippedCount;
      embeddings.push(...result.embeddings);
    }

    return {
      model,
      sourceId: source.id,
      generatedCount,
      skippedCount,
      embeddings
    };
  }

  async getEmbeddingCoverageForDocument(documentId: string): Promise<DocumentEmbeddingCoverage> {
    const document = await this.requiredDocument(documentId);
    if (document.deletedAt) {
      throw new ConflictError(`Context document ${document.id} is deleted`);
    }
    const model = await this.embeddingModelRepository.getOrCreateMockModel();
    const chunks = (await this.contextChunkRepository.listByDocument(document.id))
      .filter((chunk) => !chunk.deletedAt);
    const embeddings = await this.chunkEmbeddingRepository.getEmbeddingsByChunkIds(
      chunks.map((chunk) => chunk.id),
      model.id
    );
    const embeddedChunkIds = new Set(embeddings.map((embedding) => embedding.chunkId));

    return {
      documentId: document.id,
      model,
      chunkCount: chunks.length,
      embeddedChunkCount: embeddedChunkIds.size,
      coverage: chunks.length === 0 ? 1 : embeddedChunkIds.size / chunks.length,
      embeddings
    };
  }

  async listChunkEmbeddings(documentId: string): Promise<ChunkEmbedding[]> {
    const document = await this.requiredDocument(documentId);
    if (document.deletedAt) {
      throw new ConflictError(`Context document ${document.id} is deleted`);
    }
    return this.chunkEmbeddingRepository.listChunkEmbeddings(documentId);
  }

  private async generateForDocument(
    document: ContextDocument,
    options: GenerateEmbeddingsOptions,
    existingModel?: EmbeddingModel
  ): Promise<EmbeddingGenerationResult> {
    if (document.redactionStatus === "blocked" || document.classification === "restricted") {
      throw new ConflictError(`Context document ${document.id} is blocked by data policy`);
    }
    if (document.deletedAt) {
      throw new ConflictError(`Context document ${document.id} is deleted`);
    }
    const model = existingModel ?? (await this.embeddingModelRepository.getOrCreateMockModel());
    const chunks = (await this.contextChunkRepository.listByDocument(document.id))
      .filter((chunk) => !chunk.deletedAt);
    const existingEmbeddings = await this.chunkEmbeddingRepository.getEmbeddingsByChunkIds(
      chunks.map((chunk) => chunk.id),
      model.id
    );
    const existingChunkIds = new Set(existingEmbeddings.map((embedding) => embedding.chunkId));
    const chunksToEmbed = options.force
      ? chunks
      : chunks.filter((chunk) => !existingChunkIds.has(chunk.id));
    const vectors = await this.embeddingAdapter.embedBatch(chunksToEmbed.map((chunk) => chunk.content));
    const created: ChunkEmbedding[] = [];

    for (let index = 0; index < chunksToEmbed.length; index += 1) {
      const chunk = chunksToEmbed[index];
      const embedding = vectors[index];
      created.push(
        await this.chunkEmbeddingRepository.upsertChunkEmbedding({
          chunkId: chunk.id,
          modelId: model.id,
          embedding,
          embeddingHash: embeddingHash({
            modelName: this.embeddingAdapter.name,
            provider: this.embeddingAdapter.provider,
            dimension: this.embeddingAdapter.dimension,
            text: chunk.content,
            embedding
          })
        })
      );
    }

    return {
      model,
      generatedCount: created.length,
      skippedCount: chunks.length - chunksToEmbed.length,
      embeddings: options.force ? created : [...existingEmbeddings, ...created]
    };
  }

  private async requiredDocument(documentId: string): Promise<ContextDocument> {
    const document = await this.contextDocumentRepository.findById(documentId);
    if (!document) {
      throw new NotFoundError(`Context document ${documentId} was not found`);
    }
    return document;
  }
}
