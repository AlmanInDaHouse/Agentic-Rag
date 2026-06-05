import type { RagStatus } from "@triforge/shared";
import type { EmbeddingStorage } from "./embeddings/embeddingStorage.js";
import type { LocalEmbeddingAdapter } from "./embeddings/localEmbeddingAdapter.js";

type LocalEmbeddingAvailability = Pick<LocalEmbeddingAdapter, "isConfigured" | "isAvailable">;

export type RagStatusConfig = {
  embeddingProvider: "mock" | "local";
  embeddingStorage: "jsonb" | "pgvector";
};

export class RagStatusService {
  constructor(
    private readonly config: RagStatusConfig,
    private readonly jsonbStorage: EmbeddingStorage,
    private readonly pgvectorStorage: EmbeddingStorage,
    private readonly localEmbeddingAdapter: LocalEmbeddingAvailability
  ) {}

  async getStatus(): Promise<RagStatus> {
    const [pgvectorAvailable, localEmbeddingAvailable] = await Promise.all([
      this.pgvectorStorage.isAvailable().catch(() => false),
      this.localEmbeddingAdapter.isAvailable().catch(() => false)
    ]);
    const warnings: string[] = [];
    const localEmbeddingConfigured = this.localEmbeddingAdapter.isConfigured();
    const pgvectorConfigured = this.config.embeddingStorage === "pgvector";

    const activeEmbeddingProvider =
      this.config.embeddingProvider === "local" && localEmbeddingAvailable
        ? "local"
        : "mock";
    const embeddingStorage =
      this.config.embeddingStorage === "pgvector" && pgvectorAvailable
        ? "pgvector"
        : "jsonb";

    if (this.config.embeddingProvider === "local" && !localEmbeddingConfigured) {
      warnings.push("local_embedding_endpoint_not_configured");
    } else if (this.config.embeddingProvider === "local" && !localEmbeddingAvailable) {
      warnings.push("local_embedding_unavailable_using_mock");
    }

    if (this.config.embeddingStorage === "pgvector" && !pgvectorAvailable) {
      warnings.push("pgvector_unavailable_using_jsonb");
    }
    if (embeddingStorage === "jsonb") {
      warnings.push("jsonb_embedding_storage_active");
    }

    return {
      activeEmbeddingProvider,
      configuredEmbeddingProvider: this.config.embeddingProvider,
      embeddingStorage,
      configuredEmbeddingStorage: this.config.embeddingStorage,
      pgvectorAvailable,
      localEmbeddingAvailable,
      localEmbeddingConfigured,
      pgvectorConfigured,
      fallbackMode: determineFallbackMode(activeEmbeddingProvider, embeddingStorage),
      warnings
    };
  }
}

function determineFallbackMode(
  activeEmbeddingProvider: "mock" | "local",
  embeddingStorage: "jsonb" | "pgvector"
): RagStatus["fallbackMode"] {
  if (activeEmbeddingProvider === "local" && embeddingStorage === "pgvector") {
    return "none";
  }
  if (activeEmbeddingProvider === "mock") {
    return "mock_then_lexical";
  }
  return "mock";
}
