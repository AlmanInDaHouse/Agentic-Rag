# TriForge — Installation & Run

TriForge is a local multi-agent CLI-orchestration runtime (Codex + Claude Code) in a pnpm
monorepo: `packages/shared` (provider contracts), `apps/api` (the runtime), `apps/web`
(the product UI). This document is the A9.6 packaging/installation reference.

## Prerequisites

- **Node.js ≥ 20.11** (the repo is developed and CI-tested on Node 22).
- **pnpm 11** — the repo pins `packageManager: pnpm@11.5.0`; use `corepack enable` to get
  the pinned version automatically.
- **Git** (the writable runtime drives isolated git worktrees).
- **For a REAL provider run only:** the `codex` and `claude` CLIs installed and
  authenticated on the host (interactive login is the operator's action — TriForge never
  automates login or extracts tokens). The MVP and the entire test suite run against
  **mock** providers and need none of these.

## Install

```bash
corepack enable                 # use the pinned pnpm
pnpm install --frozen-lockfile  # install the workspace (CI uses --frozen-lockfile)
```

## Build

```bash
pnpm -r build                   # build every package (shared → api → web)
```

This compiles `@triforge/shared` (tsc), `@triforge/api` (esbuild bundle) and
`@triforge/web` (tsc + vite build → `apps/web/dist`).

## Test

```bash
pnpm typecheck                  # type-check every package
pnpm lint:deps                  # dependency-manifest checks
pnpm test                       # the full workspace suite (api + web view-model tests)
```

CI (`.github/workflows/ci.yml`, the `Validate` job) runs exactly this surface plus the
code-graph checks and an audit on every PR; `main` is always green.

## Run

- **Web UI (dev):** `pnpm dev:web` — serves the product UI (Vite) on `127.0.0.1`.
- **API (dev):** `pnpm dev:api`.
- **Both:** `pnpm dev`.

The writable execution runtime (A5) makes real changes **only inside isolated git
worktrees** it creates and manages — never on your working branch or `main`. The
collaboration/competitive runtime is driven through the runtime modules in
`apps/api/src/{execution,orchestration}`; a real provider pilot (A5.10) additionally
requires the authenticated CLIs above and is gated until a writable capability is observed.

## Safety notes (mandate §15 / ADR 0031–0032)

TriForge never: uses API keys, extracts tokens, automates provider login, writes to `main`
directly or force-pushes it, disables branch protection, or bypasses CI checks. Writable
work is confined to isolated worktrees; every writable capability is bound to a
{threat, control, milestone, verification, recovery, residual-risk} closure record.
