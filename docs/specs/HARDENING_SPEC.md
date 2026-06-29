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

## Open follow-ups

- A9.2 security acceptance tests (A0.5 threat model SATs); A9.3 version drift; A9.4
  recovery; A9.5 observability; A9.6 packaging/installation; A9.7 docs; A9.8 RC cases;
  A9.9 release gate → TriForge 1.0 DoD.