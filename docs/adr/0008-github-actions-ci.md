# ADR 0008: GitHub Actions CI

## Date

2026-06-01

## Context

TriForge Agentic Lab now has a pnpm monorepo, PostgreSQL migrations, a dashboard, shared contracts and an external harness with schema isolation. Changes need an automatic quality gate before merging.

## Decision

Add a single GitHub Actions workflow at `.github/workflows/ci.yml` that runs on pushes and pull requests targeting `main`. The workflow uses Ubuntu latest, Node.js 22, Corepack-managed pnpm, pnpm store caching and a PostgreSQL 16 service container. The harness is a required CI gate.

## Alternatives Considered

- No CI yet: rejected because the repo already has enough moving parts to regress silently.
- CI only with typecheck/test: rejected because it would miss DB migrations and black-box agentic behavior.
- CI complete with harness: selected for strong MVP coverage.
- CI split into multiple jobs: useful later, but one workflow/job is simpler for the initial gate.

## Final Decision

Use one complete validation job that runs:

```bash
pnpm install --frozen-lockfile
pnpm lint:deps
pnpm typecheck
pnpm test
pnpm test:harness
pnpm harness:mvp
pnpm build
pnpm audit
```

## Consequences

- Pull requests get a reproducible quality gate.
- PostgreSQL-backed behavior is validated in CI.
- Harness schema cleanup is exercised on every PR.
- CI runtime is longer than typecheck-only, but catches more meaningful regressions.

## Pending Risks

- CI still uses one physical PostgreSQL database; harness schemas isolate data, not global DB settings.
- Future workflows may need job splitting, artifacts or coverage once the repo grows.
