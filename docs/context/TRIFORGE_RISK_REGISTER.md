# TriForge Risk Register

**Purpose:** canonical register of active risks. Each risk: ID, description,
impact, qualitative probability, mitigation, status, owner, responsible milestone,
evidence. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.2).

**Last updated:** 2026-06-29 (Loop 13 — A5.5)

Owner is `AlmanInDaHouse` for accept/override decisions; Claude Code owns
mitigation execution unless noted. Probability/impact are qualitative
(low/medium/high).

## Governance

| ID | Description | Impact | Prob | Mitigation | Status | Milestone | Evidence |
|---|---|---|---|---|---|---|---|
| R-GOV-1 | Autonomous merge of a defective change reaches `main` | High | Med | Required CI, severity-gated adversarial review, squash+revert, post-merge verify, regression tests | Open (controlled) | Governance | ADR 0031 |
| R-GOV-2 | Scope creep across unrelated milestones in one PR | Med | Med | One branch per unit; PR-size discipline | Open (controlled) | Governance | Charter §7 |
| R-GOV-3 | Silent weakening of gates to get green | High | Low | Prohibited; CI changes reviewed; "no weakening" invariant | Open (controlled) | Governance | Charter §3.3 |
| R-GOV-4 | Loss of canonical state across sessions/context windows | High | Med | Four canonical context files reconstructed from Git/GitHub each loop | Open (controlled) | Governance | Charter §6 |
| R-GOV-5 | Approval/output spoofing or context poisoning drives a bad merge | High | Med | Deferred to A0.5 threat model; gates writable execution | Open | A0.5 | Mandate §12 |

## Credentials and security

| ID | Description | Impact | Prob | Mitigation | Status | Milestone | Evidence |
|---|---|---|---|---|---|---|---|
| R-SEC-1 | GCM-token override erodes the credential boundary | High | Low | In-memory only, never persisted/printed, scoped to repo PR/merge; owner rotates after run | Open (accepted, scoped) | Governance | Charter §3.2 |
| R-SEC-2 | PAT pasted into chat is exposed in the transcript | High | High (already occurred) | Owner must revoke/rotate the PAT; not reproduced/searched/persisted by the loop; Git auth uses the GCM token, not the pasted PAT | **External pending (owner) — non-blocking** | Governance | autonomous-loop-authorization memory |
| R-SEC-3 | Untrusted repository content (prompt injection, hostile scripts, symlink/path escape) on future writable runs | High | High | Full threat model + controls before any writable adapter | Open | A0.5 | Mandate §12 |

**R-SEC-2 reconciliation with the stop-on-exposure rule (mandate §3.3 / §24).** The
mandate treats a possible credential exposure as a stop condition. This is
reconciled, not normalized: the exposure was **owner-initiated** (the owner pasted
their own PAT) and **owner-controlled**; the loop did not exfiltrate, persist or
reproduce the token and authenticates via the **separate GCM path**, not the pasted
PAT. The owner — the §24 stop authority, who may accept exceptional risk (§2) —
explicitly directed continuation and owns the remediation. The event is counted as
a security incident (Execution State); **PAT rotation by the owner is required**.

## Substrate and providers (carried from prior milestones)

| ID | Description | Impact | Prob | Mitigation | Status | Milestone | Evidence |
|---|---|---|---|---|---|---|---|
| R-SUB-1 | Repo on `/mnt/c` causes severe perf/fidelity penalty | Med | Med | Substrate check refuses/warns; repo on Linux fs | Open | A0.4→A5 | ADR 0030, spec §8.2 |
| R-SUB-2 | Kill of lead PID only orphans the process tree on POSIX | High | High (current harness) | Future process-group ownership (setsid + negative PGID) | Open | A2 | A0.4 spec §8.5 |
| R-SUB-3 | EOL drift (no `.gitattributes`, `core.autocrlf`) between Windows/WSL checkouts | Low | Med | Normalization policy candidate follow-up | Open | A0.4 follow-up | A0.4 spec §15 |
| R-PRV-1 | Provider CLI command/flag/output drift breaks adapters | High | Med | Capability snapshots invalidated by version; `unknown` when unverified | Open | A1–A3 | Vision §12/§25 |
| R-PRV-2 | Opaque/partial quota signals; expired auth mid-run | Med | Med | `unknown` state, hard stop on exhaustion, manual resume, no paid fallback | Open | A2 | Quota spec, ADR 0027 |
| R-PRV-3 | Provider event schemas not contractually guaranteed | Med | Med | Normalize + preserve raw evidence; reverify per version | Open | A1/A3 | Vision §12 |

## Provider/repository threat model (A0.5)

Net-new top risks surfaced by the A0.5 threat model
(`docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` §12; ADR 0032). "TM T-*" =
threat IDs in that catalog. These do not restate the already-booked R-GOV-5
(spoofing/poisoning → bad merge) or R-SEC-3 (untrusted repo content).

| ID | Description | Impact | Prob | Mitigation (control → milestone) | Status | Milestone | Evidence |
|---|---|---|---|---|---|---|---|
| R-SEC-4 | No OS-level sandbox; any path escape on WSL2 reaches `/mnt/c` + `$HOME` → host/credential compromise | High | Med | A5.3 realpath containment + out-of-bounds roots; A0.5/A4 OS-isolation decision; A9 path tests | **Open (partially mitigated — A5.2)**: owner read/write paths are now contained by canonicalize→realpath→containment with symlink/hardlink/traversal refusal (SAT-A5-1/2/3 demonstrated); residual RR-2 (TOCTOU) + RR-4 (no OS sandbox) accepted; ADR 0037 | A4/A5 | TM T-FS-07, T-CMP-01/05/08 |
| R-SEC-5 | Secret leakage via full-env forwarding + unredacted output capture (the `runner.ts` seed pattern) | High | High | A5.4 env allowlist; redact all captured streams; A2 "no secret leakage" gate | **Open (partially mitigated — A5.3)**: the command supervisor forwards only an env allowlist (credential-shaped names dropped by NodeProcessRunner); output is captured separately + capped. Stream redaction still pending (A5.5/A9); ADR 0038 | A2/A5 | TM T-EXE-09/10, T-CMP-07/09 |
| R-SEC-6 | Forgeable self-certified governance/integrity artifacts under autonomy | High | Med | A5.9 gate re-derives evidence; A5.6 independent ledger; reviewer-owned findings | **Open (partially mitigated — A5.5)**: an append-only hash-chained mutation ledger is reconciled against the REAL worktree (git-derived), so a forged result / unrecorded change is detected → run marked tampered (SAT-A5-6). Gate consumption is A5.6/A5.8; ADR 0040 | A5 | TM T-INT-01/02/04 |
| R-SEC-7 | Self-modifiable CI / branch-protection gates; protection state unverified in-repo | High | Med | Workflow-integrity meta-gate; required-step allowlist; branch-protection probe | Open | A9 | TM T-INT-07/08/09, T-GIT-07 |
| R-SEC-8 | Git-mechanism code execution on untrusted trees (hooks/config/attributes/submodules) during routine git ops | Critical | Med | Hardened git invocation (hooks/config/attributes off); A5.4 enforcement | **Open (partially mitigated — A5.1)**: managed worktree ops now run hooks-off + system/global config stripped (T-GIT-01/02/03), demonstrated by a hook-non-execution SAT. `.gitattributes` smudge filters (T-FS-05) remain A5.4 | A5 | TM T-GIT-01/02/04, T-FS-05; ADR 0036 |
| R-SEC-9 | Approval unauthenticated/self-asserted and not bound to the executed diff | High | High | Authenticated approver channel; approval↔diff-hash binding | Open | A5/auth | TM T-INT-10/11 |
| R-SEC-10 | Supply-chain install-time RCE / dependency confusion | High | Med | `.npmrc` ignore-scripts + registry/scope pin; non-zero `minimumReleaseAge`; full-workspace scan | Open | A9 | TM T-GIT-05/06/08/09 |
| R-SEC-11 | Security-relevant provider/toolchain version drift silently enabling writable/sandbox/API-key modes | High | Med | Version-bound capability snapshots; drift detection + re-probe; substrate preflight matrix | Open | A3/A9 | TM T-GIT-10/11/12, T-CMP-02 |

## A5 progress (writable execution)

- **A5.1 Worktree Manager (`afc3607`→ this PR; ADR 0036).** Establishes isolated
  linked worktrees in an external state root outside the working tree (T-FS-08
  foundation), new-branch-only with a never-`main` guard (SAT-A5-10 baseline), and a
  hardened git boundary that neutralizes hooks/system/global config for managed ops
  (R-SEC-8 partial; SAT-A5-5 baseline, hook-non-execution demonstrated). Owner-facing
  path/command policy and the full `.git`/object-store blocking are A5.2–A5.4 (still
  open). Residual accepted: RR-2 (TOCTOU), RR-4 (no OS sandbox), owner-pid reuse
  (conservative).
- **A5.2 Allowed-Path Policy (this PR; ADR 0037).** Owner-facing read/write
  containment: allow-list by canonicalization (no blanket-`$HOME` block — the T-FS-08
  carve-out), symlinked-ancestor/leaf refusal, hardlink-write refusal, `.git`/object-
  store block, segment-aware read/write gating, `maxFilesChanged`, audited typed
  denials. Demonstrated by SAT-A5-1/2/3 (16 tests). Mitigates R-SEC-4 for owner
  paths. Still open: command/process policy (A5.3), owner/reviewer enforcement (A5.4).
  Residual: RR-2 (check→open TOCTOU), hardlink read-leak, case-insensitive substrate.
- **A5.3 Safe Command Policy + Process Supervision (this PR; ADR 0038).** Deny-by-
  default command classifier (no shell — metachars inert; structural; dual-binary
  refinement fails closed; cwd contained) + process supervision reusing the A3
  NodeProcessRunner (process group, SIGTERM→grace→SIGKILL, env allowlist, output cap,
  timeout). Demonstrated by SAT-A5-4 + real-process cancel/timeout (cross-platform)
  and POSIX orphan reaping. Partially mitigates R-SEC-5. Still open: owner/reviewer
  enforcement (A5.4), stream redaction (A5.5/A9). Residual: conservative over-blocking
  of unusual flag forms (fails closed); network opt-in only.
- **A5.4 Owner/Reviewer enforcement (this PR; ADR 0039).** Single writable owner lease
  (two-owner race blocked; explicit+audited reassignment only — no implicit owner
  change), role gate composing A5.2/A5.3 (reviewer cannot write or run a non-read_only
  command; lease-less owner action denied; role binding on every decision). Demonstrated
  by SAT-A5-8 (10 tests). Reduces R-GOV-1 / R-SEC-6 (attributable, owner-gated effects).
  Still open: mutation ledger (A5.5), authenticated approver channel (R-SEC-9, auth
  milestone). Residual: role-agnostic lease (writes still role-gated); logical (not yet
  authenticated) actor id.
- **A5.5 Diff Capture + Mutation Ledger (this PR; ADR 0040).** Append-only hash-chained
  ledger (tamper-evident; secret-redacted; crash-recoverable, rejects a broken chain)
  reconciled against the REAL worktree computed from git (`-z` porcelain + content
  hashes) — an unrecorded change or post-hash mismatch is unattributed → tampered →
  blocks merge (SAT-A5-6). `headHash`/`diffHash` bind the diff to the GovernanceDecision
  and detect post-review modification. Partially mitigates R-SEC-6. Still open: gate
  consumption (A5.6/A5.8). Residual: focused (not full-corpus) redactor — harness
  secretScan remains the detection backstop.

## Closed / superseded

(none yet)
