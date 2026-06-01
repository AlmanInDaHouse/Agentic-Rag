# ADR 0006: Harness Outside Runtime

## Date

2026-06-01

## Context

The first harness implementation lived partly in `apps/api/src/harness` and the scenario imported API internals. That made development tooling look like product runtime code and increased the chance of test helpers leaking into SaaS builds.

## Problem Detected

The API package is part of the product runtime. Harness code validates the product but should not be shipped with it or depend on private repositories, services or runtime classes.

## Decision

Move harness code to `tooling/harness` and make it interact with the API over HTTP. The harness may import shared Zod contracts from `packages/shared`, but it must not import private API modules.

## Alternatives Considered

- Leave it in `apps/api/src/harness`: rejected because it mixes product runtime and development tooling.
- Move it to `tests/harness`: better than API runtime, but less explicit as reusable repo tooling and less suitable for a future runner.
- Create `packages/harness`: clean package boundary, but premature while the harness is still local repo tooling and not a published or reusable package.
- Move it to `tooling/harness`: selected because it clearly separates development infrastructure from product code without adding package overhead.

## Final Decision

Use `tooling/harness` with:

- HTTP client wrapper.
- Zod-based assertions.
- Fixture reader.
- Reproducible scenarios.
- Vitest config local to the harness.

## Consequences

- Clean separation between SaaS runtime and development tooling.
- Lower risk of test code entering production builds.
- Better fit for CI execution.
- Future database isolation can be implemented inside the harness runner without touching product runtime.
