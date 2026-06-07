import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContextPack } from "./contextPack.js";
import type { CodeGraphArtifact } from "./types.js";

type PackCliOptions = {
  repoRoot: string;
  artifact: string;
  out: string;
};

const currentFile = fileURLToPath(import.meta.url);
const defaultArtifactPath = "artifacts/code-graph/code-graph.json";
const defaultOutputPath = "artifacts/code-graph/code-context-pack.json";

async function main(): Promise<void> {
  const options = parsePackArgs(process.argv.slice(2));
  await runPack(options);
}

export async function runPack(options: PackCliOptions): Promise<void> {
  const repoRoot = await resolveRepoRoot(options.repoRoot);
  const artifactPath = await resolveInsideRepo(repoRoot, options.artifact, false);
  const outputPath = await resolveInsideRepo(repoRoot, options.out, false);

  let artifactJson: string;
  try {
    artifactJson = await fs.readFile(artifactPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Code Graph artifact not found at ${toRepoPath(repoRoot, artifactPath)}. Run pnpm code-graph:scan first.`);
    }
    throw error;
  }

  const artifact = JSON.parse(artifactJson) as CodeGraphArtifact;
  const contextPack = createContextPack(artifact, {
    sourceArtifactPath: toRepoPath(repoRoot, artifactPath)
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(contextPack, null, 2)}\n`, "utf8");
  process.stdout.write(`Code Graph context pack written to ${toRepoPath(repoRoot, outputPath)}\n`);
}

export function parsePackArgs(args: string[]): PackCliOptions {
  const options: PackCliOptions = {
    repoRoot: process.cwd(),
    artifact: defaultArtifactPath,
    out: defaultOutputPath
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo-root") {
      options.repoRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--artifact") {
      options.artifact = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function resolveRepoRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  const realResolved = await fs.realpath(resolved);
  const stats = await fs.stat(realResolved);
  if (!stats.isDirectory()) {
    throw new Error(`Code Graph context pack repo root is not a directory: ${input}`);
  }
  return realResolved;
}

async function resolveInsideRepo(repoRoot: string, input: string, mustExist: boolean): Promise<string> {
  const resolved = path.resolve(repoRoot, input);
  if (!isInside(repoRoot, resolved)) {
    throw new Error(`Code Graph context pack path escapes the repository: ${input}`);
  }
  if (mustExist) {
    const realResolved = await fs.realpath(resolved);
    if (!isInside(repoRoot, realResolved)) {
      throw new Error(`Code Graph context pack path escapes the repository: ${input}`);
    }
    return realResolved;
  }
  return resolved;
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function toRepoPath(repoRoot: string, input: string): string {
  return path.relative(repoRoot, input).replaceAll("\\", "/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

if (process.argv[1] !== undefined && currentFile === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
