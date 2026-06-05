import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: RAG fallback without pgvector", () => {
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

  it("keeps hybrid search working with mock/jsonb and lexical fallback", async () => {
    const status = await runtime.api.ragStatus();
    expect(status.embeddingStorage).toBe("jsonb");

    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "RAG fallback source",
      type: "manual_text",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "RAG fallback document",
      content: "Hybrid fallback should continue with mock embeddings and lexical retrieval when pgvector is not active.",
      metadata: {}
    });

    const fallback = await runtime.api.searchContext(goal.id, {
      query: "fallback lexical retrieval",
      limit: 5,
      mode: "hybrid"
    });
    expect(fallback.results[0]?.fallbackUsed).toBe(true);
    expect(fallback.results[0]?.mode).toBe("lexical");

    await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);
    const hybrid = await runtime.api.searchContext(goal.id, {
      query: "fallback lexical retrieval",
      limit: 5,
      mode: "hybrid"
    });
    expect(hybrid.results.length).toBeGreaterThan(0);
    expect(hybrid.results[0].mode).toBe("hybrid");
    expect(hybrid.results[0].fallbackUsed).toBe(false);
  });
});
