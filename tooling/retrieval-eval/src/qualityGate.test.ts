import { describe, expect, it } from "vitest";
import { evaluateQualityGate, loadQualityThresholds, validateQualityThresholds } from "./qualityGate.js";
import type {
  EvaluatedMode,
  RetrievalEvalQualityThresholds,
  RetrievalEvalQueryResult,
  RetrievalEvalReport
} from "./types.js";

const thresholds: RetrievalEvalQualityThresholds = {
  version: 1,
  default: {
    hitAtK: 1,
    expectedChunkFound: 1,
    meanReciprocalRank: 0.5
  },
  modes: {
    lexical: {},
    mock_vector: {},
    hybrid: {}
  },
  nonBlocking: {
    precisionAtK: true,
    recallAtK: true,
    fallbackUsedRate: true
  }
};

function report(results: RetrievalEvalQueryResult[]): RetrievalEvalReport {
  return {
    generatedAt: "2026-06-06T00:00:00.000Z",
    modes: Array.from(new Set(results.map((result) => result.mode))),
    fixtures: Array.from(new Set(results.map((result) => result.fixtureName))),
    summaries: [],
    results
  };
}

function result(overrides: Partial<RetrievalEvalQueryResult> = {}): RetrievalEvalQueryResult {
  return {
    fixtureName: "basic-security-corpus",
    mode: "lexical",
    query: "how was the phishing email detected",
    k: 3,
    expectedChunkIds: ["chunk-1"],
    expectedDocumentTitles: ["Phishing incident notes"],
    expectedChunkContains: ["mail gateway flagged the sender domain"],
    fallbackUsed: false,
    metrics: {
      precision_at_k: 1 / 3,
      recall_at_k: 1,
      hit_at_k: 1,
      mean_reciprocal_rank: 1,
      expected_chunk_found: true
    },
    topResults: [],
    ...overrides
  };
}

describe("retrieval quality gate", () => {
  it("passes when metrics satisfy thresholds", () => {
    expect(evaluateQualityGate(report([result()]), thresholds)).toEqual({
      passed: true,
      thresholdsVersion: 1,
      failures: []
    });
  });

  it("fails when hitAtK is below threshold", () => {
    const gate = evaluateQualityGate(report([
      result({ metrics: { ...result().metrics, hit_at_k: 0 } })
    ]), thresholds);

    expect(gate.passed).toBe(false);
    expect(gate.failures).toMatchObject([
      { metric: "hitAtK", expected: 1, actual: 0 }
    ]);
  });

  it("fails when expectedChunkFound is below threshold", () => {
    const gate = evaluateQualityGate(report([
      result({ metrics: { ...result().metrics, expected_chunk_found: false } })
    ]), thresholds);

    expect(gate.passed).toBe(false);
    expect(gate.failures).toMatchObject([
      { metric: "expectedChunkFound", expected: 1, actual: 0 }
    ]);
  });

  it("fails when meanReciprocalRank is below threshold", () => {
    const gate = evaluateQualityGate(report([
      result({ metrics: { ...result().metrics, mean_reciprocal_rank: 0.25 } })
    ]), thresholds);

    expect(gate.passed).toBe(false);
    expect(gate.failures).toMatchObject([
      { metric: "meanReciprocalRank", expected: 0.5, actual: 0.25 }
    ]);
  });

  it("does not fail on non-blocking metrics", () => {
    const gate = evaluateQualityGate(report([
      result({
        fallbackUsed: true,
        metrics: {
          ...result().metrics,
          precision_at_k: 0,
          recall_at_k: 0
        }
      })
    ]), {
      ...thresholds,
      default: {
        ...thresholds.default,
        precisionAtK: 1,
        recallAtK: 1,
        fallbackUsedRate: 0
      }
    });

    expect(gate.passed).toBe(true);
  });

  it("uses per-mode thresholds over defaults", () => {
    const mode = "mock_vector" satisfies EvaluatedMode;
    const relaxed = evaluateQualityGate(report([
      result({
        mode,
        metrics: { ...result().metrics, mean_reciprocal_rank: 0.25 }
      })
    ]), {
      ...thresholds,
      modes: {
        ...thresholds.modes,
        mock_vector: { meanReciprocalRank: 0.25 }
      }
    });

    expect(relaxed.passed).toBe(true);
  });

  it("applies default thresholds when a mode has no explicit override", () => {
    const gate = evaluateQualityGate(report([
      result({
        mode: "hybrid",
        metrics: { ...result().metrics, mean_reciprocal_rank: 0.25 }
      })
    ]), {
      ...thresholds,
      modes: {}
    });

    expect(gate.failures).toMatchObject([
      { mode: "hybrid", metric: "meanReciprocalRank", expected: 0.5, actual: 0.25 }
    ]);
  });

  it("lists multiple blocking failures for the same query", () => {
    const gate = evaluateQualityGate(report([
      result({
        metrics: {
          ...result().metrics,
          hit_at_k: 0,
          mean_reciprocal_rank: 0,
          expected_chunk_found: false
        }
      })
    ]), thresholds);

    expect(gate.failures).toMatchObject([
      { metric: "hitAtK" },
      { metric: "expectedChunkFound" },
      { metric: "meanReciprocalRank" }
    ]);
  });

  it("can block fallbackUsedRate when it is not marked non-blocking", () => {
    const gate = evaluateQualityGate(report([
      result({ fallbackUsed: true })
    ]), {
      ...thresholds,
      default: {
        ...thresholds.default,
        fallbackUsedRate: 0
      },
      nonBlocking: {
        precisionAtK: true,
        recallAtK: true
      }
    });

    expect(gate.failures).toMatchObject([
      { metric: "fallbackUsedRate", expected: 0, actual: 1 }
    ]);
  });

  it("allows tiny floating point differences at the threshold boundary", () => {
    const gate = evaluateQualityGate(report([
      result({ metrics: { ...result().metrics, mean_reciprocal_rank: 0.5 - 1e-10 } })
    ]), thresholds);

    expect(gate.passed).toBe(true);
  });

  it("validates threshold shape", () => {
    expect(validateQualityThresholds(thresholds, "thresholds.json")).toEqual(thresholds);
    expect(() => validateQualityThresholds({
      ...thresholds,
      modes: { pgvector: {} }
    }, "thresholds.json")).toThrow('unsupported mode "pgvector"');
    expect(() => validateQualityThresholds({
      ...thresholds,
      default: {
        hitAtK: 1,
        expectedChunkFound: 1
      }
    }, "thresholds.json")).toThrow("default.meanReciprocalRank is required");
    expect(() => validateQualityThresholds({
      ...thresholds,
      default: {
        ...thresholds.default,
        hitAtK: 1.1
      }
    }, "thresholds.json")).toThrow("default must be a metric threshold object");
  });

  it("reports missing threshold files clearly", async () => {
    await expect(loadQualityThresholds("missing-thresholds.json")).rejects.toThrow(
      "Unable to read retrieval evaluation thresholds missing-thresholds.json"
    );
  });
});
