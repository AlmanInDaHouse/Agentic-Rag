import type { CodeGraphArtifact } from "./types.js";

export type NormalizedCodeGraphArtifact = ReturnType<typeof normalizeArtifact>;

export function normalizeArtifact(artifact: CodeGraphArtifact) {
  return {
    scanRun: {
      scannerVersion: artifact.scanRun.scannerVersion,
      repoRoot: artifact.scanRun.repoRoot,
      commitSha: artifact.scanRun.commitSha,
      status: artifact.scanRun.status,
      filesScanned: artifact.scanRun.filesScanned,
      filesSkipped: artifact.scanRun.filesSkipped
    },
    files: artifact.files
      .map((file) => ({
        path: file.path,
        language: file.language,
        fileKind: file.fileKind,
        isTest: file.isTest,
        isMigration: file.isMigration,
        isSpec: file.isSpec,
        isAdr: file.isAdr
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    symbols: artifact.symbols
      .map((symbol) => ({
        fileId: symbol.fileId,
        name: symbol.name,
        symbolKind: symbol.symbolKind,
        exportKind: symbol.exportKind,
        confidence: symbol.confidence,
        metadata: symbol.metadata
      }))
      .sort((left, right) => `${left.fileId}:${left.symbolKind}:${left.name}`.localeCompare(`${right.fileId}:${right.symbolKind}:${right.name}`)),
    edges: artifact.edges
      .map((edge) => ({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        edgeType: edge.edgeType,
        confidence: edge.confidence,
        metadata: edge.metadata
      }))
      .sort((left, right) => `${left.edgeType}:${left.sourceId}:${left.targetId}`.localeCompare(`${right.edgeType}:${right.sourceId}:${right.targetId}`)),
    warnings: artifact.warnings
      .map((warning) => ({
        code: warning.code,
        path: warning.path
      }))
      .sort((left, right) => `${left.path ?? ""}:${left.code}`.localeCompare(`${right.path ?? ""}:${right.code}`))
  };
}
