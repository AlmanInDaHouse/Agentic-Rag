# CI Policy

## What CI Validates

The main GitHub Actions workflow validates:

- dependency installation with `pnpm install --frozen-lockfile`,
- dependency policy with `pnpm lint:deps`,
- TypeScript type safety with `pnpm typecheck`,
- unit tests with `pnpm test`,
- black-box harness scenarios with `pnpm test:harness`,
- MVP agentic smoke scenario with `pnpm harness:mvp`,
- production builds with `pnpm build`,
- dependency advisories with `pnpm audit`.

## When CI Runs

CI runs on:

- pushes to `main`,
- pull requests targeting `main`.

## PostgreSQL Requirements

CI uses a PostgreSQL 16 service container with:

```text
POSTGRES_USER=triforge
POSTGRES_PASSWORD=triforge
POSTGRES_DB=triforge_test
DATABASE_URL=postgresql://triforge:triforge@localhost:5432/triforge_test
```

The CI database name is `triforge_test` to keep automation clearly separate from local development defaults.

## Why The Harness Runs In CI

The harness is the repo-level validation gate for agentic behavior. It exercises the API over HTTP, creates temporary PostgreSQL schemas per run, validates Zod contracts and verifies debate/timeline behavior without real model adapters.

## Reproduce Locally

Start PostgreSQL, then run:

```bash
pnpm install
pnpm lint:deps
pnpm typecheck
pnpm test
pnpm test:harness
pnpm harness:mvp
pnpm build
pnpm audit
```

## If CI Fails

1. Read the first failing step.
2. Reproduce the exact command locally.
3. Fix the cause, not the symptom.
4. Add or update tests/specs when behavior changes.
5. Push a new commit to rerun CI.

## No-Skip Policy

Do not skip, remove or downgrade CI checks to merge faster. If a check is flaky or blocked by external infrastructure, document the issue and fix the workflow or test design.
