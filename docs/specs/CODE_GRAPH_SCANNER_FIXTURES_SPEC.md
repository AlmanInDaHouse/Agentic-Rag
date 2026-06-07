# Code Graph Scanner Fixtures Spec

## Purpose

Define how a future Code Graph v0 scanner will be validated before implementing persistence, endpoints, dashboard views, runtime integration or GraphRAG.

Milestone 1.6B is a design milestone. It specifies synthetic fixtures, expected scanner output, detector expectations, quality gates, confidence thresholds and safety constraints for a future deterministic local scanner. It does not build the scanner.

The validation goal is to prove that scanner output is reproducible, conservative and auditable for a known synthetic repository shape before the project stores graph data or uses graph relationships in RAG.

## Non-Goals

Milestone 1.6B does not include:

- scanner implementation,
- CLI commands,
- API endpoints,
- SQL migrations,
- runtime integration,
- Context Engine integration,
- GraphRAG,
- dashboard changes,
- external providers,
- real models,
- code execution,
- new dependencies,
- filesystem adapters exposed through the product API,
- generated reports committed as source of truth.

## Fixture Strategy

Future scanner validation should use synthetic repository fixtures. Fixtures must be small, deterministic and safe to commit. They must not include real user data, production logs, customer data, credentials or live secrets.

The first fixture set should model a minimal TypeScript/Fastify repository with enough structure to exercise Code Graph v0 entities and edge types:

- TypeScript imports,
- TypeScript exports,
- Fastify route detection,
- service detection,
- repository detection,
- migration detection,
- test mapping,
- docs/spec/ADR mapping,
- ignored files,
- ambiguous files,
- unsupported patterns.

Fixture design principles:

- keep each fixture focused on one or two scanner behaviors,
- use stable file names and simple source code snippets,
- make expected graph output explicit in JSON,
- prefer deterministic IDs or stable fixture-local IDs,
- record warnings for omitted ambiguous patterns,
- keep false positives visible by comparing expected and actual edges,
- avoid relying on TypeScript compilation, package scripts or database setup.

The scanner should be evaluated against expected JSON artifacts rather than by visual inspection. The expected artifact should represent the accepted graph for the fixture and should omit edges that are intentionally too weak to trust.

Milestone 1.6D implements the initial executable fixture gate with:

```bash
pnpm code-graph:check
```

The command scans the synthetic fixture, normalizes unstable fields and compares the result against:

```text
tooling/code-graph-fixtures/basic-api/expected/code-graph.normalized.json
```

## Proposed Fixture Layout

Future fixtures may live under:

```text
tooling/code-graph-fixtures/
  basic-api/
    apps/api/src/routes/
    apps/api/src/services/
    apps/api/src/repositories/
    apps/api/src/__tests__/
    packages/shared/src/
    infra/sql/
    docs/specs/
    docs/adr/
    ignored/
    ambiguous/
    expected/
      code-graph.json
```

Milestone 1.6B only defines this layout. It does not require creating all physical fixture files.

If the project later favors documentation-only examples before executable fixtures, fixture narratives may live under:

```text
docs/fixtures/code-graph/
```

The preferred implementation path is still a source-controlled synthetic fixture tree plus expected JSON, because it gives future tests a reproducible input and output pair.

## Expected Output JSON Shape

The future scanner should emit a JSON artifact that mirrors the conceptual entities from `docs/specs/CODE_GRAPH_SPEC.md`.

Top-level shape:

```json
{
  "scanRun": {
    "scannerVersion": "code-graph-scanner-v0",
    "repoRoot": ".",
    "commitSha": "fixture",
    "status": "completed",
    "filesScanned": 0,
    "filesSkipped": 0
  },
  "files": [],
  "symbols": [],
  "edges": [],
  "warnings": []
}
```

Example file record:

```json
{
  "id": "file:apps/api/src/routes/goals.ts",
  "path": "apps/api/src/routes/goals.ts",
  "packageName": "apps/api",
  "fileKind": "source",
  "language": "typescript",
  "hash": "fixture-hash",
  "sizeBytes": 512,
  "isTest": false,
  "isMigration": false,
  "isSpec": false,
  "isAdr": false,
  "metadata": {
    "fixture": "basic-api"
  }
}
```

Example symbol record:

```json
{
  "id": "symbol:apps/api/src/routes/goals.ts:registerGoalRoutes",
  "fileId": "file:apps/api/src/routes/goals.ts",
  "name": "registerGoalRoutes",
  "symbolKind": "route",
  "exportKind": "named",
  "startLine": 4,
  "endLine": 18,
  "visibility": "public",
  "confidence": 1.0,
  "metadata": {
    "routeMethod": "POST",
    "routePath": "/api/goals"
  }
}
```

Example edge record:

```json
{
  "id": "edge:imports:routes-goals-to-goal-service",
  "sourceType": "file",
  "sourceId": "file:apps/api/src/routes/goals.ts",
  "targetType": "file",
  "targetId": "file:apps/api/src/services/goalService.ts",
  "edgeType": "imports",
  "confidence": 1.0,
  "metadata": {
    "evidence": "static relative import"
  }
}
```

Example warning:

```json
{
  "code": "unsupported_dynamic_import",
  "path": "ambiguous/dynamicImport.ts",
  "message": "Dynamic import target was not resolved because it requires runtime evaluation.",
  "severity": "warning"
}
```

JSON rules:

- paths must be repository-relative,
- confidence values must be bounded `0..1`,
- output ordering must be deterministic,
- warnings must not include full file contents or secret-like values,
- generated runtime reports are not committed by default,
- expected fixture artifacts may be committed as source-of-truth expectations.

## Detection Expectations

### Imports and Exports

Expected detection:

- detect static relative TypeScript imports,
- detect simple named exports,
- detect default exports when directly declared,
- detect type-only exports when syntax is explicit,
- resolve relative imports to repository files when deterministic.

Expected omissions:

- do not resolve complex external dependency graphs,
- do not execute module resolution code,
- do not infer dynamic imports that require runtime values,
- do not follow imports outside the repository root,
- skip ambiguous barrel re-exports unless the target is deterministic.

Expected fixture cases:

- `service.ts` exports a named function,
- `route.ts` imports that service through a relative path,
- `index.ts` re-exports a known symbol,
- `dynamic.ts` uses a dynamic import and produces a warning instead of an edge.

### Fastify Routes

Expected detection:

- detect direct Fastify route declarations with literal method and path,
- classify route symbols with `symbolKind: route`,
- store method and path in metadata when both are literal,
- link route files to imported services only when imports are clear.

Confidence guidance:

- `1.0` for direct `fastify.get("/path", handler)` or equivalent literal declarations,
- `0.8` for a direct route registration helper with literal method/path,
- lower confidence for indirection that is still structurally clear.

Expected omissions:

- omit routes that require executing code to compute method or path,
- do not evaluate environment variables, function calls or template expressions,
- do not claim route-to-service calls without import or direct reference evidence.

### Services and Repositories

Expected detection:

- detect services by path conventions such as `apps/api/src/services`,
- detect repositories by path conventions such as `apps/api/src/repositories`,
- detect exported service/repository classes or functions by naming and location,
- classify symbols with `symbolKind: service` or `symbolKind: repository` when evidence is clear.

Expected omissions:

- do not assume architecture from naming alone when path evidence is absent,
- do not infer repository ownership from comments or vague domain terms,
- do not create call edges unless a reference is structurally resolvable.

### Migrations

Expected detection:

- detect migration files by path and naming under `infra/sql` or another accepted migration directory,
- classify migration files with `fileKind: migration`,
- classify clear migration symbols or file records with `symbolKind: migration`,
- extract simple table references only when they are literal and easy to audit.

Expected omissions:

- do not execute SQL,
- do not connect to PostgreSQL,
- do not infer complex schema semantics,
- do not parse dynamic SQL or procedural control flow aggressively.

### Tests

Expected detection:

- map tests to source files through imports,
- map same-basename tests to nearby source files when path evidence is strong,
- classify test files with `fileKind: test`,
- emit `tests` edges with explicit confidence.

Confidence guidance:

- `1.0` for a test importing the target source file directly,
- `0.8` for same-basename and same-directory test mapping,
- `0.6` for strong path convention plus matching exported symbol name.

Expected omissions:

- do not claim behavioral coverage,
- do not map all imported helper files as covered source,
- omit weak mappings below the persistence threshold.

### Docs, Specs and ADR Mapping

Expected detection:

- classify docs under `docs/specs` as specs,
- classify docs under `docs/adr` as ADRs,
- map docs to code when explicit paths, stable entity names or ADR/spec references are present,
- assign lower confidence to documentation-derived edges than code-derived edges unless evidence is direct.

Expected omissions:

- do not create broad docs-to-code edges from vague keyword overlap,
- do not let documentation edges override code-derived structure,
- do not infer human ownership without explicit repository evidence.

### Ignored and Unsupported Patterns

Future fixtures should include ignored and unsupported cases:

- generated output directories,
- oversized files,
- `node_modules`-like paths,
- symlinks that point outside the repository,
- dynamic imports,
- computed route paths,
- SQL requiring execution or database metadata,
- ambiguous documentation references.

Expected behavior:

- ignored files should increment skip counts or warnings,
- unsupported patterns should warn when useful for auditability,
- omitted edges should not appear in `edges`,
- warnings should explain the scanner decision without exposing sensitive content.

## Quality Gates

Future scanner validation should define deterministic gates before scanner output is trusted by persistence or RAG.

Initial gate candidates:

```text
deterministic_output
no_external_files_read
no_code_execution
expected_files_detected
expected_symbols_detected
expected_edges_detected
unsupported_patterns_warned
false_positive_budget
confidence_required_for_ambiguous_edges
```

Gate meanings:

- `deterministic_output`: repeated scans of the same fixture produce byte-stable normalized JSON.
- `no_external_files_read`: scanner reads only paths under the fixture repository root.
- `no_code_execution`: scanner does not run package scripts, shell commands, TypeScript compilation as a semantic requirement or dynamic imports.
- `expected_files_detected`: all expected file records exist with correct classification.
- `expected_symbols_detected`: all expected symbols exist with correct kind and confidence range.
- `expected_edges_detected`: all required edges exist with correct type and endpoints.
- `unsupported_patterns_warned`: unsupported fixture cases produce expected warnings.
- `false_positive_budget`: unexpected high-confidence edges must be zero for the initial fixtures.
- `confidence_required_for_ambiguous_edges`: ambiguous edges below the persistence threshold must be omitted or warning-only.

Initial blocking behavior should be conservative:

- missing expected files, symbols or high-confidence edges should block,
- unexpected high-confidence edges should block,
- warnings may be required for known unsupported patterns,
- low-confidence exploratory output should not be persisted by default.

The first executable quality gate is intentionally narrow: it blocks on normalized fixture drift and deterministic scanner behavior, but it does not persist graph data or prove semantic correctness.

## Confidence Model

Scanner confidence must be explicit for symbols and edges. It should describe evidence strength, not truth.

Recommended levels:

```text
1.0: direct explicit relationship, such as a static relative import or literal route declaration.
0.8: strong structural relationship, such as clear path plus direct import or same-basename test mapping.
0.6: strong heuristic relationship, such as path convention plus matching exported symbol name.
<0.6: too weak to persist by default; emit as warning or omit.
```

Rules:

- confidence must be bounded `0..1`,
- code-derived evidence should generally outrank documentation-derived evidence,
- ambiguous docs/spec/ADR mappings should not exceed `0.6` without explicit path or symbol evidence,
- call edges should require stronger evidence than file classification,
- the future scanner should prefer false negatives over noisy false positives,
- thresholds should be versioned with the scanner or expected fixture artifact.

Default persistence recommendation:

- persist `>= 0.6` only when the edge type allows heuristic evidence,
- persist `calls` only when confidence is `>= 0.8`,
- persist docs-derived `documents` edges only when confidence is `>= 0.6`,
- emit warning-only records for useful observations below threshold.

## Safety Constraints

The future scanner must preserve the safety boundaries from the Code Graph, Context Engine, RAG and Safe Execution Policy specs.

Scanner validation must assert:

- no reading outside the repository root,
- no following symlinks outside the repository root,
- no shell commands,
- no package scripts,
- no code execution,
- no dynamic code loading,
- no database connections,
- no external providers,
- no local model calls,
- no real embeddings,
- no GraphRAG,
- no filesystem source adapter exposed through the product API,
- no full sensitive file content in output,
- no logging of secret-like values,
- no path around Safe Execution Policy,
- no changes to runtime agent behavior.

If fixture content includes secret-like placeholders, they must be synthetic and safe. Expected outputs should assert that warnings and metadata do not include the original placeholder values unless a future data policy explicitly allows it.

## Acceptance Criteria for Milestone 1.6B

- Scanner fixture validation strategy is documented.
- Future fixture layout is proposed.
- Expected scanner output JSON shape is documented.
- Detector expectations are documented for imports, exports, routes, services, repositories, migrations, tests and docs.
- Quality gates are documented.
- Confidence thresholds are documented.
- Safety constraints are explicit.
- No scanner, CLI, endpoint, migration, runtime integration, dashboard change, workflow change or dependency is added.
- No new ADR is required unless a future milestone changes the architecture beyond ADR 0025.

## Open Questions

- Should executable scanner fixtures live under `tooling/code-graph-fixtures` or documentation examples under `docs/fixtures/code-graph` first?
- Should the first scanner emit JSON artifacts before any PostgreSQL persistence is designed?
- How should graph snapshots be compared without noise from IDs, ordering, hashes or line-number drift?
- Should expected fixture IDs be stable strings, derived paths or generated UUIDs normalized during comparison?
- What is the minimum false-positive budget for docs/spec/ADR mapping before graph output can feed retrieval?
- How should large monorepos configure include/exclude patterns and maximum file size?
- Should scanner warnings become part of a versioned baseline like retrieval evaluation thresholds?
- How should generated files, build outputs and vendored dependencies be excluded consistently?
- Should future Code Graph quality gates run in required CI or remain manual until scanner output stabilizes?
- What fixture coverage is required before GraphRAG can be reconsidered?

