import { describe, expect, it } from "vitest";
import type { EmbeddingStorage } from "../services/embeddings/embeddingStorage.js";
import { RagStatusService } from "../services/ragStatusService.js";

describe("RagStatusService", () => {
  it("uses mock/jsonb defaults", async () => {
    const service = new RagStatusService(
      { embeddingProvider: "mock", embeddingStorage: "jsonb" },
      storage("jsonb", true),
      storage("pgvector", false),
      localAdapter(false, false)
    );

    const status = await service.getStatus();

    expect(status.activeEmbeddingProvider).toBe("mock");
    expect(status.embeddingStorage).toBe("jsonb");
    expect(status.fallbackMode).toBe("mock_then_lexical");
  });

  it("falls back when local and pgvector are configured but unavailable", async () => {
    const service = new RagStatusService(
      { embeddingProvider: "local", embeddingStorage: "pgvector" },
      storage("jsonb", true),
      storage("pgvector", false),
      localAdapter(true, false)
    );

    const status = await service.getStatus();

    expect(status.activeEmbeddingProvider).toBe("mock");
    expect(status.embeddingStorage).toBe("jsonb");
    expect(status.warnings).toContain("local_embedding_unavailable_using_mock");
    expect(status.warnings).toContain("pgvector_unavailable_using_jsonb");
  });

  it("does not require a local endpoint when local provider is configured", async () => {
    const service = new RagStatusService(
      { embeddingProvider: "local", embeddingStorage: "jsonb" },
      storage("jsonb", true),
      storage("pgvector", false),
      localAdapter(false, false)
    );

    const status = await service.getStatus();

    expect(status.activeEmbeddingProvider).toBe("mock");
    expect(status.localEmbeddingConfigured).toBe(false);
    expect(status.warnings).toContain("local_embedding_endpoint_not_configured");
  });

  it("falls back to jsonb when pgvector storage is configured but unavailable", async () => {
    const service = new RagStatusService(
      { embeddingProvider: "mock", embeddingStorage: "pgvector" },
      storage("jsonb", true),
      storage("pgvector", false),
      localAdapter(false, false)
    );

    const status = await service.getStatus();

    expect(status.embeddingStorage).toBe("jsonb");
    expect(status.pgvectorConfigured).toBe(true);
    expect(status.warnings).toContain("pgvector_unavailable_using_jsonb");
  });

  it("reports local and pgvector active when available", async () => {
    const service = new RagStatusService(
      { embeddingProvider: "local", embeddingStorage: "pgvector" },
      storage("jsonb", true),
      storage("pgvector", true),
      localAdapter(true, true)
    );

    const status = await service.getStatus();

    expect(status.activeEmbeddingProvider).toBe("local");
    expect(status.embeddingStorage).toBe("pgvector");
    expect(status.fallbackMode).toBe("none");
  });
});

function storage(
  storageKind: "jsonb" | "pgvector",
  available: boolean
): EmbeddingStorage {
  return {
    storageKind,
    async isAvailable() {
      return available;
    },
    async upsertChunkEmbedding() {},
    async searchSimilarChunks() {
      return [];
    }
  };
}

function localAdapter(configured: boolean, available: boolean) {
  return {
    isConfigured: () => configured,
    isAvailable: async () => available
  };
}
