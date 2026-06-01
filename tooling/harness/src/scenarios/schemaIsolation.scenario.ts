import { describe, expect, it } from "vitest";
import {
  assertSafeHarnessSchemaName,
  createHarnessSchema,
  createHarnessSchemaIdentity,
  dropHarnessSchema,
  harnessSchemaExists,
  queryHarnessSchema,
  withTemporaryHarnessSchema
} from "../db/schemaIsolation.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://triforge:triforge@localhost:5432/triforge";

describe("harness: schema isolation", () => {
  it("generates a safe harness schema name", () => {
    const schema = createHarnessSchemaIdentity(new Date("2026-06-01T13:45:00.000Z"));

    expect(schema.schemaName).toMatch(/^harness_[a-zA-Z0-9_]+$/);
    expect(assertSafeHarnessSchemaName(schema.schemaName)).toBe(schema.schemaName);
  });

  it("rejects public and dangerous schema names", async () => {
    expect(() => assertSafeHarnessSchemaName("public")).toThrow(/Refusing unsafe harness schema/);
    expect(() => assertSafeHarnessSchemaName("harness_bad;DROP_SCHEMA_public")).toThrow(
      /Refusing unsafe harness schema/
    );
    await expect(dropHarnessSchema(databaseUrl, "public")).rejects.toThrow(
      /Refusing unsafe harness schema/
    );
  });

  it("creates data inside the temporary schema and drops it afterward", async () => {
    const schema = createHarnessSchemaIdentity();
    await createHarnessSchema(databaseUrl, schema.schemaName);
    try {
      await queryHarnessSchema(
        databaseUrl,
        schema.schemaName,
        "CREATE TABLE isolation_probe (id integer PRIMARY KEY)"
      );
      await queryHarnessSchema(databaseUrl, schema.schemaName, "INSERT INTO isolation_probe (id) VALUES ($1)", [
        1
      ]);
      const rows = await queryHarnessSchema<{ count: string }>(
        databaseUrl,
        schema.schemaName,
        "SELECT count(*) AS count FROM isolation_probe"
      );
      expect(Number(rows[0].count)).toBe(1);
    } finally {
      await dropHarnessSchema(databaseUrl, schema.schemaName);
    }

    expect(await harnessSchemaExists(databaseUrl, schema.schemaName)).toBe(false);
  });

  it("cleans up the schema when a scenario fails", async () => {
    let schemaName = "";
    await expect(
      withTemporaryHarnessSchema(databaseUrl, async (schema) => {
        schemaName = schema.schemaName;
        await queryHarnessSchema(databaseUrl, schema.schemaName, "CREATE TABLE failing_probe (id integer)");
        throw new Error("intentional harness failure");
      })
    ).rejects.toThrow("intentional harness failure");

    expect(schemaName).toMatch(/^harness_/);
    expect(await harnessSchemaExists(databaseUrl, schemaName)).toBe(false);
  });
});
