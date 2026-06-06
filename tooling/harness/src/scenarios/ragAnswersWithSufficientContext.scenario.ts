import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: RAG answers with sufficient context", () => {
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

  it("marks retrieval as answerable when a strong chunk is found", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "RAG answerability notes",
      type: "manual_text",
      metadata: {}
    });
    await runtime.api.addContextDocument(source.id, {
      title: "Approval gate answerability",
      content: "The approval gate answerability note says approval gate context is sufficient for this synthetic query.",
      metadata: {}
    });

    const retrieval = await runtime.api.searchContext(goal.id, {
      query: "approval gate answerability",
      limit: 5,
      mode: "lexical"
    });

    expect(retrieval.results.length).toBeGreaterThan(0);
    expect(retrieval.answerability).toMatchObject({
      shouldAnswer: true,
      reason: "sufficient_context"
    });
  });
});
