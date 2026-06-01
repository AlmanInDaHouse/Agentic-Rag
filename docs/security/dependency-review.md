# Dependency Review

Date: 2026-06-01

## Scope

Review of direct `dependencies` and `devDependencies` in the TriForge Agentic Lab monorepo before migrating from npm to pnpm.

## Findings

No direct dependency in the current manifests shows clear evidence of typosquatting, malicious naming, or unexpected lifecycle scripts. The previous npm lockfile did not list package-level lifecycle scripts. Because no exact suspicious package was identified by name, this report records the current dependency purpose, risk and recommendation instead of inventing attribution.

## Direct Dependencies

| Package | Used by | Purpose | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `@fastify/cors` | API | CORS plugin for local dashboard/API use. | Low; maintained Fastify ecosystem package. | Keep. |
| `@triforge/shared` | API, Web | Internal contracts package. | Low; workspace package. | Keep as `workspace:*`. |
| `fastify` | API | HTTP server. | Medium; exposed server dependency, monitor advisories. | Keep current major and audit regularly. |
| `pg` | API | PostgreSQL driver. | Medium; direct DB access, must use parametrized SQL. | Keep. |
| `zod` | API, Web, Shared | Runtime contract validation. | Low; core contract dependency. | Keep. |
| `react` | Web | UI runtime. | Low; widely maintained. | Keep. |
| `react-dom` | Web | UI DOM runtime. | Low; widely maintained. | Keep. |

## Direct Dev Dependencies

| Package | Used by | Purpose | Risk | Recommendation |
| --- | --- | --- | --- | --- |
| `@types/node` | API | Node.js typings. | Low. | Keep. |
| `@types/pg` | API | PostgreSQL driver typings. | Low. | Keep. |
| `@types/react` | Web | React typings. | Low. | Keep. |
| `@types/react-dom` | Web | React DOM typings. | Low. | Keep. |
| `@vitejs/plugin-react` | Web | Vite React transform plugin. | Medium; build-time code execution surface. | Keep in `devDependencies`; do not ship as runtime dependency. |
| `tsx` | API | TypeScript dev runner and migration runner. | Medium; executes TS directly in local tooling. | Keep for MVP; revisit if build-only runtime becomes preferable. |
| `typescript` | All packages | Compiler. | Low. | Keep. |
| `vite` | Web | Dev server and web bundler. | Medium; dev server surface. | Keep in `devDependencies`; audit regularly. |
| `vitest` | API, root tooling | Tests and harness scenarios. | Medium; test runner executes local code. | Keep. |
| `pg` | Root tooling | Harness schema creation and cleanup. | Medium; DB access must stay limited to schema lifecycle checks. | Keep as root dev dependency while harness owns DB isolation. |
| `@types/pg` | Root tooling | Typings for harness DB utilities. | Low. | Keep. |

## Changes Made

- Migrated package manager source of truth from npm to pnpm.
- Removed `package-lock.json`.
- Moved `vite` and `@vitejs/plugin-react` from web runtime dependencies to `devDependencies`.
- Added `scripts/check-dependencies.mjs` and root `pnpm lint:deps`.
- Approved the transitive `esbuild` build script in `pnpm-workspace.yaml` because Vite/Vitest require its native binary package during install.

## Minimum Policy

- Do not add dependencies without a documented purpose.
- Prefer platform APIs, existing packages or small local code over new packages.
- Reject direct dependencies with `install`, `postinstall`, `preinstall`, `prepare` or similar lifecycle scripts unless an ADR justifies them.
- Review `pnpm-lock.yaml` in every PR.
- Run `pnpm audit` and `pnpm lint:deps` before merging dependency changes.

## Open Risk

Transitive dependencies can still add install-time behavior in future updates. The MVP policy intentionally avoids a heavy supply-chain platform, so lockfile review and conservative upgrades remain required.
