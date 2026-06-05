import type { EmbeddingAdapter } from "./embeddingAdapter.js";

export type LocalEmbeddingAdapterOptions = {
  endpoint?: string;
  dimension: number;
  timeoutMs?: number;
};

export class LocalEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = "local_embedding_v1";
  readonly provider = "local";
  readonly dimension: number;

  private readonly endpoint?: string;
  private readonly timeoutMs: number;

  constructor(options: LocalEmbeddingAdapterOptions) {
    this.endpoint = normalizeLocalEndpoint(options.endpoint);
    this.dimension = options.dimension;
    this.timeoutMs = options.timeoutMs ?? 2_000;
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.endpoint) {
      return false;
    }

    try {
      await this.embedText("triforge local embedding availability check");
      return true;
    } catch {
      return false;
    }
  }

  async embedText(input: string): Promise<number[]> {
    if (!this.endpoint) {
      throw new Error("Local embedding endpoint is not configured");
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        input,
        dimension: this.dimension
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Local embedding endpoint returned ${response.status}`);
    }

    const body = await response.json() as unknown;
    const embedding = parseEmbeddingResponse(body);
    if (embedding.length !== this.dimension) {
      throw new Error(
        `Local embedding dimension mismatch: expected ${this.dimension}, got ${embedding.length}`
      );
    }
    if (!embedding.every(Number.isFinite)) {
      throw new Error("Local embedding endpoint returned non-finite values");
    }
    return embedding;
  }

  async embedBatch(inputs: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const input of inputs) {
      embeddings.push(await this.embedText(input));
    }
    return embeddings;
  }
}

function parseEmbeddingResponse(body: unknown): number[] {
  if (Array.isArray(body)) {
    return body.map(Number);
  }

  if (typeof body !== "object" || body === null) {
    throw new Error("Local embedding endpoint returned an invalid payload");
  }

  const candidate = body as {
    embedding?: unknown;
    data?: unknown;
  };
  if (Array.isArray(candidate.embedding)) {
    return candidate.embedding.map(Number);
  }
  if (Array.isArray(candidate.data) && candidate.data.length > 0) {
    const first = candidate.data[0] as { embedding?: unknown };
    if (Array.isArray(first.embedding)) {
      return first.embedding.map(Number);
    }
  }

  throw new Error("Local embedding endpoint response did not include an embedding");
}

function normalizeLocalEndpoint(endpoint: string | undefined): string | undefined {
  if (endpoint === undefined) {
    return undefined;
  }
  const trimmed = endpoint.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = new URL(trimmed);
  const hostname = parsed.hostname.toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.");
  if (!isLocal) {
    throw new Error("Local embedding endpoint must point to localhost or loopback");
  }
  return parsed.toString();
}
