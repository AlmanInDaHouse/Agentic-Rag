import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: hybrid search fallback", () => {
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

  it("falls back to lexical retrieval when mock embeddings are missing", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Fallback source",
      type: "manual_text",
      metadata: {}
    });
    await runtime.api.addContextDocument(source.id, {
      title: "Fallback retrieval document",
      content: "Fallback lexical retrieval should still find approval context without embeddings.",
      metadata: {}
    });

    const retrieval = await runtime.api.searchContext(goal.id, {
      query: "approval context",
      limit: 5,
      mode: "hybrid"
    });
    const persisted = await runtime.api.listContextRetrievals(goal.id);

    expect(retrieval.results.length).toBeGreaterThan(0);
    expect(retrieval.results[0].mode).toBe("lexical");
    expect(retrieval.results[0].fallbackReason).toBe("mock_embeddings_unavailable");
    expect(persisted.map((item) => item.id)).toContain(retrieval.id);
    expect(persisted.find((item) => item.id === retrieval.id)?.results[0]?.fallbackReason).toBe("mock_embeddings_unavailable");
  });
});
