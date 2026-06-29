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
| A6.1 | Task Profiler (`orchestration/taskProfiler.ts`) | **this PR** (ADR 0045) |
| A6.2 | Static capability router | planned |
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
