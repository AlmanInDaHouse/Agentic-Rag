import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./runner.js";
import { scanRepository } from "./scanner.js";
import type { CodeGraphArtifact } from "./types.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../../..");
const fixtureRoot = path.join(repoRoot, "tooling/code-graph-fixtures/basic-api");

describe("code graph scanner", () => {
  it("scans the basic API fixture with deterministic normalized output", async () => {
    const artifact = await scanRepository({
      repoRoot: fixtureRoot,
      commitSha: "fixture",
      startedAt: "2026-06-07T00:00:00.000Z",
      completedAt: "2026-06-07T00:00:00.000Z"
    });
    const expected = JSON.parse(await fs.readFile(
      path.join(fixtureRoot, "expected/code-graph.normalized.json"),
      "utf8"
    )) as unknown;

    expect(normalizeArtifact(artifact)).toEqual(expected);
  });

  it("parses CLI options", () => {
    expect(parseArgs([
      "--repo-root",
      "fixture",
      "--out",
      "tmp/graph.json",
      "--max-file-size-bytes",
      "1024"
    ])).toEqual({
      repoRoot: "fixture",
      out: "tmp/graph.json",
      maxFileSizeBytes: 1024
    });
  });
});

function normalizeArtifact(artifact: CodeGraphArtifact) {
  return {
    scanRun: {
      scannerVersion: artifact.scanRun.scannerVersion,
      repoRoot: artifact.scanRun.repoRoot,
      commitSha: artifact.scanRun.commitSha,
      status: artifact.scanRun.status,
      filesScanned: artifact.scanRun.filesScanned,
      filesSkipped: artifact.scanRun.filesSkipped
    },
    files: artifact.files.map((file) => ({
      path: file.path,
      language: file.language,
      fileKind: file.fileKind,
      isTest: file.isTest,
      isMigration: file.isMigration,
      isSpec: file.isSpec,
      isAdr: file.isAdr
    })),
    symbols: artifact.symbols.map((symbol) => ({
      fileId: symbol.fileId,
      name: symbol.name,
      symbolKind: symbol.symbolKind,
      exportKind: symbol.exportKind,
      confidence: symbol.confidence,
      metadata: symbol.metadata
    })),
    edges: artifact.edges.map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      edgeType: edge.edgeType,
      confidence: edge.confidence,
      metadata: edge.metadata
    })),
    warnings: artifact.warnings.map((warning) => ({
      code: warning.code,
      path: warning.path
    }))
  };
}
