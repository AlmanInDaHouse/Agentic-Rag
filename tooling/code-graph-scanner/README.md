# Code Graph Scanner

Local deterministic prototype for Code Graph v0.

## Commands

```bash
pnpm code-graph:scan
pnpm code-graph:check
pnpm code-graph:pack
pnpm code-graph:pack:check
```

`pnpm code-graph:scan` scans the repository root and writes:

```text
artifacts/code-graph/code-graph.json
```

The generated artifact directory is ignored by git. Optional CLI flags:

```bash
pnpm code-graph:scan -- --repo-root tooling/code-graph-fixtures/basic-api --out artifacts/code-graph/basic-api.json
pnpm code-graph:scan -- --max-file-size-bytes 262144
```

`pnpm code-graph:check` scans the synthetic fixture, normalizes the output and compares it with:

```text
tooling/code-graph-fixtures/basic-api/expected/code-graph.normalized.json
```

The check fails on unexpected fixture drift and is part of the main CI Validate workflow.

`pnpm code-graph:pack` reads:

```text
artifacts/code-graph/code-graph.json
```

and writes the derived context pack:

```text
artifacts/code-graph/code-context-pack.json
```

If the scanner artifact does not exist, run `pnpm code-graph:scan` first. The context pack is an intermediate local artifact for future Context Engine/RAG ingestion. It creates candidate documents and chunks only; it does not write to PostgreSQL or call the product runtime.

`pnpm code-graph:pack:check` scans the synthetic fixture, creates a context pack in memory, normalizes unstable fields and compares it with:

```text
tooling/code-graph-fixtures/basic-api/expected/code-context-pack.normalized.json
```

The pack check fails on unexpected context-pack drift and is part of the main CI Validate workflow.

## Output

The artifact contains:

- `scanRun`
- `files`
- `symbols`
- `edges`
- `warnings`

The context pack contains:

- `pack`
- `documents`
- `chunks`
- `warnings`

Context pack documents and chunks are generated for file summaries, symbol summaries, edge summaries, route summaries, migration summaries, test mapping summaries, documentation relationship summaries and warning summaries. Chunks are short structured text with metadata such as `generatedFrom`, `sourcePath`, `symbolName`, `symbolKind`, `edgeType`, `targetPath`, `confidence`, `scannerVersion` and `commitSha`.

IDs and paths are stable and repository-relative. Arrays are sorted by stable IDs. The scanner records timestamps for real scan runs, so tests and quality gates compare a normalized artifact without timestamps.

Normalization removes or stabilizes:

- `startedAt`,
- `completedAt`,
- file hashes,
- file sizes,
- full metadata that is not needed for fixture assertions.

Normalization preserves:

- relative paths,
- file classifications,
- symbol kind/export kind,
- edge type/source/target,
- confidence,
- warning code/path.

Context pack normalization removes `generatedAt` and preserves stable document/chunk ids, text, metadata, warning code/path and aggregate counts.

## Detection

The v0 prototype detects:

- relevant `.ts`, `.tsx`, `.sql`, `.md` and selected `.json` files,
- TypeScript static relative imports and simple exports,
- direct Fastify literal routes such as `fastify.get("/api/example", ...)`,
- services and repositories by path plus exported declarations,
- SQL migration table statements for `CREATE TABLE`, `ALTER TABLE` and `DROP TABLE`,
- tests through test naming/path conventions and direct imports,
- docs/spec/ADR links only from explicit path or filename mentions.

## Safety

The scanner:

- resolves paths against the configured repository root,
- rejects or warns for paths that escape the repository root,
- skips symlinks instead of following them,
- limits the maximum file size read,
- does not execute package scripts or repository code,
- does not import analyzed repository modules,
- does not connect to PostgreSQL,
- does not call providers, local models or external services,
- does not include full file contents in output.

## Limits

The scanner is intentionally conservative. It does not run the TypeScript compiler, evaluate dynamic imports, compute route paths, infer call graphs, inspect package dependency graphs, parse complex SQL or make broad documentation associations.

## Tests

```bash
pnpm test:code-graph-scanner
pnpm code-graph:check
pnpm code-graph:pack:check
```

Fixtures live under:

```text
tooling/code-graph-fixtures/basic-api/
```

The expected fixture output is a normalized JSON expectation at:

```text
tooling/code-graph-fixtures/basic-api/expected/code-graph.normalized.json
```

The expected context pack fixture output is:

```text
tooling/code-graph-fixtures/basic-api/expected/code-context-pack.normalized.json
```

When scanner or context pack behavior changes intentionally, update the relevant expected JSON in the same PR as the behavior change.

## Out of Scope

This scanner and context pack tooling does not persist Code Graph data, create migrations, expose API endpoints, integrate with the runtime or Context Engine, render dashboard views, implement GraphRAG, call external providers, require pgvector or include full source-file content in generated artifacts.
