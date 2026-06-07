import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CodeGraphArtifact,
  CodeGraphEdge,
  CodeGraphFile,
  CodeGraphSymbol,
  CodeGraphWarning,
  ScanOptions
} from "./types.js";

const scannerVersion = "code-graph-scanner-v0" as const;
const defaultMaxFileSizeBytes = 256 * 1024;
const ignoredDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".playwright-mcp"
]);
const ignoredRelativeDirectories = new Set([
  "artifacts/code-graph",
  "reports/retrieval-eval"
]);
const supportedExtensions = new Set([".ts", ".tsx", ".sql", ".md", ".json"]);

type ReadFileRecord = {
  file: CodeGraphFile;
  content: string;
};

export async function scanRepository(options: ScanOptions): Promise<CodeGraphArtifact> {
  const repoRoot = await resolveRepoRoot(options.repoRoot);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? defaultMaxFileSizeBytes;
  const startedAt = options.startedAt ?? new Date().toISOString();
  const warnings: CodeGraphWarning[] = [];
  const filesSkipped = { count: 0 };
  const records = await collectFiles({
    currentDir: repoRoot,
    repoRoot,
    maxFileSizeBytes,
    filesSkipped,
    warnings
  });
  const fileByPath = new Map(records.map((record) => [record.file.path, record.file]));
  const symbols: CodeGraphSymbol[] = [];
  const edges: CodeGraphEdge[] = [];

  for (const record of records) {
    if (record.file.language === "typescript" || record.file.language === "tsx") {
      analyzeTypeScript(record, fileByPath, symbols, edges, warnings);
    }
    if (record.file.language === "sql" && record.file.isMigration) {
      analyzeSql(record, symbols, edges);
    }
  }

  analyzeDocs(records, fileByPath, edges);

  return {
    scanRun: {
      scannerVersion,
      repoRoot: ".",
      commitSha: options.commitSha ?? await readGitCommitSha(repoRoot),
      status: "completed",
      startedAt,
      completedAt: options.completedAt ?? new Date().toISOString(),
      filesScanned: records.length,
      filesSkipped: filesSkipped.count
    },
    files: records.map((record) => record.file).sort(compareById),
    symbols: dedupeById(symbols).sort(compareById),
    edges: dedupeById(edges).sort(compareById),
    warnings: dedupeWarnings(warnings).sort(compareWarnings)
  };
}

async function resolveRepoRoot(input: string): Promise<string> {
  const resolved = path.resolve(input);
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) {
    throw new Error(`Code Graph scanner repo root is not a directory: ${input}`);
  }
  return resolved;
}

async function collectFiles(input: {
  currentDir: string;
  repoRoot: string;
  maxFileSizeBytes: number;
  filesSkipped: { count: number };
  warnings: CodeGraphWarning[];
}): Promise<ReadFileRecord[]> {
  const entries = await fs.readdir(input.currentDir, { withFileTypes: true });
  const records: ReadFileRecord[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(input.currentDir, entry.name);
    const relativePath = toRepoPath(input.repoRoot, absolutePath);
    if (!isInsideRepo(input.repoRoot, absolutePath)) {
      input.filesSkipped.count += 1;
      input.warnings.push(warning("path_outside_repo", relativePath, "Skipped a path that resolved outside the repository root."));
      continue;
    }

    if (entry.isSymbolicLink()) {
      input.filesSkipped.count += 1;
      const target = await fs.readlink(absolutePath).catch(() => null);
      const resolvedTarget = target === null ? null : path.resolve(path.dirname(absolutePath), target);
      const code = resolvedTarget !== null && !isInsideRepo(input.repoRoot, resolvedTarget)
        ? "symlink_outside_repo"
        : "symlink_skipped";
      input.warnings.push(warning(code, relativePath, "Skipped a symbolic link without following it."));
      continue;
    }

    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name) || ignoredRelativeDirectories.has(relativePath)) {
        continue;
      }
      records.push(...await collectFiles({
        currentDir: absolutePath,
        repoRoot: input.repoRoot,
        maxFileSizeBytes: input.maxFileSizeBytes,
        filesSkipped: input.filesSkipped,
        warnings: input.warnings
      }));
      continue;
    }

    if (!entry.isFile() || !isRelevantFile(relativePath)) {
      continue;
    }

    const stats = await fs.stat(absolutePath);
    if (stats.size > input.maxFileSizeBytes) {
      input.filesSkipped.count += 1;
      input.warnings.push(warning("file_too_large", relativePath, "Skipped a relevant file because it exceeded the scanner file size limit."));
      continue;
    }

    const bytes = await fs.readFile(absolutePath);
    const content = bytes.toString("utf8");
    records.push({
      file: toCodeGraphFile(relativePath, bytes, stats.size),
      content
    });
  }

  return records;
}

function isRelevantFile(relativePath: string): boolean {
  const ext = path.posix.extname(relativePath);
  if (!supportedExtensions.has(ext)) {
    return false;
  }
  if (ext !== ".json") {
    return true;
  }
  const baseName = path.posix.basename(relativePath);
  return baseName === "package.json" || /^tsconfig(?:\..*)?\.json$/.test(baseName);
}

function toCodeGraphFile(relativePath: string, bytes: Buffer, sizeBytes: number): CodeGraphFile {
  const language = languageForPath(relativePath);
  const flags = flagsForPath(relativePath);
  return {
    id: fileId(relativePath),
    path: relativePath,
    packageName: packageNameForPath(relativePath),
    language,
    fileKind: fileKindForPath(relativePath, language, flags),
    hash: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes,
    isTest: flags.isTest,
    isMigration: flags.isMigration,
    isSpec: flags.isSpec,
    isAdr: flags.isAdr,
    metadata: {}
  };
}

function analyzeTypeScript(
  record: ReadFileRecord,
  fileByPath: Map<string, CodeGraphFile>,
  symbols: CodeGraphSymbol[],
  edges: CodeGraphEdge[],
  warnings: CodeGraphWarning[]
): void {
  const imports = extractStaticImportSources(record.content);
  for (const importSource of imports) {
    if (!importSource.startsWith(".")) {
      continue;
    }
    const targetFile = resolveImport(record.file.path, importSource, fileByPath);
    if (targetFile === "outside") {
      warnings.push(warning("unsafe_import_path", record.file.path, "Skipped a relative import that resolves outside the repository root."));
      continue;
    }
    if (targetFile === null) {
      warnings.push(warning("unresolved_relative_import", record.file.path, `Could not resolve relative import ${importSource}.`));
      continue;
    }
    edges.push(edge({
      sourceType: "file",
      sourceId: record.file.id,
      targetType: "file",
      targetId: targetFile.id,
      edgeType: "imports",
      confidence: 1,
      metadata: { importSource, evidence: "static relative import" }
    }));
    if (record.file.isTest && !targetFile.isTest) {
      edges.push(edge({
        sourceType: "file",
        sourceId: record.file.id,
        targetType: "file",
        targetId: targetFile.id,
        edgeType: "tests",
        confidence: 1,
        metadata: { evidence: "test file imports source file" }
      }));
    }
  }

  for (const dynamicImport of extractDynamicImports(record.content)) {
    warnings.push(warning("unsupported_dynamic_import", record.file.path, `Dynamic import ${dynamicImport} was not resolved because it may require runtime evaluation.`));
  }

  for (const exportedSymbol of extractExports(record.content, record.file.path)) {
    const symbol = symbolForExport(record.file, exportedSymbol);
    symbols.push(symbol);
    edges.push(edge({
      sourceType: "file",
      sourceId: record.file.id,
      targetType: "symbol",
      targetId: symbol.id,
      edgeType: "exports",
      confidence: symbol.confidence,
      metadata: { evidence: "static export declaration", exportKind: symbol.exportKind }
    }));
  }

  for (const reexport of extractReexports(record.content)) {
    const targetFile = resolveImport(record.file.path, reexport.importSource, fileByPath);
    if (targetFile !== null && targetFile !== "outside") {
      edges.push(edge({
        sourceType: "file",
        sourceId: record.file.id,
        targetType: "file",
        targetId: targetFile.id,
        edgeType: "exports",
        confidence: 1,
        metadata: { evidence: "static re-export declaration", exportKind: "reexport", importSource: reexport.importSource }
      }));
    }
  }

  for (const route of extractRoutes(record.content)) {
    symbols.push({
      id: symbolId(record.file.path, "route", `${route.method}:${route.routePath}`),
      fileId: record.file.id,
      name: `${route.method} ${route.routePath}`,
      symbolKind: "route",
      exportKind: "none",
      startLine: route.line,
      endLine: route.line,
      visibility: "public",
      confidence: 1,
      metadata: {
        routeMethod: route.method,
        routePath: route.routePath,
        evidence: "direct Fastify literal route declaration"
      }
    });
  }
}

function analyzeSql(record: ReadFileRecord, symbols: CodeGraphSymbol[], edges: CodeGraphEdge[]): void {
  const tablePattern = /^\s*(CREATE|ALTER|DROP)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+([`"\[]?[\w.]+[`"\]]?)/gim;
  for (const match of record.content.matchAll(tablePattern)) {
    const operation = match[1].toUpperCase();
    const tableName = match[2].replace(/^[`"\[]|[`"\]]$/g, "");
    const line = lineForIndex(record.content, match.index ?? 0);
    const symbol: CodeGraphSymbol = {
      id: symbolId(record.file.path, "migration", `${operation}:${tableName}`),
      fileId: record.file.id,
      name: `${operation} TABLE ${tableName}`,
      symbolKind: "migration",
      exportKind: "none",
      startLine: line,
      endLine: line,
      visibility: "internal",
      confidence: 1,
      metadata: { operation, tableName, evidence: "literal SQL table statement" }
    };
    symbols.push(symbol);
    edges.push(edge({
      sourceType: "file",
      sourceId: record.file.id,
      targetType: "symbol",
      targetId: symbol.id,
      edgeType: "migrates",
      confidence: 1,
      metadata: { operation, tableName, evidence: "literal SQL table statement" }
    }));
  }
}

function analyzeDocs(records: ReadFileRecord[], fileByPath: Map<string, CodeGraphFile>, edges: CodeGraphEdge[]): void {
  const targetFiles = Array.from(fileByPath.values())
    .filter((file) => !file.isAdr && !file.isSpec && file.fileKind !== "documentation")
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const record of records.filter((candidate) => candidate.file.isAdr || candidate.file.isSpec || candidate.file.fileKind === "documentation")) {
    const normalizedContent = record.content.replaceAll("\\", "/");
    for (const targetFile of targetFiles) {
      const basename = path.posix.basename(targetFile.path);
      if (normalizedContent.includes(targetFile.path) || normalizedContent.includes(basename)) {
        edges.push(edge({
          sourceType: "document",
          sourceId: record.file.id,
          targetType: "file",
          targetId: targetFile.id,
          edgeType: "documents",
          confidence: normalizedContent.includes(targetFile.path) ? 0.8 : 0.6,
          metadata: {
            evidence: normalizedContent.includes(targetFile.path) ? "explicit repository path mention" : "explicit file name mention"
          }
        }));
      }
    }
  }
}

function extractStaticImportSources(content: string): string[] {
  const sources: string[] = [];
  const importFromPattern = /\bimport\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g;
  const sideEffectPattern = /\bimport\s+["']([^"']+)["']/g;
  const exportFromPattern = /\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g;
  for (const pattern of [importFromPattern, sideEffectPattern, exportFromPattern]) {
    for (const match of content.matchAll(pattern)) {
      sources.push(match[1]);
    }
  }
  return sources;
}

function extractDynamicImports(content: string): string[] {
  return Array.from(content.matchAll(/\bimport\s*\(\s*([^)]+)\s*\)/g)).map((match) => sanitizeSnippet(match[1]));
}

function extractExports(content: string, relativePath: string): Array<{
  name: string;
  kind: CodeGraphSymbol["symbolKind"];
  exportKind: CodeGraphSymbol["exportKind"];
  line: number;
}> {
  const exports: Array<{
    name: string;
    kind: CodeGraphSymbol["symbolKind"];
    exportKind: CodeGraphSymbol["exportKind"];
    line: number;
  }> = [];
  const declarations = [
    { pattern: /\bexport\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: "function" as const, exportKind: "named" as const, nameGroup: 2 },
    { pattern: /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g, kind: "class" as const, exportKind: "named" as const, nameGroup: 1 },
    { pattern: /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, kind: "const" as const, exportKind: "named" as const, nameGroup: 1 },
    { pattern: /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g, kind: "type" as const, exportKind: "type" as const, nameGroup: 1 },
    { pattern: /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g, kind: "interface" as const, exportKind: "type" as const, nameGroup: 1 },
    { pattern: /\bexport\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?/g, kind: "function" as const, exportKind: "default" as const, nameGroup: 1 },
    { pattern: /\bexport\s+default\s+class\s+([A-Za-z_$][\w$]*)?/g, kind: "class" as const, exportKind: "default" as const, nameGroup: 1 }
  ];

  for (const declaration of declarations) {
    for (const match of content.matchAll(declaration.pattern)) {
      const fallbackName = path.posix.basename(relativePath).replace(/\.[^.]+$/, "");
      exports.push({
        name: match[declaration.nameGroup] || "default",
        kind: declaration.kind,
        exportKind: declaration.exportKind,
        line: lineForIndex(content, match.index ?? 0)
      });
      if (declaration.exportKind === "default" && match[declaration.nameGroup] === undefined) {
        exports[exports.length - 1].name = fallbackName;
      }
    }
  }

  return exports;
}

function extractReexports(content: string): Array<{ importSource: string }> {
  return Array.from(content.matchAll(/\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g))
    .map((match) => ({ importSource: match[1] }));
}

function extractRoutes(content: string): Array<{ method: string; routePath: string; line: number }> {
  const routes: Array<{ method: string; routePath: string; line: number }> = [];
  const routePattern = /\b(?:app|fastify)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/g;
  for (const match of content.matchAll(routePattern)) {
    routes.push({
      method: match[1].toUpperCase(),
      routePath: match[2],
      line: lineForIndex(content, match.index ?? 0)
    });
  }
  return routes;
}

function symbolForExport(
  file: CodeGraphFile,
  exportedSymbol: { name: string; kind: CodeGraphSymbol["symbolKind"]; exportKind: CodeGraphSymbol["exportKind"]; line: number }
): CodeGraphSymbol {
  const pathBasedKind = symbolKindForExport(file.path, exportedSymbol.kind);
  return {
    id: symbolId(file.path, pathBasedKind, exportedSymbol.name),
    fileId: file.id,
    name: exportedSymbol.name,
    symbolKind: pathBasedKind,
    exportKind: exportedSymbol.exportKind,
    startLine: exportedSymbol.line,
    endLine: exportedSymbol.line,
    visibility: exportedSymbol.exportKind === "default" || exportedSymbol.exportKind === "named" || exportedSymbol.exportKind === "type"
      ? "public"
      : "internal",
    confidence: 1,
    metadata: { evidence: "static export declaration" }
  };
}

function symbolKindForExport(relativePath: string, fallback: CodeGraphSymbol["symbolKind"]): CodeGraphSymbol["symbolKind"] {
  const normalized = relativePath.toLowerCase();
  if (/(^|\/)(services?|service)(\/|$)/.test(normalized) || /service\.(ts|tsx)$/.test(normalized)) {
    return "service";
  }
  if (/(^|\/)(repositories?|repository|repo)(\/|$)/.test(normalized) || /(repository|repo)\.(ts|tsx)$/.test(normalized)) {
    return "repository";
  }
  return fallback;
}

function resolveImport(sourcePath: string, importSource: string, fileByPath: Map<string, CodeGraphFile>): CodeGraphFile | null | "outside" {
  const sourceDir = path.posix.dirname(sourcePath);
  const unresolved = path.posix.normalize(path.posix.join(sourceDir, importSource));
  if (unresolved.startsWith("../") || unresolved === "..") {
    return "outside";
  }
  const candidates = [
    unresolved,
    ...sourceCandidatesForJsSpecifier(unresolved),
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    `${unresolved}.json`,
    path.posix.join(unresolved, "index.ts"),
    path.posix.join(unresolved, "index.tsx")
  ];
  for (const candidate of candidates) {
    const file = fileByPath.get(candidate);
    if (file !== undefined) {
      return file;
    }
  }
  return null;
}

function sourceCandidatesForJsSpecifier(unresolved: string): string[] {
  if (!unresolved.endsWith(".js")) {
    return [];
  }
  const withoutJs = unresolved.slice(0, -3);
  return [`${withoutJs}.ts`, `${withoutJs}.tsx`];
}

function edge(input: Omit<CodeGraphEdge, "id">): CodeGraphEdge {
  return {
    id: `edge:${input.edgeType}:${stableSegment(input.sourceId)}:${stableSegment(input.targetId)}`,
    ...input
  };
}

function fileId(relativePath: string): string {
  return `file:${relativePath}`;
}

function symbolId(relativePath: string, kind: string, name: string): string {
  return `symbol:${relativePath}:${kind}:${stableSegment(name)}`;
}

function stableSegment(value: string): string {
  return value
    .replace(/^file:/, "")
    .replace(/^symbol:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9/._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function flagsForPath(relativePath: string): Pick<CodeGraphFile, "isTest" | "isMigration" | "isSpec" | "isAdr"> {
  const normalized = relativePath.toLowerCase();
  return {
    isTest: /(^|\/)(__tests__|tests)(\/|$)/.test(normalized) || /\.(test|spec)\.tsx?$/.test(normalized),
    isMigration: normalized.endsWith(".sql") && (/(^|\/)migrations?\//.test(normalized) || normalized.startsWith("infra/sql/")),
    isSpec: normalized.startsWith("docs/specs/") && normalized.endsWith(".md"),
    isAdr: normalized.startsWith("docs/adr/") && normalized.endsWith(".md")
  };
}

function fileKindForPath(
  relativePath: string,
  language: CodeGraphFile["language"],
  flags: Pick<CodeGraphFile, "isTest" | "isMigration" | "isSpec" | "isAdr">
): CodeGraphFile["fileKind"] {
  if (flags.isTest) {
    return "test";
  }
  if (flags.isMigration) {
    return "migration";
  }
  if (flags.isSpec) {
    return "spec";
  }
  if (flags.isAdr) {
    return "adr";
  }
  if (relativePath.startsWith("tooling/code-graph-fixtures/")) {
    return "fixture";
  }
  if (language === "markdown") {
    return "documentation";
  }
  if (language === "json") {
    return "config";
  }
  if (language === "typescript" || language === "tsx") {
    return "source";
  }
  return "unknown";
}

function languageForPath(relativePath: string): CodeGraphFile["language"] {
  const ext = path.posix.extname(relativePath);
  if (ext === ".tsx") {
    return "tsx";
  }
  if (ext === ".ts") {
    return "typescript";
  }
  if (ext === ".sql") {
    return "sql";
  }
  if (ext === ".md") {
    return "markdown";
  }
  return "json";
}

function packageNameForPath(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return null;
}

function lineForIndex(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).replaceAll("\\", "/");
}

function isInsideRepo(repoRoot: string, absolutePath: string): boolean {
  const relative = path.relative(repoRoot, absolutePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function warning(code: string, warningPath: string | null, message: string): CodeGraphWarning {
  return {
    code,
    path: warningPath,
    message,
    severity: "warning"
  };
}

function sanitizeSnippet(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

async function readGitCommitSha(repoRoot: string): Promise<string> {
  const gitDir = path.join(repoRoot, ".git");
  const headPath = path.join(gitDir, "HEAD");
  try {
    const head = (await fs.readFile(headPath, "utf8")).trim();
    if (/^[a-f0-9]{40}$/i.test(head)) {
      return head;
    }
    const refMatch = /^ref:\s+(.+)$/.exec(head);
    if (refMatch === null) {
      return "unknown";
    }
    const refPath = path.join(gitDir, refMatch[1]);
    const resolvedRefPath = path.resolve(refPath);
    if (!isInsideRepo(gitDir, resolvedRefPath)) {
      return "unknown";
    }
    const ref = (await fs.readFile(resolvedRefPath, "utf8")).trim();
    return /^[a-f0-9]{40}$/i.test(ref) ? ref : "unknown";
  } catch {
    return "unknown";
  }
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function dedupeWarnings(warnings: CodeGraphWarning[]): CodeGraphWarning[] {
  return Array.from(new Map(warnings.map((item) => [`${item.code}:${item.path}:${item.message}`, item])).values());
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function compareWarnings(left: CodeGraphWarning, right: CodeGraphWarning): number {
  return `${left.path ?? ""}:${left.code}`.localeCompare(`${right.path ?? ""}:${right.code}`);
}
