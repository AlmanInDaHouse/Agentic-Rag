import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { env } from "../config/env.js";
import { quoteIdentifier, searchPathSql } from "./schema.js";

const currentFile = fileURLToPath(import.meta.url);
const migrationsDir = path.resolve(path.dirname(currentFile), "../../migrations");
const migrationLockKey = "triforge_migrations";

async function withMigrationLock<T>(operation: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let operationError: unknown;

  try {
    // Extensions are database-wide, so schema-per-run harness isolation still needs serialized migrations.
    await client.query("SELECT pg_advisory_lock(hashtext($1::text))", [migrationLockKey]);

    try {
      return await operation();
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1::text))", [migrationLockKey]);
      } catch (unlockError) {
        if (operationError === undefined) {
          throw unlockError;
        }
        console.error("Failed to release migration advisory lock after migration error", unlockError);
      }
    }
  } finally {
    client.release();
  }
}

async function ensureMigrationTable(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(env.TRIFORGE_DB_SCHEMA)}`);
  await pool.query(`SET search_path TO ${searchPathSql(env.TRIFORGE_DB_SCHEMA)}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS triforge_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>(
    "SELECT version FROM triforge_migrations ORDER BY version ASC"
  );
  return new Set(result.rows.map((row) => row.version));
}

export async function runMigrations(): Promise<void> {
  await withMigrationLock(async () => {
    await ensureMigrationTable();
    const applied = await appliedVersions();
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(env.TRIFORGE_DB_SCHEMA)}`);
        await client.query(`SET LOCAL search_path TO ${searchPathSql(env.TRIFORGE_DB_SCHEMA)}`);
        await client.query(sql);
        await client.query("INSERT INTO triforge_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        console.log(`Applied migration ${version}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  });
}

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === currentFile;

if (isDirectExecution) {
  runMigrations()
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}
