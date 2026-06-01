# ADR 0002: pnpm Workspaces

## Date

2026-06-01

## Context

The MVP started with npm workspaces. The project needs a stricter package manager with deterministic workspace linking and a single lockfile source of truth.

## Decision

Use pnpm workspaces as the only supported package manager. Add `pnpm-workspace.yaml`, set `packageManager` to `pnpm@11.5.0`, remove `package-lock.json` and generate `pnpm-lock.yaml`.

## Alternatives Considered

- npm workspaces: simpler default, but less strict dependency isolation.
- Yarn: viable, but not needed and not requested.

## Consequences

- Developers must use Corepack or an installed pnpm matching the package manager field.
- Scripts now use `pnpm --filter` and recursive workspace commands.
- Lockfile review moves to `pnpm-lock.yaml`.
