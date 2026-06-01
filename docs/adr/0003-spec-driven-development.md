# ADR 0003: Spec-Driven Development

## Date

2026-06-01

## Context

TriForge will grow into agent runtime, RAG, GraphRAG, code graph and execution features. Without short executable specs, implementation can drift quickly.

## Decision

Adopt spec-driven development. Every feature must have a useful spec in `docs/specs` before implementation. Specs must define objective, scope, out of scope, entities, contracts, flows, acceptance criteria, risks and open decisions.

## Alternatives Considered

- ADR-only design notes: useful for decisions, insufficient for feature contracts.
- Tests-only specification: useful after implementation, but not enough for planning.

## Consequences

- Specs become part of definition of done.
- Codex sessions must read project context, project spec, feature spec, relevant ADRs and tests.
- Documentation must stay short and actionable.
