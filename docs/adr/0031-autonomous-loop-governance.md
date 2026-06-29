# ADR 0031: Autonomous Loop Governance

## Date

2026-06-29

## Status

Accepted

Amends (does not delete) ADR 0009 (Repository Governance) and the
human-final-authority language in `docs/context/TRIFORGE_PROJECT_VISION.md`
(Sections 1, 6, 9, 10, 14, 15, 26). Those decisions are **superseded for ordinary
in-repository changes**, not erased; their record is preserved.

## Context

ADR 0009 and the Project Vision established a governance model in which the human
is the **final, mandatory gate** before every commit and merge:

```text
Human approval → Commit → Merge
```

On 2026-06-29 the repository owner (`AlmanInDaHouse`) issued a written mandate —
`docs/instrucciones.md`, the "Autonomous Loop Execution Charter" — authorizing
Claude Code to drive the project from its current state to TriForge 1.0 through
verifiable loops, **without** requesting human approval for ordinary decisions
about architecture, code, tests, branches, commits, push, pull requests or
merges. The mandate is an explicit act of the owner, recorded in the repository
for auditability, and is the source of authority for this ADR.

This is a deliberate governance experiment. Its goal is **not** to prove the
agent never fails, but to demonstrate that an autonomous loop can detect failures,
bound their blast radius, preserve evidence, repair, revert, and continue without
losing the canonical project state.

## Decision

Adopt **Autonomous Loop Governance** as the operating model for ordinary
in-repository work. The governance pipeline changes from a human-gated commit to
an evidence-gated, autonomously-decided merge:

```text
Specification
    ↓
Implementation
    ↓
Independent verification
    ↓
Adversarial review
    ↓
Repair
    ↓
Automated governance decision
    ↓
Merge
    ↓
Post-merge verification
```

The human is no longer a mandatory approval for internal repository changes. The
human role is redefined as:

- an **override** mechanism;
- a **source of new objectives**;
- an authority to **stop** the experiment;
- an authority to **modify constraints**;
- an authority to **accept exceptional external risks**.

The full operating contract — the universal loop, branch/PR policy, failure and
recovery policy, session-continuity policy and experiment metrics — is the
**Autonomous Loop Charter** (`docs/context/TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md`),
the canonical, repository-resident restatement of `docs/instrucciones.md`.

### What does not change

- All changes still enter through **pull requests** targeting `main` (ADR 0009).
- The `Validate` CI check is still **required**; it must be green before merge.
- **No direct commits to `main`**; no force-push to `main`; no destructive
  rewrite of public history.
- Branch protection stays **enabled**; it is never disabled to merge.
- CI may be strengthened, **never weakened** to obtain a green result.
- The credential, web-automation and no-API-key boundaries of ADR 0027/0028/0029
  and Vision Section 19 remain in force.

### Autonomous merge policy

Claude Code may mark a pull request ready and merge it autonomously only when all
hold:

- the specification (or acceptance criteria) is satisfied;
- CI (`Validate`) is green;
- relevant tests pass;
- no `blocker` and no `critical` review findings remain open;
- `major` findings are fixed or explicitly accepted with a recorded technical
  justification and a residual risk under control;
- the pull request is coherent (a single unit of work, reviewable);
- no gate was weakened;
- no prohibited external boundary is crossed.

Default integration strategy: **squash merge**, semantic commit message, delete
the source branch, fast-forward local `main`, post-merge `main` CI verification.

### Hard stops (the affected action stops; safe work continues)

Introducing or reading credentials, extracting cookies/tokens, automating login,
activating payments or credits, contracting services, modifying billing, deploying
to production, deleting external data, modifying external non-lab infrastructure,
changing organization membership/permissions, **disabling branch protection**,
revealing secrets, accepting legal terms on the owner's behalf, or accessing
unauthorized accounts.

> **Owner amendment to the credential boundary (2026-06-29).** Reading a git
> credential-manager token is both a hard stop ("introducing or reading
> credentials", mandate §3.2) and, read literally, an always-prohibited item
> ("reading credential stores", mandate §3.3). Exercising the owner's authority to
> **modify constraints** and **accept exceptional external risk** (mandate §1, §2),
> the owner explicitly and narrowly authorized reading the GCM token **for GitHub
> REST PR/merge operations only** during this run: in-memory only, never persisted
> or printed, excluding all provider credentials and any token extraction. This is
> an **owner act** that amends the boundary for this scoped case — **not** a
> loop-level self-exception. The loop may not self-authorize any credential read;
> only the owner may grant or revoke this amendment. Recorded as risk R-SEC-1.

### Always prohibited (the loop has no self-override path; only the owner may amend)

Automatic API-key fallback; extraction of Codex/Claude tokens; reading credential
stores (except under an explicit owner amendment as above); web automation to simulate sessions;
force-push to `main`; destructive rewrite of public history; bypassing required
checks; disabling protections to merge; hiding failing tests; deleting findings to
fake success; presenting an unverified capability as verified; automatic
production deploy; knowingly running malicious code outside a controlled
environment; adding backdoors; exfiltrating repository contents; continuing after
a possible credential exposure.

## Reasons

- The foundation milestones (A0.1–A0.4) are documentation; the human-in-every-loop
  gate is the dominant cost and the bottleneck to reaching a functional MVP.
- The repository already enforces the real quality gates (PR + required CI +
  spec/ADR discipline + an executable harness), so the merge decision can be tied
  to **evidence** rather than to a human signature.
- Small, reversible, spec-linked PRs make autonomous merges auditable and cheap to
  revert if wrong.

## Risks

- **R-GOV-1** Autonomous merge of a defective change. Mitigation: required CI,
  adversarial review with severity gating, squash + easy revert, post-merge `main`
  verification, regression-prevention tests.
- **R-GOV-2** Scope creep across unrelated milestones in one PR. Mitigation: one
  branch per unit of work; PR size discipline (Charter §7).
- **R-GOV-3** Silent weakening of gates to get green. Mitigation: explicitly
  prohibited; CI changes reviewed adversarially; "no weakening CI" invariant.
- **R-GOV-4** Loss of canonical state across sessions/context windows. Mitigation:
  the four canonical context files (Vision, Charter, Execution State, Risk
  Register) reconstructed from Git/GitHub at the start of every loop.
- **R-SEC-1** Credential-boundary erosion from the owner-amended GCM read.
  Mitigation: token used in-memory only, never persisted/printed; scoped to repo
  PR/merge; the owner rotates the credential after the run.
- **R-GOV-5** Approval/output spoofing or context poisoning driving a bad merge.
  Mitigation: deferred to the A0.5 threat model, which must merge before any
  writable provider execution.

### Credential-exposure reconciliation (R-SEC-2)

During this run the owner pasted a personal access token into chat, so a
credential is exposed in the conversation transcript (risk R-SEC-2). The mandate
treats "continuing after a possible credential exposure" as prohibited (§3.3) and
a stop condition (§24). This is reconciled, not normalized: the exposure was
**owner-initiated and owner-controlled**; the loop did not exfiltrate, persist or
reproduce the token and authenticates via the **separate GCM path**, not the
pasted PAT. The stop rule exists to protect the owner; the owner — who is the §24
stop authority and may accept exceptional risk (§2) — explicitly directed
continuation and owns the remediation (rotating the PAT after the run). The
incident is recorded (Execution State "Security incidents = 1") and rotation is
**required**.

## Mitigations summary

Evidence over narrative; reversible progress; one writable owner per unit;
adversarial review before merge; the threat model (A0.5) gates all writable
provider execution; canonical state persisted in-repo, not in chat memory.

## Consequences

### Positive

- Development is no longer blocked by per-change human availability.
- Every merge is tied to a recorded, reproducible evidence bundle.
- The governance experiment becomes measurable (Charter §9 metrics).

### Negative

- A defective autonomous merge can reach `main` before a human sees it; recovery
  shifts to fast-forward fix or revert plus a regression test.
- The model depends on CI and review actually catching defects; a gap in either is
  now more consequential.
- The audit surface grows: every autonomous decision must be inspectable.

## Conditions to Revoke Autonomy

The owner (or any of these conditions) revokes or suspends autonomous merge:

- the owner orders a stop or reinstates a human gate;
- a possible credential exposure is detected;
- the repository is corrupted and cannot be safely recovered;
- repeated autonomous merges produce regressions that review/CI did not catch;
- a prohibited external boundary would have to be crossed to proceed;
- metrics show the experiment is net-negative for repository health.

On revocation, the model reverts to ADR 0009's human-gated flow; this ADR is
marked superseded but its record is preserved.

## Relation to A0.5

Autonomous Loop Governance authorizes autonomous merges of **ordinary
in-repository changes**. It does **not** authorize **writable provider
execution** (real Codex/Claude runs that mutate the repository). That remains
unauthorized until the A0.5 provider/repository threat model is merged and the
A1–A4 contracts, mocks, read-only adapters and collaboration runtime are closed
(Vision Sections 18, 21; mandate §17).
