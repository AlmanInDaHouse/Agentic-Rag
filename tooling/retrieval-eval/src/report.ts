import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EvaluatedMode,
  RetrievalEvalModeSummary,
  RetrievalEvalQueryResult,
  RetrievalEvalReport
} from "./types.js";

export function buildReport(input: {
  generatedAt?: string;
  modes: EvaluatedMode[];
  results: RetrievalEvalQueryResult[];
}): RetrievalEvalReport {
  const fixtures = Array.from(new Set(input.results.map((result) => result.fixtureName))).sort();
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    modes: input.modes,
    fixtures,
    summaries: input.modes.map((mode) => summarizeMode(mode, input.results)),
    results: input.results
  };
}

export async function writeReports(report: RetrievalEvalReport, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(outputDir, "latest.md"), renderMarkdownReport(report), "utf8")
  ]);
}

export function renderMarkdownReport(report: RetrievalEvalReport): string {
  const lines = [
    "# Retrieval Evaluation Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    "| Mode | Queries | Precision@k | Recall@k | Hit@k | MRR | Expected Found Rate | Fallback Used Rate |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.summaries.map((summary) => (
      `| ${summary.mode} | ${summary.queryCount} | ${format(summary.precisionAtK)} | ${format(summary.recallAtK)} | ${format(summary.hitAtK)} | ${format(summary.meanReciprocalRank)} | ${format(summary.expectedChunkFoundRate)} | ${format(summary.fallbackUsedRate)} |`
    )),
    ""
  ];

  for (const result of report.results) {
    lines.push(
      `## ${result.fixtureName} / ${result.mode}`,
      "",
      `Query: ${result.query}`,
      "",
      `precision@k: ${format(result.metrics.precision_at_k)}`,
      `recall@k: ${format(result.metrics.recall_at_k)}`,
      `hit@k: ${format(result.metrics.hit_at_k)}`,
      `MRR: ${format(result.metrics.mean_reciprocal_rank)}`,
      `expected_chunk_found: ${String(result.metrics.expected_chunk_found)}`,
      `fallbackUsed: ${String(result.fallbackUsed)}`,
      "",
      "| Rank | Document | Final | Lexical | Vector | Fallback | Storage | Excerpt |",
      "| ---: | --- | ---: | ---: | ---: | --- | --- | --- |",
      ...result.topResults.map((topResult) => (
        `| ${topResult.rank} | ${escapeCell(topResult.documentTitle)} | ${format(topResult.finalScore)} | ${format(topResult.lexicalScore)} | ${topResult.vectorScore === null ? "" : format(topResult.vectorScore)} | ${topResult.fallbackUsed ? topResult.fallbackReason ?? "true" : "false"} | ${topResult.vectorStorageUsed} | ${escapeCell(topResult.chunkExcerpt)} |`
      )),
      ""
    );
  }

  return `${lines.join("\n")}\n`;
}

function summarizeMode(
  mode: EvaluatedMode,
  results: RetrievalEvalQueryResult[]
): RetrievalEvalModeSummary {
  const modeResults = results.filter((result) => result.mode === mode);
  const queryCount = modeResults.length;
  return {
    mode,
    queryCount,
    precisionAtK: average(modeResults.map((result) => result.metrics.precision_at_k)),
    recallAtK: average(modeResults.map((result) => result.metrics.recall_at_k)),
    hitAtK: average(modeResults.map((result) => result.metrics.hit_at_k)),
    meanReciprocalRank: average(modeResults.map((result) => result.metrics.mean_reciprocal_rank)),
    expectedChunkFoundRate: average(modeResults.map((result) => result.metrics.expected_chunk_found ? 1 : 0)),
    fallbackUsedRate: average(modeResults.map((result) => result.fallbackUsed ? 1 : 0))
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function format(value: number): string {
  return value.toFixed(3);
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
