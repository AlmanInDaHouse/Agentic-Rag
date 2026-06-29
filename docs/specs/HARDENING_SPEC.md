# Hardening & Release Spec (A9)

**Status:** Active — grows across A9.1–A9.9 toward the TriForge 1.0 Definition of Done.
**Authority:** Owner mandate `docs/instrucciones-a5-a9.md` §11; ADR 0053. Built on the
A5–A8 runtime + UI.

A9 hardens the runtime against its failure surface, validates it against the A0.5 threat
model, and produces a release candidate. Sub-pieces: A9.1 failure & chaos testing, A9.2
security acceptance tests, A9.3 version drift, A9.4 recovery, A9.5 observability, A9.6
packaging/installation, A9.7 documentation, A9.8 release-candidate end-to-end cases, A9.9
release gate → TriForge 1.0 DoD.

## A9.1 Failure & Chaos testing

### Design (`apps/api/src/test/chaos.failureSurface.test.ts`; ADR 0053)

A chaos suite composes the REAL runtime components under INJECTED failures and asserts a
bounded, recorded terminal outcome — never a crash or a fabricated success (no
false-green). Deterministic (injected `ManualClock`; no real processes — real-process
chaos is exercised by the POSIX-guarded supervisor tests in CI):

- **Repair loop (A5.7)** bounds every failure mode: a throwing step → `failed`; an ignored
  cancellation → `cancelled`; no-progress (same diff + recurring findings) → `rejected`;
  an output-budget overrun → `exhausted`; a blocker finding → `blocked`. Never `accepted`
  under failure.
- **Ledger reconciliation (A5.5)** detects tampering: an unattributed worktree change or a
  post-hash mismatch → `tampered`; a clean attributed change → not tampered.
- **Routing (A6.3)** never fabricates a route: all-quota-exhausted → `hard_stop` (no paid
  fallback); no authenticated provider → `paused` (needs human).
- **Event contract (A1)** rejects a malformed event (unknown type / negative sequence),
  rather than silently accepting it.

### Verification

11 chaos tests (repair: crash/cancel/no-progress/output-flood/blocker; ledger:
tamper/clean/hash-mismatch; routing: hard-stop/pause; events: malformed rejected).

### Failure surface coverage map (mandate §11)

| Failure | Where asserted |
|---|---|
| provider crash | chaos: repair `failed` |
| malformed / duplicate / sequence-gap events | chaos: event-schema reject; A8.3 timeline dedupe/gap (web) |
| auth expiry | chaos: routing `paused` |
| quota exhaustion / rate limit | chaos: routing `hard_stop`; A6.3 tests |
| timeout / output flood | chaos: repair `exhausted`; A5.7 limit tests |
| ignored cancellation | chaos: repair `cancelled`; A5.3 group-kill (POSIX CI) |
| orphan process | A5.3 supervisor reaping (POSIX CI) |
| corrupted artifact / ledger | chaos: reconcile `tampered`; A5.5 chain-verify tests |
| stale worktree / worktree failure | A5.1 stale-detection + crash-recovery tests |
| unknown CLI version / unsupported capability | A3 adapter version/capability tests |

## A9.2 Security acceptance tests

### Design (`apps/api/src/test/security.acceptance.test.ts`; ADR 0053)

Executable acceptance criteria for the A0.5 threat-model controls — each test asserts a
control HOLDS, composing the REAL A5 components, mapped to its SAT id (the consolidated
security gate for the release candidate):

- **SAT-A5-1 (filesystem containment, T-FS-*):** the path policy refuses a write outside
  the allow-list, a write to `.git`, a path-traversal escape, and a symlinked-ancestor
  escape (POSIX; guarded where symlink needs privilege); allows an in-allow-list write.
- **SAT-A5-3 (command deny-by-default + no shell, T-EXE-*/T-CMP-*):** destructive (`rm`),
  network (`curl`) and privileged (`sudo`) commands are denied by default; arguments are
  NOT shell-interpreted (a metacharacter arg is literal data); an invalid spec is denied.
- **SAT-A5-5 (ledger redaction, T-INT-*):** a secret-shaped token in a mutation reason is
  masked.
- **SAT-A5-8 (governance anti-replay, T-INT-*):** a decision binding is accepted only
  against the exact bound state; a diff or gate-result changed after the decision (replay
  / TOCTOU) is rejected.

### Verification

14 acceptance tests across SAT-A5-1/3/5/8. Component-level controls (full symlink/hardlink
matrix, command classification, ledger chain, governance preconditions) remain covered by
the A5.2/A5.3/A5.5/A5.8 suites.

## A9.3 Version & capability drift

### Design (`apps/api/src/execution/drift/versionDrift.ts`; ADR 0053)

The runtime treats a drifted provider version / capability HONESTLY:
`checkVersionSupport(installed, floor)` → `unsupported` below the supported floor,
`unknown` for an absent/unparseable version (never silently trusted), `supported` at or
above the floor (`parseSemver`/`compareSemver` are pure). `checkCapability(requested,
snapshot)` → `unknown` with no snapshot, `refused` for a capability not in the snapshot
(never assumed) or a WRITABLE capability requested against a read-only snapshot (never
inferred), `granted` otherwise. The A8.1 provider-status view-model already surfaces
unknown/unsupported; A9.3 is the backend derivation.

### Verification

`versionDrift.test.ts` (8): semver parse/compare; below-floor → unsupported; absent/
unparseable → unknown; at/above floor → supported; no snapshot → unknown; present →
granted; absent → refused; writable-against-read-only → refused, writable-verified →
granted.

## A9.4 Recovery & restart

### Design (`apps/api/src/test/recovery.restart.test.ts`; ADR 0053)

Asserts the runtime RECOVERS across a simulated restart: the A5.5 mutation ledger reloads
from its persisted JSONL and re-verifies the hash chain (a tampered/broken chain THROWS,
never silently loads); a reconstructed mutation set matches the recorded one (no lost
mutations); a missing ledger file recovers gracefully (empty); and secrets were redacted
BEFORE persistence (nothing secret on disk to recover). Worktree stale-detection /
crash-recovery is covered by the A5.1 suite (real git worktrees, CI).

### Verification

`recovery.restart.test.ts` (4): reload + verify + reconstruct every mutation (head hash
preserved); a corrupted persisted chain is rejected on reload; a missing file recovers to
empty; no secret on disk to recover (redaction before write).

## A9.5 Observability — run reconstruction

### Design (`apps/api/src/execution/observability/runReconstruction.ts`; ADR 0053)

`reconstructRun(input)` asserts a run is FULLY RECONSTRUCTABLE from its artifacts +
mutation ledger + ordered event stream, with NO hidden state: every ledger entry is
attributable (owner / tool / reason / sequence); every real worktree change maps to a
ledger entry (an unrecorded mutation = hidden state); the events form a gapless ordered
stream with lifecycle bookends (a start + a terminal event); and the recorded diff hash
reconciles to the hash bound in governance. `reconstructable` is the conjunction. Pure +
deterministic.

### Verification

`runReconstruction.test.ts` (6): a fully observable run is reconstructable; a hidden-state
mutation (worktree change with no ledger entry) is detected; an unattributed ledger entry
is detected; a sequence gap is detected; missing lifecycle bookends are detected; a diff
that does not reconcile to the governance binding is detected.

## A9.6 Packaging & installation

### Design (`docs/TRIFORGE_INSTALL.md` + `apps/api/src/test/packaging.test.ts`; ADR 0053)

The product is installable + buildable + runnable from a fresh checkout: `pnpm install
--frozen-lockfile` → `pnpm -r build` (shared → api → web) → `pnpm typecheck` / `lint:deps`
/ `test` (the surface CI runs every PR). `TRIFORGE_INSTALL.md` documents the prerequisites
(Node ≥ 20.11 / pnpm 11 / Git; the Codex/Claude CLIs only for a REAL run — the MVP + tests
run on mocks), install/build/test steps, the run entrypoints (`pnpm dev` / `dev:api` /
`dev:web`), and the safety notes. A deterministic packaging-coherence test asserts the
manifests are consistent.

### Verification

Clean `pnpm -r build` succeeds locally (shared + api + web) and on CI.
`packaging.test.ts` (5): the toolchain is pinned (Node engine + pnpm packageManager); the
root exposes build/test/typecheck/lint:deps; every package builds + type-checks and the
apps run a test suite; the workspace + lockfile + install docs are present; the workspace
globs cover `packages/*` and `apps/*`.

## A9.7 Documentation completeness

### Design (`docs/TRIFORGE_OPERATOR_GUIDE.md` + `apps/api/src/test/docsCompleteness.test.ts`; ADR 0053)

`TRIFORGE_OPERATOR_GUIDE.md` documents how an operator runs a task end-to-end and
understands it WITHOUT console logs — the full lifecycle (create → observe → audit →
cancel → recover) mapped to the A8 panels, the safety guarantees, and cross-links to the
install, threat-model, hardening, product-interface, writable-execution, routing,
competitive and execution-state docs. A deterministic completeness check asserts the doc
set is present and coherent.

### Verification

`docsCompleteness.test.ts` (4): every key doc exists; the operator guide covers the
lifecycle verbs (create/observe/audit/cancel/recover); it cross-references the install /
threat-model / hardening / execution-state docs; it states the core safety guarantees
(isolated worktrees; never api-keys / force-push / main).

## A9.8 Release-candidate end-to-end cases

### Design (`apps/api/src/test/rc.acceptance.test.ts`; ADR 0053)

An RC acceptance INDEX ties the release-candidate scenarios to the TriForge 1.0 DoD. The
heavy real-git scenarios live in their own suites (CI runs them every PR); the index
asserts they are present and re-asserts the cross-cutting RC invariants by composing the
real building blocks deterministically:

1. writable run end-to-end in an isolated worktree → `writableRun.e2e.test.ts` (real git).
2. competitive run, winner by evidence → `competitiveRun.e2e.test.ts` (real git).
3. a run that must NOT merge (blocker / tampered ledger / failed gates) → governance
   `decideVerdict` never returns merge.
4. quota/auth degradation pauses or hard-stops (never a fabricated route) → `routeQuotaAware`.
5. recovery after restart (ledger reloads + verifies its chain) → `MutationLedger.load`.

### Verification

`rc.acceptance.test.ts` (4): every RC scenario suite is present (writable E2E, competitive
E2E, chaos, SAT, recovery, observability); RC-4 degradation pauses/hard-stops; RC-3 a
blocker/tampered/failed-gate run never merges; RC-5 a run recovers after a restart.

## A9.9 Release gate → TriForge 1.0 Definition of Done

### Design (`docs/RELEASE_NOTES_1.0.md` + `apps/api/src/test/releaseGate.test.ts`; ADR 0053)

The terminal milestone. `RELEASE_NOTES_1.0.md` declares the TriForge 1.0 Definition of Done
with a checklist mapping each DoD item to its executable evidence (a test suite, spec, ADR
or the green CI gate) — NOT a narrative. `releaseGate.test.ts` asserts the declaration is
present and each milestone's primary evidence artifact (A1–A9 specs + the real-git E2E +
every A9 acceptance suite) actually exists. The authoritative full-gate green is the CI
`Validate` job (build, typecheck, lint:deps, the full api+web test suite, code-graph,
audit) on every PR; `main` is always green.

### Verification

`releaseGate.test.ts` (3): the DoD declaration exists and states "Definition of Done: MET";
every A1–A9 milestone evidence artifact exists; every A9 acceptance suite is present. The
release gate itself is the green CI on this PR.

## A9 closure — TriForge 1.0 DoD MET

A9 is **complete**: chaos/failure-surface (A9.1), A0.5 security acceptance (A9.2), version
drift (A9.3), recovery (A9.4), observability (A9.5), packaging (A9.6), documentation
(A9.7), RC cases (A9.8), release gate (A9.9). With A1–A8 complete and the release gate
green, **TriForge 1.0 Definition of Done is MET** with executable evidence. Remaining open
items (A5.10 real provider pilot, PR #26 legacy, R-SEC-2 owner PAT rotation) are
external/non-blocking and stay registered.