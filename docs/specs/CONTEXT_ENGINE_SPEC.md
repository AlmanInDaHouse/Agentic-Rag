# Context Engine Spec

## Objective

Define the future context, memory, RAG, GraphRAG and code graph boundaries.

## Scope

For this milestone, only document intended boundaries and avoid implementation.

## Out of Scope

Embeddings, vector stores, graph databases, repository indexing and retrieval ranking.

## Main Entities

- Context source
- Memory item
- Retrieval result
- Code graph node
- Code graph edge

## Contracts

Future context contracts must be Zod-first and live in `packages/shared`.

## Flows

- Ingest source.
- Normalize metadata.
- Retrieve relevant context.
- Attach context to agent run.
- Trace context usage.

## Acceptance Criteria

- No context feature is implemented without a spec update.
- Future context use must be traceable through events.

## Risks

- Context leakage between goals.
- Unbounded storage growth.

## Open Decisions

- Storage model for vector and graph data.
- Redaction and data retention policy.
