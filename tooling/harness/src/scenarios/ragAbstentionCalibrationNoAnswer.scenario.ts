import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: RAG abstention calibration for no-answer queries", () => {
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

  it("uses the no_answer threshold and abstains despite lexical overlap", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Calibration source",
      type: "manual_text",
      metadata: {}
    });
    await runtime.api.addContextDocument(source.id, {
      title: "Approval token glossary",
      content: "The approval token glossary defines a synthetic approval token phrase for calibration.",
      metadata: {}
    });

    const retrieval = await runtime.api.searchContext(goal.id, {
      query: "approval token missing answer",
      limit: 5,
      mode: "lexical",
      queryType: "no_answer"
    });

    expect(retrieval.results.length).toBeGreaterThan(0);
    expect(retrieval.answerability).toMatchObject({
      shouldAnswer: false,
      reason: "low_score",
      effectiveMinRequiredScore: 0.95,
      effectiveFallbackAllowed: false
    });
    expect(retrieval.answerability?.effectivePolicySource).toContain("queryType:no_answer");
  });
});
