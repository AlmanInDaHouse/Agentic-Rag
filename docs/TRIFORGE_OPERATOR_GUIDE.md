# TriForge — Operator Guide

How an operator runs a task end-to-end and understands it **without reading console logs**
(mandate §11 A9.7). This is the lifecycle reference for TriForge 1.0; it cross-links the
install, security, recovery and design docs.

See also: [Installation & Run](TRIFORGE_INSTALL.md) ·
[Threat model](specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md) ·
[Hardening & release](specs/HARDENING_SPEC.md) ·
[Product interface](specs/PRODUCT_INTERFACE_SPEC.md) ·
[Writable execution](specs/WRITABLE_EXECUTION_SPEC.md) ·
[Routing & learning](specs/ROUTING_LEARNING_SPEC.md) ·
[Competitive mode](specs/COMPETITIVE_MODE_SPEC.md) ·
[Execution state](context/TRIFORGE_EXECUTION_STATE.md).

## Lifecycle

### 1. Create

Compose a task in the **Task Composer** (A8.2): objective, scope, acceptance criteria,
risk, collaboration mode, budget, allowed read/write paths, blocked paths, max files
changed, timeout and repair limits. The composer validates against the SAME contracts the
backend enforces (the A1 `TaskSpecification` + the A5.2 allowed-path shape), so an invalid
task is rejected before it runs. The runtime then routes the task to a provider honestly
(A6: capability + quota + auth aware; never a fabricated route).

### 2. Observe

Watch the run live without console logs:

- **Provider status** (A8.1) — installed / version / auth / capabilities / quota, with
  honest unknown/estimated states.
- **Run timeline** (A8.3) — events ordered by **sequence number** (not timestamps), with
  gaps and deduplicated duplicates flagged.
- **Budget & quota** (A8.7) — configured / reserved / consumed / remaining shown
  separately; an unknown-capacity quota is never shown as guaranteed availability.

### 3. Audit

Understand every decision and change:

- **Artifact explorer** (A8.4) — the 12 A1 artifacts + the mutation ledger + raw evidence
  refs; nothing hidden, absence shown honestly.
- **Diff & review** (A8.5) — every changed file (never hidden), binary/deleted/renamed
  markers, findings + severity, and a banner if the diff changed **after** review
  (diff-hash ≠ reviewed-hash).
- **Governance** (A8.6) — the autonomous merge decision + rationale, policy/command
  decisions, risk/quota, rollback/cancel, and any human override shown as **audited**.

Writable changes happen **only inside isolated git worktrees**; the mutation ledger is
hash-chained and tamper-evident, and a run is fully reconstructable from artifacts + ledger
+ ordered events (A9.5 — no hidden state).

### 4. Cancel

Cancel from the **Recovery** panel (A8.8). Cancellation is honoured: the repair loop stops
and the run terminates in a bounded `cancelled` state (A9.1) — the worktree is never merged.

### 5. Recover

The **Recovery** panel (A8.8) offers only the actions the run state allows (a running run
is not resumable): resume, cancel, inspect-blocked, clean-stale-worktree, retry-auth,
retry-after-quota, abandon-repair, recover-artifacts, inspect-rollback. Across a restart,
the mutation ledger reloads and re-verifies its hash chain — a broken chain is rejected,
never silently loaded (A9.4) — and no secret was ever persisted to recover.

## Safety guarantees (mandate §15 / ADR 0031–0032)

TriForge never uses API keys, extracts tokens, automates provider login, writes `main`
directly or force-pushes it, disables branch protection, or bypasses CI checks. Every
writable capability is bound to a {threat, control, milestone, verification, recovery,
residual-risk} closure record; the security controls are demonstrated by the A0.5
acceptance tests (A9.2) and the failure surface is bounded by the chaos suite (A9.1).
