# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 12 — A5.4, on branch `feat/a5-4-owner-reviewer`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A5.3 — Safe Command Policy + Process Supervision (`cafca30`, PR #44; ADR 0038) |
| Active milestone | **A5.4 — Owner/Reviewer enforcement** (this PR; `execution/role`; ADR 0039) |
| `main` SHA | `cafca30` |
| Last `main` CI | `Validate` ✅ success (`cafca30`) |
| Open PRs | A5.4 (this branch). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is legacy 1.x, out of the A1–A9 roadmap, not blocking — still to be classified in a low-priority loop. |
| Blockers | none |
| Pending decisions | none |
| Next loop | **A5.5 — Diff Capture + Mutation Ledger** (append-only ledger: run/task/owner/worktree/branch/command/timestamp/file/operation/hash-before/hash-after/diff-ref/reason/tool/tests/policy-decision/sequence; detect unattributed changes + post-review modification; bind diff to GovernanceDecision; redact secrets; safe truncation; crash recovery). Then A5.6…A5.10. |

## Follow-ups / tech debt

- **TD-1 — RESOLVED** (`9d1dca2`, PR #40): `Clock`/`ManualClock` extracted to the
  neutral `apps/api/src/providers/clock.ts`; all importers (mock/quota/real + tests)
  re-pointed. Product code no longer depends on the `mock/` tree.
- **TD-2 — RESOLVED** (`afc3607`, PR #41): `request_rejected` added to the A1 error
  taxonomy (additive → contract `1.1.0`); the three A3 adapter refusals re-pointed off
  `provider_unavailable`.
- **TD-3 (new, from A5.1 review — deferred to A5.2/A5.3):** the worktree manager
  applies only a baseline path containment for its OWN state paths. The full
  allowed-path policy (block every worktree's `.git`/`.git/objects`, sibling
  worktrees, the state root, `$HOME`, `/mnt/c`; full normalize→realpath→containment→
  symlink/hardlink/TOCTOU on owner read/write paths) is A5.2/A5.3. `.gitattributes`
  smudge-filter neutralization on managed checkout is A5.4.

## Autonomy rule (Charter §2 / §3.2 correction, 2026-06-29)

> A pending **external** action that does not technically block the next milestone
> does **not** halt the autonomous loop. Register the risk, isolate the affected
> action, continue with safe work; stop only on a real hard stop; persist state
> before the context/session limit. (Triggered by the R-SEC-2 PAT-rotation pause,
> which was a compliance defect: PAT rotation is the owner's external action and
> does not block A2 — Git auth via GCM is unaffected. R-SEC-2 stays open as an
> external pending risk; the loop continues.)

## Milestone ladder (mandate / instrucciones.md §9 initial state + §13–§21 A1–A9)

- A0.1 Quota-aware orchestration — **merged**
- A0.2 Canonical project vision — **merged**
- A0.3 Official CLI integration + local auth — **merged**
- A0.4 WSL2-first execution substrate — **merged** (`36f84dc`)
- Governance Transition (Autonomous Loop Governance) — **merged** (`8d8ee00`)
- A0.5 Provider and repository threat model — **merged** (`e09c4d3`; ADR 0032)
- A1 Provider contracts — **merged** (`5cf7728`; PR #34; ADR 0033)
- A2 Mocks, harness, quota manager — **merged** (A2.1 `98b7c42` #35, A2.2 `ede0d55` #36, A2.3 `2ffa6fb` #37)
- A3 Real read-only adapters — **merged** (`9d5dac4`; PR #38; ADR 0034)
- A4 Collaboration runtime — **merged** (`cc57793`; PR #39; ADR 0035) → A1–A4 complete
- TD-1 Clock extraction — **merged** (`9d1dca2`; PR #40)
- TD-2 `request_rejected` error code — **merged** (`afc3607`; PR #41)
- A5 Controlled writable execution (MVP) — **active**, split A5.1–A5.10 (spec `WRITABLE_EXECUTION_SPEC.md`):
  - A5.1 Worktree Manager — **merged** (`909d54c`; PR #42; ADR 0036)
  - A5.2 Allowed-Path Policy — **merged** (`67d5956`; PR #43; ADR 0037)
  - A5.3 Safe Command Policy + Process Supervision — **merged** (`cafca30`; PR #44; ADR 0038)
  - A5.4 Owner/Reviewer enforcement — **active** (this PR; ADR 0039)
  - A5.5 Diff Capture + Mutation Ledger — pending
  - A5.6 Quality Gate Runner — pending
  - A5.7 Repair Loop — pending
  - A5.8 Autonomous Governance Decision — pending
  - A5.9 Writable E2E fixture (mock-first) — pending
  - A5.10 Low-risk real provider pilot — pending (gated on A5.1–A5.9 green)
- A6 Routing and learning — pending
- A7 Competitive mode — pending (not required for MVP)
- A8 Product interface — pending
- A9 Hardening and release — pending

## UNKNOWN

- Whether Node/pnpm/Git/Codex CLI/Claude Code are installed and authenticated
  inside the Ubuntu WSL2 distro (distro not started; A0.4 spec §5).
- The concrete OS-isolation mechanism for untrusted provider/repo code on WSL2
  (requirement recorded; design deferred to A4/A5; threat-model §14, RR-4).

## REQUIRES_VERIFICATION

- Provider event/usage/quota schemas against installed CLI versions (Vision §12,
  §17; quota spec assumptions, 2026-06-28).
- `localhost` Windows↔WSL2 interop per machine/config (A0.4 spec §8.6).
- Codex `--sandbox` runtime behavior against the installed version (A0.4 spec §8.8;
  threat-model T-CMP-01/02).
- Branch-protection enabled-state and required-check name (asserted in docs only;
  threat-model T-INT-08, R-SEC-7).
- pnpm 11 default dependency-build-script blocking without an `.npmrc`
  (threat-model T-GIT-05/08, R-SEC-10).

## Experiment metrics (running counters)

| Metric | Value |
|---|---|
| Loops executed | A0.4–A4 closed (0–6); TD-1 (7), TD-2 (8), A5.1 (9), A5.2 (10), A5.3 (11) merged; A5.4 (12) active |
| PRs created | +6 this session (TD-1 #40, TD-2 #41, A5.1 #42, A5.2 #43, A5.3 #44, A5.4 this); 14 total since A0.4 |
| PRs merged | 13 (…#42 A5.1, #43 A5.2, #44 A5.3) |
| CI failures | 1 (A5.3 first run: cross-platform binName bug — caught + fixed; re-run green) |
| Repair rounds | 10 (…A5.3: 1; A5.4: clean) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | …A5.1: 1 major (fixed); A5.2: 0; A5.3: 0 (1 minor + 1 CI-caught, fixed); A5.4: 0 |
| Time-to-merge | same session per loop |
| Diff size | A5.4: 3 new src files (ownership+roleEnforcer+index ~430 LoC) + test (~220) + ADR 0039 + spec §A5.4 |
| Coverage | +10 A5.4 role tests → 440 pure (+3 POSIX-only in CI) = 443; full api suite ~577 |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 13 — A5.5 Diff Capture + Mutation Ledger (mandate §A5.5; threat-model SAT-A5-6,
T-INJ-11, T-INT-04). Branch off main AFTER A5.4 merges. Implement an append-only
ledger recording per mutation: runId, taskId, owner, worktree, branch, command,
timestamp, file, operation (create/modify/delete/rename), hash-before, hash-after,
diff-ref, reason, tool, related tests, policy decision, sequence.
  - detect UNATTRIBUTED changes (a file changed without a ledger entry) and
    modification AFTER review (the diff hash changed since the reviewed hash);
  - bind the diff to the GovernanceDecision (diff hash); redact secrets before
    persisting; safe truncation of large diffs; hash artifacts; crash recovery.
  Compute the real worktree state (git status/hash) and compare to the ledger to
  catch a forged structured result (SAT-A5-6). Use the A5.4 role binding for owner
  attribution + the A5.1 worktree + A5.3 audit.
Loop shape unchanged: spec/impl → gates → adversarial review → repair → PR → CI →
squash-merge → verify main → persist this file.
Then A5.6 Quality Gate Runner, A5.7 repair loop, A5.8 GovernanceDecision builder, A5.9
mock-first writable E2E, A5.10 real pilot (only after A5.1–A5.9 green). Closure of A5
= the functional MVP.
```
