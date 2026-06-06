import { describe, expect, it } from "vitest";
import {
  RagAnswerabilityPolicySchema,
  RagAnswerabilityResultSchema,
  type ContextSearchResult
} from "@triforge/shared";
import {
  evaluateAnswerability,
  resolveAnswerabilityPolicy
} from "../services/ragAnswerabilityService.js";
import { contextCandidate } from "./testContextFixtures.js";

describe("RAG answerability service", () => {
  it("abstains when search returns no results", () => {
    expect(evaluateAnswerability({ results: [] }, {
      minRequiredScore: 1,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: false,
      answerability: "abstain",
      reason: "no_results",
      confidence: 0,
      topScore: null
    });
  });

  it("abstains when the top result score is too low", () => {
    const result = answerabilityCandidate({ finalScore: 0.2 });

    expect(evaluateAnswerability({ results: [result] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: false,
      reason: "low_score",
      confidence: 0.4,
      topScore: 0.2
    });
  });

  it("answers when finalScore is exactly at the threshold", () => {
    expect(evaluateAnswerability({ results: [answerabilityCandidate({ finalScore: 0.5 })] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: true,
      reason: "sufficient_context",
      topScore: 0.5
    });
  });

  it("abstains when finalScore is just below the threshold", () => {
    expect(evaluateAnswerability({ results: [answerabilityCandidate({ finalScore: 0.499 })] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: false,
      reason: "low_score"
    });
  });

  it("abstains safely when finalScore is missing", () => {
    const result = {
      ...answerabilityCandidate({ finalScore: 1 }),
      finalScore: undefined
    } as unknown as ContextSearchResult;

    expect(evaluateAnswerability({ results: [result] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: false,
      reason: "low_score",
      topScore: null
    });
  });

  it("uses the top result score even when a later result exceeds the threshold", () => {
    const weakTop = answerabilityCandidate({ finalScore: 0.1 });
    const strongSecond = answerabilityCandidate({ finalScore: 0.9 });

    expect(evaluateAnswerability({ results: [weakTop, strongSecond] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: false,
      reason: "low_score",
      topScore: 0.1
    });
  });

  it("answers with sufficient context", () => {
    const result = answerabilityCandidate({ finalScore: 0.8 });

    expect(evaluateAnswerability({ results: [result] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: true,
      answerability: "answerable",
      reason: "sufficient_context",
      confidence: 1,
      supportingResultIds: [result.chunk.id]
    });
  });

  it("abstains when every result is fallback and fallback is disallowed", () => {
    const result = answerabilityCandidate({ finalScore: 1, fallbackUsed: true });

    expect(evaluateAnswerability({ results: [result] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: false
    })).toMatchObject({
      shouldAnswer: false,
      reason: "fallback_only"
    });
  });

  it("answers with fallback results when fallback is allowed and score passes", () => {
    const result = answerabilityCandidate({ finalScore: 1, fallbackUsed: true });

    expect(evaluateAnswerability({ results: [result] }, {
      minRequiredScore: 0.5,
      minSupportingResults: 1,
      fallbackAllowed: true
    })).toMatchObject({
      shouldAnswer: true,
      reason: "sufficient_context"
    });
  });

  it("keeps confidence bounded to 0..1", () => {
    expect(evaluateAnswerability({ results: [answerabilityCandidate({ finalScore: 99 })] }, {
      minRequiredScore: 1,
      minSupportingResults: 1,
      fallbackAllowed: true
    }).confidence).toBe(1);
  });

  it("uses mode-specific default thresholds with overrides", () => {
    expect(resolveAnswerabilityPolicy("lexical", undefined).minRequiredScore).toBe(3);
    expect(resolveAnswerabilityPolicy("hybrid", undefined).minRequiredScore).toBe(0.5);
    expect(resolveAnswerabilityPolicy("hybrid", { minRequiredScore: 0.9 }).minRequiredScore).toBe(0.9);
  });

  it("validates answerability Zod contracts", () => {
    expect(RagAnswerabilityPolicySchema.parse({})).toMatchObject({
      minRequiredScore: 1,
      minSupportingResults: 1,
      fallbackAllowed: true
    });
    expect(RagAnswerabilityResultSchema.safeParse({
      shouldAnswer: false,
      answerability: "abstain",
      reason: "insufficient_context",
      confidence: 0.21,
      topScore: 0.21,
      minRequiredScore: 1,
      supportingResultIds: [],
      warnings: ["No retrieved chunk passed the minimum relevance threshold"]
    }).success).toBe(true);
    expect(RagAnswerabilityResultSchema.safeParse({
      shouldAnswer: false,
      answerability: "abstain",
      reason: "insufficient_context",
      confidence: 2,
      topScore: 2,
      minRequiredScore: 1,
      supportingResultIds: [],
      warnings: []
    }).success).toBe(false);
  });
});

function answerabilityCandidate(input: {
  finalScore: number;
  fallbackUsed?: boolean;
}): ContextSearchResult {
  return {
    ...contextCandidate({
      sourceName: "Answerability source",
      title: "Answerability document",
      content: "answerability context"
    }),
    score: input.finalScore,
    finalScore: input.finalScore,
    lexicalScore: input.finalScore,
    fallbackUsed: input.fallbackUsed ?? false
  };
}
