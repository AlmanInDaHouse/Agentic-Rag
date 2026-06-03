import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context engine ingest and search", () => {
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

  it("creates a source, ingests text, chunks it and retrieves relevant context", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);

    const source = await runtime.api.createContextSource(goal.id, {
      name: "Manual runtime notes",
      type: "manual_text",
      metadata: { origin: "harness" }
    });
    expect((await runtime.api.listContextSources(goal.id)).map((item) => item.id)).toContain(source.id);

    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Approval gate context",
      content: "The load_context step should retrieve approval gate notes with lexical search.",
      metadata: { fixture: "contextEngineIngestSearch" }
    });
    expect(ingested.chunks.length).toBeGreaterThan(0);

    const documents = await runtime.api.listContextDocuments(source.id);
    expect(documents.map((document) => document.id)).toContain(ingested.document.id);
    const chunks = await runtime.api.listContextChunks(ingested.document.id);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));

    expect(await runtime.api.searchContextStatus(goal.id, { query: "approval", limit: 5, extra: true })).toBe(400);

    const retrieval = await runtime.api.searchContext(goal.id, {
      query: "approval gate",
      limit: 5
    });
    expect(retrieval.results.length).toBeGreaterThan(0);
    expect(retrieval.results[0].chunk.content).toContain("approval gate");

    const retrievals = await runtime.api.listContextRetrievals(goal.id);
    expect(retrievals.map((item) => item.id)).toContain(retrieval.id);
  });
});
