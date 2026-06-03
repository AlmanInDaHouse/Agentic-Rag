import { createHash } from "node:crypto";
import { normalizeText } from "../contextChunkingService.js";
import type { EmbeddingAdapter } from "./embeddingAdapter.js";

export class MockEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = "mock_embedding_v1";
  readonly provider = "mock";
  readonly dimension = 32;

  async embedText(input: string): Promise<number[]> {
    const digest = createHash("sha256").update(normalizeText(input).toLowerCase()).digest();
    const rawVector = Array.from(digest).map((byte) => byte / 127.5 - 1);
    return normalizeVector(rawVector);
  }

  async embedBatch(inputs: string[]): Promise<number[][]> {
    return Promise.all(inputs.map((input) => this.embedText(input)));
  }
}

export function embeddingHash(input: {
  modelName: string;
  provider: string;
  dimension: number;
  text: string;
  embedding: number[];
}): string {
  return createHash("sha256")
    .update(input.provider)
    .update(":")
    .update(input.modelName)
    .update(":")
    .update(String(input.dimension))
    .update(":")
    .update(normalizeText(input.text).toLowerCase())
    .update(":")
    .update(JSON.stringify(input.embedding))
    .digest("hex");
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function normalizeCosineScore(score: number): number {
  return Math.max(0, Math.min(1, (score + 1) / 2));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
  if (magnitude === 0) {
    return vector.map(() => 0);
  }
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}
