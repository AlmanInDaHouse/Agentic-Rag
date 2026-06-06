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
import { evaluateQualityGate, loadQualityThresholds } from "./qualityGate.js";
import { buildReport, writeReports } from "./report.js";
import type {
  EvaluatedMode,
  IngestedChunk,
  RetrievalEvalFixture,
  RetrievalEvalQueryFixture,
  RetrievalEvalQueryResult,
  RetrievalEvalQueryTag,
  RetrievalEvalQueryType,
  RetrievalEvalTopResult,
  SearchResultLike
} from "./types.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../../..");
const fixturesDir = path.join(repoRoot, "tooling/retrieval-eval/fixtures");
const reportsDir = path.join(repoRoot, "reports/retrieval-eval");
const defaultReportJsonPath = path.join(reportsDir, "latest.json");
const defaultThresholdsPath = path.join(repoRoot, "tooling/retrieval-eval/baselines/thresholds.v1.json");
const defaultModes: EvaluatedMode[] = ["lexical", "mock_vector", "hybrid"];
const allowedModes = new Set<string>(defaultModes);
const allowedQueryTypes = new Set<string>(["answerable", "no_answer", "ambiguous", "redaction"]);
const allowedTags = new Set<string>([
  "security",
  "runtime",
  "redaction",
  "retention",
  "no_answer",
  "ambiguous"
]);

export async function runRetrievalEvaluation(options: {
  modes?: readonly EvaluatedMode[];
  fixturePaths?: string[];
  outputDir?: string;
  outputJsonPath?: string;
  gate?: boolean;
  thresholdsPath?: string;
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
    if (options.gate) {
      const thresholds = await loadQualityThresholds(options.thresholdsPath ?? defaultThresholdsPath);
      report.qualityGate = evaluateQualityGate(report, thresholds);
    }
    await writeReports(
      report,
      options.outputJsonPath !== undefined
        ? { jsonPath: options.outputJsonPath }
        : options.outputDir ?? reportsDir
    );
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
  if (expectedChunkIds.length === 0 && input.query.queryType !== "no_answer") {
    throw new Error(`Fixture ${input.fixtureName} query "${input.query.query}" did not resolve expected chunks`);
  }

  const retrieval = await input.search(input.goalId, {
    query: input.query.query,
    limit: input.query.k,
    mode: input.mode
  });
  const resultChunkIds = retrieval.results.map((result) => result.chunk.id);
  const metrics = calculateRetrievalMetrics(
    resultChunkIds,
    expectedChunkIds,
    input.query.k,
    input.query.queryType
  );

  return {
    fixtureName: input.fixtureName,
    mode: input.mode,
    query: input.query.query,
    queryType: input.query.queryType,
    tags: input.query.tags,
    k: input.query.k,
    expectedChunkIds,
    expectedDocumentTitles: input.query.expectedDocumentTitles,
    expectedChunkContains: input.query.expectedChunkContains,
    fallbackUsed: retrieval.results.some((result) => result.fallbackUsed),
    metrics,
    topResults: retrieval.results.map(toTopResult)
  };
}

export function calculateRetrievalMetrics(
  resultChunkIds: string[],
  expectedChunkIds: string[],
  k: number,
  queryType: RetrievalEvalQueryType
) {
  if (queryType === "no_answer") {
    return {
      precision_at_k: 0,
      recall_at_k: 1,
      hit_at_k: 1,
      mean_reciprocal_rank: 1,
      expected_chunk_found: true
    };
  }

  const hit = hitAtK(resultChunkIds, expectedChunkIds, k);
  return {
    precision_at_k: precisionAtK(resultChunkIds, expectedChunkIds, k),
    recall_at_k: recallAtK(resultChunkIds, expectedChunkIds, k),
    hit_at_k: hit,
    mean_reciprocal_rank: meanReciprocalRank(resultChunkIds, expectedChunkIds, k),
    expected_chunk_found: hit === 1
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
    if (!isQueryType(query.queryType)) {
      throw invalidFixture(fixturePath, `queries[${index}].queryType must be one of: ${Array.from(allowedQueryTypes).join(", ")}`);
    }
    if (!isTagArray(query.tags)) {
      throw invalidFixture(fixturePath, `queries[${index}].tags must contain only supported tags`);
    }
    const expectedDocumentTitles = query.expectedDocumentTitles;
    if (!Array.isArray(expectedDocumentTitles) || !expectedDocumentTitles.every(isNonEmptyString)) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedDocumentTitles must be a string array`);
    }
    if (query.queryType !== "no_answer" && expectedDocumentTitles.length === 0) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedDocumentTitles must be non-empty unless queryType is no_answer`);
    }
    if (query.queryType === "no_answer" && expectedDocumentTitles.length > 0) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedDocumentTitles must be empty for no_answer queries`);
    }
    for (const title of expectedDocumentTitles) {
      if (!documentTitles.has(title)) {
        throw invalidFixture(fixturePath, `queries[${index}] references unknown document title "${title}"`);
      }
    }
    const expectedChunkContains = query.expectedChunkContains;
    if (!Array.isArray(expectedChunkContains) || !expectedChunkContains.every(isNonEmptyString)) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedChunkContains must be a string array`);
    }
    if (query.queryType !== "no_answer" && expectedChunkContains.length === 0) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedChunkContains must be non-empty unless queryType is no_answer`);
    }
    if (query.queryType === "no_answer" && expectedChunkContains.length > 0) {
      throw invalidFixture(fixturePath, `queries[${index}].expectedChunkContains must be empty for no_answer queries`);
    }
    if (query.queryType !== "no_answer") {
      const expectedDocuments = value.documents
        .filter((document) => expectedDocumentTitles.includes(document.title));
      for (const expectedText of expectedChunkContains) {
        if (!expectedDocuments.some((document) => document.content.includes(expectedText))) {
          throw invalidFixture(
            fixturePath,
            `queries[${index}].expectedChunkContains entry "${expectedText}" must appear in an expected document`
          );
        }
      }
    }
    if (query.queryType === "no_answer" && !query.tags.includes("no_answer")) {
      throw invalidFixture(fixturePath, `queries[${index}].tags must include no_answer for no_answer queries`);
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

function isQueryType(value: unknown): value is RetrievalEvalQueryType {
  return typeof value === "string" && allowedQueryTypes.has(value);
}

function isTagArray(value: unknown): value is RetrievalEvalQueryTag[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((tag) => typeof tag === "string" && allowedTags.has(tag));
}

export function parseCliArgs(argv: readonly string[]): {
  gate: boolean;
  thresholdsPath: string;
  outputJsonPath: string;
} {
  const args = [...argv];
  const parsed = {
    gate: false,
    thresholdsPath: defaultThresholdsPath,
    outputJsonPath: defaultReportJsonPath
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--gate":
        parsed.gate = true;
        break;
      case "--thresholds":
        parsed.thresholdsPath = resolveRepoPath(readFlagValue(args, index, "--thresholds"));
        index += 1;
        break;
      case "--out":
        parsed.outputJsonPath = resolveRepoPath(readFlagValue(args, index, "--out"));
        index += 1;
        break;
      default:
        throw new Error(`Unknown retrieval evaluation argument "${arg}"`);
    }
  }

  return parsed;
}

function readFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === currentFile;

if (isDirectExecution) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function runCli(argv: readonly string[]): Promise<void> {
  const cli = parseCliArgs(argv);
  await runRetrievalEvaluation({
    gate: cli.gate,
    thresholdsPath: cli.thresholdsPath,
    outputJsonPath: cli.outputJsonPath
  })
    .then((report) => {
      console.log(`Retrieval evaluation complete: ${report.results.length} query runs`);
      if (report.qualityGate !== undefined) {
        console.log(`Quality gate: ${report.qualityGate.passed ? "PASS" : "FAIL"}`);
      }
      console.log(`Report written to ${cli.outputJsonPath}`);
      if (report.qualityGate?.passed === false) {
        process.exit(1);
      }
    });
}
