import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: mock embeddings idempotency", () => {
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

  it("does not duplicate chunk embeddings on a second generation", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Idempotent embedding source",
      type: "project_note",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Idempotent embedding document",
      content: "Repeated mock embedding generation must keep exactly one embedding per chunk.",
      metadata: {}
    });

    const first = await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);
    const second = await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);
    const coverage = await runtime.api.getDocumentEmbeddingCoverage(ingested.document.id);

    expect(first.generatedCount).toBe(ingested.chunks.length);
    expect(second.generatedCount).toBe(0);
    expect(second.skippedCount).toBe(ingested.chunks.length);
    expect(coverage.embeddings).toHaveLength(ingested.chunks.length);
    expect(new Set(coverage.embeddings.map((embedding) => embedding.chunkId)).size).toBe(ingested.chunks.length);
  });
});
