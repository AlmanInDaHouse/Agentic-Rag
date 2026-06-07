import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContextPack } from "./contextPack.js";
import { scanRepository } from "./scanner.js";
import type { CodeGraphContextPack, CodeGraphContextPackChunk } from "./types.js";

export type CodeGraphPackEvalQueryType = "answerable" | "no_answer" | "ambiguous";

export type CodeGraphPackEvalCase = {
  id: string;
  query: string;
  queryType: CodeGraphPackEvalQueryType;
  expectedChunkIds: string[];
  expectedTerms: string[];
  tags: string[];
  k: number;
};

export type CodeGraphPackEvalFixture = CodeGraphPackEvalCase[];

export type CodeGraphPackEvalTopResult = {
  rank: number;
  chunkId: string;
  documentId: string;
  score: number;
  matchedTerms: string[];
  text: string;
};

export type CodeGraphPackEvalCaseResult = {
  id: string;
  query: string;
  queryType: CodeGraphPackEvalQueryType;
  tags: string[];
  k: number;
  expectedChunkIds: string[];
  expectedTerms: string[];
  expectedTermsFound: boolean;
  hitAtK: number;
  shouldAnswer: boolean;
  needsClarification: boolean;
  warnings: string[];
  topResults: CodeGraphPackEvalTopResult[];
};

export type CodeGraphPackEvalSummary = {
  cases: number;
  passed: number;
  failed: number;
  hitAtK: number;
  expectedTermsFound: number;
  noAnswerAbstention: number;
  falseAnswerRate: number;
  falseAbstentionRate: number;
};

export type CodeGraphPackEvalReport = {
  summary: CodeGraphPackEvalSummary;
  thresholds: CodeGraphPackEvalThresholds;
  cases: CodeGraphPackEvalCaseResult[];
};

export type CodeGraphPackEvalThresholds = {
  hitAtK: number;
  expectedTermsFound: number;
  falseAnswerRate: number;
  falseAbstentionRate: number;
};

type PackEvalOptions = {
  fixtureRoot: string;
  casesPath: string;
  expectedPath: string;
  sourceArtifactPath: string;
};

const currentFile = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFile), "../../..");
const defaultFixtureRoot = "tooling/code-graph-fixtures/basic-api";
const defaultCasesPath = "eval/code-context-pack.eval.json";
const defaultExpectedPath = "expected/code-context-pack-eval.normalized.json";
const defaultSourceArtifactPath = "artifacts/code-graph/code-graph.json";
export const defaultPackEvalThresholds: CodeGraphPackEvalThresholds = {
  hitAtK: 0.8,
  expectedTermsFound: 0.8,
  falseAnswerRate: 0,
  falseAbstentionRate: 0.2
};

async function main(): Promise<void> {
  const options = await parsePackEvalArgs(process.argv.slice(2));
  const report = await runFixturePackEval(options);
  const normalized = normalizePackEvalReport(report);
  const expected = JSON.parse(await fs.readFile(options.expectedPath, "utf8")) as unknown;

  const actualJson = `${JSON.stringify(normalized, null, 2)}\n`;
  const expectedJson = `${JSON.stringify(expected, null, 2)}\n`;

  if (actualJson !== expectedJson) {
    throw new Error(`Code Graph context pack eval output drifted from ${toWorkspacePath(options.expectedPath)}`);
  }

  enforcePackEvalGate(report);
  process.stdout.write(
    `Code Graph context pack eval passed for ${toWorkspacePath(options.fixtureRoot)}: ` +
    `${report.summary.passed}/${report.summary.cases} cases passed\n`
  );
}

export async function runFixturePackEval(options: PackEvalOptions): Promise<CodeGraphPackEvalReport> {
  const cases = await loadEvalCases(options.casesPath);
  const artifact = await scanRepository({
    repoRoot: options.fixtureRoot,
    commitSha: "fixture",
    startedAt: "2026-06-08T00:00:00.000Z",
    completedAt: "2026-06-08T00:00:00.000Z"
  });
  const contextPack = createContextPack(artifact, {
    generatedAt: "2026-06-08T00:00:00.000Z",
    sourceArtifactPath: options.sourceArtifactPath
  });
  return evaluateContextPack(contextPack, cases, defaultPackEvalThresholds);
}

export function evaluateContextPack(
  contextPack: CodeGraphContextPack,
  cases: CodeGraphPackEvalFixture,
  thresholds: CodeGraphPackEvalThresholds = defaultPackEvalThresholds
): CodeGraphPackEvalReport {
  if (contextPack.chunks.length === 0) {
    throw new Error("Code Graph context pack eval requires at least one chunk.");
  }
  if (cases.length === 0) {
    throw new Error("Code Graph context pack eval requires at least one eval case.");
  }

  const results = cases.map((testCase) => evaluateCase(contextPack.chunks, testCase));
  const summary = summarizeResults(results);

  return {
    summary,
    thresholds,
    cases: results
  };
}

export function searchPackChunks(
  chunks: CodeGraphContextPackChunk[],
  query: string,
  k: number
): CodeGraphPackEvalTopResult[] {
  const queryTokens = tokenize(query);
  return chunks
    .map((chunk) => scoreChunk(chunk, queryTokens))
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.chunkId.localeCompare(right.chunkId);
    })
    .slice(0, k)
    .map((result, index) => ({
      rank: index + 1,
      chunkId: result.chunkId,
      documentId: result.documentId,
      score: roundScore(result.score),
      matchedTerms: result.matchedTerms,
      text: result.text
    }));
}

export function normalizePackEvalReport(report: CodeGraphPackEvalReport): CodeGraphPackEvalReport {
  return {
    summary: {
      cases: report.summary.cases,
      passed: report.summary.passed,
      failed: report.summary.failed,
      hitAtK: roundScore(report.summary.hitAtK),
      expectedTermsFound: roundScore(report.summary.expectedTermsFound),
      noAnswerAbstention: roundScore(report.summary.noAnswerAbstention),
      falseAnswerRate: roundScore(report.summary.falseAnswerRate),
      falseAbstentionRate: roundScore(report.summary.falseAbstentionRate)
    },
    thresholds: report.thresholds,
    cases: report.cases.map((testCase) => ({
      id: testCase.id,
      query: testCase.query,
      queryType: testCase.queryType,
      tags: [...testCase.tags].sort(),
      k: testCase.k,
      expectedChunkIds: [...testCase.expectedChunkIds].sort(),
      expectedTerms: [...testCase.expectedTerms].sort(),
      expectedTermsFound: testCase.expectedTermsFound,
      hitAtK: testCase.hitAtK,
      shouldAnswer: testCase.shouldAnswer,
      needsClarification: testCase.needsClarification,
      warnings: [...testCase.warnings].sort(),
      topResults: testCase.topResults.map((result) => ({
        rank: result.rank,
        chunkId: result.chunkId,
        documentId: result.documentId,
        score: roundScore(result.score),
        matchedTerms: [...result.matchedTerms].sort(),
        text: result.text
      }))
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function enforcePackEvalGate(report: CodeGraphPackEvalReport): void {
  const failures: string[] = [];
  if (report.summary.hitAtK < report.thresholds.hitAtK) {
    failures.push(`hitAtK ${report.summary.hitAtK} is below ${report.thresholds.hitAtK}`);
  }
  if (report.summary.expectedTermsFound < report.thresholds.expectedTermsFound) {
    failures.push(`expectedTermsFound ${report.summary.expectedTermsFound} is below ${report.thresholds.expectedTermsFound}`);
  }
  if (report.summary.falseAnswerRate > report.thresholds.falseAnswerRate) {
    failures.push(`falseAnswerRate ${report.summary.falseAnswerRate} is above ${report.thresholds.falseAnswerRate}`);
  }
  if (report.summary.falseAbstentionRate > report.thresholds.falseAbstentionRate) {
    failures.push(`falseAbstentionRate ${report.summary.falseAbstentionRate} is above ${report.thresholds.falseAbstentionRate}`);
  }
  for (const result of report.cases) {
    if (result.expectedChunkIds.length > 0 && result.hitAtK === 0) {
      failures.push(`${result.id} did not retrieve an expected chunk in top ${result.k}`);
    }
    if (result.expectedTerms.length > 0 && !result.expectedTermsFound) {
      failures.push(`${result.id} did not find all expected terms in retrieved evidence`);
    }
    if (result.queryType === "no_answer" && result.shouldAnswer) {
      failures.push(`${result.id} returned strong evidence for a no-answer query`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Code Graph context pack eval failed:\n${failures.join("\n")}`);
  }
}

export async function loadEvalCases(casesPath: string): Promise<CodeGraphPackEvalFixture> {
  const raw = await fs.readFile(casesPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Code Graph context pack eval cases must be an array: ${casesPath}`);
  }
  const ids = new Set<string>();
  return parsed.map((value, index) => validateEvalCase(value, index, ids));
}

export async function parsePackEvalArgs(args: string[]): Promise<PackEvalOptions> {
  let fixtureRoot = defaultFixtureRoot;
  let casesPath: string | null = null;
  let expectedPath: string | null = null;
  let sourceArtifactPath = defaultSourceArtifactPath;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fixture") {
      fixtureRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--cases") {
      casesPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--expected") {
      expectedPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--source-artifact-path") {
      sourceArtifactPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const resolvedFixtureRoot = await resolveInsideWorkspace(fixtureRoot);
  const resolvedCasesPath = casesPath === null
    ? await resolveInsideWorkspace(path.join(fixtureRoot, defaultCasesPath))
    : await resolveInsideWorkspace(casesPath);
  const resolvedExpectedPath = expectedPath === null
    ? await resolveInsideWorkspace(path.join(fixtureRoot, defaultExpectedPath))
    : await resolveInsideWorkspace(expectedPath);

  return {
    fixtureRoot: resolvedFixtureRoot,
    casesPath: resolvedCasesPath,
    expectedPath: resolvedExpectedPath,
    sourceArtifactPath
  };
}

function evaluateCase(chunks: CodeGraphContextPackChunk[], testCase: CodeGraphPackEvalCase): CodeGraphPackEvalCaseResult {
  const topResults = searchPackChunks(chunks, testCase.query, testCase.k);
  const topIds = topResults.map((result) => result.chunkId);
  const expectedSet = new Set(testCase.expectedChunkIds);
  const hitAtK = topIds.some((id) => expectedSet.has(id)) ? 1 : 0;
  const evidenceText = topResults.map((result) => result.text).join("\n").toLowerCase();
  const expectedTermsFound = testCase.expectedTerms.every((term) => evidenceText.includes(term.toLowerCase()));
  const strongEvidence = topResults[0] !== undefined && topResults[0].score >= 0.45;
  const warnings: string[] = [];
  let shouldAnswer = strongEvidence && (testCase.expectedTerms.length === 0 || expectedTermsFound);
  let needsClarification = false;

  if (testCase.queryType === "no_answer") {
    shouldAnswer = false;
    if (strongEvidence) {
      warnings.push("no_answer_query_has_lexical_overlap");
    }
  }
  if (testCase.queryType === "ambiguous") {
    shouldAnswer = false;
    needsClarification = true;
    warnings.push("ambiguous_query_needs_clarification");
  }
  if (testCase.tags.includes("warning")) {
    shouldAnswer = false;
    warnings.push("scanner_warning_is_not_positive_evidence");
  }

  return {
    id: testCase.id,
    query: testCase.query,
    queryType: testCase.queryType,
    tags: testCase.tags,
    k: testCase.k,
    expectedChunkIds: testCase.expectedChunkIds,
    expectedTerms: testCase.expectedTerms,
    expectedTermsFound,
    hitAtK,
    shouldAnswer,
    needsClarification,
    warnings,
    topResults
  };
}

function summarizeResults(results: CodeGraphPackEvalCaseResult[]): CodeGraphPackEvalSummary {
  const answerableResults = results.filter((result) => result.queryType === "answerable");
  const noAnswerResults = results.filter((result) => result.queryType === "no_answer");
  const falseAnswers = results.filter((result) => result.queryType === "no_answer" && result.shouldAnswer).length;
  const falseAbstentions = answerableResults.filter((result) => !result.shouldAnswer).length;
  const passed = results.filter(casePassed).length;

  return {
    cases: results.length,
    passed,
    failed: results.length - passed,
    hitAtK: average(answerableResults.map((result) => result.hitAtK)),
    expectedTermsFound: average(answerableResults.map((result) => result.expectedTermsFound ? 1 : 0)),
    noAnswerAbstention: average(noAnswerResults.map((result) => result.shouldAnswer ? 0 : 1)),
    falseAnswerRate: noAnswerResults.length === 0 ? 0 : falseAnswers / noAnswerResults.length,
    falseAbstentionRate: answerableResults.length === 0 ? 0 : falseAbstentions / answerableResults.length
  };
}

function casePassed(result: CodeGraphPackEvalCaseResult): boolean {
  if (result.queryType === "answerable") {
    return result.hitAtK === 1 && result.expectedTermsFound && result.shouldAnswer;
  }
  if (result.queryType === "no_answer") {
    return !result.shouldAnswer;
  }
  return result.needsClarification && !result.shouldAnswer;
}

function scoreChunk(chunk: CodeGraphContextPackChunk, queryTokens: string[]): CodeGraphPackEvalTopResult {
  const searchable = searchableText(chunk);
  const searchableTokens = new Set(tokenize(searchable));
  const matchedTerms = queryTokens.filter((token) => searchableTokens.has(token));
  const uniqueMatchedTerms = Array.from(new Set(matchedTerms)).sort();
  const tokenScore = queryTokens.length === 0 ? 0 : uniqueMatchedTerms.length / new Set(queryTokens).size;
  const phraseBoost = queryPhraseBoost(chunk, searchable);
  const score = Math.min(1, tokenScore + phraseBoost);

  return {
    rank: 0,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    score,
    matchedTerms: uniqueMatchedTerms,
    text: chunk.text
  };
}

function queryPhraseBoost(chunk: CodeGraphContextPackChunk, searchable: string): number {
  const boosts = [
    chunk.metadata.sourcePath,
    chunk.metadata.targetPath,
    chunk.metadata.symbolName,
    chunk.metadata.edgeType,
    chunk.metadata.symbolKind
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 0 && searchable.includes(value));
  return Math.min(0.2, boosts.length * 0.05);
}

function searchableText(chunk: CodeGraphContextPackChunk): string {
  return [
    chunk.text,
    chunk.documentId,
    chunk.metadata.sourcePath,
    chunk.metadata.targetPath,
    chunk.metadata.symbolName,
    chunk.metadata.symbolKind,
    chunk.metadata.edgeType
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function tokenize(input: string): string[] {
  return Array.from(input.toLowerCase().matchAll(/[a-z0-9_./:-]+/g), (match) => match[0])
    .flatMap((token) => token.split(/[/:._-]/))
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function normalizeToken(token: string): string {
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

const stopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "by",
  "does",
  "file",
  "for",
  "from",
  "in",
  "is",
  "of",
  "or",
  "the",
  "to",
  "what",
  "where",
  "which",
  "who"
]);

function validateEvalCase(value: unknown, index: number, ids: Set<string>): CodeGraphPackEvalCase {
  if (!isRecord(value)) {
    throw new Error(`Code Graph context pack eval case at index ${index} must be an object.`);
  }
  const id = requiredString(value, "id", index);
  if (ids.has(id)) {
    throw new Error(`Duplicate Code Graph context pack eval case id: ${id}`);
  }
  ids.add(id);
  const queryType = requiredString(value, "queryType", index);
  if (!["answerable", "no_answer", "ambiguous"].includes(queryType)) {
    throw new Error(`Code Graph context pack eval case ${id} has unsupported queryType: ${queryType}`);
  }
  const k = value.k;
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`Code Graph context pack eval case ${id} must define positive integer k.`);
  }
  return {
    id,
    query: requiredString(value, "query", index),
    queryType: queryType as CodeGraphPackEvalQueryType,
    expectedChunkIds: requiredStringArray(value, "expectedChunkIds", id),
    expectedTerms: requiredStringArray(value, "expectedTerms", id),
    tags: requiredStringArray(value, "tags", id),
    k
  };
}

function requiredString(value: Record<string, unknown>, key: string, index: number): string {
  const raw = value[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`Code Graph context pack eval case at index ${index} must define non-empty ${key}.`);
  }
  return raw;
}

function requiredStringArray(value: Record<string, unknown>, key: string, id: string): string[] {
  const raw = value[key];
  if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string")) {
    throw new Error(`Code Graph context pack eval case ${id} must define string array ${key}.`);
  }
  return raw;
}

async function resolveInsideWorkspace(input: string): Promise<string> {
  const resolved = path.resolve(workspaceRoot, input);
  const realWorkspaceRoot = await fs.realpath(workspaceRoot);
  const realResolved = await fs.realpath(resolved);
  if (!isInside(realWorkspaceRoot, realResolved)) {
    throw new Error(`Code Graph context pack eval path escapes the repository: ${input}`);
  }
  return realResolved;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toWorkspacePath(input: string): string {
  return path.relative(workspaceRoot, input).replaceAll("\\", "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] !== undefined && currentFile === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
