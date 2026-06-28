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

## Security Advisory Remediation

Date: 2026-06-28

- Advisory: `GHSA-g7r4-m6w7-qqqr` (esbuild).
- Severity: LOW.
- Type: transitive, development/test-only dependency, pulled in via `vitest > @vitest/mocker > vite > esbuild` and `tsx > esbuild`.
- Impact: path traversal / arbitrary file read in the esbuild development server on Windows. It affects the dev server only; TriForge does not expose the esbuild dev server as a product surface, and there is no evidence or implication of exploitation.
- Affected versions: `>=0.27.3 <0.28.1`; the tree had `esbuild@0.28.0`.
- Patched version: `0.28.1`.
- Strategy: pinned the corrected version through a root pnpm `overrides` entry in `pnpm-workspace.yaml` (`esbuild: 0.28.1`), the repository's canonical location for pnpm dependency-resolution settings, and updated `pnpm-lock.yaml`. No major upgrade of Vite, Vitest, tsx or other packages was required; `vite@8.0.16` accepts `esbuild ^0.28.0` and a single `esbuild` version remains in the tree.
- Validations: `corepack pnpm install`, `corepack pnpm audit` (now reports no known vulnerabilities), plus the standard typecheck, lint, test and build gates.
- Residual risk: none specific to this advisory after the bump. The general transitive-upgrade risk in "Open Risk" still applies. The audit gate is dynamic, so this update was triggered by a newly published advisory rather than by any change in TriForge's own code; it was not introduced by the Milestone A0.1 documentation work.

## Minimum Policy

- Do not add dependencies without a documented purpose.
- Prefer platform APIs, existing packages or small local code over new packages.
- Reject direct dependencies with `install`, `postinstall`, `preinstall`, `prepare` or similar lifecycle scripts unless an ADR justifies them.
- Review `pnpm-lock.yaml` in every PR.
- Run `pnpm audit` and `pnpm lint:deps` before merging dependency changes.

## Open Risk

Transitive dependencies can still add install-time behavior in future updates. The MVP policy intentionally avoids a heavy supply-chain platform, so lockfile review and conservative upgrades remain required.
