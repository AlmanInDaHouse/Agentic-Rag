# Provider Contracts Spec

**Milestone:** A1 — Provider Contracts
**Status:** Implemented in `packages/shared` (provider-agnostic contracts only;
no adapters, no provider execution).
**Related:** `docs/adr/0033-provider-contract-boundary.md`,
`docs/instrucciones.md` §13 (A1.1–A1.4),
`docs/context/TRIFORGE_PROJECT_VISION.md` §11, §12, §14, §16,
`docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` (ADR 0027),
`docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §11 (ADR 0032),
`docs/specs/SAFE_EXECUTION_POLICY_SPEC.md` (ADR 0011).

A1 is the first **code** milestone of the provider reorientation. It defines the
provider-agnostic data contracts that every later milestone (A2 mocks, A3 real
read-only adapters, A4 collaboration runtime, A5 writable execution) builds on,
expressed as Zod schemas + inferred TypeScript types in `@triforge/shared`, plus
the `ProviderAdapter` TypeScript interface.

## Objective

Provide a stable, provider-agnostic contract surface for: the adapter boundary
(A1.1), the normalized provider event stream (A1.2), capability snapshots (A1.3)
and the 12 collaboration artifacts (A1.4). The contracts are the shared language
between the orchestration runtime and any provider, so that adapters can be
written, mocked and verified against schemas rather than narrative.

## Scope

- A single contract version constant `PROVIDER_CONTRACT_SCHEMA_VERSION` and a
  provider enum `ProviderIdSchema = z.enum(["codex", "claude"])`.
- The `ProviderEvent` envelope + 13-member discriminated union and terminal-event
  semantics.
- The `CapabilitySnapshot` tri-state contract.
- The adapter data contracts (availability, authentication, request, usage,
  quota, error taxonomy, result) and the `ProviderAdapter` interface.
- The 12 Zod artifact contracts.
- Re-export of all of the above from `packages/shared/src/index.ts`.
- Schema tests in `apps/api/src/test/providerContracts.test.ts` (pure, no DB).

## Non-Goals

A1 does **not**:

- implement any adapter (mock or real), event normalizer, quota manager, worktree
  manager, or any provider execution — those are A2/A3/A5;
- add any provider-specific behavior or per-provider branching. The provider
  knowledge in the contracts is vocabulary only: the `"codex" | "claude"` enum
  plus the provider-named quota-flavor tokens (`claude_five_hour`,
  `codex_weekly`, etc.) inherited from
  `QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` (sanctioned vocabulary, not logic);
- change dependencies, the lockfile, the database schema, endpoints, the runtime
  or CI;
- freeze the event/capability schemas against a real CLI. They are versioned
  assumptions until verified against the installed provider version
  (quota spec "External Fact Verification"; Vision §12); where a signal cannot be
  verified the adapter reports `unknown` rather than fabricating a value.

## Contract Inventory

All schemas live under `packages/shared/src/provider/` and are re-exported from
`packages/shared/src/index.ts`.

### Primitives (`provider/common.ts`)

- `PROVIDER_CONTRACT_SCHEMA_VERSION` — `"1.0.0"`.
- `ProviderIdSchema` — `"codex" | "claude"`; with the inherited quota-flavor
  tokens in `QuotaExhaustionFlavorSchema`, the contracts' only provider-named
  vocabulary (no per-provider logic branches on it).
- `AvailabilityStatusSchema`, `AuthenticationStateSchema` — reachability and auth
  state, **separate** from quota status (quota spec).
- `ProviderUsageSchema` — client-side usage estimate; `isBillingAuthoritative`
  fixed to `false`; optional numerics stay absent rather than back-filled.
- `ProviderQuotaSchema` — normalized quota signal (status/window/utilization/
  resetsAt/flavor/source); never fabricates a remaining percentage;
  `isBillingAuthoritative` fixed to `false`.
- `ProviderErrorCodeSchema` — the 13-code error taxonomy shared by the
  `run.failed` payload and the adapter error/result.

`ProviderUsage`/`ProviderQuota` and the auth/error enums live in this leaf module
(not in `adapter.ts`) because they are shared by both the event payloads and the
adapter result; this keeps `events.ts` and `adapter.ts` free of a circular import.

### A1.2 Provider events (`provider/events.ts`)

A common envelope — `schemaVersion`, `executionId`, `provider`, `sequenceNumber`
(int ≥ 0), `timestamp` (ISO datetime), `rawEvidenceRef` (string | null, default
null), `type`, `payload` — and a `z.discriminatedUnion("type", …)` of the 13
events, each `.strict()` with a typed payload:

`run.started`, `authentication.updated`, `agent.message`, `plan.updated`,
`tool.started`, `tool.completed`, `file.changed`, `usage.updated`,
`quota.updated`, `approval.requested`, `warning.raised`, `run.failed`,
`run.completed`.

Helpers: `PROVIDER_EVENT_TYPES` (canonical order), `ProviderEventTypeSchema`,
`TERMINAL_EVENT_TYPES` (`run.failed`, `run.completed`), and
`isTerminalEvent(eventOrType)`.

### A1.3 Capability snapshot (`provider/capability.ts`)

`CapabilitySnapshotSchema`: `provider`, `cliVersion` (string | null),
`verifiedAt`, and tri-state (`yes` | `no` | `unknown`) flags for
`headlessSupport`, `structuredOutput`, `eventStream`, `authProbe`,
`usageObservable`, `quotaObservable`, `readOnly`, `write`, `cancellation`,
`resume`, plus `unknownCapabilities: string[]`. Every capability is tri-state
because each is probe-based and may be unverifiable; `unknown` over fabrication
(mandate §4.5).

### A1.1 Adapter contracts (`provider/adapter.ts`)

`AvailabilityResultSchema`, `AuthenticationResultSchema`,
`ProviderCapabilitiesSchema` (alias of `CapabilitySnapshotSchema`),
`AgentExecutionRequestSchema` (executionId, provider, objective,
`sanitizedArguments`, cwd?, `timeoutMs`, `readOnly`, `environmentAllowlist`,
`maxOutputBytes` — sanitized, no secrets), `ProviderErrorSchema`,
`ProviderResultSchema` (terminal structured result referencing the terminal
event via `terminalEventType` + `terminalSequenceNumber`), and the TypeScript
`ProviderAdapter` interface:

```ts
interface ProviderAdapter {
  readonly provider: ProviderId;
  checkAvailability(): Promise<AvailabilityResult>;
  checkAuthentication(): Promise<AuthenticationResult>;
  getCapabilities(): Promise<ProviderCapabilities>;
  execute(request: AgentExecutionRequest): AsyncIterable<ProviderEvent>;
  cancel(executionId: string): Promise<void>;
}
```

### A1.4 Artifact contracts (`provider/artifacts.ts`)

Twelve Zod contracts, provider-agnostic:

1. `TaskSpecification` — objective, scope, nonGoals, invariants, acceptance
   criteria, failure modes, relation to prior decisions.
2. `ContextManifest` — source/provenance/hash/retrieval-ref entries.
3. `AgentPlan` — owner, rationale, ordered steps.
4. `CrossReview` — reviewer, target, findings.
5. `StrategyDecision` — chosen option, authority-source ranking and the deciding
   source (mandate §A4.5 authority order), rationale.
6. `TaskProfile` — EXACT Vision §16 shape.
7. `RoutingDecision` — EXACT Vision §16 shape.
8. `ImplementationResult` — diffHash, filesChanged, commands, test summary,
   mutation summary.
9. `ReviewFindings` — findings (severity blocker|critical|major|minor|
   observation, category, file, line, evidence, impact, requiredAction,
   missingTest, confidence — mandate §A4.4) + summary.
10. `QualityGateResult` — per-gate name (unit/integration/e2e/typecheck/lint/
    build/dependency/security/codeGraph/custom) + status, plus overall status.
11. `GovernanceDecision` — task, specRef, owner, reviewer, contextRef, diffHash,
    tests, findings summary, quota, risks, mergeDecision (merge|block|hold),
    justification, and the `capabilityBinding` with all six binding fields
    (threat, control, milestone, verification, recovery, residualRisk) required
    by the threat-model closure rule (§11.2, ADR 0032).
12. `RunFinalReport` — objective, baseSha, branch, commit, pr, mergeSha, files,
    tests, findings, decisions, risks, finalState, nextObjective (mandate §5.10).

## Schema Versioning and Compatibility Rules

- `PROVIDER_CONTRACT_SCHEMA_VERSION` is a semantic version carried on the wire by
  every `ProviderEvent` (`schemaVersion`), `AgentExecutionRequest` and
  `ProviderResult`.
- **Additive, backward-compatible changes** (a new optional field, a new event
  type added to the union, a new enum member that consumers can treat as
  unknown) bump the MINOR/PATCH segment.
- **Breaking changes** (removing/renaming a field, changing a type, tightening a
  constraint, removing an enum member) bump the **MAJOR** segment.
- A MAJOR bump **invalidates capability snapshots** verified against the prior
  contract, and a new provider `cliVersion` likewise invalidates the prior
  snapshot (A1.3). Snapshots are re-derived, never assumed forward.
- `unknown` over fabrication: any capability, usage or quota signal that cannot
  be verified against the installed CLI version is reported as `unknown` /
  absent, never invented (mandate §4.5; quota spec).

## Terminal-Event Semantics

- Exactly one terminal event (`run.failed` | `run.completed`) ends a run.
- `isTerminalEvent` and `TERMINAL_EVENT_TYPES` express this in the contract;
  `ProviderResult.terminalEventType` must be one of the terminal types and
  references the terminating event's `sequenceNumber`.
- The single-terminal invariant, ordering and duplicate/gap handling are
  **enforced** by the adapter harness and normalizer in A2/A3 (the contract
  states the shape; the runtime enforces the protocol). This directly serves
  threat T-INJ-12 (falsified events) — see the threat model.

## Acceptance Criteria

A1 is closed when:

- the contracts compile and `packages/shared` builds cleanly to `dist`;
- there is **no provider-specific logic** anywhere — only the `ProviderId` enum;
- the `ProviderEvent` discriminated union routes all 13 event types, and the
  terminal-event helper is correct;
- all 12 artifact contracts validate via Zod, with `.strict()` rejecting unknown
  keys, and `TaskProfile`/`RoutingDecision` matching the Vision §16 shapes;
- `GovernanceDecision` requires all six capability-binding fields;
- schema tests (`apps/api/src/test/providerContracts.test.ts`) pass with no DB;
- the compatibility/versioning rules and terminal semantics are documented (this
  spec) and recorded as an ADR (0033);
- dependencies, the lockfile and CI are unchanged;
- `pnpm typecheck`, the new tests, `pnpm lint:deps` and `pnpm build` pass.
