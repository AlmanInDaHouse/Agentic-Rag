# TriForge Agentic Lab

## Canonical Project Vision, Architecture, and Development Model

**Status:** Canonical project vision
**Audience:** Maintainers, contributors, agents, and reviewers
**Initial deployment model:** Local, single-user development environment
**Initial providers:** OpenAI Codex CLI and Anthropic Claude Code
**Authentication model:** Official local subscription sessions
**API-key policy:** No API keys in the initial product path

---

## How to read this document

This document is the canonical source of product vision and architectural
direction for TriForge Agentic Lab. It exists to orient future milestones,
contextualize new sessions, prevent divergence, explain the project to
collaborators, evaluate architectural changes, and preserve the original product
intent.

It is deliberately careful about tense. Every substantive claim is tagged so the
reader can tell what is real today from what is intended:

- **[Implemented]** — real, running code exists in this repository (cited by
  path or command). Mock and deterministic stand-ins are still implemented code,
  but their mock nature is stated explicitly.
- **[Decided]** — an ADR or spec records the decision or target architecture,
  but no production code implements it yet.
- **[Planned]** — named future work; not yet specified or built.
- **[Requires verification]** — depends on an external provider fact, an unmerged
  milestone, or another claim that must be reverified before it is frozen into
  architecture.

The architecture sections describe the **target** system. Today TriForge is a
mock-only RAG / Context Engine / Code Graph lab; the multi-agent orchestrator it
is being reoriented into does not exist in code yet. Sections 20 and 21 draw the
exact line between the two.

This file does not duplicate existing specs or ADRs. Where a topic is fully
specified elsewhere, it is referenced conceptually rather than copied. The
load-bearing references are:

- `docs/context/PROJECT_CONTEXT.md` — living description of the current build.
- `docs/context/TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md`,
  `docs/context/TRIFORGE_EXECUTION_STATE.md`,
  `docs/context/TRIFORGE_RISK_REGISTER.md` and ADR 0031 — the autonomous loop
  governance model, current operational state, and active risk register
  (`docs/instrucciones.md` is the verbatim owner mandate).
- `docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` and
  `docs/adr/0027-quota-aware-provider-orchestration.md` — the quota-aware
  orchestration design (Milestone A0.1).
- `docs/specs/AGENTIC_RUNTIME_SPEC.md`, `docs/specs/SAFE_EXECUTION_POLICY_SPEC.md`
  and ADRs 0010–0012 — the runtime state machine, approval gates and safe
  execution policy.
- `docs/specs/CONTEXT_ENGINE_SPEC.md`, `docs/specs/RAG_ENGINE_SPEC.md`,
  `docs/specs/RETRIEVAL_EVALUATION_SPEC.md` and ADRs 0013–0024 — context,
  retrieval, abstention and evaluation.
- `docs/specs/CODE_GRAPH_SPEC.md`,
  `docs/specs/CODE_GRAPH_ARTIFACT_INGESTION_SPEC.md` and ADRs 0025–0026 — the
  Code Graph scanner, context pack and ingestion design.
- `docs/specs/DEBATE_ENGINE_SPEC.md` and `docs/specs/DASHBOARD_SPEC.md` — the
  current mock debate round and the current dashboard.
- `docs/known-issues.md` — the authoritative list of accepted limitations.

A note on milestone numbering: the historical build used a `1.x` scheme
(`1.3.1`, `1.4`, `1.5C-A` … `1.5I`, `1.6A` … `1.6G`). The reorientation described
here introduces a new `A0.x` / `A1` … `A9` scheme (matching the owner mandate
`docs/instrucciones.md` §13–§21 and `TRIFORGE_EXECUTION_STATE.md`). Both appear in
this document; they are distinct lines, not a renumbering of the same work.

---

## 1. Executive Summary

TriForge Agentic Lab is, in its target form, a **local, multi-agent software
engineering environment**. It does not connect models through APIs. It
coordinates official, locally authenticated provider CLIs that the user already
runs under their own subscription:

```text
TriForge
├── Codex CLI        (OpenAI, official CLI, local subscription session)
└── Claude Code      (Anthropic, official CLI, local subscription session)
```

TriForge prepares context, coordinates planning, assigns an **implementation
owner**, captures execution events, validates results against an executable
harness, and makes an **autonomous, evidence-bound governance decision** before
commit or merge, with the human retaining **override** (ADR 0031,
`TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md`).

The innovation is not "making two AIs talk." The innovation is a **governed
process** in which:

- both providers can analyze and both can criticize;
- exactly one provider implements each unit of work (the implementation owner);
- the other performs **cross-vendor adversarial review** from different biases
  and blind spots;
- tests, quality gates and the harness act as the arbiter of truth;
- an autonomous, evidence-bound governance decision authorizes each merge, with
  the human retaining override (ADR 0031).

**[Requires verification]** Because both providers are reached through their
official CLIs under personal subscriptions, provider behavior, quotas and event
formats are treated as dated, versioned assumptions, never as permanent truths
(see Section 6 and Section 17).

**[Planned]** The orchestrator that coordinates these providers does not exist in
code yet. What exists today is the foundation it will be built on: a mock agent
runtime, a Context Engine, a Code Graph toolchain, and the quota-aware
orchestration design (Sections 20–21).

---

## 2. Origin of the Project

The original idea was to connect several AI assistants — each available through a
subscription rather than a paid API — and let them debate inside an IDE, without
depending on API keys.

The architecture was then corrected on an important point:

- web subscriptions must **not** be turned into unofficial APIs;
- TriForge does **not** automate provider web pages;
- TriForge does **not** extract cookies or tokens;
- TriForge uses the providers' **official CLIs**;
- authenticated sessions remain entirely under the user's control.

This correction is what makes the project defensible. The product coordinates
tools the user is already entitled to run locally; it does not impersonate a
browser session, share an account, or smuggle a subscription into a programmatic
channel.

---

## 3. Problem Statement

Using a single AI assistant in isolation has recurring failure modes:

- **No independent review** — the same model that writes the code also judges it.
- **Context loss** — relevant repository knowledge is not assembled or reused.
- **Undocumented decisions** — choices are made in chat and never recorded.
- **Convincing but unverified code** — output that reads well but was never run.
- **Over-broad changes** — diffs that exceed the scope of the task.
- **No accountability** — no single owner is responsible for a change.
- **No measurement by task type** — no data on what each agent is actually good
  at in this repository.
- **Hard to compare agents** — no apples-to-apples basis for routing work.

TriForge exists to remove these failure modes by structure, not by hope.

---

## 4. Product Purpose

TriForge should turn independent assistants into a **coordinated local team**.
The target capability is to:

1. receive a task;
2. turn it into a specification or contract with acceptance criteria;
3. retrieve relevant, traceable context;
4. choose a collaboration mode;
5. select an implementation owner;
6. implement inside a controlled environment;
7. perform cross-vendor adversarial review;
8. run executable quality gates;
9. present evidence to the human;
10. record metrics that improve future routing.

Each step produces an inspectable artifact (Section 14). Nothing in this list is
implemented yet as an end-to-end provider-backed flow; it is the product the
roadmap (Section 22) builds toward.

---

## 5. Non-Goals

TriForge is explicitly **not**:

- a proxy for ChatGPT or Claude web;
- a scraper of provider web pages or dashboards;
- a covert or unofficial API;
- a system for sharing accounts or credentials;
- a service that resells the owner's subscriptions to third parties;
- an unbounded autonomous agent;
- a replacement for Git;
- a replacement for tests;
- a replacement for human review (under ADR 0031 the human's review authority is
  preserved as an **override**, not a mandatory per-change gate);
- GraphRAG in the MVP;
- a centralized SaaS in its first stage.

These non-goals are durable. They constrain every future milestone and are
consistent with the safe execution and credential boundaries in Sections 18–19.

---

## 6. Core Principles

### Specification before implementation
The task and its acceptance criteria are defined before any code is written. This
is already the repository's working rule (ADR 0003, spec-driven development) and
extends to provider-backed work.

### Context engineering
Agents receive selected, traceable, shared context — not the whole repository by
default (Section 13).

### Evidence over narrative
Claims are checked against code, tests, specs, ADRs and sources. A persuasive
explanation is not acceptance; a passing harness is.

### Single implementation owner
Each unit of work has exactly one write owner (Section 15).

### Cross-vendor adversarial review
The second provider reviews from different biases and blind spots than the owner.

### Harness before trust
Output is validated against executable contracts before it is trusted (ADR 0004,
ADR 0006).

### Human override authority
**[Amended by ADR 0031]** Ordinary in-repository merges are decided autonomously
against evidence (CI, relevant tests, adversarial review with severity gating).
The human is an **override** and **stop** authority, a source of objectives, and
the authority to accept exceptional external risks — not a mandatory per-change
gate. The prior "human final authority" rule is superseded for ordinary changes,
**not deleted**; see ADR 0031 and `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md`. Writable
provider execution remains unauthorized until A0.5 (Section 18).

### Economy of invocations
Provider invocations consume scarce quota and must be budgeted (Section 17).

### External provider facts are versioned assumptions
External capabilities, limits and behaviors must be **dated**, **cite their
source**, **mark their confidence**, and be **reverified** before any adapter is
frozen. A claim does not become architecture merely because it was published,
looks recent, has a past target date, or was produced confidently by an AI. This
principle is operationalized by the `ExternalProviderAssumption` record in the
quota spec and ADR 0027.

---

## 7. Initial Provider Model

The two initial providers are reached only through their official CLIs, each
authenticated locally with the user's own subscription. The following
specialization priors are **orienting defaults, not permanent truths**: actual
performance is measured per repository, quota can change the assignment, and
critical tasks never degrade silently.

### Codex CLI — initial orienting prior
- typed contracts and interfaces;
- common frameworks and idioms;
- direct implementation;
- repetitive transformation;
- structured generation;
- changes with a clear, bounded scope.

### Claude Code — initial orienting prior
- complex refactors;
- logical bugs;
- algorithms;
- adversarial tests;
- invariants;
- multi-file reasoning;
- documenting the "why."

**[Requires verification]** These priors are seeds for the routing model
(Section 16), not fixed truths. The quota spec records a `historicalPerformanceScore`
that is repository-specific, precisely so that measured behavior — not vendor
folklore — drives routing over time.

---

## 8. Collaboration Modes

**[Decided] / [Planned]** Four collaboration modes are introduced by
`QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md`. The spec is explicit that these
modes **do not yet exist in the repository**; the only debate that exists today
is a single mock round with three mock agents and a highest-confidence judge
(`DEBATE_ENGINE_SPEC.md`), which is the seed for Full Debate Mode. Mode selection
is driven by risk, uncertainty and available budget.

### Specialist Mode — [Decided]
The economical default. A single owner implements, performs self-review, and
triggers cross-vendor review only conditionally when risk or uncertainty
warrants it. Selected unless risk, uncertainty or an explicit human opt-in
escalates to another mode.

### Pair Mode — [Decided]
One provider produces the primary proposal; the second critiques it; then
implementation and review follow.

### Full Debate Mode — [Decided]
Used for architecture, security, migrations and high uncertainty. Requires
sufficient budget **after** implementation and review reserves are protected, and
is not selected when the budget cannot fund the debate plus the reserved phases.

### Competitive Mode — [Decided]
Exceptional. Requires explicit human opt-in, sufficient budget, separate
worktrees per competing owner, high uncertainty, and comparative quality gates.
Never selected automatically on cost grounds alone (high quota consumption).

### Review-Only Mode — [Planned]
A read-only collaboration pattern introduced by this vision document and not yet
in the quota spec: no agent modifies anything; both providers review a proposal,
a diff or an incident and produce structured findings. It maps naturally onto the
existing reviewer model (Section 15) and the read-first reviewer posture.

---

## 9. End-to-End Workflow

**[Planned]** The target task lifecycle:

```text
Task intake
    ↓
Specification
    ↓
Context preparation
    ↓
Mode selection
    ↓
Planning / debate
    ↓
Strategy resolution
    ↓
Task decomposition
    ↓
Owner and reviewer assignment
    ↓
Controlled implementation
    ↓
Self-review
    ↓
Automated quality gates
    ↓
Cross-vendor adversarial review
    ↓
Repair loop
    ↓
Autonomous governance decision (human override)
    ↓
Commit / merge
    ↓
Metrics and learning
```

For each phase, the target contract is:

| Phase | Input | Output / Artifact | Stop conditions | Human role |
|---|---|---|---|---|
| Task intake | Free-form request | `task.md` | Empty/ambiguous task | Frames the task |
| Specification | `task.md` | `acceptance-criteria.json` | No testable criteria | Frames / override |
| Context preparation | Spec + repo | `context-pack.json` | No relevant context | May curate sources |
| Mode selection | Risk + budget | mode + `routing` inputs | Budget cannot fund mode | Can force a mode |
| Planning / debate | Context pack | `codex-plan.json`, `claude-plan.json`, `cross-review.json` | Reserve violation | Observes |
| Strategy resolution | Plans + critique | `strategy-decision.json` | Unresolved conflict | Override |
| Task decomposition | Strategy | unit list | Scope too large | — |
| Owner/reviewer assignment | Task profile + quota | `routing-decision.json` | Critical task cannot route | Override (degraded/critical) |
| Controlled implementation | Unit + scope | `implementation-diff.patch` | Out-of-scope write, blocked action | Override (high-risk) |
| Self-review | Diff | annotations | — | — |
| Quality gates | Diff | `quality-gates.json` | Gate failure | — |
| Cross-vendor review | Diff + tests | `review-findings.json` | Unverifiable finding | — |
| Repair loop | Findings | new diff | `maxRepairRounds` reached | Override |
| Governance decision | Evidence bundle | `governance-decision.json` | Blocker/critical open | **Override** |
| Commit / merge | Decided diff | commit / PR | Gate weakened | Override |
| Metrics | Final report | `final-report.md` + metrics | — | — |

The reserves, hard stops and degraded-routing rules that govern several of these
stop conditions are specified in the quota spec (Section 17).

---

## 10. Architecture

**[Planned]** Target architecture. Only the Context Builder layer and the mock
runtime substrate exist today (Section 20).

```text
TriForge IDE
    ↓
Orchestration Runtime
    ├── State Machine        (extends the existing mock runtime state machine)
    ├── Approval Gates       (extends the existing approval-gate model)
    ├── Quota Manager        (implements the A0.1 quota design)
    ├── Task Router          (quota-aware routing)
    └── Event Timeline       (extends the existing timeline_events log)
          ↓
Context Builder
    ├── Context Engine       (implemented, lexical + optional vector)
    ├── Code Graph           (implemented as tooling; ingestion not yet wired)
    ├── Specs
    ├── ADRs
    └── Retrieval Evaluation (implemented)
          ↓
Provider Adapter Layer
    ├── Codex Adapter        (not built)
    └── Claude Adapter       (not built)
          ↓
Official Local CLIs         (Codex CLI, Claude Code)
          ↓
Artifact Store
          ↓
Harness and Quality Gates   (implemented as a black-box harness)
          ↓
Autonomous Integration Gate (human override)   [Amended by ADR 0031;
                                                was: Human Commit Gate]
```

The design intent is that the Orchestration Runtime **extends** the existing
PostgreSQL-backed state machine, approval gates and timeline rather than
replacing them, and that the Provider Adapter Layer is the only new component
that touches the outside world.

---

## 11. Provider Adapter Architecture

**[Planned] / [Proposed]** ADR 0027 explicitly **defers** the `ProviderAdapter`
contract; no adapter exists, and this interface is a future design target, not a
current contract:

```ts
interface ProviderAdapter {
  checkAvailability(): Promise<AvailabilityResult>;
  checkAuthentication(): Promise<AuthenticationResult>;
  getCapabilities(): Promise<ProviderCapabilities>;
  execute(
    request: AgentExecutionRequest
  ): AsyncIterable<ProviderEvent>;
  cancel(executionId: string): Promise<void>;
}
```

Design intent for the future adapter:

- the interface is **event-stream based**, not just a final message;
- provider events are **normalized** into a common shape (Section 12);
- `stdout` / `stderr` are preserved as evidence;
- it supports **cancellation** and **timeout**;
- it returns a **structured result**;
- it surfaces **quota and rate-limit** signals (Section 17);
- it relies on **local authentication** only;
- it stores **no credentials**.

Availability and authentication are **separate** from quota status: in the quota
model they map to the `PROVIDER_UNAVAILABLE` and
`PROVIDER_AUTHENTICATION_REQUIRED` condition codes, not to a quota `status`.

The integration boundary this adapter sits behind — official local headless CLIs,
the process model, capability detection, and local subscription authentication —
is specified by Milestone A0.3: `docs/specs/OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md`,
ADR 0028 and ADR 0029.

---

## 12. Event-Driven Integration

**[Planned]** The future adapters will consume **structured event streams** from
the CLIs rather than only a final message, to enable:

- live progress;
- tool-use visibility;
- file-change tracking;
- estimated usage;
- partial failures;
- cancellation;
- a complete timeline;
- auditability.

A conceptual normalized event union:

```ts
type ProviderEvent =
  | RunStarted
  | AgentMessage
  | PlanUpdated
  | ToolStarted
  | ToolCompleted
  | FileChanged
  | UsageUpdated
  | QuotaUpdated
  | RunFailed
  | RunCompleted;
```

**[Requires verification]** These schemas are **not frozen**. The structured
event and status formats of each CLI must be verified against the installed
provider version before any adapter is built or frozen; the quota spec records
this as a `REQUIRES_REVERIFICATION` assumption. Where a signal cannot be verified
against the installed version, the adapter reports `unknown` rather than inventing
a value. This `ProviderEvent` union is distinct from the quota spec's
`ProviderQuotaEvent`/`ProviderUsageEstimate`, which model quota and usage
specifically; `UsageUpdated` and `QuotaUpdated` are the bridge between them.

---

## 13. Context Architecture

**[Implemented]** The Context Builder is the most mature part of the foundation.
Its role is to assemble a **shared, traceable evidence base** for both agents —
not to dump the whole repository.

Components and their current status:

- **Context Engine** — [Implemented] registers `manual_text`, `project_note` and
  `artifact` sources, performs deterministic chunking, lexical retrieval by
  default, persists retrieval traces, and integrates with the runtime's
  `load_context` step (`CONTEXT_ENGINE_SPEC.md`).
- **Code Graph** — [Implemented as tooling] a deterministic scanner produces a
  structural graph and a derived context pack; **ingestion into the Context
  Engine is not wired** (Section 20).
- **Context packs** — [Implemented] the Code Graph context pack is generated and
  lexically evaluated as a standalone artifact.
- **Specs and ADRs** — [Implemented] first-class repository documents and the
  primary source of truth over derived data.
- **Retrieval evaluation** — [Implemented] deterministic synthetic fixtures,
  metrics, versioned baselines and quality gates (`RETRIEVAL_EVALUATION_SPEC.md`).
- **Redaction** — [Implemented] deterministic regex redaction before chunk
  persistence (basic, not full DLP; `CONTEXT_DATA_POLICY_SPEC.md`).
- **Retention / deletion** — [Implemented] service-layer quotas, soft
  delete/restore and audit events (`CONTEXT_RETENTION_POLICY_SPEC.md`).
- **Provenance metadata** — [Implemented] retrievals record search mode, vector
  storage, fallback reason and answerability; Code Graph chunks carry scanner
  version, commit and confidence.

The design rule is that **derived context never outranks primary sources**: if a
Code Graph chunk conflicts with newer code, specs or ADRs, the primary source
wins, and low-confidence derived chunks must not relax abstention.

Both agents must be given the **same** evidence base for a task. The default unit
of context is a curated pack, not the entire repository.

---

## 14. Artifact-Driven Collaboration

**[Planned]** Agents must not collaborate through opaque conversations. Each stage
produces an inspectable artifact that TriForge validates and persists:

```text
task.md
acceptance-criteria.json
context-pack.json
codex-plan.json
claude-plan.json
cross-review.json
strategy-decision.json
routing-decision.json
implementation-diff.patch
review-findings.json
quality-gates.json
governance-decision.json
final-report.md
```

**[Amended by ADR 0031]** The canonical decision artifact is
`governance-decision.json` (an autonomous, evidence-bound merge decision with human
override), replacing the former `human-approval.json`. It maps to the
`GovernanceDecision` contract (mandate §A1.4).

The providers **emit events and results**; they do **not** own the canonical
record. TriForge is the authority that validates each artifact against its
contract and stores it. This mirrors the existing pattern where the runtime —
not the agent — writes the canonical `timeline_events`, `agent_runs` and
`agent_steps` rows.

---

## 15. Owner and Reviewer Model

**[Planned]** Roles for provider-backed work:

```text
Implementation Owner
- may write only within the authorized scope;
- may run only permitted commands;
- is accountable for the diff.

Cross-Vendor Reviewer
- works read-first;
- inspects strategy, diff, tests and risks;
- produces structured findings;
- does not modify until an explicit reassignment.
```

Four review layers are distinguished:

- **Self-review** — the owner reviews its own diff before submission.
- **Permission review** — the safe execution policy classifies each requested
  action (low/medium auto, high → approval gate, critical → blocked); this layer
  is **[Implemented]** today for the mock runtime.
- **Cross-vendor review** — the other provider reviews adversarially. [Planned]
- **Governance decision** — **[Amended by ADR 0031]** an autonomous,
  evidence-bound decision authorizes or blocks the merge (no merge with open
  blocker/critical findings); the human retains **override**. [Planned] for
  provider-backed work; the **approval-gate mechanism** it can reuse for an
  override/hold is **[Implemented]**. (Was: "human review — the final authority.")

There is no contradiction between owner and reviewer: exactly one owner holds the
write capability for a unit, and the reviewer is read-only until TriForge
explicitly reassigns ownership. A reviewer never silently edits the owner's diff.

---

## 16. Task Routing

**[Planned]** A task profile drives mode and owner selection. This profile is a
vision-level proposed input; it is not yet in any spec:

```ts
type TaskProfile = {
  taskKind: string;
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high" | "critical";
  blastRadius: "file" | "module" | "package" | "repository";
  reasoningDepthRequired: number;
  repetitiveWorkRatio: number;
  testBurden: number;
  behavioralPreservationRequired: boolean;
};
```

Routing must consider capability, quota, risk, history and availability
simultaneously. The **canonical routing decision** is defined in the quota spec;
its full shape is:

```ts
type RoutingDecision = {
  preferredOwner: "claude" | "codex";
  assignedOwner: "claude" | "codex";
  capabilityScore: number;
  quotaAvailabilityScore: number;
  historicalPerformanceScore: number;   // repository-specific
  risk: "low" | "medium" | "high" | "critical";
  degradedFromPreferredOwner: boolean;
  reason: string[];
  humanApprovalRequired: boolean;
};
```

Routing rules (from the quota spec):

- technical capability is the **primary** factor in choosing `preferredOwner`;
- quota and history may change `assignedOwner`, but doing so sets
  `degradedFromPreferredOwner: true` and records a `reason`;
- degradation is **always visible**, never silent;
- low/medium-risk tasks may degrade to the alternate provider when the preferred
  owner is unavailable;
- high-risk tasks may degrade only with a recorded reason; if no acceptable
  alternate exists, the run pauses with `humanApprovalRequired: true`;
- critical tasks must **not** degrade silently — they pause for a human decision;
- a temporary availability limit must not permanently invert the specialization
  matrix; degradation is per-run.

---

## 17. Quota-Aware Orchestration

**[Decided]** Milestone A0.1 records the quota-aware orchestration design as a
spec (`QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md`, 586 lines) and ADR 0027. It is
documentation only: no runtime, adapter, schema or endpoint change. This section
summarizes the design conceptually; it does not restate the spec.

Key elements:

- **Heterogeneous budgets** — budgets are per provider, not a single symmetric
  invocation counter, because provider usage models and quota signals are not
  equivalent.
- **Reserves** — capacity is reserved for implementation and for review (and
  optionally repair) and checked **before** each runtime transition that consumes
  provider capacity, so planning cannot starve implementation or review.
- **Hard stop** — when quota is exhausted with no API keys and no permitted
  credits, the runtime stops issuing invocations, preserves partial artifacts,
  marks the run explicitly paused or failed (never silently idle), surfaces the
  reason and exhaustion flavor, and allows **manual** resumption after reset.
- **Specialist by default** — the economical mode; Pair / Full Debate /
  Competitive escalate by risk, uncertainty and budget.
- **`unknown` state** — if a signal cannot be verified against the installed
  provider version, the adapter reports `unknown`; TriForge never fabricates a
  remaining percentage.
- **No API fallback** — never auto-switch to an API key.
- **No automatic credits** — `allowUsageCredits` and `allowPurchasedCredits` are
  fixed to `false`; spending credits is forbidden, not approvable.
- **Cost is an estimate** — `estimatedCostUsd` and any provider-reported
  `total_cost_usd` are client-side estimates, never authoritative billing
  (`isBillingAuthoritative: false`).
- **Shared with interactive use** — provider quota can be shared with the user's
  own interactive use of the same subscription, so budgets are conservative.
- **Manual resume after reset** — no indefinite background waiting; a resumable
  hold reuses the existing `waiting_for_approval` pause pattern rather than an
  implicit background wait.

**[Requires verification]** The spec records four dated external assumptions, all
flagged `REQUIRES_REVERIFICATION` as of 2026-06-28 and not verified against
installed CLI versions: the paused Anthropic monthly programmatic pool (so there
is **no** separate active dollar pool for Claude), the `--bare` exclusion from the
subscription-auth flow, Codex usage windows/ranges, and the provider event
schemas. The condition codes (`PROVIDER_QUOTA_EXHAUSTED`,
`RUN_BUDGET_RESERVE_VIOLATION`, etc.) and new lowercase stop conditions must be
wired into the Zod enums, SQL `CHECK` constraints and runtime service in a later
implementation milestone; that wiring is out of scope for A0.1.

See `docs/adr/0027-quota-aware-provider-orchestration.md` and
`docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` for the full design.

---

## 18. Execution Environment

**[Decided] (A0.4, ADR 0030) — substrate decided; writable execution still
unauthorized**

The execution substrate is **WSL2-first**: the runtime, Git, Node, pnpm, both
provider CLIs, the working repository, worktrees and quality gates run inside one
WSL2 distribution on the Linux filesystem; Windows hosts only the editor (remote-WSL
integration) and the browser (`localhost` to the WSL2 service). Native Windows
execution is deferred. Worktrees live in an external TriForge-managed state root on
the Linux filesystem, outside the active working tree. See
`docs/specs/WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md` and ADR 0030.

WSL2 is the operational and compatibility substrate; it is **not** a security
sandbox for untrusted repository content. The full provider/repository threat model
is Milestone A0.5. Allowed-path enforcement, command policy, the worktree manager,
real cancellation and **writable provider execution remain unbuilt and unauthorized**
until A0.5 is closed (A0.4 is merged; ADR 0030).

---

## 19. Security Boundaries

TriForge must **not**:

- read cookies;
- copy OAuth tokens;
- persist credentials;
- automate provider web pages or scrape dashboards;
- access anything outside the workspace;
- follow symlinks outside the repository;
- run critical commands without approval;
- share subscriptions or accounts;
- trigger payments;
- bypass provider limits;
- deploy automatically.

Adapters interact only with official provider CLIs, existing local authenticated
sessions, and officially supported commands and output formats. A real provider
invocation is an external action in the same family as `external_adapter_call`
under the Safe Execution Policy (ADR 0011): it requires the CLI to be explicitly
available and authenticated locally, and it must respect existing redaction and
data-handling boundaries before any context is passed to a provider. Raw quota
and usage payloads retained for audit must exclude secrets and credentials.

**Agent output is untrusted.** Provider output — including proposed diffs,
commands and context — is treated as untrusted input, subject to the same
classification, approval and blocking rules as any other action, and is a vector
for prompt injection from repository content (Section 25).

---

## 20. Existing Foundation

This is the **present tense**. Everything below is [Implemented] in this
repository today. The runtime is **mock-only**: it does not execute real
commands, modify code, install dependencies, run migrations, generate LLM
answers, or call real adapters (`PROJECT_CONTEXT.md`).

- **Fastify ESM API** with PostgreSQL repositories, parametrized SQL (no ORM) and
  versioned SQL migrations (`apps/api`).
- **Mock debate runtime** — a single round with three mock agents
  (`codex_architect`, `claude_critic`, `gemini_researcher`) and a
  highest-confidence mock judge (`DEBATE_ENGINE_SPEC.md`). The agents and judge
  are deterministic canned functions, not provider calls. Note that
  `gemini_researcher` is a **legacy mock label**: the initial provider model
  (Section 7) is **Codex + Claude only**, and no third provider is planned for
  the initial path; the quota model (Section 17) is `claude | codex`.
- **Mock agent runtime state machine** — persisted runs/steps with states
  `created → queued → running → waiting_for_approval → completed | failed |
  cancelled | stopped`, and the step sequence `load_context → plan → debate →
  judge → execute_mock_task → validate → summarize` (`AGENTIC_RUNTIME_SPEC.md`,
  ADR 0010).
- **Approval gates** — high-risk mock actions create a pending gate and move the
  run to `waiting_for_approval`; critical actions are blocked with
  `ACTION_BLOCKED`; gate resolution enforces **simulated** actor roles
  (`human_operator`, `admin`, `system`) and is not yet backed by real auth
  (ADR 0012, APPROVAL-001).
- **Safe execution policy** — action types, risk levels, the approval/blocking
  matrix and request-time gate expiration (`SAFE_EXECUTION_POLICY_SPEC.md`,
  ADR 0011).
- **Transactional advance** — `advance` runs in a PostgreSQL transaction with
  `SELECT ... FOR UPDATE NOWAIT` per run; concurrent advances get `409`
  (RUNTIME-001, resolved).
- **Context Engine v0** — sources, deterministic chunking, lexical retrieval and
  `load_context` integration.
- **Retrieval modes** — `lexical` (default), `mock_vector` and `hybrid`, with
  mandatory JSONB/mock/lexical fallback.
- **Mock embeddings** — `mock_embedding_v1`, 32-dim, SHA-256-derived,
  deterministic; not semantically meaningful (RAG-005).
- **Optional pgvector active retrieval** — opt-in via
  `TRIFORGE_EMBEDDING_STORAGE=pgvector`, not required by CI/harness (RAG-003,
  ADR 0019).
- **Data policy / redaction** — deterministic regex redaction before persistence
  (basic, not full DLP; DATA-001).
- **Retention / deletion** — service-layer quotas, soft delete/restore, audit
  events (ADR 0017).
- **Retrieval evaluation** — deterministic synthetic fixtures, metrics, versioned
  baselines and blocking quality gates (`tooling/retrieval-eval`, ADRs 0020–0022).
- **RAG abstention** — deterministic answerability metadata calibrated by mode,
  query type and fallback (ADRs 0023–0024).
- **Code Graph scanner** — deterministic structural scanner with quality gates
  (`tooling/code-graph-scanner`, `pnpm code-graph:scan` / `:check`, ADR 0025).
- **Code Graph context pack** — generator and lexical evaluation of a derived
  context pack (`pnpm code-graph:pack` / `:pack:eval`, ADR 0026). The
  `artifacts/code-graph/` outputs are **generated and gitignored**, not committed;
  the committed source of truth is the expected-output fixtures under
  `tooling/code-graph-fixtures/`, against which CI checks for drift.
- **Black-box harness** — creates temporary PostgreSQL schemas per run and drives
  the API over HTTP (`tooling/harness`, ADR 0006/0007).
- **Dashboard** — React + Vite, basic goal/debate/timeline/approval inspection,
  no live updates (`DASHBOARD_SPEC.md`).
- **CI** — GitHub Actions; the required check is `Validate` (ADR 0008).

**Code Graph clarification.** The Code Graph **scanner, quality gates, context
pack generator and context-pack evaluation are implemented as standalone
tooling**, deterministic and gated in CI against committed fixtures; their
generated outputs under `artifacts/code-graph/` are gitignored. **Artifact
ingestion into the Context Engine is not present on `main`**
(`CODE_GRAPH_ARTIFACT_INGESTION_SPEC.md` is design-only): there is no
`code_graph` source type in the contracts or schema, no persistence, and no
runtime `load_context` integration. The README's older note that "Code Graph is
not implemented" predates these milestones and is stale on this point; the
authoritative present state is as described here. The Code Graph toolchain is a
developer/analysis facility — it is not invoked by the agent runtime.

---

## 21. Missing Components

**[Planned]** None of the following exist yet:

- `ProviderAdapter` contract;
- mock adapters (even the mock adapters the quota spec describes are not built);
- capability detection;
- Codex adapter;
- Claude adapter;
- event normalizer;
- quota manager implementation;
- task router;
- collaboration protocols (Specialist / Pair / Full Debate / Competitive /
  Review-Only);
- owner/reviewer permission enforcement;
- worktree manager;
- repository-specific performance profiles;
- IDE timeline (live event stream UI);
- human review UI for diffs and findings;
- Code Graph artifact **ingestion** into the Context Engine and runtime.

---

## 22. Updated Roadmap

**[Planned]** Direction, not commitment. Milestone scheme `A0.x` / `A1`–`A9`,
aligned with the owner mandate (`docs/instrucciones.md` §13–§21) and
`TRIFORGE_EXECUTION_STATE.md`.

### A0 Foundations
- **A0.1** Quota-aware orchestration — **completed** (spec + ADR 0027).
- **A0.2** Canonical project vision — **completed** (this document).
- **A0.3** Official CLI integration and local authentication — **completed**
  (`OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md`, ADR 0028, ADR 0029).
- **A0.4** Windows/WSL2 execution substrate — **completed**
  (`WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md`, ADR 0030).
- **Governance Transition** Autonomous Loop Governance — **current** (ADR 0031,
  `TRIFORGE_AUTONOMOUS_LOOP_CHARTER.md`; replaces the human-mandatory-approval gate
  with autonomous, evidence-bound merges plus human override).
- **A0.5** Provider and repository threat model — **next** (security sandbox and
  the prerequisite for any writable provider execution).

### A1 Provider Contracts
- `ProviderAdapter` interface; provider event contract; capability snapshots;
  Zod-validated artifact contracts; schema tests. No provider-specific logic.
  (Mandate §13.)

### A2 Mocks, Harness and Quota Manager
- Mock Codex/Claude adapters and failure scenarios; black-box adapter harness;
  quota manager (budgets, reserves, hard stops, unknown state). All orchestration
  testable without real providers. (Mandate §14.)

### A3 Real Read-Only Adapters
- Real Codex and Claude adapters (read-only): availability/version/auth probes,
  headless execution, event normalization, cancellation, timeout, structured
  results, evidence retention. (Mandate §15.)

### A4 Collaboration Runtime
- Specialist / Pair / Full Debate modes; cross-review protocol; strategy
  resolution; autonomous governance gate (human override). No real writes.
  (Mandate §16.)

### A5 Controlled Writable Execution (MVP)
- Worktree manager; owner/reviewer enforcement; allowed paths; safe command
  policy; process supervision; mutation ledger; quality-gate runner; repair loop;
  autonomous integration gate; writable E2E. Gated on A0.5 + A1–A4. (Mandate §17.)

### A6 Routing and Learning
- Task profiler; static router; quota-aware routing; metrics; repository profiles;
  adaptive router with confidence. (Mandate §18.)

### A7 Competitive Mode
- Two isolated solutions (Codex vs Claude worktrees), common harness, comparative
  evidence, governance selection. Opt-in; not required for the MVP. (Mandate §19.)

### A8 Product Interface
- Provider status; task composer; run timeline; artifact explorer; diff/review;
  governance dashboard; budget panel. (Mandate §20.)

### A9 Hardening and Release
- Failure / security / chaos testing; version-drift handling; recovery;
  observability; packaging; documentation; release candidate. (Mandate §21.)

---

## 23. MVP Definition

**[Planned]** The MVP must be able to:

1. validate that both CLIs are available;
2. exercise both through **mocks first**;
3. prepare a shared context;
4. run Specialist or Pair mode;
5. select an owner;
6. allow isolated implementation;
7. run quality gates;
8. perform cross-vendor review;
9. present evidence;
10. produce an autonomous, evidence-bound governance decision (human override).

The MVP path goes through **mock adapters before any real adapter**, consistent
with the long-standing project rule that mock agents precede real adapters
(`PROJECT_CONTEXT.md`).

---

## 24. Success Metrics

**[Planned]** TriForge measures outcomes, not output volume:

- tasks accepted;
- first-pass success rate;
- repair rounds per task;
- review findings (and confirmed vs dismissed);
- regressions detected;
- routing accuracy (`assignedOwner` vs measured best);
- quota consumption per task;
- wall-clock time;
- human overrides;
- provider failures;
- context relevance;
- artifact completeness.

Lines of code generated is explicitly **not** a success metric.

---

## 25. Risks

**[Requires verification] / [Planned]** The approach carries real risks:

- **CLI changes** — provider CLIs can change commands, flags and output formats.
- **Opaque quotas** — quota signals are partial and may be unavailable.
- **Expired auth** — local sessions can lapse mid-run.
- **Unstable event schemas** — provider event formats are not contractually
  guaranteed and may change between versions.
- **Invalid output** — providers can emit malformed plans, diffs or findings.
- **Context poisoning** — derived or stale context can mislead retrieval.
- **Prompt injection from the repository** — repository content can carry
  instructions aimed at the agents; agent output is untrusted.
- **Dangerous commands** — owners may attempt high-risk or blocked actions.
- **Incorrect routing** — the wrong owner may be assigned for a task.
- **Repair loops** — repair can fail to converge and consume quota.
- **Excessive consumption** — debate and competition can burn scarce quota.
- **Provider dependency** — availability of either vendor affects throughput.
- **Windows/WSL2 differences** — path, process and filesystem behavior differs
  across the substrate (substrate decided in A0.4, ADR 0030; enforcement still
  unbuilt).

---

## 26. Final Identity

> TriForge is a local, quota-aware, artifact-driven, **autonomously-governed**
> software engineering environment that coordinates Codex CLI and Claude Code
> through official local sessions, assigns one implementation owner per task, uses
> the second provider for adversarial review, and treats specifications, evidence,
> tests, and an **autonomous, evidence-bound governance decision (with human
> override)** as the authority for merges.

**[Amended by ADR 0031, 2026-06-29]** The original identity read "human-governed"
and "human approval as the final authority." The owner mandate
(`docs/instrucciones.md`) deliberately and explicitly amended this document to
autonomous loop governance with the human as an override authority. This identity
is the invariant the project must preserve across every future milestone. When a
proposed change conflicts with it, the change is wrong until this document is
deliberately and explicitly amended.
