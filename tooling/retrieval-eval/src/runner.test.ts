import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  calculateRetrievalMetrics,
  evaluateQuery,
  parseCliArgs,
  validateFixture,
  validateModes
} from "./runner.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(currentDir, "../fixtures");

const validFixture = {
  name: "unit-fixture",
  documents: [
    {
      title: "Synthetic document",
      content: "A synthetic document with enough retrieval text."
    }
  ],
  queries: [
    {
      query: "what text should be retrieved",
      expectedDocumentTitles: ["Synthetic document"],
      expectedChunkContains: ["retrieval text"],
      queryType: "answerable",
      tags: ["runtime"],
      k: 3
    }
  ]
};

describe("retrieval eval runner validation", () => {
  it("accepts valid fixtures", () => {
    expect(validateFixture(validFixture, "unit.json")).toEqual(validFixture);
  });

  it("rejects fixtures with clear schema errors", () => {
    expect(() => validateFixture({ ...validFixture, queries: [] }, "unit.json"))
      .toThrow("queries must be a non-empty array");
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "missing title",
          expectedDocumentTitles: ["Missing document"],
          expectedChunkContains: ["retrieval text"],
          queryType: "answerable",
          tags: ["runtime"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow('references unknown document title "Missing document"');
  });

  it("rejects empty expected chunks for answerable queries and invalid k", () => {
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "empty expected",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: [],
          queryType: "answerable",
          tags: ["runtime"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("expectedChunkContains must be non-empty unless queryType is no_answer");

    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "bad k",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: ["retrieval text"],
          queryType: "answerable",
          tags: ["runtime"],
          k: 0
        }
      ]
    }, "unit.json")).toThrow("k must be a positive integer");
  });

  it("accepts explicit no_answer queries with empty expected arrays", () => {
    const fixture = validateFixture({
      ...validFixture,
      queries: [
        {
          query: "which policy mentions quantum backups",
          expectedDocumentTitles: [],
          expectedChunkContains: [],
          queryType: "no_answer",
          tags: ["no_answer"],
          k: 3
        }
      ]
    }, "unit.json");

    expect(fixture.queries[0]?.queryType).toBe("no_answer");
  });

  it("rejects no_answer queries with accidental expected values", () => {
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "which policy mentions quantum backups",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: [],
          queryType: "no_answer",
          tags: ["no_answer"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("expectedDocumentTitles must be empty for no_answer queries");

    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "which policy mentions quantum backups",
          expectedDocumentTitles: [],
          expectedChunkContains: ["retrieval text"],
          queryType: "no_answer",
          tags: ["no_answer"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("expectedChunkContains must be empty for no_answer queries");
  });

  it("rejects expected chunk substrings that do not appear in expected documents", () => {
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "where is the missing expected text",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: ["missing expected text"],
          queryType: "answerable",
          tags: ["runtime"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("expectedChunkContains entry");
  });

  it("rejects invalid expectedShouldAnswer values", () => {
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "bad expected answerability",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: ["retrieval text"],
          queryType: "answerable",
          tags: ["runtime"],
          expectedShouldAnswer: "yes",
          k: 3
        }
      ]
    }, "unit.json")).toThrow("expectedShouldAnswer must be a boolean");
  });

  it("rejects invalid queryType and tags", () => {
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "bad query type",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: ["retrieval text"],
          queryType: "pgvector",
          tags: ["runtime"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("queryType must be one of");

    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "bad tag",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: ["retrieval text"],
          queryType: "answerable",
          tags: ["external"],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("tags must contain only supported tags");
  });

  it("rejects unknown modes before harness startup", () => {
    expect(validateModes(["lexical", "hybrid"])).toEqual(["lexical", "hybrid"]);
    expect(() => validateModes(["lexical", "pgvector"])).toThrow(
      'Unsupported retrieval evaluation mode "pgvector"'
    );
    expect(() => validateModes([])).toThrow("requires at least one mode");
  });

  it("parses quality gate CLI flags", () => {
    const parsed = parseCliArgs([
      "--gate",
      "--thresholds",
      "tooling/retrieval-eval/baselines/thresholds.v1.json",
      "--out",
      "reports/retrieval-eval/latest.json"
    ]);

    expect(parsed.gate).toBe(true);
    expect(parsed.thresholdsPath.replaceAll("\\", "/")).toContain(
      "tooling/retrieval-eval/baselines/thresholds.v1.json"
    );
    expect(parsed.outputJsonPath.replaceAll("\\", "/")).toContain("reports/retrieval-eval/latest.json");
  });

  it("rejects unknown CLI flags and missing values", () => {
    expect(() => parseCliArgs(["--unknown"])).toThrow('Unknown retrieval evaluation argument "--unknown"');
    expect(() => parseCliArgs(["--thresholds"])).toThrow("Missing value for --thresholds");
  });

  it("does not penalize explicit no_answer queries for empty expected matches", () => {
    expect(calculateRetrievalMetrics(["irrelevant-a"], [], 3, "no_answer")).toEqual({
      precision_at_k: 0,
      recall_at_k: 1,
      hit_at_k: 1,
      mean_reciprocal_rank: 1,
      expected_chunk_found: true,
      abstention_accuracy: 1,
      false_answer_rate: 0,
      false_abstention_rate: 0
    });
  });

  it("keeps answerable metrics unchanged", () => {
    expect(calculateRetrievalMetrics(["a", "b"], ["b"], 2, "answerable")).toEqual({
      precision_at_k: 0.5,
      recall_at_k: 1,
      hit_at_k: 1,
      mean_reciprocal_rank: 0.5,
      expected_chunk_found: true,
      abstention_accuracy: 1,
      false_answer_rate: 0,
      false_abstention_rate: 0
    });
  });

  it("tracks false answer and false abstention metrics", () => {
    expect(calculateRetrievalMetrics(["a"], [], 3, "no_answer", false, true)).toMatchObject({
      abstention_accuracy: 0,
      false_answer_rate: 1,
      false_abstention_rate: 0
    });
    expect(calculateRetrievalMetrics(["a"], ["a"], 3, "answerable", true, false)).toMatchObject({
      abstention_accuracy: 0,
      false_answer_rate: 0,
      false_abstention_rate: 1
    });
  });

  it("passes queryType to the search endpoint input", async () => {
    let observedQueryType: unknown;

    await evaluateQuery({
      fixtureName: "unit-fixture",
      mode: "lexical",
      goalId: "00000000-0000-4000-8000-000000000001",
      query: {
        query: "missing answer",
        expectedDocumentTitles: [],
        expectedChunkContains: [],
        queryType: "no_answer",
        tags: ["no_answer"],
        k: 3
      },
      chunks: [],
      search: async (_goalId, input) => {
        observedQueryType = input.queryType;
        return {
          results: [],
          answerability: {
            shouldAnswer: false,
            answerability: "abstain",
            reason: "no_results",
            confidence: 0,
            topScore: null,
            minRequiredScore: 0.95,
            effectiveMinRequiredScore: 0.95,
            effectiveFallbackAllowed: false,
            effectivePolicySource: ["default", "queryType:no_answer"],
            supportingResultIds: [],
            warnings: []
          }
        };
      }
    });

    expect(observedQueryType).toBe("no_answer");
  });

  it("validates every bundled fixture file", async () => {
    const files = (await fs.readdir(fixturesDir)).filter((file) => file.endsWith(".json"));

    expect(files).toContain("no-answer-corpus.json");
    for (const file of files) {
      const fixturePath = path.join(fixturesDir, file);
      const raw = await fs.readFile(fixturePath, "utf8");

      expect(() => validateFixture(JSON.parse(raw), fixturePath), file).not.toThrow();
    }
  });
});
