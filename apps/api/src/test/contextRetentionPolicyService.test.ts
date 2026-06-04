import { describe, expect, it } from "vitest";
import { getDefaultPolicy } from "../services/contextRetentionPolicyService.js";

describe("ContextRetentionPolicyService", () => {
  it("uses conservative local defaults", () => {
    expect(getDefaultPolicy()).toMatchObject({
      maxDocumentsPerGoal: 100,
      maxDocumentCharacters: 200_000,
      maxChunksPerDocument: 500,
      maxChunkCharacters: 2_000,
      maxRetrievalsPerGoal: 1_000,
      maxEmbeddingRowsPerDocument: 500,
      softDeleteDefault: true
    });
  });
});
