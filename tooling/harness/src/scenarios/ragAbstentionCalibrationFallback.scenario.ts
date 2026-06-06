import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: RAG abstention calibration for fallback", () => {
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

  it("records fallback-adjusted policy metadata and keeps queryType optional", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Fallback calibration source",
      type: "manual_text",
      metadata: {}
    });
    await runtime.api.addContextDocument(source.id, {
      title: "Fallback calibration document",
      content: "Hybrid fallback calibration should keep search usable when embeddings are absent.",
      metadata: {}
    });

    const fallbackRetrieval = await runtime.api.searchContext(goal.id, {
      query: "hybrid fallback calibration",
      limit: 5,
      mode: "hybrid"
    });

    expect(fallbackRetrieval.results[0]?.fallbackUsed).toBe(true);
    expect(fallbackRetrieval.answerability?.effectiveMinRequiredScore).toBeCloseTo(0.45);
    expect(fallbackRetrieval.answerability?.effectiveFallbackAllowed).toBe(true);
    expect(fallbackRetrieval.answerability?.effectivePolicySource).toContain("fallback");

    const normalRetrieval = await runtime.api.searchContext(goal.id, {
      query: "fallback calibration",
      limit: 5,
      mode: "lexical"
    });
    expect(normalRetrieval.results.length).toBeGreaterThan(0);
    expect(normalRetrieval.answerability?.effectivePolicySource).toContain("queryType:answerable");
  });
});
