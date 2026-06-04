import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CreateGoalRequest } from "@triforge/shared";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { readFixture } from "../fixtures/readFixture.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context audit events", () => {
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

  it("lists audit events, quota status and rejects extra delete/restore payload fields", async () => {
    const goalFixture = await readFixture<CreateGoalRequest>("tests/fixtures/goals/basic-goal.json");
    const goal = await runtime.api.createGoal(goalFixture);
    const source = await runtime.api.createContextSource(goal.id, {
      name: "Audit source",
      type: "manual_text",
      metadata: {}
    });
    const ingested = await runtime.api.addContextDocument(source.id, {
      title: "Audit document",
      content: "audit lifecycle phrase",
      metadata: {}
    });

    const invalidDelete = await runtime.api.deleteContextDocumentStatus(ingested.document.id, {
      actor: "human_operator",
      hardDelete: false,
      extra: true
    });
    await runtime.api.deleteContextDocument(ingested.document.id, {
      actor: "human_operator",
      reason: "audit delete",
      hardDelete: false
    });
    const invalidRestore = await runtime.api.restoreContextDocumentStatus(ingested.document.id, {
      actor: "human_operator",
      reason: "audit restore",
      extra: true
    });
    await runtime.api.restoreContextDocument(ingested.document.id, {
      actor: "human_operator",
      reason: "audit restore"
    });
    const quota = await runtime.api.getContextQuota(goal.id);
    const auditEvents = await runtime.api.listContextAuditEvents(goal.id);

    expect(invalidDelete).toBe(400);
    expect(invalidRestore).toBe(400);
    expect(quota.activeDocuments).toBe(1);
    expect(auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["context_document_deleted", "context_document_restored"])
    );
    expect(auditEvents.every((event) => event.actor.length > 0)).toBe(true);
  });
});
