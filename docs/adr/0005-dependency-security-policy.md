# ADR 0005: Dependency Security Policy

## Date

2026-06-01

## Context

A potentially untrusted npm dependency was reported, but no exact package name was identified. The project needs a conservative baseline without adding heavy supply-chain platforms.

## Decision

Create a dependency review and policy. Add `pnpm lint:deps` as a lightweight local manifest check. Keep dependency count small, reject unjustified lifecycle scripts and require lockfile review.

## Alternatives Considered

- Add a full supply-chain scanner: useful later, too heavy for current MVP.
- Do nothing until the package is identified: leaves no baseline guardrail.

## Consequences

- New dependencies require explicit justification.
- Build tools must stay out of runtime dependencies.
- `pnpm audit` and `pnpm lint:deps` are part of validation.
