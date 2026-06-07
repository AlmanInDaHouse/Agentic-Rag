import type {
  CodeGraphArtifact,
  CodeGraphContextPack,
  CodeGraphContextPackChunk,
  CodeGraphContextPackDocument,
  CodeGraphContextPackDocumentKind,
  CodeGraphEdge,
  CodeGraphFile,
  CodeGraphSymbol,
  CodeGraphWarning
} from "./types.js";

const packVersion = "code-graph-context-pack-v0" as const;
const generatedFrom = "code_graph";

export type ContextPackOptions = {
  sourceArtifactPath: string;
  generatedAt?: string;
};

export function createContextPack(artifact: CodeGraphArtifact, options: ContextPackOptions): CodeGraphContextPack {
  validateArtifactShape(artifact);

  const documents = new Map<string, CodeGraphContextPackDocument>();
  const chunks = new Map<string, CodeGraphContextPackChunk>();
  const filesById = new Map(artifact.files.map((file) => [file.id, file]));
  const symbolsById = new Map(artifact.symbols.map((symbol) => [symbol.id, symbol]));

  for (const file of artifact.files) {
    addRecord(documents, chunks, fileDocument(file, artifact), fileChunk(file, artifact));
  }

  for (const symbol of artifact.symbols) {
    const file = filesById.get(symbol.fileId);
    addRecord(documents, chunks, symbolDocument(symbol, file, artifact), symbolChunk(symbol, file, artifact));

    if (symbol.symbolKind === "route") {
      addRecord(documents, chunks, routeDocument(symbol, file, artifact), routeChunk(symbol, file, artifact));
    }

    if (symbol.symbolKind === "migration") {
      addRecord(documents, chunks, migrationDocument(symbol, file, artifact), migrationChunk(symbol, file, artifact));
    }
  }

  for (const edge of artifact.edges) {
    const source = resolveGraphRef(edge.sourceId, filesById, symbolsById);
    const target = resolveGraphRef(edge.targetId, filesById, symbolsById);
    addRecord(documents, chunks, edgeDocument(edge, source, target, artifact), edgeChunk(edge, source, target, artifact));
  }

  if (artifact.warnings.length > 0) {
    addRecord(documents, chunks, warningDocument(artifact), warningChunk(artifact));
  }

  const sortedDocuments = Array.from(documents.values()).sort(compareById);
  const sortedChunks = Array.from(chunks.values()).sort(compareById);
  const sortedWarnings = [...artifact.warnings].sort(compareWarnings);

  return {
    pack: {
      packVersion,
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      sourceArtifactPath: normalizeRepoPath(options.sourceArtifactPath),
      scannerVersion: artifact.scanRun.scannerVersion,
      commitSha: artifact.scanRun.commitSha,
      documents: sortedDocuments.length,
      chunks: sortedChunks.length,
      warnings: sortedWarnings.length
    },
    documents: sortedDocuments,
    chunks: sortedChunks,
    warnings: sortedWarnings
  };
}

export function validateArtifactShape(input: unknown): asserts input is CodeGraphArtifact {
  if (!isRecord(input)) {
    throw new Error("Code Graph artifact must be a JSON object.");
  }
  if (!isRecord(input.scanRun)) {
    throw new Error("Code Graph artifact is missing scanRun.");
  }
  if (input.scanRun.scannerVersion !== "code-graph-scanner-v0") {
    throw new Error("Code Graph artifact has an unsupported scannerVersion.");
  }
  if (input.scanRun.status !== "completed") {
    throw new Error("Code Graph artifact scanRun must be completed.");
  }
  for (const key of ["files", "symbols", "edges", "warnings"] as const) {
    if (!Array.isArray(input[key])) {
      throw new Error(`Code Graph artifact is missing ${key}.`);
    }
  }
}

function fileDocument(file: CodeGraphFile, artifact: CodeGraphArtifact): CodeGraphContextPackDocument {
  return {
    id: documentId("file", file.id),
    kind: "file",
    title: `File ${file.path}`,
    sourcePath: file.path,
    metadata: commonMetadata(artifact, {
      sourcePath: file.path,
      fileKind: file.fileKind,
      language: file.language,
      packageName: file.packageName
    })
  };
}

function fileChunk(file: CodeGraphFile, artifact: CodeGraphArtifact): CodeGraphContextPackChunk {
  const packageText = file.packageName === null ? "without a workspace package" : `in package ${file.packageName}`;
  const role = file.fileKind === "source" && file.path.includes("/routes/")
    ? "route file"
    : `${fileLanguage(file.language)} ${file.fileKind} file`;
  return {
    id: chunkId("file", file.id),
    documentId: documentId("file", file.id),
    text: `File ${file.path} is a ${role} ${packageText}.`,
    metadata: commonMetadata(artifact, {
      sourcePath: file.path,
      fileKind: file.fileKind,
      language: file.language,
      packageName: file.packageName
    })
  };
}

function symbolDocument(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined, artifact: CodeGraphArtifact): CodeGraphContextPackDocument {
  return {
    id: documentId("symbol", symbol.id),
    kind: "symbol",
    title: `Symbol ${symbol.name}`,
    sourcePath: file?.path ?? null,
    metadata: commonMetadata(artifact, symbolMetadata(symbol, file))
  };
}

function symbolChunk(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined, artifact: CodeGraphArtifact): CodeGraphContextPackChunk {
  const exportText = symbol.exportKind === "none" ? "not exported" : `${symbol.exportKind} exported`;
  const pathText = file === undefined ? symbol.fileId : file.path;
  return {
    id: chunkId("symbol", symbol.id),
    documentId: documentId("symbol", symbol.id),
    text: `Symbol ${symbol.name} is a ${exportText} ${symbol.symbolKind} in ${pathText}.`,
    metadata: commonMetadata(artifact, symbolMetadata(symbol, file))
  };
}

function routeDocument(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined, artifact: CodeGraphArtifact): CodeGraphContextPackDocument {
  return {
    id: documentId("route", symbol.id),
    kind: "route",
    title: `Route ${routeName(symbol)}`,
    sourcePath: file?.path ?? null,
    metadata: commonMetadata(artifact, symbolMetadata(symbol, file))
  };
}

function routeChunk(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined, artifact: CodeGraphArtifact): CodeGraphContextPackChunk {
  const method = stringMetadata(symbol.metadata, "routeMethod") ?? "UNKNOWN";
  const routePath = stringMetadata(symbol.metadata, "routePath") ?? symbol.name;
  const sourcePath = file?.path ?? symbol.fileId;
  return {
    id: chunkId("route", symbol.id),
    documentId: documentId("route", symbol.id),
    text: `Fastify route ${method} ${routePath} is defined in ${sourcePath}.`,
    metadata: commonMetadata(artifact, symbolMetadata(symbol, file))
  };
}

function migrationDocument(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined, artifact: CodeGraphArtifact): CodeGraphContextPackDocument {
  return {
    id: documentId("migration", symbol.id),
    kind: "migration",
    title: `Migration ${symbol.name}`,
    sourcePath: file?.path ?? null,
    metadata: commonMetadata(artifact, symbolMetadata(symbol, file))
  };
}

function migrationChunk(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined, artifact: CodeGraphArtifact): CodeGraphContextPackChunk {
  const operation = stringMetadata(symbol.metadata, "operation") ?? "REFERENCES";
  const tableName = stringMetadata(symbol.metadata, "tableName") ?? symbol.name;
  const sourcePath = file?.path ?? symbol.fileId;
  return {
    id: chunkId("migration", symbol.id),
    documentId: documentId("migration", symbol.id),
    text: `Migration ${sourcePath} references table ${tableName} through ${operation} TABLE.`,
    metadata: commonMetadata(artifact, symbolMetadata(symbol, file))
  };
}

function edgeDocument(
  edge: CodeGraphEdge,
  source: GraphRef,
  target: GraphRef,
  artifact: CodeGraphArtifact
): CodeGraphContextPackDocument {
  const kind = documentKindForEdge(edge);
  return {
    id: documentId(kind, edge.id),
    kind,
    title: edgeTitle(edge, source, target),
    sourcePath: source.path,
    metadata: commonMetadata(artifact, edgeMetadata(edge, source, target))
  };
}

function edgeChunk(
  edge: CodeGraphEdge,
  source: GraphRef,
  target: GraphRef,
  artifact: CodeGraphArtifact
): CodeGraphContextPackChunk {
  const kind = documentKindForEdge(edge);
  return {
    id: chunkId(kind, edge.id),
    documentId: documentId(kind, edge.id),
    text: edgeText(edge, source, target),
    metadata: commonMetadata(artifact, edgeMetadata(edge, source, target))
  };
}

function warningDocument(artifact: CodeGraphArtifact): CodeGraphContextPackDocument {
  return {
    id: documentId("warning_summary", "scanner-warnings"),
    kind: "warning_summary",
    title: "Code Graph scanner warnings",
    sourcePath: null,
    metadata: commonMetadata(artifact, {
      warningCount: artifact.warnings.length,
      authority: "warning_only"
    })
  };
}

function warningChunk(artifact: CodeGraphArtifact): CodeGraphContextPackChunk {
  const warningTexts = artifact.warnings
    .map((warning) => `${warning.code}${warning.path === null ? "" : ` at ${warning.path}`}`)
    .sort();
  return {
    id: chunkId("warning_summary", "scanner-warnings"),
    documentId: documentId("warning_summary", "scanner-warnings"),
    text: `Code Graph scanner emitted warnings; treat these as scanner limitations, not positive evidence: ${warningTexts.join("; ")}.`,
    metadata: commonMetadata(artifact, {
      warningCount: artifact.warnings.length,
      warningCodes: artifact.warnings.map((warning) => warning.code).sort(),
      authority: "warning_only"
    })
  };
}

function documentKindForEdge(edge: CodeGraphEdge): CodeGraphContextPackDocumentKind {
  if (edge.edgeType === "tests") {
    return "test";
  }
  if (edge.edgeType === "documents") {
    return "doc_relationship";
  }
  if (edge.edgeType === "migrates") {
    return "migration";
  }
  return "edge";
}

function edgeTitle(edge: CodeGraphEdge, source: GraphRef, target: GraphRef): string {
  if (edge.edgeType === "tests") {
    return `Test relationship ${source.label} to ${target.label}`;
  }
  if (edge.edgeType === "documents") {
    return `Documentation relationship ${source.label} to ${target.label}`;
  }
  return `${edge.edgeType} relationship ${source.label} to ${target.label}`;
}

function edgeText(edge: CodeGraphEdge, source: GraphRef, target: GraphRef): string {
  if (edge.edgeType === "imports") {
    return `${source.label} imports ${target.label}.`;
  }
  if (edge.edgeType === "exports") {
    return `${source.label} exports ${target.label}.`;
  }
  if (edge.edgeType === "tests") {
    return `Test ${source.label} covers ${target.label} by direct import.`;
  }
  if (edge.edgeType === "migrates") {
    const operation = stringMetadata(edge.metadata, "operation");
    const tableName = stringMetadata(edge.metadata, "tableName");
    if (operation !== null && tableName !== null) {
      return `Migration ${source.label} references table ${tableName} through ${operation} TABLE.`;
    }
    return `Migration ${source.label} references ${target.label}.`;
  }
  if (edge.edgeType === "documents") {
    return `${documentLabel(source)} ${source.label} documents ${target.label}.`;
  }
  return `${source.label} has ${edge.edgeType} relationship to ${target.label}.`;
}

function documentLabel(ref: GraphRef): string {
  if (ref.file?.isAdr === true) {
    return "ADR";
  }
  if (ref.file?.isSpec === true) {
    return "Spec";
  }
  return "Document";
}

type GraphRef = {
  id: string;
  label: string;
  path: string | null;
  file?: CodeGraphFile;
  symbol?: CodeGraphSymbol;
};

function resolveGraphRef(id: string, filesById: Map<string, CodeGraphFile>, symbolsById: Map<string, CodeGraphSymbol>): GraphRef {
  const file = filesById.get(id);
  if (file !== undefined) {
    return { id, label: file.path, path: file.path, file };
  }
  const symbol = symbolsById.get(id);
  if (symbol !== undefined) {
    const fileForSymbol = filesById.get(symbol.fileId);
    return {
      id,
      label: fileForSymbol === undefined ? symbol.name : `${symbol.name} in ${fileForSymbol.path}`,
      path: fileForSymbol?.path ?? null,
      file: fileForSymbol,
      symbol
    };
  }
  return { id, label: id, path: null };
}

function symbolMetadata(symbol: CodeGraphSymbol, file: CodeGraphFile | undefined): Record<string, unknown> {
  return {
    sourcePath: file?.path ?? null,
    symbolName: symbol.name,
    symbolKind: symbol.symbolKind,
    exportKind: symbol.exportKind,
    confidence: symbol.confidence,
    scannerMetadata: symbol.metadata
  };
}

function edgeMetadata(edge: CodeGraphEdge, source: GraphRef, target: GraphRef): Record<string, unknown> {
  return {
    sourcePath: source.path,
    sourceId: edge.sourceId,
    targetPath: target.path,
    targetId: edge.targetId,
    edgeType: edge.edgeType,
    confidence: edge.confidence,
    scannerMetadata: edge.metadata,
    symbolName: target.symbol?.name ?? source.symbol?.name ?? null,
    symbolKind: target.symbol?.symbolKind ?? source.symbol?.symbolKind ?? null
  };
}

function commonMetadata(artifact: CodeGraphArtifact, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    generatedFrom,
    scannerVersion: artifact.scanRun.scannerVersion,
    commitSha: artifact.scanRun.commitSha,
    ...extra
  };
}

function addRecord(
  documents: Map<string, CodeGraphContextPackDocument>,
  chunks: Map<string, CodeGraphContextPackChunk>,
  document: CodeGraphContextPackDocument,
  chunk: CodeGraphContextPackChunk
): void {
  documents.set(document.id, document);
  chunks.set(chunk.id, chunk);
}

function documentId(kind: CodeGraphContextPackDocumentKind, value: string): string {
  return `document:${kind}:${stableSegment(value)}`;
}

function chunkId(kind: CodeGraphContextPackDocumentKind, value: string): string {
  return `chunk:${kind}:${stableSegment(value)}`;
}

function stableSegment(value: string): string {
  return value
    .replace(/^file:/, "")
    .replace(/^symbol:/, "")
    .replace(/^edge:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9/._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function routeName(symbol: CodeGraphSymbol): string {
  const method = stringMetadata(symbol.metadata, "routeMethod");
  const routePath = stringMetadata(symbol.metadata, "routePath");
  return method === null || routePath === null ? symbol.name : `${method} ${routePath}`;
}

function fileLanguage(language: CodeGraphFile["language"]): string {
  if (language === "typescript") {
    return "TypeScript";
  }
  if (language === "tsx") {
    return "TSX";
  }
  if (language === "sql") {
    return "SQL";
  }
  if (language === "markdown") {
    return "Markdown";
  }
  return "JSON";
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

function normalizeRepoPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function compareWarnings(left: CodeGraphWarning, right: CodeGraphWarning): number {
  return `${left.path ?? ""}:${left.code}`.localeCompare(`${right.path ?? ""}:${right.code}`);
}
