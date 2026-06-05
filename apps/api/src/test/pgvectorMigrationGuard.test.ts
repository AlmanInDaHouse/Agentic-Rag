import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentFile = fileURLToPath(import.meta.url);
const optionalMigrationPath = path.resolve(
  path.dirname(currentFile),
  "../../migrations/0010_pgvector_optional.sql"
);
const activeRetrievalMigrationPath = path.resolve(
  path.dirname(currentFile),
  "../../migrations/0011_pgvector_active_retrieval.sql"
);

describe("0010 pgvector optional migration guard", () => {
  it("keeps pgvector optional and storage_kind compatible", async () => {
    const sql = await readFile(optionalMigrationPath, "utf8");

    expect(sql).not.toMatch(/CREATE\s+EXTENSION\s+.*vector/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+context_chunk_embeddings/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS storage_kind TEXT NOT NULL DEFAULT 'jsonb'/i);
    expect(sql).toMatch(/CHECK \(storage_kind IN \('jsonb', 'pgvector'\)\)/i);
    expect(sql).toMatch(/conrelid = 'embedding_models'::regclass/i);
    expect(sql).toMatch(/pg_available_extensions/i);
  });

  it("keeps active retrieval table creation guarded by installed extension", async () => {
    const sql = await readFile(activeRetrievalMigrationPath, "utf8");

    expect(sql).not.toMatch(/CREATE\s+EXTENSION\s+.*vector/i);
    expect(sql).toMatch(/FROM pg_extension/i);
    expect(sql).toMatch(/WHERE extname = 'vector'/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS context_chunk_vector_embeddings/i);
    expect(sql).toMatch(/embedding vector\(32\) NOT NULL/i);
    expect(sql).toMatch(/RAISE NOTICE 'pgvector extension is not installed/i);
  });
});
