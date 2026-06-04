import { describe, expect, it } from "vitest";
import { EmbeddingVectorSchema } from "@triforge/shared";
import {
  cosineSimilarity,
  MockEmbeddingAdapter,
  normalizeCosineScore
} from "../services/embeddings/mockEmbeddingAdapter.js";

describe("MockEmbeddingAdapter", () => {
  it("returns deterministic 32 dimension vectors", async () => {
    const adapter = new MockEmbeddingAdapter();

    const first = await adapter.embedText("Deterministic context");
    const second = await adapter.embedText("Deterministic context");

    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect(first.every(Number.isFinite)).toBe(true);
    expect(first).not.toEqual(new Array(32).fill(0));
  });

  it("normalizes equivalent text before hashing", async () => {
    const adapter = new MockEmbeddingAdapter();

    await expect(adapter.embedText("alpha\r\n\r\nbeta")).resolves.toEqual(
      await adapter.embedText("alpha\n\nbeta")
    );
  });

  it("produces distinct vectors for different text in batch mode", async () => {
    const adapter = new MockEmbeddingAdapter();

    const inputs = ["approval context", "runtime summary", "approval context"];
    const [first, second, third] = await adapter.embedBatch(inputs);

    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
    expect(third).toEqual(first);
  });

  it("handles whitespace-only input without empty or non-finite vectors", async () => {
    const adapter = new MockEmbeddingAdapter();

    const vector = await adapter.embedText(" \n\t ");

    expect(vector).toHaveLength(32);
    expect(vector.every(Number.isFinite)).toBe(true);
  });

  it("rejects non-finite embedding vector contract values", () => {
    expect(EmbeddingVectorSchema.safeParse(new Array(32).fill(0.1)).success).toBe(true);
    expect(EmbeddingVectorSchema.safeParse([Infinity, ...new Array(31).fill(0.1)]).success).toBe(false);
    expect(EmbeddingVectorSchema.safeParse([Number.NaN, ...new Array(31).fill(0.1)]).success).toBe(false);
  });

  it("computes cosine similarity and normalized scores", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(normalizeCosineScore(1)).toBe(1);
    expect(normalizeCosineScore(-1)).toBe(0);
  });
});
