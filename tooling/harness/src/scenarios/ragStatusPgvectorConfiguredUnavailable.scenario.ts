import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: RAG status with pgvector configured but unavailable", () => {
  let runtime: HarnessRuntime;
  let schemaName: string;

  beforeAll(async () => {
    runtime = await startHarnessRuntime({
      env: {
        TRIFORGE_EMBEDDING_STORAGE: "pgvector"
      }
    });
    schemaName = runtime.schemaName;
  });

  afterAll(async () => {
    await runtime?.stop();
    if (schemaName) {
      expect(await harnessSchemaExists(databaseUrl, schemaName)).toBe(false);
    }
  });

  it("reports JSONB as effective storage and a pgvector fallback reason", async () => {
    const status = await runtime.api.ragStatus();

    expect(status.configuredEmbeddingStorage).toBe("pgvector");
    expect(status.embeddingStorage).toBe("jsonb");
    expect(status.effectiveEmbeddingStorage).toBe("jsonb");
    expect(status.pgvectorAvailable).toBe(false);
    expect(status.pgvectorTableAvailable).toBe(false);
    expect(status.vectorSearchEnabled).toBe(true);
    expect(status.fallbackReason).toMatch(/pgvector_.*_using_jsonb/);
  });
});
