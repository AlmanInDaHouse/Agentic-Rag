import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context document soft delete", () => {
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

  it("marks document and chunks deleted", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Soft delete source",
      type: "manual_text",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Soft deleted document",
      content: "soft delete phrase for chunks",
      metadata: {}
    });

    const deleted = await runtime.api.deleteContextDocument(ingested.document.id, {
      actor: "human_operator",
      reason: "cleanup",
      hardDelete: false
    });
    const documents = await runtime.api.listContextDocuments(source.id);
    const chunks = await runtime.api.listContextChunks(ingested.document.id);

    expect(deleted.hardDeleted).toBe(false);
    expect(deleted.document?.deletedAt).not.toBeNull();
    expect(documents.find((document) => document.id === ingested.document.id)?.deletedAt).not.toBeNull();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.deletedAt !== null)).toBe(true);
  });
});
