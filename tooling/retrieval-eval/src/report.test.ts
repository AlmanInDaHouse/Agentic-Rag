import { describe, expect, it } from "vitest";
import { buildReport, renderMarkdownReport } from "./report.js";
import type { RetrievalEvalQueryResult } from "./types.js";

function result(overrides: Partial<RetrievalEvalQueryResult>): RetrievalEvalQueryResult {
  return {
    fixtureName: "unit-fixture",
    mode: "lexical",
    query: "unit query",
    queryType: "answerable",
    tags: ["runtime"],
    k: 3,
    expectedChunkIds: ["expected-1"],
    expectedDocumentTitles: ["Unit document"],
    expectedChunkContains: ["expected text"],
    expectedShouldAnswer: true,
    answerability: {
      shouldAnswer: true,
      answerability: "answerable",
      reason: "sufficient_context",
      confidence: 1,
      topScore: 1,
      minRequiredScore: 0.5,
      effectiveMinRequiredScore: 0.5,
      effectiveFallbackAllowed: true,
      effectivePolicySource: ["default", "mode:lexical", "queryType:answerable"],
      supportingResultIds: ["expected-1"],
      warnings: []
    },
    fallbackUsed: false,
    metrics: {
      precision_at_k: 1 / 3,
      recall_at_k: 1,
      hit_at_k: 1,
      mean_reciprocal_rank: 1,
      expected_chunk_found: true,
      abstention_accuracy: 1,
      false_answer_rate: 0,
      false_abstention_rate: 0
    },
    topResults: [
      {
        rank: 1,
        documentTitle: "Unit document",
        chunkId: "expected-1",
        chunkExcerpt: "expected text",
        finalScore: 1,
        lexicalScore: 1,
        vectorScore: null,
        fallbackUsed: false,
        fallbackReason: null,
        vectorStorageUsed: "none"
      }
    ],
    ...overrides
  };
}

describe("retrieval eval reports", () => {
  it("summarizes expected chunk and fallback rates", () => {
    const report = buildReport({
      generatedAt: "2026-06-06T00:00:00.000Z",
      modes: ["lexical"],
      results: [
        result({ fallbackUsed: false }),
        result({
          fallbackUsed: true,
          metrics: {
            ...result({}).metrics,
            precision_at_k: 0,
            recall_at_k: 0,
            hit_at_k: 0,
            mean_reciprocal_rank: 0,
            expected_chunk_found: false
          }
        })
      ]
    });

    expect(report.summaries).toEqual([
      {
        mode: "lexical",
        queryCount: 2,
        retrievalQueryCount: 2,
        precisionAtK: 1 / 6,
        recallAtK: 0.5,
        hitAtK: 0.5,
        meanReciprocalRank: 0.5,
        expectedChunkFoundRate: 0.5,
        fallbackUsedRate: 0.5,
        abstentionAccuracy: 1,
        falseAnswerRate: 0,
        falseAbstentionRate: 0
      }
    ]);
  });

  it("excludes no_answer queries from retrieval metric summaries", () => {
    const report = buildReport({
      generatedAt: "2026-06-06T00:00:00.000Z",
      modes: ["lexical"],
      results: [
        result({}),
        result({
          queryType: "no_answer",
          tags: ["no_answer"],
          expectedChunkIds: [],
          expectedDocumentTitles: [],
          expectedChunkContains: [],
          metrics: {
            ...result({}).metrics,
            precision_at_k: 0,
            recall_at_k: 1,
            hit_at_k: 1,
            mean_reciprocal_rank: 1,
            expected_chunk_found: true,
            abstention_accuracy: 1,
            false_answer_rate: 0,
            false_abstention_rate: 0
          },
          expectedShouldAnswer: false,
          answerability: {
            shouldAnswer: false,
            answerability: "abstain",
            reason: "no_results",
            confidence: 0,
            topScore: null,
            minRequiredScore: 0.5,
            supportingResultIds: [],
            warnings: []
          }
        })
      ]
    });

    expect(report.summaries[0]).toMatchObject({
      queryCount: 2,
      retrievalQueryCount: 1,
      precisionAtK: 1 / 3,
      recallAtK: 1,
      hitAtK: 1,
      meanReciprocalRank: 1,
      expectedChunkFoundRate: 1,
      abstentionAccuracy: 1,
      falseAnswerRate: 0,
      falseAbstentionRate: 0
    });
  });

  it("renders fixture, mode, metrics, fallback state and top results", () => {
    const report = buildReport({
      generatedAt: "2026-06-06T00:00:00.000Z",
      modes: ["lexical"],
      results: [result({})]
    });

    expect(renderMarkdownReport(report)).toContain("## unit-fixture / lexical");
    expect(renderMarkdownReport(report)).toContain("Query type: answerable");
    expect(renderMarkdownReport(report)).toContain("Tags: runtime");
    expect(renderMarkdownReport(report)).toContain("Answerability: sufficient_context / shouldAnswer=true");
    expect(renderMarkdownReport(report)).toContain("Effective minRequiredScore: 0.500");
    expect(renderMarkdownReport(report)).toContain("Effective fallbackAllowed: true");
    expect(renderMarkdownReport(report)).toContain("Effective policy source: default, mode:lexical, queryType:answerable");
    expect(renderMarkdownReport(report)).toContain("precision@k: 0.333");
    expect(renderMarkdownReport(report)).toContain("fallbackUsed: false");
    expect(renderMarkdownReport(report)).toContain("| 1 | Unit document |");
  });

  it("renders quality gate status and failures when present", () => {
    const report = buildReport({
      generatedAt: "2026-06-06T00:00:00.000Z",
      modes: ["lexical"],
      results: [result({})]
    });
    report.qualityGate = {
      passed: false,
      thresholdsVersion: 1,
      failures: [
        {
          fixture: "unit-fixture",
          mode: "lexical",
          query: "unit query",
          metric: "hitAtK",
          expected: 1,
          actual: 0
        }
      ]
    };

    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain("## Quality Gate");
    expect(markdown).toContain("Status: FAIL");
    expect(markdown).toContain("| unit-fixture | lexical | unit query | hitAtK | 1.000 | 0.000 |");
  });
});
