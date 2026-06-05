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

export async function runRetrievalEvaluation(options: {
  modes?: EvaluatedMode[];
  fixturePaths?: string[];
  outputDir?: string;
} = {}) {
  const modes = options.modes ?? defaultModes;
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

function validateFixture(value: unknown, fixturePath: string): RetrievalEvalFixture {
  const candidate = value as RetrievalEvalFixture;
  if (
    typeof candidate?.name !== "string" ||
    !Array.isArray(candidate.documents) ||
    !Array.isArray(candidate.queries)
  ) {
    throw new Error(`Invalid retrieval evaluation fixture: ${fixturePath}`);
  }
  return candidate;
}

function excerpt(content: string): string {
  return content.length <= 180 ? content : `${content.slice(0, 177)}...`;
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
