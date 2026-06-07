import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeArtifact } from "./normalize.js";
import { scanRepository } from "./scanner.js";

type CheckOptions = {
  fixtureRoot: string;
  expectedPath: string;
};

const currentFile = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(currentFile), "../../..");
const defaultFixtureRoot = "tooling/code-graph-fixtures/basic-api";
const defaultExpectedPath = "expected/code-graph.normalized.json";

async function main(): Promise<void> {
  const options = await parseArgs(process.argv.slice(2));
  const artifact = await scanRepository({
    repoRoot: options.fixtureRoot,
    commitSha: "fixture",
    startedAt: "2026-06-07T00:00:00.000Z",
    completedAt: "2026-06-07T00:00:00.000Z"
  });
  const normalized = normalizeArtifact(artifact);
  const expected = JSON.parse(await fs.readFile(options.expectedPath, "utf8")) as unknown;

  const actualJson = `${JSON.stringify(normalized, null, 2)}\n`;
  const expectedJson = `${JSON.stringify(expected, null, 2)}\n`;

  if (actualJson !== expectedJson) {
    throw new Error(`Code Graph fixture output drifted from ${path.relative(workspaceRoot, options.expectedPath).replaceAll("\\", "/")}`);
  }

  process.stdout.write(`Code Graph fixture check passed for ${path.relative(workspaceRoot, options.fixtureRoot).replaceAll("\\", "/")}\n`);
}

async function parseArgs(args: string[]): Promise<CheckOptions> {
  let fixtureRoot = defaultFixtureRoot;
  let expectedPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fixture") {
      fixtureRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--expected") {
      expectedPath = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const resolvedFixtureRoot = await resolveInsideWorkspace(fixtureRoot);
  const resolvedExpectedPath = expectedPath === null
    ? await resolveInsideWorkspace(path.join(fixtureRoot, defaultExpectedPath))
    : await resolveInsideWorkspace(expectedPath);

  return {
    fixtureRoot: resolvedFixtureRoot,
    expectedPath: resolvedExpectedPath
  };
}

async function resolveInsideWorkspace(input: string): Promise<string> {
  const resolved = path.resolve(workspaceRoot, input);
  const realWorkspaceRoot = await fs.realpath(workspaceRoot);
  const realResolved = await fs.realpath(resolved);
  if (!isInside(realWorkspaceRoot, realResolved)) {
    throw new Error(`Code Graph check path escapes the repository: ${input}`);
  }
  return realResolved;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (process.argv[1] !== undefined && currentFile === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
