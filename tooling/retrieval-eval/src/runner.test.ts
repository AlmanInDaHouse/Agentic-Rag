import { describe, expect, it } from "vitest";
import { parseCliArgs, validateFixture, validateModes } from "./runner.js";

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
          k: 3
        }
      ]
    }, "unit.json")).toThrow('references unknown document title "Missing document"');
  });

  it("rejects empty expected chunks and invalid k", () => {
    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "empty expected",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: [],
          k: 3
        }
      ]
    }, "unit.json")).toThrow("expectedChunkContains must be a non-empty string array");

    expect(() => validateFixture({
      ...validFixture,
      queries: [
        {
          query: "bad k",
          expectedDocumentTitles: ["Synthetic document"],
          expectedChunkContains: ["retrieval text"],
          k: 0
        }
      ]
    }, "unit.json")).toThrow("k must be a positive integer");
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
});
