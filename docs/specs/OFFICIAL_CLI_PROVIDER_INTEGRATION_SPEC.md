# Official CLI Provider Integration Spec

**Milestone:** A0.3 — Official CLI Integration and Local Authentication Architecture
**Status:** Documentation only. No code, tests, migrations, endpoints, runtime,
database, dashboard or dependency changes.
**Related:** `docs/adr/0028-official-headless-cli-integration.md`,
`docs/adr/0029-local-subscription-authentication.md`,
`docs/specs/QUOTA_AWARE_PROVIDER_ORCHESTRATION_SPEC.md` (ADR 0027),
`docs/context/TRIFORGE_PROJECT_VISION.md`.

A note on tense: this spec fixes the architectural boundary that must exist
*before* a `ProviderAdapter` is written. Nothing here is implemented. The
conceptual `ts` blocks are design contracts for a future milestone, not Zod
contracts, database schemas or API shapes. External, provider-dependent facts are
recorded as dated, versioned assumptions and are flagged
`REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION` where the installed CLI behavior
has not been confirmed at runtime.

---

## 1. Purpose

TriForge will integrate providers by running their **official CLIs as local
processes**. In the initial flow TriForge does not:

- call models directly through an API,
- automate web interfaces,
- capture cookies,
- extract OAuth tokens,
- share sessions,
- act as a proxy for third parties.

The user authenticates each official CLI directly. TriForge launches the CLI as a
controlled child process, observes its supported outputs, and normalizes them
into internal contracts. The CLI — not TriForge — owns provider credentials and
the session lifecycle.

This spec defines availability detection, version detection, non-secret
authentication probing, capability detection, non-interactive execution,
structured-stream consumption, evidence capture, timeout/cancellation
requirements, the trust boundary, and the API-key boundary. It establishes these
limits before any adapter is built.

## 2. Scope

Initial providers:

```text
codex     (OpenAI Codex CLI)
claude    (Anthropic Claude Code)
```

Initial integration model:

```text
local
single-user
subscription-authenticated
headless execution
no API keys
```

## 3. Goals

A future integration must be able to:

- detect availability,
- detect version,
- check authentication without exposing secrets,
- detect capabilities,
- execute non-interactively,
- consume structured streams when they exist,
- capture stdout and stderr,
- record the exit code,
- support a per-invocation timeout,
- support cancellation,
- normalize events into internal contracts,
- produce a structured result,
- stop if human interaction is required,
- respect quota and the Safe Execution Policy.

## 4. Non-Goals

This milestone implements none of the following.

Deferred to a future adapter milestone (A1+):

- adapter implementation,
- real event or output parsing,
- model execution,
- remote execution,
- multi-user SaaS,
- the Windows/WSL2 substrate decision (deferred to A0.4),
- worktree isolation,
- provider-specific business logic.

Permanently excluded by the initial policy (ADR 0027, 0028, 0029) — not deferred
features a later milestone may add:

- API keys,
- OAuth managed by TriForge,
- automated login,
- refresh-token handling,
- bypassing provider restrictions.

## 5. Trust Boundary

```text
User
  └── authenticates directly with the official CLI

Official CLI
  └── owns provider credentials and session lifecycle

TriForge
  └── launches the process and observes supported outputs
```

TriForge must never receive:

- a password,
- a cookie,
- an access token,
- a refresh token,
- a credential file,
- a keychain secret.

The boundary is one-directional: credentials flow from the user into the official
CLI's own secure storage; TriForge observes only process I/O and exit status.

## 6. Process Model

```text
TriForge Runtime
    ↓ spawn
Provider CLI Process
    ├── stdin
    ├── stdout
    ├── stderr
    ├── structured event stream   (when supported)
    └── exit code
```

The runtime must control:

- working directory,
- environment allowlist (Section 12),
- timeout,
- cancellation,
- maximum output size,
- process-tree termination,
- allowed paths,
- network policy,
- artifact persistence.

The concrete sandbox policy (OS-level isolation, process-tree kill semantics,
network confinement) is deferred to the execution-substrate ADR (A0.4) and is not
fixed here.

## 7. Execution Modes

```ts
type ProviderExecutionMode =
  | "analysis_read_only"
  | "review_read_only"
  | "implementation_write_limited"
  | "self_review"
  | "capability_probe";
```

Rules:

- `capability_probe` must not run a user task; it only inspects local,
  non-destructive interfaces (version, help, non-secret auth probe).
- `analysis_read_only` must not write.
- `review_read_only` must not write.
- `implementation_write_limited` requires an explicit owner assignment
  (`docs/context/TRIFORGE_PROJECT_VISION.md`, Section 15) and writes only within
  the authorized scope.
- The adapter never decides permissions on its own; the **Safe Execution Policy
  governs** (ADR 0011), and a real provider invocation is in the
  `external_adapter_call` family.

These modes are mapped onto each CLI's supported controls during capability
detection (Section 8); the mapping is provider- and version-specific and is not
frozen here.

## 8. Capability Detection

```ts
type ProviderCapabilities = {
  provider: "codex" | "claude";
  installed: boolean;
  version?: string;
  headlessExecution: boolean | "unknown";
  structuredEvents: boolean | "unknown";
  structuredFinalOutput: boolean | "unknown";
  cancellation: boolean | "unknown";
  timeoutControl: boolean | "unknown";
  readOnlyMode: boolean | "unknown";
  writeLimitedMode: boolean | "unknown";
  localSubscriptionAuth: boolean | "unknown";
  sessionResume: boolean | "unknown";
  usageSignals: boolean | "unknown";
  quotaSignals: boolean | "unknown";
  verifiedAt: string;
  verifiedAgainstInstalledVersion: boolean;
};
```

Rules:

- capability detection is **version-specific**;
- unknown fields remain `unknown`; they are never coerced into `true`;
- support is never inferred from reputation, documentation, or an AI claim;
- flags are never frozen without being observed against the installed version;
- a CLI update invalidates or degrades the cached capability snapshot, which must
  carry the version it was verified against (Section 20 and ADR 0028).

A flag observed in a CLI's `--help` is evidence that the *flag exists* in the
installed version; it is **not** proof of runtime behavior. Capability fields are
only set to `true` once the corresponding behavior is verified; until then they
record the observed flag and remain `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION`
for runtime behavior.

## 9. Authentication State Model

```ts
type ProviderAuthenticationState =
  | "authenticated"
  | "authentication_required"
  | "authentication_expired"
  | "authentication_unknown"
  | "provider_unavailable";
```

TriForge needs to know only the **state**, never the credentials. These states
map onto the quota orchestration condition codes (ADR 0027): an unauthenticated
or expired provider surfaces `PROVIDER_AUTHENTICATION_REQUIRED`, and an
unreachable provider surfaces `PROVIDER_UNAVAILABLE`. Authentication and
reachability are deliberately separate from quota `status`.

## 10. Authentication Flow

```text
TriForge checks provider availability
    ↓
TriForge performs a non-secret auth probe
    ↓
Authenticated?
    ├── yes      → execution may continue
    ├── no       → stop with PROVIDER_AUTHENTICATION_REQUIRED
    └── unknown  → require manual verification or stop conservatively
```

TriForge must not automate login. The user starts the session directly through
the official CLI. A non-secret auth probe inspects only the provider's reported
authentication *state*; it must not request, display, persist or transit any
secret, and must be confirmed (Section 20) not to emit credentials before it is
relied upon.

## 11. Local Session Policy

Provider sessions:

- belong to the user,
- remain inside official mechanisms (the CLI's own credential storage),
- are not copied between machines,
- are not exported,
- are not shared,
- are not written to logs,
- are not written to artifacts,
- are not written to context packs.

## 12. Environment Policy

TriForge must not pass the entire environment indiscriminately to the child
process. Each variable is classified:

```ts
type EnvironmentVariableClass =
  | "required_runtime"
  | "safe_project"
  | "provider_managed"
  | "sensitive_blocked"
  | "unknown_blocked";
```

Rules:

- `required_runtime` and `safe_project` may be forwarded;
- `provider_managed` variables are owned by the CLI and are not injected,
  rewritten or logged by TriForge;
- `sensitive_blocked` is never forwarded;
- `unknown_blocked` is the conservative default — an unrecognized variable is
  blocked, not forwarded.

This spec does not document the names of real secrets. The allowlist is
conceptual; the concrete list is defined during implementation and is
repository-specific.

## 13. Event-Driven Integration

The future adapter interface is event-stream based:

```ts
execute(
  request: AgentExecutionRequest
): AsyncIterable<ProviderEvent>;
```

Conceptual internal event union:

```ts
type ProviderEvent =
  | RunStarted
  | AuthenticationUpdated
  | AgentMessage
  | PlanUpdated
  | ToolStarted
  | ToolCompleted
  | FileChanged
  | UsageUpdated
  | QuotaUpdated
  | ApprovalRequested
  | WarningRaised
  | RunFailed
  | RunCompleted;
```

External payloads are **not frozen**. Each adapter normalizes the
provider-specific stream into this internal contract. `UsageUpdated` and
`QuotaUpdated` are the bridge to the quota model's `ProviderUsageEstimate` and
`ProviderQuotaEvent` (ADR 0027). The exact provider event schemas must be verified
against the installed CLI version before an adapter is frozen
(`REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION`).

## 14. Raw Evidence Retention

Retained safely for audit:

- permitted stdout,
- permitted stderr,
- structured events,
- exit code,
- timestamps,
- provider version,
- sanitized arguments,
- repository-relative working directory,
- termination reason.

Never retained:

- secrets,
- tokens,
- cookies,
- sensitive environment variables,
- content outside the authorized scope,
- unnecessary private paths.

Evidence retention reuses the existing data-handling and redaction boundaries
(Context Data Policy, ADR 0016); raw provider payloads must be redacted of
secret-like values before persistence.

## 15. Error Model

```ts
type ProviderExecutionErrorCode =
  | "provider_not_installed"
  | "provider_version_unsupported"
  | "authentication_required"
  | "authentication_expired"
  | "authentication_unknown"
  | "quota_warning"
  | "quota_exhausted"
  | "rate_limited"
  | "interaction_required"
  | "permission_denied"
  | "structured_output_invalid"
  | "event_stream_invalid"
  | "timeout"
  | "cancelled"
  | "process_crashed"
  | "output_limit_exceeded"
  | "provider_unavailable"
  | "unknown";
```

These error codes are internal. The quota-related codes (`quota_warning`,
`quota_exhausted`, `rate_limited`) resolve onto the quota orchestration condition
codes defined in ADR 0027, where `quota_exhausted` maps to the terminal
`provider_quota_exhausted` stop condition while `quota_warning` and `rate_limited`
are non-terminal there; the auth codes resolve onto
`PROVIDER_AUTHENTICATION_REQUIRED`. `unknown` is never coerced into a more
specific code.

## 16. Interactive Prompt Handling

If the CLI requests:

- login,
- approval,
- an interactive selection,
- a destructive confirmation,
- any unanticipated input,

TriForge must:

1. detect the condition when possible,
2. stop or pause,
3. preserve partial evidence,
4. surface the required action to the user,
5. never respond automatically to a login, an approval, or a destructive
   confirmation — these always hard-stop with `interaction_required` (a login
   resolves to `PROVIDER_AUTHENTICATION_REQUIRED`), consistent with Section 10,
   ADR 0029 and the blocked-by-default Safe Execution Policy; any "explicit policy
   permits it" exception is limited to non-auth, non-destructive prompts.

Headless modes are used specifically to avoid interactive prompts; if a prompt is
nonetheless detected, the safe default is `interaction_required` and a stop, not a
guessed answer. Detection mechanics are provider- and version-specific
(`REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION`).

## 17. Cancellation and Timeout

The architecture must require:

- a per-invocation timeout,
- manual cancellation,
- child-process termination,
- process-tree termination,
- an explicit final state,
- preserved partial artifacts,
- no orphaned processes.

Whether timeout and cancellation are enforced by a CLI flag or by TriForge's own
process control depends on the installed version's capabilities (Section 8) and
on the execution substrate (A0.4). When the CLI exposes no native control,
TriForge enforces timeout and cancellation at the process level. Process-tree
termination semantics differ across Windows and WSL2 and are an open question for
A0.4.

## 18. Output Normalization

Each execution must finish by producing:

```ts
type ProviderExecutionResult = {
  provider: "codex" | "claude";
  status: "completed" | "partial" | "failed" | "cancelled";
  artifact?: AgentArtifact;
  exitCode?: number;
  startedAt: string;
  completedAt?: string;
  warnings: string[];
  errorCode?: ProviderExecutionErrorCode;
  usage?: ProviderUsageEstimate;
};
```

`usage` reuses `ProviderUsageEstimate` from the quota spec and is always a
client-side estimate, never authoritative billing. A crashed or cancelled run
still produces a result with `status: "partial" | "cancelled"` and preserved
partial artifacts; it is never silently dropped.

## 19. Subscription and API Boundary

Initial policy:

```text
local subscription sessions only
no API key fallback
no automatic purchased credits
no automatic usage-credit activation
```

If a CLI requires an API key for a capability:

- that capability is marked `unavailable`,
- execution stops,
- no key is requested, generated or persisted.

This is consistent with ADR 0027 (no API keys, no automatic credits) and ADR 0029.
A provider mode that bypasses subscription OAuth in favor of an API key is
excluded from the initial flow (see Section 20, Claude `--bare`).

## 20. Provider-Specific Assumptions

Every provider-dependent claim is a dated, versioned assumption. The following
were recorded on **2026-06-28** by inspecting only local, non-destructive
interfaces (`--version`, `--help`) of the installed CLIs. No AI task was run, no
session was started, no credential store was read.

Installed versions observed: **`codex-cli 0.101.0`**, **`claude 2.1.195 (Claude
Code)`**.

The distinction below is deliberate: a `--help` observation establishes that a
*flag exists* in the installed version; it does **not** establish runtime
behavior. Runtime behavior is `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION`
until confirmed by controlled execution in a later milestone.

### Codex CLI

| Claim | Source | Verified date | Installed version | Status | Reverify before implementation |
|---|---|---|---|---|---|
| Headless command available (`codex exec`) | local `--help` | 2026-06-28 | 0.101.0 | flag observed | yes |
| Structured event stream (`--json`, JSONL events) | local `exec --help` | 2026-06-28 | 0.101.0 | flag observed; payload schema unverified | yes |
| Structured final output (`--output-schema`, `-o/--output-last-message`) | local `exec --help` | 2026-06-28 | 0.101.0 | flag observed | yes |
| Read-only mode (`--sandbox read-only`) | local `exec --help` | 2026-06-28 | 0.101.0 | flag observed | yes |
| Write-limited mode (`--sandbox workspace-write`, `--add-dir`, `-C/--cd`) | local `exec --help` | 2026-06-28 | 0.101.0 | flag observed | yes |
| Local subscription auth (`login`/`logout` subcommands) | local `--help` | 2026-06-28 | 0.101.0 | subcommands observed; subscription-vs-key default unverified | yes |
| Session resume (`exec resume`, `--last`) | local `exec --help` | 2026-06-28 | 0.101.0 | flag observed | yes |
| Usage signal available | — | 2026-06-28 | 0.101.0 | not observable via `--help` | yes — `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION` |
| Quota signal available | — | 2026-06-28 | 0.101.0 | not observable via `--help` | yes — `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION` |
| Native timeout / cancellation flag | — | 2026-06-28 | 0.101.0 | no such flag in `exec --help`; process-level only | yes |

### Claude Code

| Claim | Source | Verified date | Installed version | Status | Reverify before implementation |
|---|---|---|---|---|---|
| Headless command available (`-p`/`--print`) | local `--help` | 2026-06-28 | 2.1.195 | flag observed | yes |
| Structured event stream (`--output-format stream-json`, `--include-partial-messages`) | local `--help` | 2026-06-28 | 2.1.195 | flag observed; payload schema unverified | yes |
| Structured final output (`--output-format json`, `--json-schema`) | local `--help` | 2026-06-28 | 2.1.195 | flag observed | yes |
| Read-only / write-limited mode (`--permission-mode`, `--allowedTools`/`--disallowedTools`, `--add-dir`) | local `--help` | 2026-06-28 | 2.1.195 | flags observed; exact read-only preset unverified | yes |
| Local subscription auth is the default (OAuth/keychain) | local `--help` (`--bare` description) | 2026-06-28 | 2.1.195 | observed by negative definition (see below) | yes |
| Session resume (`--resume`, `--session-id`, `--fork-session`) | local `--help` | 2026-06-28 | 2.1.195 | flag observed | yes |
| Usage signal in result/stream | — | 2026-06-28 | 2.1.195 | not confirmed from `--help`; payload unverified | yes — `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION` |
| Quota signal available | — | 2026-06-28 | 2.1.195 | not observable via `--help` | yes — `REQUIRES_VERIFICATION_AGAINST_INSTALLED_VERSION` |
| Native timeout / cancellation flag | — | 2026-06-28 | 2.1.195 | no such flag in `--help`; process-level only | yes |

### Cross-cutting verified exclusion: Claude `--bare`

ADR 0027 recorded the `--bare` exclusion as `REQUIRES_REVERIFICATION`. The
installed Claude Code 2.1.195 `--help` describes `--bare` as: *"Anthropic auth is
strictly `ANTHROPIC_API_KEY` or apiKeyHelper via `--settings` (OAuth and keychain
are never read)."* This **confirms, against the installed version (2026-06-28),**
that `--bare` bypasses subscription OAuth and requires an API key. Therefore the
no-API-key subscription flow **must not use `--bare`**. This assumption is upgraded
from "unverified" to "verified against installed version 2.1.195"; it remains a
dated assumption that must be reverified if the CLI version changes.

## 21. Mock Requirements for A1

Mocks are not implemented in this milestone. The future mock adapters (A1) must
cover at least:

```text
provider installed and authenticated
provider not installed
auth required
auth expired
auth status unknown
headless unsupported
structured events unsupported
invalid event
partial output then crash
timeout
manual cancellation
interactive prompt detected
permission denied
quota warning
quota exhausted
rate limited
output limit exceeded
successful structured result
```

## 22. Acceptance Criteria

This documentation milestone is accepted if the spec:

- defines the trust boundary,
- defines the process model,
- defines capability detection,
- defines authentication states,
- prohibits credential handling,
- defines event-driven integration,
- defines the error model,
- defines interactive prompt handling,
- defines timeout and cancellation requirements,
- defines the API boundary,
- defines future mock scenarios,
- records external facts as dated, versioned assumptions,
- implements no code, tests, migrations, endpoints, runtime, database or
  dashboard changes.

## 23. Open Questions

- How can authentication be probed without triggering interactive prompts?
- Which flags are stable across CLI versions, and how is drift detected?
- How is "interaction required" reliably detected in a headless stream?
- How are process trees terminated safely on Windows and on WSL2 (A0.4)?
- Which provider payloads can contain secret-like values and must be redacted?
- How are provider-specific tool-use events normalized into `ProviderEvent`?
- How is stdout summarized for the timeline without losing audit evidence?
- How are capability snapshots versioned and invalidated on CLI updates?
- How are incompatible CLI changes detected before they reach an adapter?
- Which capabilities require explicit human opt-in before first use?
