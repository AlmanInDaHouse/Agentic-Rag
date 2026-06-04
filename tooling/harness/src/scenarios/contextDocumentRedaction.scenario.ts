import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context document redaction", () => {
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

  it("stores redaction metadata and redacted chunks for sensitive manual text", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Redaction source",
      type: "manual_text",
      metadata: {}
    });

    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Redacted document",
      content: "Email security@example.com and use api_key=sk_1234567890abcdef1234567890.",
      metadata: {}
    });
    const chunks = await runtime.api.listContextChunks(ingested.document.id);

    expect(ingested.document.classification).toBe("secret");
    expect(ingested.document.redactionStatus).toBe("redacted");
    expect(ingested.document.sensitiveFindings.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].content).toContain("[REDACTED_EMAIL]");
    expect(chunks[0].content).toContain("[REDACTED_SECRET]");
    expect(JSON.stringify({ document: ingested.document, chunks })).not.toContain("security@example.com");
    expect(JSON.stringify({ document: ingested.document, chunks })).not.toContain("sk_1234567890abcdef");
  });
});
