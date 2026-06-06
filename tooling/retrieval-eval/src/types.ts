import type { ContextSearchResult, RagSearchMode } from "@triforge/shared";

export type RetrievalEvalDocumentFixture = {
  title: string;
  content: string;
};

export type RetrievalEvalQueryFixture = {
  query: string;
  expectedDocumentTitles: string[];
  expectedChunkContains: string[];
  k: number;
};

export type RetrievalEvalFixture = {
  name: string;
  documents: RetrievalEvalDocumentFixture[];
  queries: RetrievalEvalQueryFixture[];
};

export type EvaluatedMode = Extract<RagSearchMode, "lexical" | "mock_vector" | "hybrid">;

export type RetrievalEvalMetrics = {
  precision_at_k: number;
  recall_at_k: number;
  hit_at_k: number;
  mean_reciprocal_rank: number;
  expected_chunk_found: boolean;
};

export type RetrievalEvalTopResult = {
  rank: number;
  documentTitle: string;
  chunkId: string;
  chunkExcerpt: string;
  finalScore: number;
  lexicalScore: number;
  vectorScore: number | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  vectorStorageUsed: "jsonb" | "pgvector" | "none";
};

export type RetrievalEvalQueryResult = {
  fixtureName: string;
  mode: EvaluatedMode;
  query: string;
  k: number;
  expectedChunkIds: string[];
  expectedDocumentTitles: string[];
  expectedChunkContains: string[];
  fallbackUsed: boolean;
  metrics: RetrievalEvalMetrics;
  topResults: RetrievalEvalTopResult[];
};

export type RetrievalEvalModeSummary = {
  mode: EvaluatedMode;
  queryCount: number;
  precisionAtK: number;
  recallAtK: number;
  hitAtK: number;
  meanReciprocalRank: number;
  expectedChunkFoundRate: number;
  fallbackUsedRate: number;
};

export type RetrievalEvalReport = {
  generatedAt: string;
  modes: EvaluatedMode[];
  fixtures: string[];
  summaries: RetrievalEvalModeSummary[];
  results: RetrievalEvalQueryResult[];
  qualityGate?: RetrievalEvalQualityGateResult;
};

export type RetrievalEvalQualityMetricThresholds = {
  hitAtK?: number;
  expectedChunkFound?: number;
  meanReciprocalRank?: number;
  precisionAtK?: number;
  recallAtK?: number;
  fallbackUsedRate?: number;
};

export type RetrievalEvalQualityThresholds = {
  version: number;
  default: RetrievalEvalQualityMetricThresholds;
  modes: Partial<Record<EvaluatedMode, RetrievalEvalQualityMetricThresholds>>;
  nonBlocking: Partial<Record<keyof RetrievalEvalQualityMetricThresholds, boolean>>;
};

export type RetrievalEvalQualityGateFailure = {
  fixture: string;
  mode: EvaluatedMode;
  query: string;
  metric: keyof RetrievalEvalQualityMetricThresholds;
  expected: number;
  actual: number;
};

export type RetrievalEvalQualityGateResult = {
  passed: boolean;
  thresholdsVersion: number;
  failures: RetrievalEvalQualityGateFailure[];
};

export type IngestedChunk = {
  documentTitle: string;
  chunkId: string;
  content: string;
};

export type SearchResultLike = Pick<
  ContextSearchResult,
  | "document"
  | "chunk"
  | "finalScore"
  | "lexicalScore"
  | "vectorScore"
  | "fallbackUsed"
  | "fallbackReason"
  | "vectorStorageUsed"
>;
