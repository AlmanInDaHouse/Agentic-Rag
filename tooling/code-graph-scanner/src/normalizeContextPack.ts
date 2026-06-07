import type { CodeGraphContextPack } from "./types.js";

export type NormalizedCodeGraphContextPack = ReturnType<typeof normalizeContextPack>;

export function normalizeContextPack(contextPack: CodeGraphContextPack) {
  return {
    pack: {
      packVersion: contextPack.pack.packVersion,
      sourceArtifactPath: contextPack.pack.sourceArtifactPath,
      scannerVersion: contextPack.pack.scannerVersion,
      commitSha: contextPack.pack.commitSha,
      documents: contextPack.pack.documents,
      chunks: contextPack.pack.chunks,
      warnings: contextPack.pack.warnings
    },
    documents: contextPack.documents
      .map((document) => ({
        id: document.id,
        kind: document.kind,
        title: document.title,
        sourcePath: document.sourcePath,
        metadata: document.metadata
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    chunks: contextPack.chunks
      .map((chunk) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        text: chunk.text,
        metadata: chunk.metadata
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    warnings: contextPack.warnings
      .map((warning) => ({
        code: warning.code,
        path: warning.path
      }))
      .sort((left, right) => `${left.path ?? ""}:${left.code}`.localeCompare(`${right.path ?? ""}:${right.code}`))
  };
}
