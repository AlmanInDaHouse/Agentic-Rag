# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 14 — A5.6, on branch `feat/a5-6-quality-gate-runner`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A5.5 — Diff Capture + Mutation Ledger (`31446da`, PR #46; ADR 0040) |
| Active milestone | **A5.6 — Quality Gate Runner** (this PR; `execution/gates`; ADR 0041) |
| `main` SHA | `31446da` |
| Last `main` CI | `Validate` ✅ success (`31446da`) |
| Open PRs | A5.6 (this branch). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is legacy 1.x, out of the A1–A9 roadmap, not blocking — still to be classified in a low-priority loop. |
| Blockers | none |
| Pending decisions | none |
| Next loop | **A5.7 — Repair Loop** (owner implementation → gates → reviewer findings → owner repair → gates again; bounded by repair rounds / quota / wall-time / commands / files / output / repeated-finding + no-progress detection / cancellation / hard stop; terminal state ∈ accepted/rejected/blocked/exhausted/cancelled/failed; no infinite loops). Then A5.8…A5.10. |

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
  - A5.4 Owner/Reviewer enforcement — **merged** (`f2784b4`; PR #45; ADR 0039)
  - A5.5 Diff Capture + Mutation Ledger — **merged** (`31446da`; PR #46; ADR 0040)
  - A5.6 Quality Gate Runner — **active** (this PR; ADR 0041)
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
| Loops executed | A0.4–A4 (0–6); TD-1..A5.5 merged (7–13); A5.6 (14) active |
| PRs created | +8 this session (TD-1 #40 … A5.5 #46, A5.6 this); 16 total since A0.4 |
| PRs merged | 15 (…#44 A5.3, #45 A5.4, #46 A5.5) |
| CI failures | 1 (A5.3 first run: cross-platform binName — caught + fixed; re-run green) |
| Repair rounds | 10 (A5.5: 1 pre-PR NUL fix; A5.6: 1 pre-PR NUL fix — both caught in diff review) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | A5.4–A5.6: 0 (2 pre-PR NUL-byte fixes — Write-tool template-literal artifact, scanned each PR) |
| Time-to-merge | same session per loop |
| Diff size | A5.6: 3 new src files (qualityGateRunner+gateTampering+index ~270 LoC) + test (~180) + ADR 0041 + spec §A5.6 |
| Coverage | +7 A5.6 gate tests → 460 pure (+3 POSIX-only in CI) = 463; full api suite ~597 |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 15 — A5.7 Repair Loop (mandate §A5.7). Branch off main AFTER A5.6 merges.
Implement the bounded loop: owner implementation → quality gates (A5.6) → reviewer
findings → owner repair → gates again, with limits on repair rounds / quota /
wall-time / commands / files / output, plus repeated-finding + no-progress detection,
cancellation and a hard stop. The loop MUST terminate in a state ∈ {accepted,
rejected, blocked, exhausted, cancelled, failed}; no infinite loops. Compose A5.4
(owner/reviewer) + A5.6 (gates) + A5.5 (ledger/diffHash for progress detection).
  Tests: converges to accepted when gates pass + no findings; exhausted at the round
  limit; no-progress detection (a repeated finding / unchanged diff) stops the loop;
  cancellation/hard-stop terminal; blocked on an open blocker finding.
Loop shape unchanged: spec/impl → gates → adversarial review → repair → PR → CI →
squash-merge → verify main → persist this file.
Then A5.8 GovernanceDecision builder, A5.9 mock-first writable E2E, A5.10 real pilot
(only after A5.1–A5.9 green). Closure of A5 = the functional MVP.
```
