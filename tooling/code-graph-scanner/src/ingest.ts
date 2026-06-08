import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../../../apps/api/src/db/pool.js";
import { PgContextAuditEventRepository } from "../../../apps/api/src/repositories/contextAuditEventRepository.js";
import { PgContextChunkRepository } from "../../../apps/api/src/repositories/contextChunkRepository.js";
import { PgContextDocumentRepository } from "../../../apps/api/src/repositories/contextDocumentRepository.js";
import { PgContextRetrievalRepository } from "../../../apps/api/src/repositories/contextRetrievalRepository.js";
import { PgContextSourceRepository } from "../../../apps/api/src/repositories/contextSourceRepository.js";
import { PgGoalsRepository } from "../../../apps/api/src/repositories/goalsRepository.js";
import { ContextRetentionPolicyService } from "../../../apps/api/src/services/contextRetentionPolicyService.js";
import { CodeGraphContextPackIngestionService } from "./ingestion.js";

type IngestCliOptions = {
  repoRoot: string;
  pack: string;
  goalId: string | null;
  sourceName?: string;
};

const currentFile = fileURLToPath(import.meta.url);
const defaultPackPath = "artifacts/code-graph/code-context-pack.json";

async function main(): Promise<void> {
  const options = parseIngestArgs(process.argv.slice(2));
  if (options.goalId === null) {
    throw new Error("code-graph:ingest requires --goal-id <uuid>.");
  }
  await runIngest({ ...options, goalId: options.goalId });
}

export async function runIngest(options: IngestCliOptions & { goalId: string }): Promise<void> {
  const repoRoot = await resolveRepoRoot(options.repoRoot);
  const packPath = await resolveInsideRepo(repoRoot, options.pack, true);
  const packJson = await fs.readFile(packPath, "utf8");
  const pack = JSON.parse(packJson) as unknown;

  const goalsRepository = new PgGoalsRepository(pool);
  const contextSourceRepository = new PgContextSourceRepository(pool);
  const contextDocumentRepository = new PgContextDocumentRepository(pool);
  const contextChunkRepository = new PgContextChunkRepository(pool);
  const contextRetrievalRepository = new PgContextRetrievalRepository(pool);
  const contextAuditEventRepository = new PgContextAuditEventRepository(pool);
  const retentionPolicyService = new ContextRetentionPolicyService(
    goalsRepository,
    contextSourceRepository,
    contextDocumentRepository,
    contextRetrievalRepository,
    contextAuditEventRepository
  );
  const ingestionService = new CodeGraphContextPackIngestionService(
    {
      goalsRepository,
      contextSourceRepository,
      contextDocumentRepository,
      contextChunkRepository,
      contextRetrievalRepository
    },
    retentionPolicyService
  );

  const result = await ingestionService.ingest({
    goalId: options.goalId,
    pack,
    artifactPath: toRepoPath(repoRoot, packPath),
    sourceName: options.sourceName
  });

  process.stdout.write(
    [
      `Code Graph context pack ingested for goal ${options.goalId}.`,
      `source=${result.source.id}`,
      `sourceCreated=${result.sourceCreated}`,
      `packHash=${result.packHash}`,
      `documentsCreated=${result.documentsCreated}`,
      `documentsReused=${result.documentsReused}`,
      `chunksCreated=${result.chunksCreated}`,
      `chunksRedacted=${result.chunksRedacted}`,
      `chunksSkippedRestricted=${result.chunksSkippedRestricted}`
    ].join("\n") + "\n"
  );
}

export function parseIngestArgs(args: string[]): IngestCliOptions {
  const options: IngestCliOptions = {
    repoRoot: process.cwd(),
    pack: defaultPackPath,
    goalId: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo-root") {
      options.repoRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--pack") {
      options.pack = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--goal-id") {
      options.goalId = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-name") {
      options.sourceName = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function resolveRepoRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  const realResolved = await fs.realpath(resolved);
  const stats = await fs.stat(realResolved);
  if (!stats.isDirectory()) {
    throw new Error(`Code Graph context pack ingest repo root is not a directory: ${input}`);
  }
  return realResolved;
}

async function resolveInsideRepo(repoRoot: string, input: string, mustExist: boolean): Promise<string> {
  const resolved = path.resolve(repoRoot, input);
  if (!isInside(repoRoot, resolved)) {
    throw new Error(`Code Graph context pack ingest path escapes the repository: ${input}`);
  }
  if (mustExist) {
    const realResolved = await fs.realpath(resolved);
    if (!isInside(repoRoot, realResolved)) {
      throw new Error(`Code Graph context pack ingest path escapes the repository: ${input}`);
    }
    return realResolved;
  }
  return resolved;
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function toRepoPath(repoRoot: string, input: string): string {
  return path.relative(repoRoot, input).replaceAll("\\", "/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

if (process.argv[1] !== undefined && currentFile === path.resolve(process.argv[1])) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
