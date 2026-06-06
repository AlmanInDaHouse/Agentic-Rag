import { promises as fs } from "node:fs";
import type {
  EvaluatedMode,
  RetrievalEvalQualityGateFailure,
  RetrievalEvalQualityGateResult,
  RetrievalEvalQualityMetricThresholds,
  RetrievalEvalQualityThresholds,
  RetrievalEvalQueryResult,
  RetrievalEvalReport
} from "./types.js";

const gateMetrics: Array<keyof RetrievalEvalQualityMetricThresholds> = [
  "hitAtK",
  "expectedChunkFound",
  "meanReciprocalRank",
  "precisionAtK",
  "recallAtK",
  "fallbackUsedRate"
];
const requiredDefaultMetrics: Array<keyof RetrievalEvalQualityMetricThresholds> = [
  "hitAtK",
  "expectedChunkFound",
  "meanReciprocalRank"
];
const comparisonEpsilon = 1e-9;

export async function loadQualityThresholds(thresholdsPath: string): Promise<RetrievalEvalQualityThresholds> {
  let raw: string;
  try {
    raw = await fs.readFile(thresholdsPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read retrieval evaluation thresholds ${thresholdsPath}: ${errorMessage(error)}`);
  }

  try {
    return validateQualityThresholds(JSON.parse(raw), thresholdsPath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw invalidThresholds(thresholdsPath, `invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function evaluateQualityGate(
  report: RetrievalEvalReport,
  thresholds: RetrievalEvalQualityThresholds
): RetrievalEvalQualityGateResult {
  const failures: RetrievalEvalQualityGateFailure[] = [];

  for (const result of report.results) {
    const effective = thresholdsForMode(thresholds, result.mode);
    for (const metric of gateMetrics) {
      if (thresholds.nonBlocking[metric]) {
        continue;
      }
      const expected = effective[metric];
      if (expected === undefined) {
        continue;
      }
      const actual = metricValue(result, metric);
      if (violatesThreshold(metric, actual, expected)) {
        failures.push({
          fixture: result.fixtureName,
          mode: result.mode,
          query: result.query,
          metric,
          expected,
          actual
        });
      }
    }
  }

  return {
    passed: failures.length === 0,
    thresholdsVersion: thresholds.version,
    failures
  };
}

export function validateQualityThresholds(value: unknown, thresholdsPath: string): RetrievalEvalQualityThresholds {
  if (!isRecord(value)) {
    throw invalidThresholds(thresholdsPath, "thresholds must be an object");
  }
  if (!Number.isInteger(value.version) || value.version <= 0) {
    throw invalidThresholds(thresholdsPath, "version must be a positive integer");
  }
  if (!isMetricThresholdRecord(value.default)) {
    throw invalidThresholds(thresholdsPath, "default must be a metric threshold object");
  }
  for (const metric of requiredDefaultMetrics) {
    if (value.default[metric] === undefined) {
      throw invalidThresholds(thresholdsPath, `default.${metric} is required`);
    }
  }
  if (!isRecord(value.modes)) {
    throw invalidThresholds(thresholdsPath, "modes must be an object");
  }
  for (const [mode, modeThresholds] of Object.entries(value.modes)) {
    if (!["lexical", "mock_vector", "hybrid"].includes(mode)) {
      throw invalidThresholds(thresholdsPath, `unsupported mode "${mode}"`);
    }
    if (!isMetricThresholdRecord(modeThresholds)) {
      throw invalidThresholds(thresholdsPath, `modes.${mode} must be a metric threshold object`);
    }
  }
  if (!isRecord(value.nonBlocking)) {
    throw invalidThresholds(thresholdsPath, "nonBlocking must be an object");
  }
  for (const [metric, enabled] of Object.entries(value.nonBlocking)) {
    if (!isKnownMetric(metric)) {
      throw invalidThresholds(thresholdsPath, `unsupported nonBlocking metric "${metric}"`);
    }
    if (typeof enabled !== "boolean") {
      throw invalidThresholds(thresholdsPath, `nonBlocking.${metric} must be a boolean`);
    }
  }

  return value as RetrievalEvalQualityThresholds;
}

function thresholdsForMode(
  thresholds: RetrievalEvalQualityThresholds,
  mode: EvaluatedMode
): RetrievalEvalQualityMetricThresholds {
  return {
    ...thresholds.default,
    ...(thresholds.modes[mode] ?? {})
  };
}

function metricValue(
  result: RetrievalEvalQueryResult,
  metric: keyof RetrievalEvalQualityMetricThresholds
): number {
  switch (metric) {
    case "hitAtK":
      return result.metrics.hit_at_k;
    case "expectedChunkFound":
      return result.metrics.expected_chunk_found ? 1 : 0;
    case "meanReciprocalRank":
      return result.metrics.mean_reciprocal_rank;
    case "precisionAtK":
      return result.metrics.precision_at_k;
    case "recallAtK":
      return result.metrics.recall_at_k;
    case "fallbackUsedRate":
      return result.fallbackUsed ? 1 : 0;
  }
}

function violatesThreshold(
  metric: keyof RetrievalEvalQualityMetricThresholds,
  actual: number,
  expected: number
): boolean {
  if (metric === "fallbackUsedRate") {
    return actual - comparisonEpsilon > expected;
  }
  return actual + comparisonEpsilon < expected;
}

function isMetricThresholdRecord(value: unknown): value is RetrievalEvalQualityMetricThresholds {
  if (!isRecord(value)) {
    return false;
  }
  return Object.entries(value).every(([metric, threshold]) => (
    isKnownMetric(metric) &&
    typeof threshold === "number" &&
    Number.isFinite(threshold) &&
    threshold >= 0 &&
    threshold <= 1
  ));
}

function isKnownMetric(metric: string): metric is keyof RetrievalEvalQualityMetricThresholds {
  return [
    "hitAtK",
    "expectedChunkFound",
    "meanReciprocalRank",
    "precisionAtK",
    "recallAtK",
    "fallbackUsedRate"
  ].includes(metric);
}

function invalidThresholds(thresholdsPath: string, reason: string): Error {
  return new Error(`Invalid retrieval evaluation thresholds ${thresholdsPath}: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
