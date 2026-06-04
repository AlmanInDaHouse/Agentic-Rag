import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: mock embeddings document generation", () => {
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

  it("creates mock embeddings for every chunk in a document", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Embedding source",
      type: "manual_text",
      metadata: { scenario: "mockEmbeddingsGenerateDocument" }
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Embedding document",
      content: "Mock embeddings should cover every chunk.\n\nThe second paragraph creates retrievable context.",
      metadata: {}
    });

    const result = await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);
    const coverage = await runtime.api.getDocumentEmbeddingCoverage(ingested.document.id);

    expect(result.model.name).toBe("mock_embedding_v1");
    expect(result.model.provider).toBe("mock");
    expect(result.model.dimension).toBe(32);
    expect(result.generatedCount).toBe(ingested.chunks.length);
    expect(result.embeddings.every((embedding) => embedding.embedding.length === 32)).toBe(true);
    expect(coverage.embeddedChunkCount).toBe(coverage.chunkCount);
    expect(coverage.coverage).toBe(1);
    expect((await runtime.api.listEmbeddingModels()).map((model) => model.name)).toContain("mock_embedding_v1");
  });
});
