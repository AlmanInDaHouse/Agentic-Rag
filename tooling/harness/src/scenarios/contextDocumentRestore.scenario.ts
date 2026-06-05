import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context document restore", () => {
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

  it("restores a soft-deleted document and makes it searchable again", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Restore source",
      type: "manual_text",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Restored document",
      content: "restore searchable phrase",
      metadata: {}
    });

    await runtime.api.deleteContextDocument(ingested.document.id, {
      actor: "human_operator",
      reason: "cleanup",
      hardDelete: false
    });
    const emptySearch = await runtime.api.searchContext(goal.id, {
      query: "restore searchable",
      limit: 5,
      mode: "lexical"
    });
    const restored = await runtime.api.restoreContextDocument(ingested.document.id, {
      actor: "human_operator",
      reason: "restore for test"
    });
    const restoredSearch = await runtime.api.searchContext(goal.id, {
      query: "restore searchable",
      limit: 5,
      mode: "lexical"
    });
    const chunks = await runtime.api.listContextChunks(ingested.document.id);

    expect(emptySearch.results).toEqual([]);
    expect(restored.deletedAt).toBeNull();
    expect(chunks.every((chunk) => chunk.deletedAt === null)).toBe(true);
    expect(restoredSearch.results).toHaveLength(1);
  });
});
