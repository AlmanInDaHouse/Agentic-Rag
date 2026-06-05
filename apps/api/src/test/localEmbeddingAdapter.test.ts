import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalEmbeddingAdapter } from "../services/embeddings/localEmbeddingAdapter.js";

describe("LocalEmbeddingAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is unavailable when no endpoint is configured", async () => {
    const adapter = new LocalEmbeddingAdapter({ dimension: 32 });

    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.embedText("input")).rejects.toThrow("not configured");
  });

  it("returns endpoint errors without logging content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503
    })));
    const adapter = new LocalEmbeddingAdapter({
      endpoint: "http://127.0.0.1:11434/api/embed",
      dimension: 32,
      timeoutMs: 5
    });

    await expect(adapter.embedText("sensitive input")).rejects.toThrow("503");
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it("parses a valid local embedding response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: new Array(32).fill(0.1) })
    })));
    const adapter = new LocalEmbeddingAdapter({
      endpoint: "http://127.0.0.1:11434/api/embed",
      dimension: 32
    });

    await expect(adapter.embedText("input")).resolves.toEqual(new Array(32).fill(0.1));
    await expect(adapter.isAvailable()).resolves.toBe(true);
  });
});
