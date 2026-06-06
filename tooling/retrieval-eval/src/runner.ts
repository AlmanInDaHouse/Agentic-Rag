import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextChunk } from "@triforge/shared";
import { startHarnessRuntime } from "../../harness/src/runner.js";
import {
  hitAtK,
  meanReciprocalRank,
  precisionAtK,
  recallAtK
} from "./metrics.js";
import { buildReport, writeReports } from "./report.js";
import type {
  EvaluatedMode,
  IngestedChunk,
  RetrievalEvalFixture,
  RetrievalEvalQueryFixture,
  RetrievalEvalQueryResult,
  RetrievalEvalTopResult,
  SearchResultLike
} from "./types.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../../..");
const fixturesDir = path.join(repoRoot, "tooling/retrieval-eval/fixtures");
const reportsDir = path.join(repoRoot, "reports/retrieval-eval");
const defaultModes: EvaluatedMode[] = ["lexical", "mock_vector", "hybrid"];
const allowedModes = new Set<string>(defaultModes);

export async function runRetrievalEvaluation(options: {
  modes?: readonly EvaluatedMode[];
  fixturePaths?: string[];
  outputDir?: string;
} = {}) {
  const modes = validateModes(options.modes ?? defaultModes);
  const fixturePaths = options.fixturePaths ?? await listFixturePaths();
  const fixtures = await Promise.all(fixturePaths.map(readFixture));
  const runtime = await startHarnessRuntime({});

  try {
    const results: RetrievalEvalQueryResult[] = [];
    const goal = await runtime.api.createGoal({
      title: "Retrieval evaluation",
      description: "Evaluate deterministic retrieval fixtures against Context Engine search modes."
    });

    for (const fixture of fixtures) {
      const source = await runtime.api.createContextSource(goal.id, {
        name: `Retrieval eval: ${fixture.name}`,
        type: "manual_text",
        metadata: { fixtureName: fixture.name }
      });
      const chunks = await ingestFixture(runtime.api, source.id, fixture);
      let embeddingsGenerated = false;

      for (const mode of modes) {
        if (mode !== "lexical" && !embeddingsGenerated) {
          await runtime.api.generateSourceMockEmbeddings(source.id);
          embeddingsGenerated = true;
        }
        for (const query of fixture.queries) {
          results.push(await evaluateQuery({
            fixtureName: fixture.name,
            mode,
            goalId: goal.id,
            query,
            chunks,
            search: (goalId, searchInput) => runtime.api.searchContext(goalId, searchInput)
          }));
        }
      }
    }

    const report = buildReport({ modes, results });
    await writeReports(report, options.outputDir ?? reportsDir);
    return report;
  } finally {
    await runtime.stop();
  }
}

async function ingestFixture(
  api: Awaited<ReturnType<typeof startHarnessRuntime>>["api"],
  sourceId: string,
  fixture: RetrievalEvalFixture
): Promise<IngestedChunk[]> {
  const chunks: IngestedChunk[] = [];
  for (const document of fixture.documents) {
    const ingested = await api.addContextDocument(sourceId, {
      title: document.title,
      content: document.content,
      metadata: { fixtureName: fixture.name }
    });
    chunks.push(...ingested.chunks.map((chunk) => toIngestedChunk(document.title, chunk)));
  }
  return chunks;
}

async function evaluateQuery(input: {
  fixtureName: string;
  mode: EvaluatedMode;
  goalId: string;
  query: RetrievalEvalQueryFixture;
  chunks: IngestedChunk[];
  search: (
    goalId: string,
    input: { query: string; limit: number; mode: EvaluatedMode }
  ) => Promise<{ results: SearchResultLike[] }>;
}): Promise<RetrievalEvalQueryResult> {
  const expectedChunkIds = resolveExpectedChunkIds(input.chunks, input.query);
  if (expectedChunkIds.length === 0) {
    throw new Error(`Fixture ${input.fixtureName} query "${input.query.query}" did not resolve expected chunks`);
  }

  const retrieval = await input.search(input.goalId, {
    query: input.query.query,
    limit: input.query.k,
    mode: input.mode
  });
  const resultChunkIds = retrieval.results.map((result) => result.chunk.id);
  const metrics = {
    precision_at_k: precisionAtK(resultChunkIds, expectedChunkIds, input.query.k),
    recall_at_k: recallAtK(resultChunkIds, expectedChunkIds, input.query.k),
    hit_at_k: hitAtK(resultChunkIds, expectedChunkIds, input.query.k),
    mean_reciprocal_rank: meanReciprocalRank(resultChunkIds, expectedChunkIds, input.query.k),
    expected_chunk_found: hitAtK(resultChunkIds, expectedChunkIds, input.query.k) === 1
  };

  return {
    fixtureName: input.fixtureName,
    mode: input.mode,
    query: input.query.query,
    k: input.query.k,
    expectedChunkIds,
    expectedDocumentTitles: input.query.expectedDocumentTitles,
    expectedChunkContains: input.query.expectedChunkContains,
    fallbackUsed: retrieval.results.some((result) => result.fallbackUsed),
    metrics,
    topResults: retrieval.results.map(toTopResult)
  };
}

function resolveExpectedChunkIds(
  chunks: IngestedChunk[],
  query: RetrievalEvalQueryFixture
): string[] {
  const expectedTitles = new Set(query.expectedDocumentTitles);
  const explicitChunks = chunks.filter((chunk) => (
    query.expectedChunkContains.some((expectedText) => chunk.content.includes(expectedText))
  ));
  if (explicitChunks.length > 0) {
    return explicitChunks.map((chunk) => chunk.chunkId);
  }
  return chunks
    .filter((chunk) => expectedTitles.has(chunk.documentTitle))
    .map((chunk) => chunk.chunkId);
}

function toTopResult(result: SearchResultLike, index: number): RetrievalEvalTopResult {
  return {
    rank: index + 1,
    documentTitle: result.document.title,
    chunkId: result.chunk.id,
    chunkExcerpt: excerpt(result.chunk.content),
    finalScore: result.finalScore,
    lexicalScore: result.lexicalScore,
    vectorScore: result.vectorScore,
    fallbackUsed: result.fallbackUsed,
    fallbackReason: result.fallbackReason,
    vectorStorageUsed: result.vectorStorageUsed
  };
}

function toIngestedChunk(documentTitle: string, chunk: ContextChunk): IngestedChunk {
  return {
    documentTitle,
    chunkId: chunk.id,
    content: chunk.content
  };
}

async function listFixturePaths(): Promise<string[]> {
  const files = await fs.readdir(fixturesDir);
  return files
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(fixturesDir, file));
}

async function readFixture(fixturePath: string): Promise<RetrievalEvalFixture> {
  const raw = await fs.readFile(fixturePath, "utf8");
  return validateFixture(JSON.parse(raw), fixturePath);
}

export function validateModes(modes: readonly string[]): EvaluatedMode[] {
  if (modes.length === 0) {
    throw new Error("Retrieval evaluation requires at least one mode");
  }
  for (const mode of modes) {
    if (!allowedModes.has(mode)) {
      throw new Error(`Unsupported retrieval evaluation mode "${mode}". Expected one of: ${defaultModes.join(", ")}`);
    }
  }
  return [...modes] as EvaluatedMode[];
}

export function validateFixture(value: unknown, fixturePath: string): RetrievalEvalFixture {
  if (!isRecord(value)) {
    throw invalidFixture(fixturePath, "fixture must be an object");
  }
  if (!isNonEmptyString(value.name)) {
    throw invalidFixture(fixturePath, "name must be a non-empty string");
  }
  if (!Array.isArray(value.documents) || value.documents.length === 0) {
    throw invalidFixture(fixturePath, "documents must be a non-empty array");
  }
  if (!Array.isArray(value.queries) || value.queries.length === 0) {
    throw invalidFixture(fixturePath, "queries must be a non-empty array");
  }

  const documentTitles = new Set<string>();
  for (const [index, document] of value.documents.entries()) {
    if (!isRecord(document)) {
      throw invalidFixture(fixturePath, `documents[${index}] must be an object`);
    }
    if (!isNonEmptyString(document.title)) {
      throw invalidFixture(fixturePath, `documents[${index}].title must be a non-empty string`);
    }
    if (documentTitles.has(document.title)) {
      throw invalidFixture(fixturePath, `documents[${index}].title must be unique`);
    }
    documentTitles.add(document.title);
    if (!isNonEmptyString(document.content)) {
      throw invalidFixture(fixturePath, `documents[${index}].content must be a non-empty string`);
    }
  }

  for (const [index, query] of value.queries.entries()) {
    if (!isRecord(query)) {
      throw invalidFixture(fixturePath, `queries[${index}] must be an object`);
    }
    if (!isNonEmptyString(query.query)) {
      throw invalidFixture(fixturePath, `queries[${index}].query must be a non-empty string`);
    }
    if (!isNonEmptyStringArray(query.expectedDocumentTitles)) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedDocumentTitles must be a non-empty string array`);
    }
    for (const title of query.expectedDocumentTitles) {
      if (!documentTitles.has(title)) {
        throw invalidFixture(fixturePath, `queries[${index}] references unknown document title "${title}"`);
      }
    }
    if (!isNonEmptyStringArray(query.expectedChunkContains)) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedChunkContains must be a non-empty string array`);
    }
    if (!Number.isInteger(query.k) || query.k <= 0) {
      throw invalidFixture(fixturePath, `queries[${index}].k must be a positive integer`);
    }
  }

  return value as RetrievalEvalFixture;
}

function excerpt(content: string): string {
  return content.length <= 180 ? content : `${content.slice(0, 177)}...`;
}

function invalidFixture(fixturePath: string, reason: string): Error {
  return new Error(`Invalid retrieval evaluation fixture ${fixturePath}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === currentFile;

if (isDirectExecution) {
  runRetrievalEvaluation()
    .then((report) => {
      console.log(`Retrieval evaluation complete: ${report.results.length} query runs`);
      console.log(`Reports written to ${reportsDir}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
