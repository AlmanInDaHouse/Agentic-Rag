import { describe, expect, it } from "vitest";
import {
  hitAtK,
  meanReciprocalRank,
  precisionAtK,
  recallAtK
} from "./metrics.js";

describe("retrieval eval metrics", () => {
  it("calculates precision, recall and hit at k", () => {
    const results = ["a", "b", "c"];
    const expected = ["b", "d"];

    expect(precisionAtK(results, expected, 2)).toBe(0.5);
    expect(recallAtK(results, expected, 2)).toBe(0.5);
    expect(hitAtK(results, expected, 2)).toBe(1);
  });

  it("returns zero when no expected result appears", () => {
    const results = ["a", "b"];
    const expected = ["c"];

    expect(precisionAtK(results, expected, 2)).toBe(0);
    expect(recallAtK(results, expected, 2)).toBe(0);
    expect(hitAtK(results, expected, 2)).toBe(0);
    expect(meanReciprocalRank(results, expected)).toBe(0);
  });

  it("uses k as the precision denominator when fewer results are returned", () => {
    expect(precisionAtK(["a"], ["a"], 3)).toBe(1 / 3);
    expect(precisionAtK(["a"], ["a"], 0)).toBe(0);
  });

  it("calculates reciprocal rank for the first expected result", () => {
    expect(meanReciprocalRank(["x", "y", "z"], ["z"], 3)).toBe(1 / 3);
    expect(meanReciprocalRank(["x", "y", "z"], ["y", "z"], 3)).toBe(1 / 2);
  });

  it("handles empty result and expected lists deterministically", () => {
    expect(precisionAtK([], ["a"], 3)).toBe(0);
    expect(recallAtK(["a"], [], 3)).toBe(0);
    expect(hitAtK([], [], 3)).toBe(0);
    expect(meanReciprocalRank([], ["a"], 3)).toBe(0);
  });
});
