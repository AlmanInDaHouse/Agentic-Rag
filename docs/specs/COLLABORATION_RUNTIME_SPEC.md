# Collaboration Runtime Spec (A4)

## Purpose

Milestone A4 (owner mandate `docs/instrucciones.md` §16) adds the **collaboration
runtime**: a pure, deterministic, in-memory orchestration layer that coordinates
**planning, critique, resolution and review** between two providers over the A1
contracts, driven by the A2 mock adapters and the A2.3 quota manager.

A4 is **pure orchestration over already-merged pieces** (A1 contracts, A2 mocks +
harness + quota, A3 real read-only adapters). It is **mock-first** and performs
**no real writes** and **no real CLI execution**. Every "implementation" step is
**simulated** by consuming an adapter's normalized `ProviderEvent` stream to its
terminal — never by mutating a file, a process or a repository. Writable execution
is **A5**, gated on the A0.5 capability binding.

The runtime is **NOT wired into the Fastify routes**. As with A2/A3, it is a domain
component that the product runtime will consume in a later milestone; the running
server stays mock-only.

Canonical decision record: **ADR 0035**. Relations: A1 (artifacts/events/adapter),
A2 (`apps/api/src/providers/mock`, `.../harness`, `.../quota`), A3
(`apps/api/src/providers/real`), A5 (adds real writable execution + the governance
decision over a real diff).

## Goals

- Implement the three collaboration modes (mandate §16): **Specialist** (A4.1),
  **Pair** (A4.2), **Full Debate** (A4.3).
- Select a mode from **risk + uncertainty**, then constrain it by a **first-reservation
  feasibility probe** (the first reservation each provider would make in the mode, after
  the protected reserves) so a mode the budget cannot even begin to fund is
  **downgraded**, never selected silently (mirrors
  `QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md`). When an escalation-triggered task
  cannot fund its **mandatory reviewer review**, selection does **not** downgrade to a
  doomed cheaper mode — it requires **human approval** (the run pauses).
- Implement the **review protocol** (A4.4): structured `ReviewFindings` carrying the
  nine mandated fields, and a **severity gate** that is **ENFORCED** (no open
  blocker/critical → proceed; otherwise the mode HALTS before the simulated execute).
- Implement **strategy resolution** (A4.5) by an **authority order**, never by agent
  majority or confidence, producing a `StrategyDecision` that names the deciding
  authority source.
- Gate **every** provider step through the quota manager (reserve → run → commit /
  release; respect hard stops, reserve violations and degraded routing).
- Make every stage a **validated A1 artifact** (parsed with its Zod schema) and the
  whole runtime **deterministic** (same inputs → same artifacts and ordering).
- Stay **provider-agnostic**: the only provider-named values are `ProviderId`
  members; there is no Codex/Claude-specific branching.

## Non-Goals

- **No real writes**, no real CLI/process execution, no network, no credentials, no
  DB. (Writable execution is A5; A4 simulates execution via event streams.)
- **No** `GovernanceDecision` artifact. That artifact binds a writable capability
  (its `capabilityBinding` references the delivering milestone, controls and SATs),
  which is an A5 concern; A4 closes at planning/critique/resolution/review.
- No task profiler / static router heuristics (A6) beyond a minimal,
  capability-primary **owner selection** needed to drive the modes.
- No worktree manager, owner/reviewer write enforcement or quality-gate runner (A5).
- No Competitive or Review-Only mode (A7 / later); A4 ships the three modes the
  mandate enumerates.
- No wiring into Fastify routes.

## Module Layout

`apps/api/src/orchestration/`:

| File | Responsibility |
|---|---|
| `collaborationModes.ts` | The three modes, mode selection, the `runCollaboration` dispatcher, and the artifact builders (`AgentPlan` / `CrossReview`). |
| `providerStep.ts` | The quota-gated provider step primitive (reserve → run → commit/release) every mode uses. |
| `reviewProtocol.ts` | `ReviewFindings` construction/normalization + the severity gate. |
| `strategyResolution.ts` | The authority-order resolver + `AUTHORITY_ORDER`. |
| `routing.ts` | Capability-primary owner selection → `RoutingDecision`. |
| `index.ts` | Public barrel. |

## The Quota-Gated Provider Step

Every step (plan / execute / review / critique) runs through `runProviderStep` with
the mandated lifecycle (mandate §11):

1. **`assertCanProceed(provider, { requireUnits, purpose })`** — the full gate: auth,
   availability, hard stop, rate limit, wall-time, turns/repair loops AND the reserve
   admissibility check. On failure the step is **blocked**.
2. **`reserve(provider, amount, purpose)`** — reserve capacity BEFORE the step. On a
   typed error (e.g. `RUN_BUDGET_RESERVE_VIOLATION`) the step is **blocked**.
3. **Run the adapter stream** to its single terminal. The request is **always
   `readOnly: true`** — A4 simulates implementation, it never writes. Observed
   `quota.updated` / `usage.updated` events are fed back into the quota manager so a
   mid-stream `exhausted` / `rate_limited` becomes a hard stop and a degraded-routing
   suggestion that **blocks the next step**.
4. **`commit`** on a clean `run.completed`; **`release`** otherwise (the capacity was
   not consumed).

**Blocked ⇒ the adapter never runs.** A hard stop or a reserve violation halts the
mode with **no execution and no simulated write**.

## A4.1 Specialist Mode (default)

```text
TaskProfile → owner (RoutingDecision) → owner AgentPlan → owner "execution"
            → self-review → [conditional cross-vendor review]
```

The economical default. A single owner plans, "executes" (read-only event stream),
and self-reviews. The **second provider participates only on a recorded trigger**
(`specialistEscalation`): `risk = high|critical`, `behavioralPreservationRequired`,
or uncertainty ≥ 0.6. When it fires, the reviewer runs a read-only review step and
produces a `CrossReview` + `ReviewFindings`; the trigger string is recorded on the
result (`secondProviderTrigger`).

## A4.2 Pair Mode

```text
owner AgentPlan → reviewer critique (CrossReview + ReviewFindings)
               → strategy resolution (StrategyDecision) → owner "execution"
```

One provider proposes; the second always critiques; the conflict (proceed vs revise)
is resolved by authority order; the owner then executes (simulated).

## A4.3 Full Debate Mode

```text
owner AgentPlan + reviewer AgentPlan (independent)
   → cross-review (each reviews the other)
   → agreements/disagreements
   → evidence-based resolution (StrategyDecision)
   → owner "execution"
```

Selected for architecture, security, migration, high blast radius or high
uncertainty. Both providers produce **independent** plans; each cross-reviews the
other; the two plans are resolved by authority order. Entry requires sufficient
budget **after** the implementation/review reserves are protected (see selection).

## Mode Selection

`selectMode` chooses from risk + uncertainty, then constrains by budget:

- **Uncertainty** is, by runtime convention, `TaskProfile.reasoningDepthRequired`
  treated as a normalized 0..1 signal (values saturate); an explicit override wins.
- **Full Debate** is requested when `taskKind` matches
  architecture/security/migration, OR risk is `critical`, OR blast radius is
  `package`/`repository`, OR uncertainty ≥ 0.7.
- **Pair** is requested when risk is `high`, complexity is `high`,
  `behavioralPreservationRequired`, or uncertainty ≥ 0.4.
- Otherwise **Specialist**.

**First-reservation feasibility probe (mirrors the reserve logic).** Feasibility is a
**probe**, not a full per-mode cost profile: it checks, via `QuotaManager.canReserve`
(which enforces the protected implementation/review reserves), the **first reservation
each provider would make** in the mode. A later step can still hit the per-step quota
gate — that is handled by `runProviderStep` (which halts the mode without a simulated
write).

- Full Debate is probed feasible only if **both** providers can fund a `planning`
  reservation. If not → **downgrade to Pair** (`budgetConstrained: true`).
- Pair is probed feasible only if the owner can fund `planning` and the reviewer can
  fund `review`. If not → **downgrade to Specialist** (`budgetConstrained: true`).
- Specialist is the floor.

**Escalation override (M1).** An escalation-triggered task (risk `high`/`critical`,
`behavioralPreservationRequired`, or uncertainty ≥ 0.6) forces a **mandatory reviewer
review** in *every* mode (Pair/Full Debate always cross-review; Specialist escalates per
`specialistEscalation`). If that reviewer review cannot be funded, no cheaper mode can
complete, so selection does **not** downgrade to a mode that would only halt later;
instead it sets `humanApprovalRequired` and the run **pauses** for a human decision
(consistent with the critical-routing posture in `routing.ts`).

A **human can force a mode** (`forcedMode`); this bypasses risk/uncertainty
selection and is recorded (`humanForced: true`).

A shared pre-flight (`preflightPause`) runs in `runCollaboration` **and** in every mode
runner, so a direct mode call honors the same pause posture. When
`RoutingDecision.humanApprovalRequired` **or** `ModeSelection.humanApprovalRequired` is
set (e.g. a critical task whose preferred owner is unusable, or the M1 escalation
override above), the run **pauses** (`status: "paused"`) before any step — no execution,
no writes.

## Owner Selection (`routing.ts`)

Capability is the **primary** factor in `preferredOwner`; quota availability may
change `assignedOwner`, but a change is **always visible**
(`degradedFromPreferredOwner: true` + a recorded `reason`). Risk gates degradation:
low/medium may degrade to a usable alternate; high may degrade only with a recorded
reason, else pauses (`humanApprovalRequired: true`); critical never degrades
silently — an unusable preferred owner pauses for a human. A provider is "usable"
when a budget exists and an `implementation` reserve would pass the gate.

## A4.4 Review Protocol

`ReviewFindings.findings[*]` carry the nine mandated fields: `severity`, `category`,
`file`, `line`, `evidence`, `impact`, `requiredAction`, `missingTest`, `confidence`.
`reviewFindingsFromEvents` maps a reviewer's read-only stream into findings
deterministically:

- a `file.changed` event → **BLOCKER** (`unauthorized_write`; A4 forbids real
  writes, so a mutation under a read-only run is an unauthorized write attempt);
- an `approval.requested` → **MAJOR** (a gated action surfaced);
- each `warning.raised` → **MINOR**;
- a terminal `run.failed` → **MAJOR**;
- otherwise → a single **OBSERVATION** ("no blocking findings").

The **severity gate** (`severityGate`) passes when there is no open blocker/critical
finding, and returns the blocking findings otherwise. The gate is **ENFORCED in A4**:
in **Pair** and **Full Debate**, after the critique/cross-review stage the runtime
evaluates the gate and, if it fails (open blocker/critical), **HALTS the mode before
the simulated execute step** (`status: "halted"`, with the blocking findings recorded
as the halt reason). No execution proceeds with an open blocker/critical (Vision §15).
A5's writable **merge gate** builds directly on this enforced gate (it additionally
gates a real diff behind the `GovernanceDecision`). *(In Specialist the cross-vendor
review is the final step — there is no later execute step to gate — so the gate is
reported but there is nothing to halt.)*

## A4.5 Strategy Resolution (authority order)

`resolveStrategy` resolves competing options by the **authority order** (highest
first), **never** by agent majority or confidence:

```text
1. safety_invariants  2. spec            3. acceptance_criteria
4. code_evidence      5. tests           6. adrs
7. threat_model       8. risk_policy     9. governance_decision
```

The first authority source with a ruling for a candidate decides. Candidate
confidences are recorded but never break ties. The result is a validated
`StrategyDecision` naming `decidingAuthoritySource`, plus a flag
(`overrodeHighestConfidence`) that makes "authority beat the popular/confident
choice" observable. If **no** authority can decide, resolution **throws**
(`UnresolvedStrategyError`) rather than falling back to majority.

In the modes, evidence comes from `CollaborationContext.authorityEvidence`; when a
caller supplies none, a **synthesized, non-binding default** `spec` ruling backs the
assigned owner's option so a run always has grounding. That fallback is marked
**`defaulted: true`** on the `StrategyResolution` and carries an explicit rationale
("synthesized default, NOT a real spec ruling"), so the audit trail never claims a real
authority source decided the conflict. The default is still authority-keyed — never
agent majority.

## Determinism

No `Date.now`, `Math.random`, network, credentials or DB. All time derives from the
**injected clocks** inside the quota manager and the mock adapters (`ManualClock`,
frozen epoch). Execution ids are derived from a per-run counter (`a4-<phase>-
<provider>-<seq>`). Same inputs ⇒ byte-identical artifacts and step ordering
(asserted in the suite via a `JSON.stringify` equality check).

## Acceptance Criteria

- Each mode runs end-to-end over the **mock** adapters and produces artifacts that
  validate against the A1 Zod schemas (`AgentPlan`, `CrossReview`, `ReviewFindings`,
  `StrategyDecision`, `RoutingDecision`).
- Specialist runs a single owner and does **not** invoke the second provider unless
  a recorded risk/policy trigger fires.
- Pair runs proposal → critique → resolution → execution; Full Debate runs two
  independent plans → cross-review → resolution.
- Strategy resolution selects by authority source, demonstrably **not** by majority
  (a safety invariant beats a higher-confidence plan).
- A quota hard stop / reserve violation halts the mode **without** running the
  adapter (no simulated write); degraded routing surfaces when a provider reports
  exhaustion mid-stream. An uncommitted reservation is **released** if the adapter
  throws mid-stream (no capacity leak).
- The severity gate is **enforced**: a blocking critique/cross-review halts Pair and
  Full Debate **before** the simulated execute step (no execute step runs).
- An escalation-triggered task that cannot fund the mandatory reviewer review
  **pauses** for human approval (not a silent downgrade to a doomed cheaper mode); the
  same pause posture applies whether a mode is run via `runCollaboration` or directly.
- Determinism holds (same inputs → same artifacts/order).
- No real CLI, no network, no writes; `pnpm-lock.yaml` unchanged; provider-agnostic.

## Tests

`apps/api/src/test/collaborationRuntime.test.ts` — mode end-to-end coverage,
strategy authority order (incl. non-majority and the unresolved-throws case), quota
gating (reserve violation, hard stop, degraded routing), mode selection +
downgrades, owner selection, severity gate and determinism. Pure, deterministic,
mock-driven; no DB.
