# ADR 0034: Real Read-Only Provider Adapters

## Date

2026-06-29

## Status

Accepted

Establishes the execution boundary for Milestone A3 (Real Read-Only Adapters,
mandate §15): real Codex + Claude `ProviderAdapter` implementations that run the
official CLIs read-only and normalize their output into the A1 contract. Builds on
ADR 0028 (headless CLI integration), ADR 0029 (local subscription auth, no
credential handling), ADR 0030/§8.5 (WSL2 process model), ADR 0032 (untrusted
repository/provider boundaries) and ADR 0033 (provider contract boundary).
Canonical spec: `docs/specs/REAL_PROVIDER_ADAPTERS_SPEC.md`.

## Context

A1 froze the provider-agnostic contracts; A2 added mock adapters, a black-box
conformance harness and the quota manager. A3 must add the first adapters that
touch a real CLI process — while CI runs on ubuntu with neither Codex nor Claude
installed or authenticated, and the threat model declares provider output, the
process environment and the repository all untrusted.

Two forces collide. First, an adapter that spawns a real CLI is inherently
non-deterministic, slow, quota-consuming and impossible to run in CI. Second, the
mandate and threat model forbid spawning a CLI in tests, reading credentials,
forwarding the full environment, writing under a read-only run, or accessing
anything outside the workspace. The exact CLI event schemas are also not frozen:
they are dated, versioned assumptions (CLI spec §20) that cannot be verified in CI.

The contracts already anticipate this: `execute` is `AsyncIterable<ProviderEvent>`,
capabilities are tri-state with `unknown` as first-class, and the harness validates
any adapter purely through its public interface — including an opt-in wall-clock
liveness budget added specifically for real adapters.

## Decision

1. **Inject the child-process boundary (`ProcessRunner`).** The adapters depend on
   a `ProcessRunner` interface (`run(spec) → RunningProcess` with a tagged output
   `AsyncIterable`, `cancel()`, and an `exit` promise). Production uses
   `NodeProcessRunner` — the single file that imports `node:child_process`; tests
   use `FakeProcessRunner`, which replays scripted fixtures and spawns nothing. This
   isolates the only dangerous site and makes the adapters fully testable without a
   live CLI.

2. **Fixtures in CI, live smoke as a manual step.** Unit tests replay synthetic
   fixtures of the documented CLI output through the fake runner and validate both
   adapters with the UNCHANGED A2.2 harness (plus `livenessTimeoutMs`). A real CLI
   is exercised only by a deliberate, human-run live smoke (REQUIRES_VERIFICATION)
   that consumes real quota and is never run in CI. `NodeProcessRunner` is never
   invoked by a test.

3. **Enforce read-only at the boundary; REFUSE writable.** `execute` builds a
   read-only headless invocation (codex `--sandbox read-only`; claude
   `--permission-mode plan`, never `--bare`). The normalizer never fabricates a
   `file.changed`; the harness's `NO_WRITE_UNDER_READ_ONLY` invariant (authority =
   `request.readOnly`) catches a reviewer write attempt (T-INT-14). Writable
   execution is out of scope for A3 and gated on A0.5 + the per-capability binding
   (A5; ADR 0032 §11): a `readOnly:false` request is **REFUSED** with a normalized
   `run.failed` ("writable provider execution is not authorized until A5; requires the
   A0.5 capability binding") and NEVER produces a writable argv. The documented
   writable flags (`--sandbox workspace-write`, `--permission-mode acceptEdits`) are
   kept only as an A5-future spec note.

9. **Harden argv against flag injection.** `buildExecArgs` places a `--`
   end-of-options marker immediately before the sanitized arguments and the objective
   so a flag-shaped objective/arg cannot override the read-only/sandbox flag under
   last-wins argv parsing. Because `--` handling per CLI is unverified
   (REQUIRES_VERIFICATION), the adapter ALSO rejects any objective or sanitized
   argument that begins with `-` (defense in depth) — surfaced as a normalized
   `run.failed`.

10. **Credential-name env denylist (defense in depth).** Beyond the env-name
    allowlist, a credential-name denylist (`*_API_KEY`, `ANTHROPIC_API_KEY`,
    `OPENAI_*KEY*`, `*TOKEN*`, `AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`, `*SECRET*`,
    `*PASSWORD*`, `*_PAT`) is applied case-insensitively when unioning allowlists and
    again inside `curateEnv`, so a credential-shaped NAME is dropped and its value
    never read, even if a caller allowlists it (T-EXE-09 / TB-4).

11. **No collateral kill on settle.** The POSIX SIGKILL-grace timer handle is tracked
    on the run state and cleared on `settle()`, and a second grace timer is never armed
    while one is pending, so a late timer cannot escalate `SIGKILL` against a reused
    PID/PGID.

4. **Normalize defensively into the A1 contract.** A provider-agnostic core fills
   the envelope (monotonic sequence, clock-stamped timestamps, non-secret
   `rawEvidenceRef`), maps raw kinds onto the 13 event types, surfaces parse errors
   and unknown kinds as `warning.raised` (never a throw or an unknown
   discriminator), and always closes with exactly one terminal carrying a
   normalized error code derived from the process exit + any provider-reported
   error. The only provider-specific code is a pure `mapLine` function.

5. **Version-bind capabilities; prefer `unknown` over fabrication.** A
   `CapabilitySnapshot` is recorded against a specific `cliVersion`; a different (or
   undetectable) version invalidates it and degrades all tri-state caps to
   `unknown`. Unobservable signals (usage/quota, the auth probe, Claude's read-only
   preset) stay `unknown` — flag-existence in `--help` is not runtime proof.

6. **Handle no credentials.** Authentication is probed only as a non-secret STATE;
   no password, token, cookie or credential file is read, stored, logged or
   transmitted. The environment is an allowlist of NAMES whose values are pulled
   from `process.env` only inside `NodeProcessRunner`.

7. **Process-group termination.** Cancellation and timeout signal the whole process
   group (POSIX negative-PID SIGTERM→grace→SIGKILL; win32 `taskkill /T /F`), per
   §8.5, so no orphan survives and partial evidence is preserved.

8. **Do not wire into the runtime.** The adapters exist but the server stays
   mock-only; wiring is a later milestone gated on A0.5 + the per-capability binding
   rule.

## Consequences

- The real adapters are validated by the same harness and Zod schemas as the mocks,
  deterministically and offline ("harness before trust"); the single `spawn` site
  is small, isolated and never on the CI path.
- A3 closes the "Codex adapter / Claude adapter / event normalizer" gap (Vision §21)
  for the READ-ONLY case; writable adapters remain missing.
- The provider event schemas remain versioned assumptions; the live smoke + the
  MAJOR-bump/snapshot-invalidation rule absorb the eventual reconciliation against
  the installed CLI versions.
- A2.3's quota manager can consume real `usage.updated` / `quota.updated` events
  where the CLIs expose them; where they do not, the adapter reports `unknown`.

## Risks

- **Schema drift vs. real CLIs.** The assumed Codex/Claude event shapes may differ
  from the installed versions. Mitigation: defensive mapping (unknown→warning, never
  crash), version-bound capabilities, and the manual live smoke that updates
  fixtures/mappers and bumps the contract version on a breaking change.
- **Auth-probe gaps / interactivity.** A reliable non-secret auth-state probe is
  unproven for both CLIs (CLI spec §23); the assumed argvs (`codex login status`,
  `claude auth status`) are REQUIRES_VERIFICATION and a `login`-style verb could be
  interactive. Mitigation: the probe argv MUST be confirmed NON-INTERACTIVE and
  NON-SECRET against the installed CLI before any wiring to `NodeProcessRunner`
  (documented as a first, explicitly-warned step of the manual smoke,
  REAL_PROVIDER_ADAPTERS_SPEC §9); until then the probe is reachable only via the
  manual smoke (never CI), output maps conservatively to `unknown`, and no
  interactive login or credential read is ever performed. Prefer a clearly read-only
  status verb once verified.
- **Production process control not yet exercised.** `NodeProcessRunner`'s kill/grace
  and byte-cap paths are not covered by CI. Mitigation: they are deliberately the
  manual-smoke surface; construction mirrors the verified `tooling/harness` patterns
  and §8.5, and the runtime is not wired until later.
- **Untrusted output trusted too far.** Strict schemas catch malformed events but
  not semantically false ones (T-INJ-12 residual). Mitigation: the harness enforces
  ordering/single-terminal and the result is derived from the stream and reconciled
  against the OS exit; messages are sanitized and `rawEvidenceRef` carries no payload.
