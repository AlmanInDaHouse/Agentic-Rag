# TriForge Agentic Lab Project Context

## Vision

TriForge Agentic Lab is an experimental platform for coordinating AI agents through structured debate, traceable decisions, future memory/RAG/GraphRAG, code graph analysis, task execution and monitoring.

## Current Architecture

- `apps/api`: Fastify ESM API, PostgreSQL repositories, migrations, mock debate runtime, mock agent runtime state machine, safe execution policy, Context Engine, basic context redaction/retention policy, mock embedding boundary, optional local/pgvector capability reporting, optional pgvector active retrieval and tests.
- `apps/web`: React + Vite dashboard.
- `packages/shared`: Zod contracts and shared TypeScript types.
- `infra/docker`: local PostgreSQL compose setup.
- `docs`: ADRs, specs, security policy and living project context.
- `.github/workflows`: GitHub Actions CI.
- `.github/pull_request_template.md`: pull request checklist.
- `.github/CODEOWNERS`: basic ownership rule.
- `tooling/harness`: black-box development harness that creates temporary PostgreSQL schemas and drives the API over HTTP.
- `tooling/retrieval-eval`: deterministic retrieval evaluation fixtures, metrics, baselines, quality gates and report runner.
- `tests`: fixtures used by harness scenarios.

## Stack

- TypeScript ESM.
- Fastify.
- React + Vite.
- PostgreSQL with `pg`.
- No ORM.
- SQL parametrizado.
- Zod contracts.
- pnpm workspaces.
- Vitest.

## Technical Restrictions

- Do not add features without a spec.
- Do not use ORM.
- Do not interpolate user values into SQL.
- Keep architecture modular and small.
- Mock agents come before real adapters.
- pnpm is the only supported package manager.

## Current State

The MVP supports goal creation/listing, debate round creation, latest round retrieval, mock agents, mock judge, persisted proposals, timeline events and basic dashboard. Milestone 1.3.1 adds a persisted mock agent runtime state machine with approval gate workflows, a safe execution policy, transactional advance locking and approval hardening. Milestone 1.4 adds Context Engine v0 with manual/project/artifact sources, deterministic chunking, lexical retrieval and runtime `load_context` integration. Milestone 1.5C-A adds deterministic regex redaction and context data policy metadata before future real embedding work. Milestone 1.5C-B adds basic context retention quotas, soft delete/restore and audit events. Milestone 1.5D adds optional pgvector active retrieval when explicitly configured and available, with JSONB/mock/lexical fallback when it is not. Milestone 1.5E adds deterministic retrieval evaluation fixtures, metrics and report generation. Milestone 1.5F adds versioned retrieval baselines and quality gates for the synthetic evaluation harness. Milestone 1.5G expands the synthetic retrieval evaluation corpus with query types, tags, ambiguous retrieval, redaction and no-answer cases. The runtime remains mock-only and does not execute real commands, modify code, install dependencies, run migrations or call real adapters.

## Decisions Taken

- Vite over Next.js for MVP simplicity.
- pnpm workspaces over npm workspaces.
- Harness lives outside product runtime in `tooling/harness`.
- Timeline events are stored in PostgreSQL as JSONB payloads.
- Agent runtime state uses a minimal PostgreSQL-backed state machine before adopting any external workflow engine.
- Runtime advance uses a PostgreSQL transaction and `SELECT ... FOR UPDATE NOWAIT` to serialize per-run state transitions.
- Approval gates use simulated actor roles until real auth is introduced.
- Context Engine uses lexical retrieval by default.
- RAG v1 now has deterministic mock embeddings, mock/hybrid search modes and optional pgvector active retrieval without external embeddings.
- Retrieval evaluation uses deterministic synthetic fixtures, query metadata, simple metrics, versioned thresholds and compact baselines; no LLM-as-judge or real model is required.
- pgvector and local embeddings are optional capabilities only; default CI/harness remains mock plus JSONB, and pgvector requires explicit extension/table setup.
- Context ingestion applies basic local regex redaction before chunk persistence.
- Context retention uses simple service-layer quotas, soft delete by default and audit events for deletion/quota outcomes.

## Next Steps

- Consider database-per-run harness isolation only if schema isolation becomes insufficient.
- Add adapter specs before implementing real agent bridges.
- Keep the runtime mock-only until adapter sandboxing, subprocess limits and authorization exist.
- Add real semantic vector quality evaluation only after optional pgvector/local retrieval setup is stable.

## Development Rules

- Read this file before each Codex session.
- Read `docs/specs/PROJECT_SPEC.md`, the relevant feature spec, ADRs and harness tests.
- Update specs before implementing new behavior.
- Add or update tests for critical services and harness flows.
- Run validation commands before handing off.

## Main Commands

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
pnpm install
pnpm db:migrate
pnpm dev
pnpm typecheck
pnpm test
pnpm test:retrieval-eval
pnpm test:harness
pnpm eval:retrieval
pnpm eval:retrieval:gate
pnpm build
pnpm audit
pnpm lint:deps
```

## CI

GitHub Actions runs `pnpm lint:deps`, `pnpm typecheck`, `pnpm test`, `pnpm test:harness`, `pnpm harness:mvp`, `pnpm build` and `pnpm audit` on pushes and pull requests targeting `main`.

## Repository Governance

- All changes should enter through pull requests.
- Direct commits to `main` are not part of the normal workflow.
- The required status check is `Validate`.
- Prefer squash merge.
- Update specs for behavior changes.
- Update ADRs for architecture changes.
- Update dependency review docs when dependencies change.

## Folder Map

```text
apps/api
apps/web
packages/shared
infra/docker
docs/adr
docs/specs
docs/security
docs/context
docs/repo
tests/fixtures
tooling/harness
tooling/retrieval-eval
```

## Current Risks

- Harness uses temporary schemas inside the configured PostgreSQL database.
- Real agent adapters will introduce untrusted output and subprocess risks.
- Timeline event retention is undefined.
- Context retention has no background worker and no tenant-specific quota configuration.
- Agent runtime is synchronous and mock-only; it is not yet a durable worker queue.
- Approval gate authorization is simulated by payload actor roles, but not yet tied to authenticated users.

## Technical Debt

- Debate orchestration is not wrapped in a single transaction.
- Dashboard has no live updates.
- API route schemas are manually wired instead of using Fastify schema integration.
- Approval gates are exposed for mock runtime actions and enforce simulated actor roles, but are not yet backed by authentication or real role binding.
- Context retrieval is lexical by default and has basic regex redaction plus basic retention/quota/delete policy, but no full DLP yet.
- RAG v1 has deterministic mock embeddings, optional local/pgvector capability reporting, optional pgvector active retrieval, hybrid/mock-vector modes and a deterministic retrieval evaluation harness with expanded synthetic quality gates, but no required real semantic embeddings, external providers, LLM-as-judge or production vector tuning yet.

## Definition of Done

- Relevant spec exists and is current.
- Contracts are updated in `packages/shared` when API shape changes.
- Migrations are versioned.
- Critical logic has unit tests or harness coverage.
- `pnpm typecheck`, `pnpm test`, `pnpm test:harness`, `pnpm build`, `pnpm audit` pass.
- CI passes for pull requests.
