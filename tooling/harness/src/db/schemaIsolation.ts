import pg from "pg";

const harnessSchemaPattern = /^harness_[a-zA-Z0-9_]+$/;

export type HarnessSchema = {
  runId: string;
  schemaName: string;
};

export function createHarnessSchemaIdentity(date = new Date()): HarnessSchema {
  const timestamp = date
    .toISOString()
    .replaceAll("-", "")
    .replace("T", "_")
    .replaceAll(":", "")
    .replace(/\..+$/, "");
  const random = Math.random().toString(16).slice(2, 8);
  const runId = `${timestamp}_${random}`;
  return {
    runId,
    schemaName: `harness_${runId}`
  };
}

export function assertSafeHarnessSchemaName(schemaName: string): string {
  if (schemaName === "public" || !harnessSchemaPattern.test(schemaName)) {
    throw new Error(`Refusing unsafe harness schema "${schemaName}"`);
  }

  return schemaName;
}

export function quoteHarnessIdentifier(schemaName: string): string {
  const safeName = assertSafeHarnessSchemaName(schemaName);
  return `"${safeName.replaceAll('"', '""')}"`;
}

export async function createHarnessSchema(databaseUrl: string, schemaName: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteHarnessIdentifier(schemaName)}`);
  } finally {
    await pool.end();
  }
}

export async function dropHarnessSchema(databaseUrl: string, schemaName: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteHarnessIdentifier(schemaName)} CASCADE`);
  } finally {
    await pool.end();
  }
}

export async function harnessSchemaExists(
  databaseUrl: string,
  schemaName: string
): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists",
      [schemaName]
    );
    return result.rows[0]?.exists ?? false;
  } finally {
    await pool.end();
  }
}

export async function queryHarnessSchema<T>(
  databaseUrl: string,
  schemaName: string,
  sql: string,
  values: unknown[] = []
): Promise<T[]> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${assertSafeHarnessSchemaName(schemaName)},public`
  });
  try {
    const result = await pool.query<T>(sql, values);
    return result.rows;
  } finally {
    await pool.end();
  }
}

export async function withTemporaryHarnessSchema<T>(
  databaseUrl: string,
  callback: (schema: HarnessSchema) => Promise<T>
): Promise<T> {
  const schema = createHarnessSchemaIdentity();
  await createHarnessSchema(databaseUrl, schema.schemaName);
  try {
    return await callback(schema);
  } finally {
    await dropHarnessSchema(databaseUrl, schema.schemaName);
  }
}
