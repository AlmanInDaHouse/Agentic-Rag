# ADR 0035: Collaboration Runtime (Mock-First, No Real Writes)

## Date

2026-06-29

## Status

Accepted

Establishes Milestone A4 (Collaboration Runtime, owner mandate
`docs/instrucciones.md` §16): a pure orchestration layer that coordinates planning,
critique, resolution and review between two providers over the A1 contracts, driven
by the A2 mock adapters and the A2.3 quota manager. Builds on ADR 0027
(quota-aware orchestration), ADR 0031 (autonomous loop governance), ADR 0033
(provider contract boundary) and ADR 0034 (real read-only adapters). Canonical spec:
`docs/specs/COLLABORATION_RUNTIME_SPEC.md`.

## Context

A1 froze the provider-agnostic contracts; A2 added mock adapters, a black-box
harness and the quota manager; A3 added the real read-only adapters. None of the
**collaboration protocols** existed — the only multi-agent flow in the repository was
the legacy single-round mock debate (`DEBATE_ENGINE_SPEC.md`). The mandate §16
requires three modes (Specialist / Pair / Full Debate), a review protocol and a
strategy-resolution authority order, with an explicit closure: *TriForge can
coordinate planning, critique, resolution and review between providers without real
writes.*

Several forces shape the decision:

- Writable execution is **forbidden** until A0.5 (the threat model) and A5 deliver
  the per-capability binding. A4 must therefore be able to run an entire
  collaboration **without mutating anything**.
- The collaboration must be **testable without real providers** — the whole point of
  A2 — so A4 has to be drivable entirely by the mock adapters and the quota manager.
- Conflict resolution between two adversarial agents must not collapse into "two
  votes beat one" or "the most confident model wins"; the mandate is explicit that
  decisions follow an **authority order**, not agent majority.
- Mode escalation is expensive (more invocations); the quota spec is explicit that a
  richer mode must not be selected when the budget cannot fund it after the
  implementation/review reserves are protected.

## Decision

1. **A4 is pure orchestration, mock-first, read-only.** A new
   `apps/api/src/orchestration/` package composes the existing A1/A2/A3 pieces. It
   performs **no real writes, no real CLI execution, no network, no credentials and
   no DB**. Every "implementation" step is **simulated** by consuming an adapter's
   normalized `ProviderEvent` stream to its terminal; the execution request is always
   `readOnly: true`. The runtime is **not wired into the Fastify routes**.

2. **Every provider step is quota-gated** through one primitive (`runProviderStep`):
   `assertCanProceed` (full gate incl. reserve admissibility) → `reserve` → run the
   stream → `commit` on clean completion / `release` otherwise. A blocked gate means
   the adapter **never runs**, so a hard stop or reserve violation halts the mode with
   no execution and no simulated write. Observed quota/usage events are fed back so a
   mid-stream exhaustion surfaces as degraded routing that blocks the next step. The
   request is validated before the reserve, and stream consumption is wrapped in
   try/finally so an uncommitted reservation is **released** if the adapter throws
   mid-stream (no capacity leak). The **severity gate is enforced**: in Pair and Full
   Debate a blocking critique/cross-review HALTS the mode before the simulated execute
   step — no execution proceeds with an open blocker/critical (A5's merge gate builds on
   this).

3. **Strategy resolution is by authority order, never by agent majority/confidence.**
   `resolveStrategy` walks a fixed nine-source ranking (safety invariants → spec →
   acceptance criteria → code evidence → tests → ADRs → threat model → risk policy →
   governance decision) and the first source with a ruling for a candidate decides.
   Confidence is recorded but never breaks ties; with no authoritative grounding the
   resolver **throws** rather than falling back to a vote.

4. **Mode selection is risk/uncertainty-driven and budget-downgraded.** A mode whose
   first reservation the budget cannot fund after the reserves are protected is
   downgraded (Full Debate → Pair → Specialist), checked via `QuotaManager.canReserve`
   (a first-reservation feasibility probe, not a full per-mode cost profile). Downgrades
   and human-forced modes are recorded. A shared pre-flight (run by `runCollaboration`
   and every mode runner) pauses the run before any step when **routing** requires a
   human, or when **selection** does — an escalation-triggered task that cannot fund its
   mandatory reviewer review pauses for a human rather than downgrading to a doomed
   cheaper mode.

5. **No `GovernanceDecision` artifact in A4.** That artifact binds a writable
   capability (its `capabilityBinding` references the delivering milestone, controls
   and SATs). Binding it requires a real diff and the A0.5 capability rule, so it
   belongs to A5. A4 closes at planning/critique/resolution/review, as the mandate
   states.

6. **Provider-agnostic.** The only provider-named values are `ProviderId` members;
   there is no Codex/Claude-specific branching (ADR 0033).

## Consequences

- The collaboration protocols listed as "missing" in the vision (§21) now exist
  **mock-first**; writable execution stays missing and gated on A0.5 + A5.
- A5 builds directly on A4: it replaces the simulated, read-only execution step with
  a real, sandboxed, worktree-scoped writable step bound to a capability, and adds
  the `GovernanceDecision` over the resulting diff. The mode shapes, the review
  protocol and the authority-order resolver carry over unchanged.
- The authority-order resolver is a stable contract A5/A6 reference; treating its
  ranking and "never majority" rule as durable avoids re-litigating resolution policy
  per milestone.
- Because the runtime is deterministic and mock-driven, the full collaboration is
  exercised in CI with no provider installed, authenticated or billed.

## Alternatives Considered

- **Resolve conflicts by judge/confidence (extend the legacy debate judge).**
  Rejected: it is exactly the agent-majority/popularity rule the mandate forbids and
  it ignores the spec/safety/threat-model hierarchy.
- **Let A4 perform real, scoped writes behind an approval gate.** Rejected: writable
  execution is unauthorized until A0.5 + A5 bind each capability; A4 must run fully
  read-only.
- **Emit a `GovernanceDecision` in A4.** Rejected: it cannot be honestly bound to a
  capability without a real diff and the A0.5 rule; doing so would fabricate the
  binding fields.
