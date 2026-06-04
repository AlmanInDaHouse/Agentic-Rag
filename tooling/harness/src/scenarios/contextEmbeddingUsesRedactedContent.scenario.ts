import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context embeddings use redacted content", () => {
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

  it("generates embeddings only after sensitive content has been redacted into chunks", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Embedding redaction source",
      type: "project_note",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Embedding redacted document",
      content: "Contact embed@example.com before ranking context.",
      metadata: {}
    });
    const chunks = await runtime.api.listContextChunks(ingested.document.id);

    expect(chunks.every((chunk) => chunk.redactionStatus === "redacted")).toBe(true);
    expect(chunks.map((chunk) => chunk.content).join("\n")).toContain("[REDACTED_EMAIL]");
    expect(chunks.map((chunk) => chunk.content).join("\n")).not.toContain("embed@example.com");

    const generated = await runtime.api.generateDocumentMockEmbeddings(ingested.document.id);
    expect(generated.generatedCount).toBe(chunks.length);
    expect(generated.embeddings).toHaveLength(chunks.length);
  });
});
