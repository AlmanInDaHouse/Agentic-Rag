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

  it("treats a whitespace endpoint as unconfigured", async () => {
    const adapter = new LocalEmbeddingAdapter({
      endpoint: "   ",
      dimension: 32
    });

    expect(adapter.isConfigured()).toBe(false);
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it("rejects external endpoints when constructed directly", () => {
    expect(() => new LocalEmbeddingAdapter({
      endpoint: "https://example.com/embed",
      dimension: 32
    })).toThrow(/localhost or loopback/);
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

  it("rejects responses with the wrong dimension", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2] })
    })));
    const adapter = new LocalEmbeddingAdapter({
      endpoint: "http://127.0.0.1:11434/api/embed",
      dimension: 32
    });

    await expect(adapter.embedText("input")).rejects.toThrow("dimension mismatch");
  });

  it("reports network failures as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));
    const adapter = new LocalEmbeddingAdapter({
      endpoint: "http://127.0.0.1:11434/api/embed",
      dimension: 32
    });

    await expect(adapter.isAvailable()).resolves.toBe(false);
  });
});
