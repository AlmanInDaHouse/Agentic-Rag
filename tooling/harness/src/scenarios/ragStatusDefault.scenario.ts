import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: RAG status default", () => {
  let runtime: HarnessRuntime;
  let schemaName: string;

  beforeAll(async () => {
    runtime = await startHarnessRuntime({});
    schemaName = runtime.schemaName;
  });

  afterAll(async () => {
    await runtime?.stop();
    if (schemaName) {
      expect(await harnessSchemaExists(databaseUrl, schemaName)).toBe(false);
    }
  });

  it("reports mock provider and jsonb storage by default", async () => {
    const status = await runtime.api.ragStatus();

    expect(status.configuredEmbeddingProvider).toBe("mock");
    expect(status.activeEmbeddingProvider).toBe("mock");
    expect(status.configuredEmbeddingStorage).toBe("jsonb");
    expect(status.embeddingStorage).toBe("jsonb");
    expect(status.localEmbeddingConfigured).toBe(false);
    expect(status.localEmbeddingAvailable).toBe(false);
    expect(status.fallbackMode).toBe("mock_then_lexical");
  });
});
