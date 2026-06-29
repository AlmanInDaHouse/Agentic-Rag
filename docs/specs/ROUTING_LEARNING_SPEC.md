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
| A6.2 | Static capability router (`orchestration/staticRouter.ts`) | merged (ADR 0046) |
| A6.3 | Quota-aware router (`orchestration/quotaAwareRouter.ts`) | merged (ADR 0047) |
| A6.4 | Execution metrics (`orchestration/executionMetrics.ts`) | merged (ADR 0048) |
| A6.5 | Repository-specific profiles (`orchestration/repositoryProfiles.ts`) | merged (ADR 0049) |
| A6.6 | Protected adaptive router (`orchestration/adaptiveRouter.ts`) | **this PR** (ADR 0050) — **closes A6** |

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

---

## A6.3 Quota-aware router

### Objective

Combine the A6.2 capability scores with provider availability + quota + reservations +
authentication + task risk + historical performance into the end-to-end routing
decision, with explicit terminal classification.

### Design (`orchestration/quotaAwareRouter.ts`; ADR 0047)

`routeQuotaAware(input)`:
1. runs the A6.2 static router → capability scores (honest, no stereotype);
2. applies the **authentication gate** — an unauthenticated provider is ineligible
   (capability zeroed + passed to A4 as `ineligibleProviders`, so it is never
   preferred nor a degradation target);
3. calls the A4 owner-selection (`routing.ts`), which already does the risk-gated quota
   degradation (low=fallback allowed, medium=visible degraded, high=recorded-or-pause,
   critical=never-silent), reads usability from the A2.3 quota manager (quota UNKNOWN
   scored ≤0.5, never a fabricated 1.0), and produces a validated `RoutingDecision`;
4. classifies the terminal status: `routed`, `paused` (no usable provider — auth/quota,
   recoverable by owner action), or `hard_stop` (ALL providers hard-stopped/quota-
   exhausted — await quota reset; **NO paid fallback**).

A small additive change to A4 `routing.ts` adds `ineligibleProviders` (default none,
backward-compatible) so the auth gate plugs into the existing degradation logic without
duplicating it. Pure + deterministic.

### Verification

`quotaAwareRouter.test.ts` (5): routes when both authenticated+budgeted; auth-gates an
unauthenticated provider and routes to the other; pauses (not hard-stop) when none
authenticated; hard-stops when all quota-exhausted (no paid fallback); never presents an
unknown-capacity quota as guaranteed availability.

### Open follow-ups

- A6.4 records execution metrics (protected against duplication / cross-run
  contamination / unverified self-reporting / missing samples / cherry-picking).
- A6.5 repository profiles; A6.6 protected adaptive router (min sample + confidence +
  fallback + human override + explainable; security/correctness over speed).

---

## A6.4 Execution metrics

### Objective

Record per-run outcomes as evidence the adaptive router (A6.6) and repository profiles
(A6.5) can learn from — protected against the five ways metrics could lie.

### Design (`orchestration/executionMetrics.ts`; ADR 0048)

`MetricsStore` is an append-only store of `RunMetric` samples (task type, owner,
reviewer, provider versions, mode, first-pass success, repair rounds, findings,
regressions, wall time, command count, files changed, diff size, governance decision,
merge result, rollback, failure reason, provenance). Protections:

- **duplication** — `record` is idempotent on the `(runId, taskId)` key; a repeat is
  ignored (one run/task = one sample);
- **cross-run contamination** — every sample carries its `runId`; the store keys by it
  and never overwrites another run's sample;
- **unverified provider self-reporting** — `provenance ∈ {re_derived, provider_reported}`;
  `aggregate` counts ONLY `re_derived` samples (gates/ledger/governance), reporting how
  many `provider_reported` it excluded;
- **missing samples** — an aggregate over zero matching samples reports `"unknown"`,
  never a fabricated 0/rate;
- **cherry-picking** — the store is append-only (no delete API); aggregates use ALL
  matching samples and report the sample count `n`.

Pure + deterministic (timestamps supplied by the caller).

### Verification

`executionMetrics.test.ts` (6): dedup (idempotent), no cross-run contamination,
provider-reported excluded from aggregates (retained for audit), unknown-not-zero on no
samples, append-only + `n` reported (no delete API), filter by task type + owner.

### Open follow-ups

- A6.5 builds repository-specific profiles from these samples (no auto-generalization).
- A6.6 adaptive router consumes them only above a minimum sample + confidence.

---

## A6.5 Repository-specific profiles

### Objective

Learn, FROM THIS REPOSITORY'S metrics only, "in repo R, provider X performs better for
task family Y", and emit evidence-bearing `CapabilityRule`s the routers can consume —
without ever generalizing to other repositories.

### Design (`orchestration/repositoryProfiles.ts`; ADR 0049)

`buildRepositoryProfile(store, repoId, providers, taskFamilies, opts?)` reads the A6.4
`MetricsStore` aggregates per (task family, provider) and derives a rule only when BOTH
providers have at least `minSample` re-derived samples AND their first-pass success
rates differ by at least `minDifference`. The derived `CapabilityRule`:

- is **repo-scoped** — it fires only when `RouterContext.repoId` matches the repo it was
  learned from (added to `RouterContext`), so it is inert in any other repository (no
  auto-generalization);
- records `n` per provider and a `confidence` from the observed difference, with the
  evidence basis citing the repo + counts;
- favors the better provider for that task family by a delta proportional to confidence.

A task family with data but below the gates is reported in `unknownFamilies` (UNKNOWN,
never a fabricated preference). Pure + deterministic.

### Verification

`repositoryProfiles.test.ts` (3): a rule forms only above the sample + difference gates
(equal rates / too-few samples → UNKNOWN); the derived rule fires ONLY in its repo +
task family (different repo / family → inert); insufficient data → no rule + UNKNOWN.

### Open follow-ups

- A6.6 adaptive router applies these rules above a minimum-sample + confidence gate,
  with human override and explainable decisions; sparse data must not dominate.

---

## A6.6 Protected adaptive router — closes A6

### Objective

Compose the A6.2 static (neutral) baseline with the A6.5 repository-learned rules into
an adaptive capability score, but ONLY behind protective guards, falling back to static
routing otherwise — every decision explainable.

### Design (`orchestration/adaptiveRouter.ts`; ADR 0050)

`routeAdaptive(input)` applies learned rules only when ALL guards hold:

- **human override** — if provided, it wins outright (audited);
- **minimum sample + confidence** — only learned rules with `confidence ≥ minConfidence`
  qualify (A6.5 already sample-gated them);
- **fallback exists** — the static neutral routing is always the fallback;
- **explainable** — the result carries the rule trace + guard outcomes;
- **sparse data must not dominate** — learned deltas are bounded (A6.5) and only
  qualifying rules apply; with none, routing stays neutral;
- **security/correctness over speed** — for a critical-risk or security-sensitive task,
  the learned (speed-oriented) rules are NOT applied; routing stays conservative.

It returns the mode (`override`/`adaptive`/`static`), the capability scores, the
preferred owner, the activated rules, whether the fallback was used, the guard outcomes
and an explanation. Pure + deterministic.

### Verification

`adaptiveRouter.test.ts` (6): applies a confident learned rule (adaptive); falls back to
static when no rule meets the confidence gate (sparse); does NOT apply learned routing to
a security-sensitive task; honours a human override outright; is explainable (rule trace +
guard outcomes); does not generalize a rule to another repository.

---

## A6 closure

A6 is **complete**: Task Profiler (A6.1) + static capability router (A6.2) + quota-aware
router (A6.3) + protected execution metrics (A6.4) + repository-specific profiles (A6.5)
+ protected adaptive router (A6.6). Routing is honest (no stereotypes), quota/auth-aware
(unknown ≠ available, exhausted = hard stop, no paid fallback), learns only from
re-derived, deduplicated, repo-scoped, sample-gated evidence, and every decision is
explainable with a human override and a static fallback. Next: A7 Competitive Mode.
