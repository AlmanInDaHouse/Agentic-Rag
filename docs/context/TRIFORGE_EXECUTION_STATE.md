# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 9 — A5.1, on branch `feat/a5-1-worktree-manager`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A4 — Collaboration runtime (`cc57793`, PR #39) → A1–A4 complete; then chores TD-1 (`9d1dca2`, PR #40) + TD-2 (`afc3607`, PR #41) |
| Active milestone | **A5.1 — Worktree Manager** (this PR; first piece of A5 writable execution) |
| `main` SHA | `afc3607` |
| Last `main` CI | `Validate` ✅ success (`afc3607`) |
| Open PRs | A5.1 (this branch). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is legacy 1.x, out of the A1–A9 roadmap, not blocking — still to be classified in a low-priority loop. |
| Blockers | none |
| Pending decisions | none |
| Next loop | **A5.2 — Allowed-Path Policy** (`readPaths/writePaths/blockedPaths/maxFilesChanged`; normalize→realpath→containment→symlink/hardlink/TOCTOU; block `.git`/home/external/secrets/other-worktrees/state-root). Then A5.3…A5.10. |

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
  - A5.1 Worktree Manager — **active** (this PR; ADR 0036)
  - A5.2 Allowed-Path Policy — next
  - A5.3 Safe Command Policy + Process Supervision — pending
  - A5.4 Owner/Reviewer enforcement — pending
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
| Loops executed | A0.4–A4 closed (Loops 0–6); Loop 7 TD-1, Loop 8 TD-2, Loop 9 A5.1 (active) |
| PRs created | +3 this session (TD-1 #40, TD-2 #41, A5.1 this); 11 total since A0.4 |
| PRs merged | 10 (#31 A0.4, #32 Gov, #33 A0.5, #34 A1, #35–#37 A2, #38 A3, #39 A4, #40 TD-1, #41 TD-2) |
| CI failures | 0 |
| Repair rounds | 9 (…A4; A5.1 self-review: 1 security finding — hardening dir moved off world-writable temp) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | …A4 as before; A5.1: 1 major (self-found) hardening-dir-in-temp → fixed pre-PR |
| Time-to-merge | same session per loop |
| Diff size | A5.1: 4 new src files (gitRunner+worktreeManager+index+test, ~900 LoC) + spec + ADR 0036 |
| Coverage | provider+orchestration suite 379 pure/no-DB; +19 A5.1 worktree tests (real-git integration) = 398 pure; full api suite ~532 |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 10 — A5.2 Allowed-Path Policy (mandate §A5.2; threat-model SAT-A5-1/2/3).
Branch off main AFTER A5.1 merges. Implement the contract + enforcement of
{readPaths, writePaths, blockedPaths, maxFilesChanged}:
  - relative-to-workspace, POSIX semantics, normalize → canonicalize → realpath →
    real containment; reject `..`/prefix-confusion/absolute escape; symlink + hardlink
    validation; validate a NONEXISTENT path via its nearest existing ancestor;
  - block `.git` and every worktree's `.git/objects` (shared object store, T-FS-08),
    credential stores, `$HOME`, other worktrees, the state root, `/mnt/c`/external;
  - enforce maxFilesChanged; typed errors; audited decisions; cover TOCTOU to a
    reasonable MVP level and record residual (RR-2).
Wire it onto the A5.1 worktree (block the worktree's own `.git`). SATs to demonstrate:
SAT-A5-1 (symlink/traversal/hardlink corpus rejected before open), SAT-A5-2 (`/mnt/c`
+ `$HOME` out-of-bounds), SAT-A5-3 (cross-worktree + `.git/objects` blocked).
Loop shape unchanged: spec/impl → gates (typecheck + vitest + lint:deps) → adversarial
review → repair → PR → CI → squash-merge → verify main → persist this file.
Then A5.3 Safe Command Policy + Process Supervision (reuse the A3 NodeProcessRunner
process-group model), A5.4 owner/reviewer, A5.5 mutation ledger, A5.6 gate runner,
A5.7 repair loop, A5.8 GovernanceDecision builder, A5.9 mock-first writable E2E,
A5.10 real pilot (only after A5.1–A5.9 green). Closure of A5 = the functional MVP.
```
