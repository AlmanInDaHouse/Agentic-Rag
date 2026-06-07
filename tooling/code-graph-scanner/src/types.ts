export type CodeGraphFile = {
  id: string;
  path: string;
  packageName: string | null;
  language: "typescript" | "tsx" | "sql" | "markdown" | "json";
  fileKind: "source" | "test" | "migration" | "spec" | "adr" | "documentation" | "config" | "fixture" | "unknown";
  hash: string;
  sizeBytes: number;
  isTest: boolean;
  isMigration: boolean;
  isSpec: boolean;
  isAdr: boolean;
  metadata: Record<string, unknown>;
};

export type CodeGraphSymbol = {
  id: string;
  fileId: string;
  name: string;
  symbolKind: "function" | "class" | "type" | "interface" | "const" | "route" | "service" | "repository" | "migration" | "unknown";
  exportKind: "none" | "named" | "default" | "type" | "reexport";
  startLine: number | null;
  endLine: number | null;
  visibility: "public" | "internal";
  confidence: number;
  metadata: Record<string, unknown>;
};

export type CodeGraphEdge = {
  id: string;
  sourceType: "file" | "symbol" | "document";
  sourceId: string;
  targetType: "file" | "symbol" | "document";
  targetId: string;
  edgeType: "imports" | "exports" | "tests" | "migrates" | "documents";
  confidence: number;
  metadata: Record<string, unknown>;
};

export type CodeGraphWarning = {
  code: string;
  path: string | null;
  message: string;
  severity: "warning";
};

export type CodeGraphArtifact = {
  scanRun: {
    scannerVersion: "code-graph-scanner-v0";
    repoRoot: ".";
    commitSha: string;
    status: "completed";
    startedAt: string;
    completedAt: string;
    filesScanned: number;
    filesSkipped: number;
  };
  files: CodeGraphFile[];
  symbols: CodeGraphSymbol[];
  edges: CodeGraphEdge[];
  warnings: CodeGraphWarning[];
};

export type CodeGraphContextPackDocumentKind =
  | "file"
  | "symbol"
  | "edge"
  | "route"
  | "migration"
  | "test"
  | "doc_relationship"
  | "warning_summary";

export type CodeGraphContextPackDocument = {
  id: string;
  kind: CodeGraphContextPackDocumentKind;
  title: string;
  sourcePath: string | null;
  metadata: Record<string, unknown>;
};

export type CodeGraphContextPackChunk = {
  id: string;
  documentId: string;
  text: string;
  metadata: Record<string, unknown>;
};

export type CodeGraphContextPack = {
  pack: {
    packVersion: "code-graph-context-pack-v0";
    generatedAt: string;
    sourceArtifactPath: string;
    scannerVersion: "code-graph-scanner-v0";
    commitSha: string;
    documents: number;
    chunks: number;
    warnings: number;
  };
  documents: CodeGraphContextPackDocument[];
  chunks: CodeGraphContextPackChunk[];
  warnings: CodeGraphWarning[];
};

export type ScanOptions = {
  repoRoot: string;
  startedAt?: string;
  completedAt?: string;
  commitSha?: string;
  maxFileSizeBytes?: number;
};
