# TriForge Execution State

**Purpose:** current operational state only — not a diary. Reconstructed from Git
and GitHub at the start of every loop; this file records the conclusion, not the
history. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.1).

**Last updated:** 2026-06-29 (Loop 16 — A5.8, on branch `feat/a5-8-governance-decision`)

## Snapshot

| Field | Value |
|---|---|
| Last closed milestone | A5.7 — Repair Loop (`ea36465`, PR #48; ADR 0042) |
| Active milestone | **A5.8 — Autonomous Governance Decision** (this PR; `execution/governance`; ADR 0043) |
| `main` SHA | `ea36465` |
| Last `main` CI | `Validate` ✅ success (`ea36465`) |
| Open PRs | A5.8 (this branch). NOTE: pre-existing PR #26 "ingest Code Graph context pack" is legacy 1.x, out of the A1–A9 roadmap, not blocking — still to be classified in a low-priority loop. |
| Blockers | none |
| Pending decisions | none |
| Next loop | **A5.9 — Writable E2E fixture (mock-first)** — the MVP demonstration. Wire the full pipeline over the mock providers: create worktree (A5.1) → assign owner (A5.4) → apply allowed paths (A5.2) → owner implements → capture mutations (A5.5) → run gates (A5.6) → reviewer findings → repair (A5.7) → GovernanceDecision (A5.8) → commit → controlled merge → cleanup. Plus negative cases (.git write, out-of-workspace, reviewer write, blocked command, test deletion, CI weakening, diff-changed-after-review, approval-hash mismatch, quota exhausted, repair-limit, cleanup failure). Then A5.10 real pilot (gated on A5.1–A5.9 green; if writable capability can't be safely verified, leave BLOCKED + demonstrate MVP with mock + continue to A6). |

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
  - A5.6 Quality Gate Runner — **merged** (`a604336`; PR #47; ADR 0041)
  - A5.7 Repair Loop — **merged** (`ea36465`; PR #48; ADR 0042)
  - A5.8 Autonomous Governance Decision — **active** (this PR; ADR 0043)
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
| Loops executed | A0.4–A4 (0–6); TD-1..A5.7 merged (7–15); A5.8 (16) active |
| PRs created | +10 this session (TD-1 #40 … A5.7 #48, A5.8 this); 18 total since A0.4 |
| PRs merged | 17 (…#46 A5.5, #47 A5.6, #48 A5.7) |
| CI failures | 1 (A5.3 first run: cross-platform binName — caught + fixed; re-run green) |
| Repair rounds | 10 (A5.5/A5.6: pre-PR NUL fixes; A5.7: typecheck fix; A5.8: clean) |
| Regressions | 0 |
| Reverts | 0 |
| Blockers hit | 0 |
| Human interventions | 1 (auth-method decision) |
| Findings by severity (reviews) | A5.4–A5.8: 0 (pre-PR fixes caught locally) |
| Time-to-merge | same session per loop |
| Diff size | A5.8: 2 new src files (governanceGate+index ~270 LoC) + test (~150) + ADR 0043 + spec §A5.8 |
| Coverage | +13 A5.8 governance tests → 481 pure (+3 POSIX-only in CI) = 484; full api suite ~618 |
| Quota usage | not yet instrumented (no provider runs) |
| Reverted decisions | 0 |
| Security incidents | 1 (PAT pasted into chat — R-SEC-2; external, owner must rotate; non-blocking) |
| Context recoveries | 1 (Loop 4 reconstructed state from Git after user resume) |

## Exact next loop

```text
Loop 17 — A5.9 Writable E2E fixture (mock-first) — the MVP demonstration (mandate
§A5.9). Branch off main AFTER A5.8 merges. Wire the full writable pipeline end to end
over a controlled FIXTURE repo using the MOCK owner/reviewer (no real provider):
  create worktree (A5.1) → assign single owner (A5.4) → apply allowed paths (A5.2) →
  owner implements a bounded change → capture mutations in the ledger (A5.5) → run the
  quality gates (A5.6) → reviewer produces findings → repair loop (A5.7) →
  GovernanceDecision (A5.8, re-derived) → commit on the worktree branch → controlled
  merge → cleanup. Demonstrate the POSITIVE path reaches verdict=merge, AND the
  negative cases each block: .git write, out-of-workspace write, reviewer write,
  blocked command, test deletion, CI weakening, diff-changed-after-review, approval-
  hash mismatch, quota exhausted, repair-limit reached, cleanup failure.
  This is real writes confined to an isolated worktree/fixture — NEVER the live tree
  or main. Closing A5.9 demonstrates the functional MVP with mocks.
Loop shape unchanged. Then A5.10 real provider pilot — ONLY after A5.1–A5.9 green;
re-verify CLI versions/auth without reading creds; if writable capability cannot be
safely verified (the WSL distro / Codex+Claude install+auth is REQUIRES_VERIFICATION),
leave the pilot BLOCKED with the exact missing verification recorded, keep the MVP
demonstrated via the mock adapter, and continue to A6 (routing).
```
