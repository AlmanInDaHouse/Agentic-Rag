# ADR 0033: Provider Contract Boundary

## Date

2026-06-29

## Status

Accepted

Establishes the provider-agnostic contract boundary for Milestone A1 (Provider
Contracts), the first code milestone of the provider reorientation. Implements
the contract sketches deferred by ADR 0027 (Quota-Aware Provider Orchestration)
and Vision §11/§12, within the security model of ADR 0032 (Untrusted Repository
and Provider Boundaries). Does not authorize any provider execution. Canonical
spec: `docs/specs/PROVIDER_CONTRACTS_SPEC.md`.

## Context

TriForge is being reoriented to coordinate the official Codex CLI and Claude Code
(Vision; mandate `docs/instrucciones.md`). ADR 0027 deliberately **deferred** the
`ProviderAdapter` contract and described `ProviderEvent`, usage and quota only as
conceptual `ts` blocks; Vision §11/§12 carry the same shapes as `[Planned]`
sketches. The downstream milestones cannot proceed without a stable, shared
contract surface:

- A2 needs mock adapters and a black-box harness to verify against fixed shapes;
- A3 needs an event contract to normalize real CLI output into;
- A4/A5 need the artifact contracts (plans, reviews, routing, governance) to
  collaborate through inspectable records rather than opaque chat (Vision §14).

Two constraints shape the design. First, the mandate forbids provider-specific
logic in the contracts (only a `"codex" | "claude"` enum) and requires `unknown`
as a first-class state rather than fabricated values (§4.5). Second, the threat
model (ADR 0032) declares provider output and the event stream **untrusted**
(T-INJ-12 falsified events; §11 binding rule), so the contracts must support
strict schema validation, sequence numbers, single-terminal semantics and raw
evidence references, and the `GovernanceDecision` must carry the six
capability-binding fields the closure rule requires.

The runtime remains mock-only; A1 adds contracts only, no execution.

## Decision

1. **Define the provider contracts as Zod schemas + inferred types in
   `@triforge/shared`**, under `packages/shared/src/provider/`
   (`common`, `events`, `capability`, `adapter`, `artifacts`), re-exported from
   the package barrel. A single `PROVIDER_CONTRACT_SCHEMA_VERSION` ("1.0.0") and
   a `ProviderIdSchema = z.enum(["codex","claude"])` are the only provider-aware
   elements, alongside the provider-named quota-flavor tokens in
   `QuotaExhaustionFlavorSchema` inherited from the quota spec (sanctioned
   vocabulary, not logic). There is no Codex/Claude-specific behavior or
   per-provider branching.

2. **Model integration as an event stream, not a final message.** `ProviderEvent`
   is a strict envelope (schemaVersion, executionId, provider, sequenceNumber,
   timestamp, rawEvidenceRef, payload) over a 13-member discriminated union, with
   explicit terminal-event semantics (`TERMINAL_EVENT_TYPES`, `isTerminalEvent`).
   The `ProviderAdapter` interface exposes `execute` as
   `AsyncIterable<ProviderEvent>` plus availability/authentication/capability
   probes and `cancel` (Vision §11/§12).

3. **Keep capability, usage and quota signals honest.** `CapabilitySnapshot`
   capabilities are tri-state (`yes|no|unknown`); `ProviderUsage`/`ProviderQuota`
   never claim authoritative billing (`isBillingAuthoritative: false`) and never
   fabricate missing numbers (ADR 0027). Snapshots are version-bound: a new
   `cliVersion` or a MAJOR contract bump invalidates the prior snapshot.

4. **Adopt a semantic compatibility policy.** Additive changes bump MINOR/PATCH;
   breaking changes bump MAJOR and invalidate capability snapshots. The version
   is carried on the wire so adapters and the harness can detect drift.

5. **Contracts precede adapters.** A1 ships contracts and schema tests only. No
   adapter, normalizer, quota manager or execution is implemented or authorized;
   writable execution stays gated on A0.5 + the per-capability binding rule
   (ADR 0032 §11).

## Consequences

- A2–A5 can build and test against fixed shapes; mocks and the harness validate
  against the same Zod schemas the real adapters will (harness-before-trust).
- The artifact contracts make collaboration inspectable and give the autonomous
  governance gate (ADR 0031) a typed `GovernanceDecision` bound to the six
  threat-model fields, computed by TriForge rather than parsed from provider prose.
- `@triforge/shared` grows a new public surface; consumers import provider
  contracts from `@triforge/shared` like the existing runtime/context contracts.
- The event/capability schemas are **not frozen** against a real CLI; they remain
  versioned assumptions until verified against the installed version (Vision §12;
  quota spec). The MAJOR-bump rule absorbs the eventual reconciliation.

## Risks

- **Schema drift vs. real CLIs.** The installed Codex/Claude event and status
  formats may differ from these shapes. Mitigation: the version constant + the
  MAJOR-bump/snapshot-invalidation rule; A3 normalizers verify against the
  installed version and report `unknown` where a signal is unverifiable.
- **Contract churn before adapters exist.** Designing shapes ahead of real output
  risks rework. Mitigation: minimal, provider-agnostic payloads; additive
  evolution is non-breaking; breaking changes are explicit MAJOR bumps.
- **Over-trusting well-formed-but-false events.** Strict schemas catch malformed
  events but not semantically false ones (T-INJ-12 residual). Mitigation: A2/A3
  enforce sequence ordering and single-terminal semantics and reconcile against
  independent evidence (real diff, OS exit); the contract only states the shape.
- **`@triforge/shared` surface growth.** More exports to maintain. Mitigation:
  one module per concern under `provider/`, single version constant, documented
  compatibility policy (`PROVIDER_CONTRACTS_SPEC.md`).
