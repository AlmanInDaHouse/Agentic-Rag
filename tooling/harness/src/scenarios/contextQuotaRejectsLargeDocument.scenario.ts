import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context quota rejects large document", () => {
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

  it("returns 413, quota status and an audit event", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Quota source",
      type: "manual_text",
      metadata: {}
    });

    const status = await runtime.api.addContextDocumentStatus(source.id, {
      title: "Too large",
      content: "a".repeat(200_001),
      metadata: {}
    });
    const quota = await runtime.api.getContextQuota(goal.id);
    const auditEvents = await runtime.api.listContextAuditEvents(goal.id);

    expect(status).toBe(413);
    expect(quota.activeDocuments).toBe(0);
    expect(quota.remainingDocuments).toBe(quota.maxDocumentsPerGoal);
    expect(auditEvents.some((event) => event.eventType === "context_quota_rejected")).toBe(true);
  });
});
