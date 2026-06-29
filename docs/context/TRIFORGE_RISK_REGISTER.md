# TriForge Risk Register

**Purpose:** canonical register of active risks. Each risk: ID, description,
impact, qualitative probability, mitigation, status, owner, responsible milestone,
evidence. See `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` §6 (mandate `instrucciones.md` §6.2).

**Last updated:** 2026-06-29 (Loop 1)

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
| R-SEC-2 | PAT pasted into chat is exposed in the transcript | High | High (already occurred) | Owner must revoke/rotate the PAT after the session; not reproduced in any output | **Action required (owner)** | Governance | autonomous-loop-authorization memory |
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

## Closed / superseded

(none yet)
