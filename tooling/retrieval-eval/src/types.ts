import type {
  ContextSearchResult,
  RagAnswerabilityResult,
  RagSearchMode
} from "@triforge/shared";

export type RetrievalEvalDocumentFixture = {
  title: string;
  content: string;
};

export type RetrievalEvalQueryFixture = {
  query: string;
  expectedDocumentTitles: string[];
  expectedChunkContains: string[];
  k: number;
  queryType: RetrievalEvalQueryType;
  tags: RetrievalEvalQueryTag[];
  expectedShouldAnswer?: boolean;
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
  abstention_accuracy: number;
  false_answer_rate: number;
  false_abstention_rate: number;
};

export type RetrievalEvalQueryType = "answerable" | "no_answer" | "ambiguous" | "redaction";

export type RetrievalEvalQueryTag =
  | "security"
  | "runtime"
  | "redaction"
  | "retention"
  | "no_answer"
  | "ambiguous";

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
  queryType: RetrievalEvalQueryType;
  tags: RetrievalEvalQueryTag[];
  k: number;
  expectedChunkIds: string[];
  expectedDocumentTitles: string[];
  expectedChunkContains: string[];
  expectedShouldAnswer: boolean;
  answerability: RagAnswerabilityResult;
  fallbackUsed: boolean;
  metrics: RetrievalEvalMetrics;
  topResults: RetrievalEvalTopResult[];
};

export type RetrievalEvalModeSummary = {
  mode: EvaluatedMode;
  queryCount: number;
  retrievalQueryCount: number;
  precisionAtK: number;
  recallAtK: number;
  hitAtK: number;
  meanReciprocalRank: number;
  expectedChunkFoundRate: number;
  fallbackUsedRate: number;
  abstentionAccuracy: number;
  falseAnswerRate: number;
  falseAbstentionRate: number;
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
  abstentionAccuracy?: number;
  falseAnswerRate?: number;
  falseAbstentionRate?: number;
};

export type RetrievalEvalQualityThresholds = {
  version: number;
  default: RetrievalEvalQualityMetricThresholds;
  modes: Partial<Record<EvaluatedMode, RetrievalEvalQualityMetricThresholds>>;
  fixtures?: Record<string, RetrievalEvalQualityMetricThresholds>;
  queryTypes?: Partial<Record<RetrievalEvalQueryType, RetrievalEvalQualityMetricThresholds>>;
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

export type SearchResponseLike = {
  results: SearchResultLike[];
  answerability?: RagAnswerabilityResult;
};
