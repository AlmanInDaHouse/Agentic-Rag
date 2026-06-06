import type { ContextSearchResult } from "@triforge/shared";

const now = new Date("2026-01-01T00:00:00.000Z").toISOString();
const goalId = "00000000-0000-4000-8000-000000000001";

export function contextCandidate(input: {
  sourceName: string;
  title: string;
  content: string;
}): ContextSearchResult {
  return {
    source: {
      id: "00000000-0000-4000-8000-000000000010",
      goalId,
      name: input.sourceName,
      type: "manual_text",
      metadata: {},
      deletedAt: null,
      deletedReason: null,
      createdAt: now,
      updatedAt: now
    },
    document: {
      id: "00000000-0000-4000-8000-000000000020",
      sourceId: "00000000-0000-4000-8000-000000000010",
      title: input.title,
      contentHash: "hash",
      classification: "internal",
      redactionStatus: "clean",
      sensitiveFindings: [],
      redactedContentHash: null,
      contentSize: input.content.length,
      deletedAt: null,
      deletedReason: null,
      metadata: {},
      createdAt: now,
      updatedAt: now
    },
    chunk: {
      id: "00000000-0000-4000-8000-000000000030",
      documentId: "00000000-0000-4000-8000-000000000020",
      chunkIndex: 0,
      content: input.content,
      tokenEstimate: 4,
      redactionStatus: "clean",
      contentSize: input.content.length,
      deletedAt: null,
      deletedReason: null,
      metadata: {},
      createdAt: now
    },
    score: 0,
    finalScore: 0,
    lexicalScore: 0,
    vectorScore: null,
    mode: "lexical",
    searchMode: "lexical",
    vectorStorageUsed: "none",
    fallbackUsed: false,
    fallbackReason: null
  };
}
