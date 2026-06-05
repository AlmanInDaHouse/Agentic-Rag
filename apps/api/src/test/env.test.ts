import { describe, expect, it } from "vitest";
import { parseEnv } from "../config/env.js";

describe("env config", () => {
  it("uses mock/jsonb embedding defaults", () => {
    const env = parseEnv({});

    expect(env.TRIFORGE_EMBEDDING_PROVIDER).toBe("mock");
    expect(env.TRIFORGE_EMBEDDING_STORAGE).toBe("jsonb");
    expect(env.TRIFORGE_LOCAL_EMBEDDING_ENDPOINT).toBeUndefined();
    expect(env.TRIFORGE_LOCAL_EMBEDDING_DIMENSION).toBe(32);
  });

  it("parses local embedding opt-in config", () => {
    const env = parseEnv({
      TRIFORGE_EMBEDDING_PROVIDER: "local",
      TRIFORGE_LOCAL_EMBEDDING_ENDPOINT: "http://127.0.0.1:11434/api/embed",
      TRIFORGE_LOCAL_EMBEDDING_DIMENSION: "384",
      TRIFORGE_EMBEDDING_STORAGE: "pgvector"
    });

    expect(env.TRIFORGE_EMBEDDING_PROVIDER).toBe("local");
    expect(env.TRIFORGE_LOCAL_EMBEDDING_DIMENSION).toBe(384);
    expect(env.TRIFORGE_EMBEDDING_STORAGE).toBe("pgvector");
  });

  it("treats an empty local embedding endpoint as unconfigured", () => {
    const env = parseEnv({
      TRIFORGE_LOCAL_EMBEDDING_ENDPOINT: ""
    });

    expect(env.TRIFORGE_LOCAL_EMBEDDING_ENDPOINT).toBeUndefined();
  });

  it("treats a whitespace local embedding endpoint as unconfigured", () => {
    const env = parseEnv({
      TRIFORGE_LOCAL_EMBEDDING_ENDPOINT: "   "
    });

    expect(env.TRIFORGE_LOCAL_EMBEDDING_ENDPOINT).toBeUndefined();
  });

  it("allows provider local without requiring an endpoint at startup", () => {
    const env = parseEnv({
      TRIFORGE_EMBEDDING_PROVIDER: "local"
    });

    expect(env.TRIFORGE_EMBEDDING_PROVIDER).toBe("local");
    expect(env.TRIFORGE_LOCAL_EMBEDDING_ENDPOINT).toBeUndefined();
  });

  it("rejects non-local embedding endpoints", () => {
    expect(() => parseEnv({
      TRIFORGE_LOCAL_EMBEDDING_ENDPOINT: "https://example.com/embed"
    })).toThrow(/localhost or loopback/);
  });

  it("rejects invalid local embedding dimensions", () => {
    expect(() => parseEnv({
      TRIFORGE_LOCAL_EMBEDDING_DIMENSION: "0"
    })).toThrow();
    expect(() => parseEnv({
      TRIFORGE_LOCAL_EMBEDDING_DIMENSION: "4097"
    })).toThrow();
  });
});
