import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createContextPack } from "./contextPack.js";
import { normalizeArtifact } from "./normalize.js";
import { normalizeContextPack } from "./normalizeContextPack.js";
import { parsePackArgs, runPack } from "./pack.js";
import {
  defaultPackEvalThresholds,
  enforcePackEvalGate,
  evaluateContextPack,
  loadEvalCases,
  normalizePackEvalReport,
  searchPackChunks
} from "./packEval.js";
import { parseArgs } from "./runner.js";
import { scanRepository } from "./scanner.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "../../..");
const fixtureRoot = path.join(repoRoot, "tooling/code-graph-fixtures/basic-api");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

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

  it("produces identical normalized output across repeated fixture scans", async () => {
    const first = await scanFixture();
    const second = await scanFixture();

    expect(normalizeArtifact(first)).toEqual(normalizeArtifact(second));
  });

  it("keeps primary output arrays sorted", async () => {
    const artifact = await scanFixture();

    expect(artifact.files.map((file) => file.id)).toEqual([...artifact.files.map((file) => file.id)].sort());
    expect(artifact.symbols.map((symbol) => symbol.id)).toEqual([...artifact.symbols.map((symbol) => symbol.id)].sort());
    expect(artifact.edges.map((edge) => edge.id)).toEqual([...artifact.edges.map((edge) => edge.id)].sort());
    expect(artifact.warnings.map((warning) => `${warning.path ?? ""}:${warning.code}`)).toEqual(
      [...artifact.warnings.map((warning) => `${warning.path ?? ""}:${warning.code}`)].sort()
    );
  });

  it("warns for dynamic imports without inventing an import edge", async () => {
    const artifact = await scanFixture();

    expect(artifact.warnings).toContainEqual(expect.objectContaining({
      code: "unsupported_dynamic_import",
      path: "apps/api/src/ambiguous/dynamic.ts"
    }));
    expect(artifact.edges).not.toContainEqual(expect.objectContaining({
      sourceId: "file:apps/api/src/ambiguous/dynamic.ts",
      edgeType: "imports"
    }));
  });

  it("warns for unresolved imports conservatively", async () => {
    const tempRepo = await createTempRepo();
    await fs.mkdir(path.join(tempRepo, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepo, "src/index.ts"),
      "import { missing } from './missing';\nexport function useMissing() { return missing; }\n",
      "utf8"
    );

    const artifact = await scanRepository({ repoRoot: tempRepo, commitSha: "fixture" });

    expect(artifact.warnings).toContainEqual(expect.objectContaining({
      code: "unresolved_relative_import",
      path: "src/index.ts"
    }));
  });

  it("does not include full source content in the artifact", async () => {
    const tempRepo = await createTempRepo();
    await fs.mkdir(path.join(tempRepo, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepo, "src/secret.ts"),
      "const token = 'fixture-secret-token-value';\nexport function readName() { return 'safe'; }\n",
      "utf8"
    );

    const artifact = await scanRepository({ repoRoot: tempRepo, commitSha: "fixture" });

    expect(JSON.stringify(artifact)).not.toContain("fixture-secret-token-value");
  });

  it("rejects imports that escape the repository root", async () => {
    const tempRepo = await createTempRepo();
    await fs.mkdir(path.join(tempRepo, "src"), { recursive: true });
    await fs.writeFile(path.join(tempRepo, "src/index.ts"), "import '../outside';\n", "utf8");

    const artifact = await scanRepository({ repoRoot: path.join(tempRepo, "src"), commitSha: "fixture" });

    expect(artifact.warnings).toContainEqual(expect.objectContaining({
      code: "unsafe_import_path",
      path: "index.ts"
    }));
  });

  it.skipIf(process.platform === "win32")("skips symlinks that point outside the repository", async () => {
    const tempRepo = await createTempRepo();
    const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "code-graph-outside-"));
    temporaryDirectories.push(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, "outside.ts"), "export const outside = true;\n", "utf8");
    await fs.symlink(path.join(outsideDirectory, "outside.ts"), path.join(tempRepo, "outside-link.ts"));

    const artifact = await scanRepository({ repoRoot: tempRepo, commitSha: "fixture" });

    expect(artifact.warnings).toContainEqual(expect.objectContaining({
      code: "symlink_outside_repo",
      path: "outside-link.ts"
    }));
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

  it("generates context pack documents and chunks from the fixture", async () => {
    const artifact = await scanFixture();
    const contextPack = createFixtureContextPack(artifact);

    expect(contextPack.pack.packVersion).toBe("code-graph-context-pack-v0");
    expect(contextPack.documents.length).toBeGreaterThan(0);
    expect(contextPack.chunks.length).toBeGreaterThan(0);
    expect(contextPack.documents).toContainEqual(expect.objectContaining({
      kind: "file",
      sourcePath: "apps/api/src/routes/goals.ts"
    }));
    expect(contextPack.chunks).toContainEqual(expect.objectContaining({
      text: "Fastify route POST /api/goals is defined in apps/api/src/routes/goals.ts."
    }));
    expect(contextPack.chunks).toContainEqual(expect.objectContaining({
      text: "Test apps/api/src/__tests__/goalService.test.ts covers apps/api/src/services/goalService.ts by direct import."
    }));
    expect(contextPack.chunks).toContainEqual(expect.objectContaining({
      text: "Spec docs/specs/GOALS_SPEC.md documents apps/api/src/routes/goals.ts."
    }));
  });

  it("keeps context pack chunk metadata traceable to code graph", async () => {
    const contextPack = createFixtureContextPack(await scanFixture());

    expect(contextPack.chunks.every((chunk) => chunk.metadata.generatedFrom === "code_graph")).toBe(true);
    expect(contextPack.chunks.every((chunk) => chunk.metadata.scannerVersion === "code-graph-scanner-v0")).toBe(true);
    expect(contextPack.chunks).toContainEqual(expect.objectContaining({
      metadata: expect.objectContaining({
        edgeType: "imports",
        sourcePath: "apps/api/src/routes/goals.ts",
        targetPath: "apps/api/src/services/goalService.ts",
        confidence: 1
      })
    }));
  });

  it("does not include full source content in the context pack", async () => {
    const tempRepo = await createTempRepo();
    await fs.mkdir(path.join(tempRepo, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempRepo, "src/secret.ts"),
      "const token = 'fixture-secret-token-value';\nexport function readName() { return 'safe'; }\n",
      "utf8"
    );

    const artifact = await scanRepository({ repoRoot: tempRepo, commitSha: "fixture" });
    const contextPack = createContextPack(artifact, {
      sourceArtifactPath: "artifacts/code-graph/code-graph.json",
      generatedAt: "2026-06-08T00:00:00.000Z"
    });

    expect(JSON.stringify(contextPack)).not.toContain("fixture-secret-token-value");
  });

  it("keeps scanner warnings as low-authority context", async () => {
    const contextPack = createFixtureContextPack(await scanFixture());
    const warningChunk = contextPack.chunks.find((chunk) => chunk.documentId.includes("warning_summary"));

    expect(warningChunk).toEqual(expect.objectContaining({
      text: expect.stringContaining("not positive evidence"),
      metadata: expect.objectContaining({
        authority: "warning_only"
      })
    }));
    expect(contextPack.chunks).not.toContainEqual(expect.objectContaining({
      documentId: expect.not.stringContaining("warning_summary"),
      text: expect.stringContaining("unsupported_dynamic_import")
    }));
  });

  it("produces stable normalized context pack output", async () => {
    const first = createFixtureContextPack(await scanFixture());
    const second = createFixtureContextPack(await scanFixture());
    const expected = JSON.parse(await fs.readFile(
      path.join(fixtureRoot, "expected/code-context-pack.normalized.json"),
      "utf8"
    )) as unknown;

    expect(normalizeContextPack(first)).toEqual(normalizeContextPack(second));
    expect(normalizeContextPack(first)).toEqual(expected);
  });

  it("fails clearly when the source artifact is missing", async () => {
    const tempRepo = await createTempRepo();

    await expect(runPack({
      repoRoot: tempRepo,
      artifact: "artifacts/code-graph/code-graph.json",
      out: "artifacts/code-graph/code-context-pack.json"
    })).rejects.toThrow("Run pnpm code-graph:scan first");
  });

  it("keeps context pack source paths repository-relative", async () => {
    const contextPack = createFixtureContextPack(await scanFixture());
    const sourcePaths = [
      ...contextPack.documents.map((document) => document.sourcePath),
      ...contextPack.chunks.flatMap((chunk) => [chunk.metadata.sourcePath, chunk.metadata.targetPath])
    ].filter((value): value is string => typeof value === "string");

    expect(sourcePaths.length).toBeGreaterThan(0);
    expect(sourcePaths.every((sourcePath) => !path.isAbsolute(sourcePath))).toBe(true);
    expect(sourcePaths.every((sourcePath) => !sourcePath.startsWith("../"))).toBe(true);
  });

  it("parses context pack CLI options", () => {
    expect(parsePackArgs([
      "--repo-root",
      "fixture",
      "--artifact",
      "tmp/graph.json",
      "--out",
      "tmp/pack.json"
    ])).toEqual({
      repoRoot: "fixture",
      artifact: "tmp/graph.json",
      out: "tmp/pack.json"
    });
  });

  it("evaluates context pack fixture cases against the normalized baseline", async () => {
    const contextPack = createFixtureContextPack(await scanFixture());
    const cases = await loadEvalCases(path.join(fixtureRoot, "eval/code-context-pack.eval.json"));
    const report = evaluateContextPack(contextPack, cases);
    const expected = JSON.parse(await fs.readFile(
      path.join(fixtureRoot, "expected/code-context-pack-eval.normalized.json"),
      "utf8"
    )) as unknown;

    enforcePackEvalGate(report);
    expect(normalizePackEvalReport(report)).toEqual(expected);
  });

  it("orders pack lexical retrieval deterministically", () => {
    const chunks = [
      {
        id: "chunk:z",
        documentId: "document:z",
        text: "File b.ts imports c.ts.",
        metadata: { generatedFrom: "code_graph" }
      },
      {
        id: "chunk:a",
        documentId: "document:a",
        text: "File a.ts imports c.ts.",
        metadata: { generatedFrom: "code_graph" }
      }
    ];

    expect(searchPackChunks(chunks, "imports c", 2).map((result) => result.chunkId)).toEqual(["chunk:a", "chunk:z"]);
  });

  it("marks no-answer pack eval cases as abstentions", async () => {
    const report = evaluateContextPack(createFixtureContextPack(await scanFixture()), await loadFixtureEvalCases());
    const noAnswer = report.cases.find((result) => result.id === "missing-users-route-no-answer");

    expect(noAnswer).toEqual(expect.objectContaining({
      queryType: "no_answer",
      shouldAnswer: false,
      needsClarification: false
    }));
  });

  it("marks ambiguous pack eval cases as needing clarification", async () => {
    const report = evaluateContextPack(createFixtureContextPack(await scanFixture()), await loadFixtureEvalCases());
    const ambiguous = report.cases.find((result) => result.id === "ambiguous-goal-file");

    expect(ambiguous).toEqual(expect.objectContaining({
      queryType: "ambiguous",
      shouldAnswer: false,
      needsClarification: true,
      warnings: expect.arrayContaining(["ambiguous_query_needs_clarification"])
    }));
  });

  it("fails the pack eval gate when thresholds are not met", async () => {
    const contextPack = createFixtureContextPack(await scanFixture());
    const cases = await loadFixtureEvalCases();
    const report = evaluateContextPack(contextPack, cases, {
      ...defaultPackEvalThresholds,
      hitAtK: 1.01
    });

    expect(() => enforcePackEvalGate(report)).toThrow("hitAtK");
  });

  it("rejects empty pack eval inputs", async () => {
    const contextPack = createFixtureContextPack(await scanFixture());
    const cases = await loadFixtureEvalCases();

    expect(() => evaluateContextPack({ ...contextPack, chunks: [] }, cases)).toThrow("requires at least one chunk");
    expect(() => evaluateContextPack(contextPack, [])).toThrow("requires at least one eval case");
  });
});

function scanFixture() {
  return scanRepository({
    repoRoot: fixtureRoot,
    commitSha: "fixture",
    startedAt: "2026-06-07T00:00:00.000Z",
    completedAt: "2026-06-07T00:00:00.000Z"
  });
}

function createFixtureContextPack(artifact: Awaited<ReturnType<typeof scanFixture>>) {
  return createContextPack(artifact, {
    sourceArtifactPath: "artifacts/code-graph/code-graph.json",
    generatedAt: "2026-06-08T00:00:00.000Z"
  });
}

function loadFixtureEvalCases() {
  return loadEvalCases(path.join(fixtureRoot, "eval/code-context-pack.eval.json"));
}

async function createTempRepo(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code-graph-scanner-"));
  temporaryDirectories.push(directory);
  return directory;
}
