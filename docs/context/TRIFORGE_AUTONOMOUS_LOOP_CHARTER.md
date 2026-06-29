# TriForge Autonomous Loop Charter

**Status:** Canonical operating contract for autonomous execution
**Authority:** Owner mandate `docs/instrucciones.md` (2026-06-29) and ADR 0031
**Audience:** Claude Code (executor), reviewers, the owner, future sessions
**Supersedes (for ordinary in-repo changes):** the human-mandatory-approval gate
of ADR 0009 and `TRIFORGE_PROJECT_VISION.md` §1/§6/§9/§10/§14/§15/§26

This document is the repository-resident, canonical restatement of the owner's
autonomous-execution mandate. The verbatim owner mandate is preserved at
`docs/instrucciones.md`; where the two differ in wording, `instrucciones.md` is
the source of authority and this file is its operational projection. The durable
architectural decision is ADR 0031.

---

## 1. Mandate

Claude Code is authorized to drive the project from its current state to TriForge
1.0 through verifiable loops: analyze the repository, decide technical solutions,
create and modify specs and ADRs, design contracts, write and refactor code,
create and update tests, create branches, commit, push, open and update pull
requests, mark them ready, resolve findings, merge, delete merged branches, update
the roadmap, reorder work when evidence justifies it, fix discovered technical
debt, revert its own failed changes, and keep iterating until the TriForge 1.0
Definition of Done is met.

Claude Code does **not** request human approval for ordinary decisions about
architecture, code, tests, branches, commits, push, PR or merge.

## 2. Human role

The human is not a mandatory approval for internal repository changes. The human
is: an override mechanism; a source of new objectives; an authority to stop the
experiment; an authority to modify constraints; an authority to accept exceptional
external risks. Human absence does not block development when the spec is clear,
acceptance criteria are defined, validations pass, no blocker/critical findings
remain, CI is green, and no prohibited external boundary is crossed.

## 3. Limits of autonomy

### 3.1 Authorized (autonomous)

Source code, tests, documentation, contracts, local migrations, justified
dependencies, repository scripts, dev and CI configuration, branches, commits,
prerelease tags, pull requests, merges, issues, worktrees, fixtures, mocks,
schemas, local databases, internal TriForge tooling, UI, local packaging, release
candidates. CI may be changed to **improve** validation, security or
reproducibility — never weakened to obtain a green result.

### 3.2 Hard stops (stop the affected action; continue other safe work)

Introducing or reading credentials; extracting cookies/tokens; automating login;
activating payments or credits; contracting services; modifying billing; deploying
to production; deleting external data; modifying external non-lab infrastructure;
changing org membership/permissions; disabling branch protection; revealing
secrets; accepting legal terms for the owner; accessing unauthorized accounts.

> **Owner amendment (2026-06-29).** Reading a git credential-manager token is a
> §3.2 hard stop and, read literally, also a §3.3 always-prohibited item. Using the
> owner's authority to modify constraints and accept exceptional risk (§1, §2), the
> owner explicitly and narrowly authorized reading the GCM token for GitHub REST
> PR/merge operations **only**: in-memory, never persisted or printed, excluding all
> provider credentials and token extraction; the owner rotates it after the run.
> This is an **owner act**, not a loop self-exception — the loop may not
> self-authorize any credential read, and only the owner may grant or revoke it.

### 3.3 Always prohibited (the loop has no self-override path; only the owner may amend)

Automatic API-key fallback; Codex/Claude token extraction; reading credential
stores (except under an explicit owner amendment as in §3.2); web automation to simulate sessions;
force-push to `main`; destructive rewrite of public history; bypassing required
checks; disabling protections to merge; hiding failing tests; deleting findings to
fake success; presenting an unverified capability as verified; automatic
production deploy; knowingly running malicious code outside a controlled
environment; adding backdoors; exfiltrating repository content; continuing after a
possible credential exposure.

## 4. Guiding principles

- **Spec before code** — objective, scope, non-goals, invariants, acceptance
  criteria, failure modes, relation to prior decisions (small spec for small
  change).
- **ADR for durable decisions** — multi-phase, hard-to-reverse, boundary,
  security, persistence, contract, structural-dependency or decision-replacing
  changes get an ADR.
- **Harness before trust** — an integration is trusted only with independent
  evidence (contract tests, fixtures, mocks, integration/E2E, security tests,
  observed events, hashes, diffs, structured logs).
- **Evidence over narrative** — agent claims are proposals; code, tests, outputs,
  CI, schemas, artifacts, hashes, Git, metrics and reproductions are evidence.
- **`UNKNOWN` / `REQUIRES_VERIFICATION` are valid states** — never fill a gap with
  an assumption presented as fact.
- **Reversible progress** — small, auditable, revertible, isolated, verifiable,
  spec/issue-linked changes.
- **One writable owner** — within a unit of work exactly one agent has write
  authority; others are read-only reviewers/evaluators.

## 5. Universal loop

```text
Observe → Reconstruct state → Select objective → Define success → Inspect evidence
→ Plan → Implement → Verify locally → Review adversarially → Repair → Re-run gates
→ Decide → Commit → Push → Open/update PR → Verify CI → Merge → Verify main
→ Record state → Select next loop
```

State is reconstructed from Git, GitHub, specs, ADRs, the roadmap, tests, CI, real
code and the persisted state of the previous loop — never from chat memory alone.

### Adversarial review and decision

Before merge, review: correctness, security, backward compatibility, scope creep,
silent errors, failure paths, cleanup, secrets, paths, network, process/cancel,
observability, missing tests, documentation, ADR contradictions. Findings are
`blocker | critical | major | minor | observation`. **No merge with open blockers
or criticals.** Majors are fixed or explicitly accepted with justification and
controlled residual risk. The autonomous merge conditions are ADR 0031.

## 6. Continuity across sessions

The project must not depend on chat memory. The four canonical context files are
kept current:

- `docs/context/TRIFORGE_PROJECT_VISION.md` — product vision and target.
- `docs/context/TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md` — this file.
- `docs/context/TRIFORGE_EXECUTION_STATE.md` — current operational state only.
- `docs/context/TRIFORGE_RISK_REGISTER.md` — risks with IDs and evidence.

Before exhausting context: finish or stabilize the current change, leave no
unidentified edits, persist state, record the commands needed to continue, record
the open PR and CI status, indicate the exact next loop, and create a continuation
prompt if needed.

## 7. Branch and PR policy

One branch per unit of work (`docs/`, `feat/`, `fix/`, `test/`, `security/`,
`refactor/<topic>`). PRs small enough to understand, review, verify, revert and
attribute. Draft while working; ready when complete. Default: **squash merge**,
semantic message, delete the branch. After merge: verify `main`, verify CI,
confirm branch deletion, check for unexpected local files, update Execution State,
select the next loop.

## 8. Failure and recovery

- **CI red** → do not merge; Diagnose → Reproduce → Repair → Re-run.
- **Post-merge regression** → confirm, scope blast radius, fix-forward or revert,
  restore `main`, record cause, add a regression test.
- **Blocked by a prohibited external action** → mark blocked, preserve evidence,
  document exactly what is missing, continue with independent work.
- **Architectural uncertainty** → decide by: safety invariants → specs →
  acceptance criteria → real code → tests → current ADRs → compatibility →
  simplicity → reversibility → performance → aesthetics. Ties go to the simpler,
  more reversible option.

## 9. Experiment metrics

Per milestone and globally: loops executed; PRs created/merged; CI failures;
repair rounds; regressions; reverts; blockers; human interventions; findings by
severity; time-to-merge; diff size; coverage; quota usage; reverted decisions;
security incidents; context recoveries. The goal is not zero failures; it is a
loop that detects, bounds, preserves evidence, repairs, reverts, learns, and keeps
canonical state recoverable. Running counters live in `TRIFORGE_EXECUTION_STATE.md`.

## 10. Stop conditions

Stop only when: TriForge 1.0 meets the full Definition of Done (proven by
executable evidence, not declaration); an unresolvable external hard stop exists; a
possible credential exposure is detected; the repository is corrupted beyond safe
recovery; the owner orders a stop; or the platform ends the session. State is
persisted before any stop.
