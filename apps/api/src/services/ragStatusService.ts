import type { RagStatus } from "@triforge/shared";
import type {
  EmbeddingStorage,
  PgvectorAvailability
} from "./embeddings/embeddingStorage.js";
import type { LocalEmbeddingAdapter } from "./embeddings/localEmbeddingAdapter.js";

type LocalEmbeddingAvailability = Pick<LocalEmbeddingAdapter, "isConfigured" | "isAvailable">;
type PgvectorStatusProvider = EmbeddingStorage & {
  getAvailability(): Promise<PgvectorAvailability>;
};

export type RagStatusConfig = {
  embeddingProvider: "mock" | "local";
  embeddingStorage: "jsonb" | "pgvector";
};

export class RagStatusService {
  constructor(
    private readonly config: RagStatusConfig,
    private readonly jsonbStorage: EmbeddingStorage,
    private readonly pgvectorStorage: PgvectorStatusProvider,
    private readonly localEmbeddingAdapter: LocalEmbeddingAvailability
  ) {}

  async getStatus(): Promise<RagStatus> {
    const [pgvectorAvailability, localEmbeddingAvailable] = await Promise.all([
      this.pgvectorStorage.getAvailability().catch(() => ({
        extensionAvailable: false,
        tableAvailable: false,
        available: false,
        fallbackReason: "pgvector_status_check_failed"
      })),
      this.localEmbeddingAdapter.isAvailable().catch(() => false)
    ]);
    const pgvectorAvailable = pgvectorAvailability.available;
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
    const fallbackReason = determineFallbackReason({
      providerConfigured: this.config.embeddingProvider,
      localEmbeddingConfigured,
      localEmbeddingAvailable,
      storageConfigured: this.config.embeddingStorage,
      pgvectorAvailability
    });

    if (this.config.embeddingProvider === "local" && !localEmbeddingConfigured) {
      warnings.push("local_embedding_endpoint_not_configured");
    } else if (this.config.embeddingProvider === "local" && !localEmbeddingAvailable) {
      warnings.push("local_embedding_unavailable_using_mock");
    }

    if (this.config.embeddingStorage === "pgvector" && !pgvectorAvailable) {
      warnings.push(`${pgvectorAvailability.fallbackReason ?? "pgvector_unavailable"}_using_jsonb`);
    }
    if (embeddingStorage === "jsonb") {
      warnings.push("jsonb_embedding_storage_active");
    }

    return {
      activeEmbeddingProvider,
      configuredEmbeddingProvider: this.config.embeddingProvider,
      embeddingStorage,
      effectiveEmbeddingStorage: embeddingStorage,
      configuredEmbeddingStorage: this.config.embeddingStorage,
      pgvectorAvailable,
      pgvectorExtensionAvailable: pgvectorAvailability.extensionAvailable,
      pgvectorTableAvailable: pgvectorAvailability.tableAvailable,
      localEmbeddingAvailable,
      localEmbeddingConfigured,
      pgvectorConfigured,
      vectorSearchEnabled: pgvectorAvailable || await this.jsonbStorage.isAvailable().catch(() => false),
      fallbackReason,
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

function determineFallbackReason(input: {
  providerConfigured: "mock" | "local";
  localEmbeddingConfigured: boolean;
  localEmbeddingAvailable: boolean;
  storageConfigured: "jsonb" | "pgvector";
  pgvectorAvailability: PgvectorAvailability;
}): string | null {
  if (input.providerConfigured === "local" && !input.localEmbeddingConfigured) {
    return "local_embedding_endpoint_not_configured";
  }
  if (input.providerConfigured === "local" && !input.localEmbeddingAvailable) {
    return "local_embedding_unavailable_using_mock";
  }
  if (input.storageConfigured === "pgvector" && !input.pgvectorAvailability.available) {
    return `${input.pgvectorAvailability.fallbackReason ?? "pgvector_unavailable"}_using_jsonb`;
  }
  return null;
}
