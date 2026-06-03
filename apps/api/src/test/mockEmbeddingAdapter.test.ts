import { describe, expect, it } from "vitest";
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
  });

  it("normalizes equivalent text before hashing", async () => {
    const adapter = new MockEmbeddingAdapter();

    await expect(adapter.embedText("alpha\r\n\r\nbeta")).resolves.toEqual(
      await adapter.embedText("alpha\n\nbeta")
    );
  });

  it("produces distinct vectors for different text in batch mode", async () => {
    const adapter = new MockEmbeddingAdapter();

    const [first, second] = await adapter.embedBatch(["approval context", "runtime summary"]);

    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
  });

  it("computes cosine similarity and normalized scores", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(normalizeCosineScore(1)).toBe(1);
    expect(normalizeCosineScore(-1)).toBe(0);
  });
});
