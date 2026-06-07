# Code Graph Scanner

Local deterministic prototype for Code Graph v0.

## Command

```bash
pnpm code-graph:scan
```

By default this scans the repository root and writes:

```text
artifacts/code-graph/code-graph.json
```

The generated artifact directory is ignored by git. Optional CLI flags:

```bash
pnpm code-graph:scan -- --repo-root tooling/code-graph-fixtures/basic-api --out artifacts/code-graph/basic-api.json
pnpm code-graph:scan -- --max-file-size-bytes 262144
```

## Output

The artifact contains:

- `scanRun`
- `files`
- `symbols`
- `edges`
- `warnings`

IDs and paths are stable and repository-relative. Arrays are sorted by stable IDs. The scanner records timestamps for real scan runs, so tests compare a normalized artifact without timestamps.

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
```

Fixtures live under:

```text
tooling/code-graph-fixtures/basic-api/
```

The expected fixture output is a normalized JSON expectation at:

```text
tooling/code-graph-fixtures/basic-api/expected/code-graph.normalized.json
```
