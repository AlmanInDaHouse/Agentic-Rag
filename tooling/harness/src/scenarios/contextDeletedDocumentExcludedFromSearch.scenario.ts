import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: deleted context document excluded from search", () => {
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

  it("does not return deleted chunks in active retrievals", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Search delete source",
      type: "manual_text",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Search deletion document",
      content: "delete exclusion phrase",
      metadata: {}
    });

    const beforeDelete = await runtime.api.searchContext(goal.id, {
      query: "delete exclusion",
      limit: 5,
      mode: "lexical"
    });
    await runtime.api.deleteContextDocument(ingested.document.id, {
      actor: "human_operator",
      reason: "cleanup",
      hardDelete: false
    });
    const afterDelete = await runtime.api.searchContext(goal.id, {
      query: "delete exclusion",
      limit: 5,
      mode: "lexical"
    });

    expect(beforeDelete.results).toHaveLength(1);
    expect(afterDelete.results).toEqual([]);
  });
});
