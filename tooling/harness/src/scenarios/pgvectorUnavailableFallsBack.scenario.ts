import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: pgvector unavailable falls back", () => {
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

  it("uses lexical fallback before embeddings and JSONB vector fallback after embeddings", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Configured pgvector fallback source",
      type: "manual_text",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Configured pgvector fallback document",
      content: "Configured pgvector should fall back to lexical retrieval and JSONB mock vectors.",
      metadata: {}
    });

    const lexicalFallback = await runtime.api.searchContext(goal.id, {
      query: "pgvector fallback lexical",
      limit: 5,
      mode: "hybrid"
    });
    expect(lexicalFallback.results[0]?.fallbackUsed).toBe(true);
    expect(lexicalFallback.results[0]?.mode).toBe("lexical");
    expect(lexicalFallback.results[0]?.vectorStorageUsed).toBe("none");

    await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);
    const jsonbFallback = await runtime.api.searchContext(goal.id, {
      query: "pgvector fallback lexical",
      limit: 5,
      mode: "hybrid"
    });
    expect(jsonbFallback.results.length).toBeGreaterThan(0);
    expect(jsonbFallback.results[0].mode).toBe("hybrid");
    expect(jsonbFallback.results[0].vectorStorageUsed).toBe("jsonb");
    expect(jsonbFallback.results[0].fallbackUsed).toBe(true);
    expect(jsonbFallback.results[0].fallbackReason).toMatch(/pgvector_.*_using_jsonb/);
  });
});
