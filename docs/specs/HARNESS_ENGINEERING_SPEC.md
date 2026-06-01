# Harness Engineering Spec

## Objective

Provide reproducible validation for agentic behavior without real model dependencies.

## Scope

The MVP harness lives in `tooling/harness`, creates temporary PostgreSQL schemas, starts API processes on local ports and validates behavior through public HTTP endpoints.

## Out of Scope

Browser automation, load tests, model quality evaluation and external service simulation.

## Main Entities

- Harness fixture
- Harness scenario
- Goal
- Debate round
- Timeline event

## Contracts

Fixtures must remain valid JSON. Scenario assertions must validate API responses with shared Zod contracts.

## Flows

- Generate `runId` and `harness_<runId>` schema.
- Create the schema with strict validation.
- Apply migrations through the API workspace script with `TRIFORGE_DB_SCHEMA`.
- Start or verify a local API process.
- Create a goal over HTTP.
- Run a mock debate over HTTP.
- Verify persisted latest round inside the temporary schema.
- Verify timeline.
- Validate invalid-agent behavior through mock-agent failure modes exposed by environment configuration.
- Drop the temporary schema in cleanup.

## Acceptance Criteria

- `pnpm test:harness` runs the MVP scenario.
- GitHub Actions runs `pnpm test:harness` and `pnpm harness:mvp`.
- Harness verifies three mock agents, proposal contracts, judge decision and persistence.
- Harness verifies invalid agent output is recorded and does not break remaining valid proposals.
- Harness verifies a round cannot complete with no decision.
- Harness does not import API repositories, services or private runtime classes.
- `apps/api/src` contains no harness folder.
- Harness refuses to drop `public` or schema names that do not match `^harness_[a-zA-Z0-9_]+$`.

## Current limitation: shared configured database

The current harness still uses the configured `DATABASE_URL`, but rows are isolated inside temporary schemas and schemas are dropped at the end of each runtime.

## Future target: isolated database or schema per run

Schema-per-run isolation is implemented. A future target is database-per-run isolation if tests need stronger isolation.

## Risks

- Harness shares the configured PostgreSQL database, but should not leave rows after successful cleanup.
- Mock failure modes are controlled through environment variables and should remain limited to mock-agent runtime behavior.

## Open Decisions

- Decide whether database-per-run isolation is needed later.
