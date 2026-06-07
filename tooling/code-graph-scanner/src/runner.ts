import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./scanner.js";

type CliOptions = {
  repoRoot: string;
  out: string;
  maxFileSizeBytes?: number;
};

const defaultOutputPath = "artifacts/code-graph/code-graph.json";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const artifact = await scanRepository({
    repoRoot: options.repoRoot,
    maxFileSizeBytes: options.maxFileSizeBytes
  });
  const outputPath = path.resolve(options.repoRoot, options.out);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stdout.write(`Code Graph artifact written to ${path.relative(path.resolve(options.repoRoot), outputPath).replaceAll("\\", "/")}\n`);
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    repoRoot: process.cwd(),
    out: defaultOutputPath
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--repo-root") {
      options.repoRoot = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--max-file-size-bytes") {
      const parsed = Number(requireValue(args, index, arg));
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--max-file-size-bytes must be a positive integer");
      }
      options.maxFileSizeBytes = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
