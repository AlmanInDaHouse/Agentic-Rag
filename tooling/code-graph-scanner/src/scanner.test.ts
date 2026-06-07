import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeArtifact } from "./normalize.js";
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
});

function scanFixture() {
  return scanRepository({
    repoRoot: fixtureRoot,
    commitSha: "fixture",
    startedAt: "2026-06-07T00:00:00.000Z",
    completedAt: "2026-06-07T00:00:00.000Z"
  });
}

async function createTempRepo(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "code-graph-scanner-"));
  temporaryDirectories.push(directory);
  return directory;
}
