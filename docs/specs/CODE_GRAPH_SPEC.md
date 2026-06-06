# Code Graph Spec

## Objective

Define Code Graph v0 for TriForge Agentic Lab: a derived, reproducible and safe structural representation of this repository.

The Code Graph is intended to improve code context, auditability and future RAG/GraphRAG capabilities by describing repository structure without executing code, calling models, requiring pgvector or reading outside the repository.

This milestone is design-only. It creates no scanner, no storage, no API, no dashboard and no runtime behavior.

## Scope v0

Code Graph v0 should model, in a future milestone:

- files,
- TypeScript imports and exports,
- Fastify API routes,
- services,
- repositories,
- tests,
- migrations,
- internal package dependencies,
- relationships between specs, ADRs, docs and code.

The graph should be conservative and reproducible. When scanner confidence is low, v0 should prefer omitting an edge over creating aggressive false positives that could pollute future retrieval context.

## Non-Goals

Milestone 1.6A does not include:

- scanner implementation,
- GraphRAG,
- real adapters,
- real models,
- code execution,
- reading outside the repository,
- following symlinks outside the repository,
- complex semantic analysis,
- new endpoints,
- dashboard changes,
- SQL migrations,
- new dependencies,
- package/shared contract changes,
- runtime integration,
- agent actions.

## Conceptual Entities

These entities are design targets only. Do not create migrations in this milestone.

### `code_scan_runs`

Purpose:

- record one reproducible scan of the repository,
- bind graph output to a repository root, commit and scanner version,
- make skipped files, warnings and errors auditable.

Conceptual fields:

```text
id
startedAt
completedAt
status: pending | running | completed | failed
repoRoot
commitSha
scannerVersion
filesScanned
filesSkipped
warnings
errors
metadata
```

Notes:

- `repoRoot` must resolve inside the configured project workspace.
- `commitSha` should identify the exact repository state when available.
- `warnings` and `errors` should avoid storing file contents or secrets.

### `code_files`

Purpose:

- represent files included in a scan,
- classify file role and language for downstream graph and retrieval use.

Conceptual fields:

```text
id
scanRunId
path
packageName
fileKind
language
hash
sizeBytes
isTest
isMigration
isSpec
isAdr
metadata
```

Initial `fileKind` examples:

```text
source
test
migration
spec
adr
documentation
config
fixture
unknown
```

Notes:

- `path` must be repository-relative.
- `hash` should be derived from file bytes or normalized text so unchanged files are detectable.
- v0 should skip oversized files and generated outputs by default.

### `code_symbols`

Purpose:

- represent named declarations and exported API surfaces found inside files,
- support later context retrieval at symbol granularity.

Conceptual fields:

```text
id
scanRunId
fileId
name
symbolKind
exportKind
startLine
endLine
visibility
confidence
metadata
```

Initial `symbolKind` examples:

```text
function
class
type
interface
const
route
service
repository
schema
migration
test
unknown
```

Initial `exportKind` examples:

```text
none
named
default
type
reexport
```

Notes:

- Line numbers are best-effort metadata for navigation and traceability.
- `confidence` should be bounded `0..1`.
- v0 should avoid claiming symbol semantics it cannot infer structurally.

### `code_edges`

Purpose:

- represent relationships between files, symbols and docs,
- provide traceable structure for future code-aware context retrieval.

Conceptual fields:

```text
id
scanRunId
sourceType: file | symbol | document
sourceId
targetType: file | symbol | document
targetId
edgeType
confidence
metadata
```

Notes:

- `confidence` should be bounded `0..1`.
- Edges must be explainable from local repository structure.
- Edges should store minimal metadata, not large source excerpts.

## Edge Types v0

### `imports`

Meaning:

- a source file imports another file, package or exported symbol.

Creation rules:

- create from static TypeScript import declarations,
- resolve relative imports to repository files when deterministic,
- represent unresolved workspace/package imports conservatively.

Limits:

- do not execute module resolution code,
- do not infer dynamic imports aggressively,
- do not follow paths outside the repository.

### `exports`

Meaning:

- a file or symbol exposes a named, default, type-only or re-exported API surface.

Creation rules:

- create from static TypeScript export declarations,
- link exported symbols to their defining file when directly visible.

Limits:

- do not infer runtime export behavior,
- skip ambiguous barrel re-exports unless resolution is deterministic.

### `calls`

Meaning:

- a symbol appears to call another known symbol.

Creation rules:

- v0 may create this edge only for clear same-file or imported symbol references that can be resolved structurally.

Limits:

- no control-flow analysis,
- no type checker requirement in v0,
- prefer omission over weak call inference.

### `tests`

Meaning:

- a test file or test symbol covers a source file or symbol.

Creation rules:

- create from filename conventions such as `*.test.ts`,
- map nearby or same-basename tests to source files,
- use imports from test files as stronger evidence.

Limits:

- do not claim behavioral coverage,
- do not treat all imports as complete test coverage.

### `migrates`

Meaning:

- a migration file changes or introduces a schema concept used by code.

Creation rules:

- create from files under migration directories,
- extract migration file identity and simple table/object references when clear.

Limits:

- do not execute SQL,
- do not require a database,
- do not infer complex schema semantics in v0.

### `documents`

Meaning:

- a spec, ADR or documentation file describes a code file, package, service, route or milestone.

Creation rules:

- create from explicit path mentions, stable names, ADR numbers, spec titles and conservative keyword matches.

Limits:

- weak docs-to-code heuristics must use low confidence or be omitted,
- do not let weak documentation edges override code-derived structure.

### `owns`

Meaning:

- a repository area, package or document owns or governs a file or symbol.

Creation rules:

- create from clear workspace/package boundaries, CODEOWNERS-style metadata if present, or explicit governance docs.

Limits:

- do not infer human ownership without explicit repository evidence,
- do not introduce auth or permission behavior.

## Scanner v0 Design

The future scanner should be local, deterministic and conservative.

Initial scan inputs:

- repository root,
- include/exclude patterns,
- current commit SHA when available,
- scanner version,
- maximum file size.

Initial scan outputs:

- scan summary,
- file records,
- symbol records,
- edge records,
- warnings for skipped or unresolved items.

Scanner v0 should cover:

- TypeScript imports and exports,
- Fastify route detection from route registration files,
- service detection from service directories and exported service classes/functions,
- repository detection from repository directories and exported repository classes/functions,
- migration detection from migration directories and migration filenames,
- test mapping from `*.test.ts`, scenario files and imports,
- docs/spec/ADR mapping from explicit names, paths and milestone references.

Scanner v0 should not:

- execute code,
- run the TypeScript compiler as a required semantic engine,
- call package scripts,
- connect to PostgreSQL,
- call external providers,
- call local model endpoints,
- inspect files outside the repository root.

Implementation guidance for future milestones:

- prefer structured parsers or TypeScript AST when available through existing toolchain,
- keep scanner output deterministic for the same commit and scanner version,
- store enough confidence/source metadata to audit why each edge exists,
- keep graph generation independent from runtime request handling,
- allow lexical RAG fallback to work even when Code Graph scanning is absent or failed.

## Safety and Limits

Code Graph v0 must preserve existing project safety boundaries:

- no code execution,
- no reading outside the repository,
- no following symlinks outside the repository,
- no providers external to the local repository,
- no real models,
- no required pgvector,
- no disruption to lexical fallback,
- no runtime behavior changes,
- no new agent actions,
- no path around safe execution policy,
- no filesystem source adapter exposed through the product API,
- no storage of secrets beyond existing repository file metadata and hashes.

If a future scanner reads repository files, it must treat file content as local project data and avoid logging large content or sensitive-looking values. Any external provider use remains out of scope and would require a separate data handling and approval policy.

## Future Integration

Future milestones may use the Code Graph after this design is accepted:

- RAG may retrieve code-aware context such as files, symbols and related tests.
- GraphRAG may use Code Graph relationships after graph quality and safety are proven.
- Runtime `load_context` may include Code Graph-derived context.
- Retrieval evaluation may add synthetic fixtures for code context.
- Dashboard may visualize repository relationships and scan health.

None of these integrations are implemented in Milestone 1.6A.

## Acceptance Criteria for Milestone 1.6A

- Code Graph v0 design is documented.
- ADR records the architectural decision.
- No scanner is implemented.
- No runtime, API, dashboard, shared contract, migration, workflow or dependency changes are introduced.
- Security limits are explicit.
- Open questions are documented for future milestones.

## Open Questions

- Should Code Graph data be persisted in PostgreSQL, generated as JSON artifacts first, or both?
- How should scan runs be versioned and compared across commits?
- How should specs and ADRs map to code without creating noisy weak edges?
- Should scanner confidence thresholds be configurable or fixed per scanner version?
- How should generated files, build outputs and fixtures be excluded consistently?
- Should future scanner output be evaluated by a dedicated code-context retrieval corpus?
- How can weak heuristics be prevented from contaminating RAG context or answerability decisions?
- What is the minimum useful graph before GraphRAG should be reconsidered?
