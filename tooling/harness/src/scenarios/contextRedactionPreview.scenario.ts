import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harnessSchemaExists } from "../db/schemaIsolation.js";
import { startHarnessRuntime, type HarnessRuntime } from "../runner.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: context redaction preview", () => {
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

  it("detects email and token without persistence", async () => {
    const preview = await runtime.api.previewContextRedaction({
      content: "Contact ops@example.com with token=abcdef1234567890."
    });

    expect(preview.classification).toBe("secret");
    expect(preview.redactionStatus).toBe("redacted");
    expect(preview.findings.map((finding) => finding.type)).toEqual(expect.arrayContaining([
      "email",
      "secret_token_like"
    ]));
    expect(preview.redactedContent).toContain("[REDACTED_EMAIL]");
    expect(preview.redactedContent).toContain("[REDACTED_TOKEN]");
    expect(preview.redactedContent).not.toContain("ops@example.com");
  });

  it("rejects invalid preview payloads", async () => {
    expect(await runtime.api.previewContextRedactionStatus({
      content: "hello",
      unexpected: true
    })).toBe(400);
  });
});
