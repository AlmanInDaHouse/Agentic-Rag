import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export async function readFixture<T>(relativePath: string): Promise<T> {
  const content = await readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(content) as T;
}
