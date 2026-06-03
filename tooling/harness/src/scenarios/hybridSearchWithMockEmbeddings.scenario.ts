import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: hybrid search with mock embeddings", () => {
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

  it("runs mock vector and hybrid search after generating mock embeddings", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Hybrid source",
      type: "artifact",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Hybrid retrieval document",
      content: "Hybrid retrieval combines lexical score and deterministic mock vector score for context ranking.",
      metadata: {}
    });
    await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);

    const mockVector = await runtime.api.searchContext(goal.id, {
      query: "context ranking",
      limit: 5,
      mode: "mock_vector"
    });
    const hybrid = await runtime.api.searchContext(goal.id, {
      query: "context ranking",
      limit: 5,
      mode: "hybrid"
    });
    const persisted = await runtime.api.listContextRetrievals(goal.id);

    expect(mockVector.results.length).toBeGreaterThan(0);
    expect(mockVector.results[0].mode).toBe("mock_vector");
    expect(mockVector.results[0].vectorScore).not.toBeNull();
    expect(mockVector.results[0].fallbackReason).toBeNull();
    expect(hybrid.results.length).toBeGreaterThan(0);
    expect(hybrid.results[0].mode).toBe("hybrid");
    expect(hybrid.results[0].vectorScore).not.toBeNull();
    expect(hybrid.results[0].fallbackReason).toBeNull();
    expect(persisted.find((item) => item.id === hybrid.id)?.results[0]?.mode).toBe("hybrid");
  });
});
