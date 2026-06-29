# Routing & Performance Learning Spec (A6)

**Status:** Active — grows across A6.1–A6.6.
**Authority:** Owner mandate `docs/instrucciones-a5-a9.md` §8; Vision §16 (TaskProfile /
RoutingDecision); ADR 0027 (quota-aware orchestration); ADR 0045 (task profiler).

A6 decides WHICH provider owns a task, from EVIDENCE rather than stereotype, and learns
per-repository performance — without ever optimizing for speed over security/correctness
(mandate §8). A6 is decision-making over read-only signals; it enables no new writable
capability, so it carries no A0.5 capability binding (unlike A5).

## 0. Architecture

| Piece | Component | Status |
|---|---|---|
| A6.1 | Task Profiler (`orchestration/taskProfiler.ts`) | merged (ADR 0045) |
| A6.2 | Static capability router (`orchestration/staticRouter.ts`) | **this PR** (ADR 0046) |
| A6.3 | Quota-aware router (extends A4 `orchestration/routing.ts`) | planned |
| A6.4 | Execution metrics | planned |
| A6.5 | Repository-specific profiles | planned |
| A6.6 | Protected adaptive router | planned |

The A4 `orchestration/routing.ts` already produces a `RoutingDecision` (owner selection
+ quota-gated degradation) from a `TaskProfile`; A6.1 is the missing piece that PRODUCES
the `TaskProfile` that router consumes.

---

## A6.1 Task Profiler

### Objective

Turn a `TaskSpecification` (+ optional repository signals) into a structured, validated
`TaskProfile` (A1 contract) plus an extended profile, so the routers pick a provider
from evidence.

### Design (`orchestration/taskProfiler.ts`; ADR 0045)

`profileTask(spec, signals?, override?)` computes:

- the A1 `TaskProfile`: `taskKind` (feature/bugfix/refactor/migration/test/docs/security
  by spec keywords), `complexity` (from scope+invariants+files), `risk` (driven by
  security sensitivity + blast radius + behavioural preservation), `blastRadius` (from
  the files touched, else scope size), and the `reasoningDepthRequired` /
  `repetitiveWorkRatio` / `testBurden` ratios + `behavioralPreservationRequired`;
- an extended profile: `language` (inferred from extensions or a hint), `framework`,
  `securitySensitivity`, `migrationImpact`, `contextSize`, the required provider
  capabilities, and `profilerVersion`.

It is **validated** (parsed against `TaskProfileSchema`), **deterministic / reproducible**
(pure heuristics — no clock, no randomness), **versioned** (`profilerVersion`),
**overrideable** (an explicit override wins and the overridden fields are recorded for
audit), and **auditable** (returns the rationale).

The profiler classifies the TASK, not the provider — it encodes no provider stereotype
(that constraint is the A6.2 router's, where each rule must carry evidence/confidence/
fallback).

### Verification

`taskProfiler.test.ts` (9): feature/security/refactor/migration classification, blast
radius from files, language inference, schema validity, reproducibility (same input →
identical output), versioning, override-wins + recorded, invalid-override rejected,
no-op override not recorded.

### Open follow-ups

- A6.2 static router consumes the profile with explicit, evidence-bearing rules.
- A6.3 combines the profile with quota/auth/history (extends the A4 router).

---

## A6.2 Static capability router

### Objective

Map a `TaskProfile` (A6.1) to a per-provider **capability score** that the A4
owner-selection (`routing.ts`) consumes as its PRIMARY factor — honestly, with no
provider stereotypes.

### Design (`orchestration/staticRouter.ts`; ADR 0046)

`routeStatically(profile, extended, providers, opts?)` starts every provider at a
NEUTRAL baseline (0.5) and applies a configurable rule set. Each `CapabilityRule`
carries an **evidence basis, confidence, fallback, reason and version**; rules return
per-provider score deltas (clamped to 0–1) or `null` when not applicable.

The DEFAULT rules are conservative and evidence-grounded — TriForge has **no repository
performance evidence yet** (that is A6.4/A6.5), so it does NOT encode "provider X is
better at Y":

- `required-capability-snapshot` (confidence 1): a provider whose version-bound
  capability snapshot lacks a capability the task REQUIRES is driven to 0 (a hard fact,
  not a stereotype); neutral when no snapshot is available.
- `neutral-baseline` (confidence 0.5): documents the no-stereotype stance and applies
  no adjustment — providers are equally capable until measured.

The result (scores + the applied rules with their evidence/confidence) is auditable,
versioned and overridable (pass custom evidence-bearing rules, e.g. from A6.4/A6.5
metrics). Pure + deterministic.

### Verification

`staticRouter.test.ts` (5): neutral default (no stereotype), required-capability drives
a provider to 0 (recorded with evidence/confidence), neutral when both support all
required caps, overridable custom rule (versioned + recorded), reproducible.

### Open follow-ups

- A6.3 combines these scores with quota/auth/reservations/risk/history/confidence and
  the degradation rules (extends `orchestration/routing.ts`).
- A6.4/A6.5 add learned, evidence-bearing rules from repository metrics.
