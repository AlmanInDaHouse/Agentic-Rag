# Real Read-Only Provider Adapters Spec

**Milestone:** A3 — Real Read-Only Adapters (mandate §15)
**Status:** Implemented (read-only). Adds the real Codex + Claude read-only
adapters, the injectable `ProcessRunner` boundary and the per-provider event
normalizers under `apps/api/src/providers/real/`. The adapters are **not wired into
the running server** — the runtime stays mock-only until a later milestone. No
dependency or `pnpm-lock.yaml` change.
**Related:** `docs/adr/0034-real-read-only-provider-adapters.md`,
`docs/specs/OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC.md` (A0.3, the documented CLI
contract this targets), `docs/specs/PROVIDER_CONTRACTS_SPEC.md` (A1 contracts),
`docs/specs/PROVIDER_MOCKS_HARNESS_QUOTA_SPEC.md` (A2 mocks/harness/quota),
`docs/specs/WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC.md` §8.5 (A0.4 process model),
`docs/specs/PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` (A0.5 threats),
ADR 0028/0029/0032/0033.

A note on tense and trust: every provider-dependent claim here (event schema, CLI
flags, auth-probe command, usage/quota payloads) is a **dated, versioned
assumption** recorded against the versions in OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC
§20 (`codex-cli 0.101.0`, `claude 2.1.195`). Where runtime behavior has not been
confirmed against the installed CLI it is tagged
`REQUIRES_VERIFICATION` and the adapter reports `unknown` / a `warning.raised`
rather than fabricating a value (mandate §4.5; Vision §12). The CI-safe fixtures
encode these assumptions; the **manual live smoke** (Section 9), not CI, confirms
them.

---

## 1. Objective

Implement real, read-only `ProviderAdapter` (A1) implementations for the official
Codex CLI and Claude Code that:

- detect availability + version,
- probe authentication **state** without ever handling a credential,
- report a **version-bound** capability snapshot,
- execute a **read-only** headless invocation as a controlled child process,
- normalize each CLI's raw output stream into the A1 `ProviderEvent` contract,
- support cancellation and timeout via process-group termination,
- pass the A2.2 conformance harness UNCHANGED when driven with a fake runner.

All of this without spawning a real CLI in tests/CI, without reading credentials,
and without writing to the repository or anywhere outside the workspace.

## 2. Scope

- `apps/api/src/providers/real/processRunner.ts` — the `ProcessRunner` abstraction,
  `NodeProcessRunner` (production), `FakeProcessRunner` (tests).
- `apps/api/src/providers/real/normalizerCore.ts` — provider-agnostic
  normalization (envelope, ordering, terminal synthesis, parse/unknown handling).
- `apps/api/src/providers/real/codexNormalizer.ts`, `claudeNormalizer.ts` — the
  per-provider line mappers (the ONLY provider-specific normalizer code).
- `apps/api/src/providers/real/realAdapter.ts` — the shared `RealAdapter` base.
- `apps/api/src/providers/real/codexAdapter.ts`, `claudeAdapter.ts` — the concrete
  adapters (config only: bin, argv, parsers, mapper, capability fixture).
- `apps/api/src/providers/real/index.ts` — the barrel.
- `apps/api/src/test/realAdapters.test.ts`, `normalizers.test.ts`,
  `apps/api/src/test/fixtures/realProviderFixtures.ts` — CI-safe tests + fixtures.

## 3. Non-Goals

- Wiring the real adapters into the server/runtime (the runtime stays mock-only).
- Writable execution / `implementation_write_limited` (A5; gated on A0.5 + the
  per-capability binding rule, ADR 0032 §11).
- Worktree isolation, network confinement, OS-level sandboxing (A0.4/A5/A9).
- Freezing the provider event schemas (they remain versioned assumptions).
- Persisting raw evidence / redaction pipeline (A4/A9) — the adapter only produces
  non-secret `rawEvidenceRef` pointers.
- Quota orchestration decisions (A2.3 quota manager consumes the events).

## 4. The ProcessRunner abstraction

The adapters depend on an injectable boundary so the single `child_process` site is
isolated and testable:

```ts
interface ProcessRunSpec {
  bin: string;            // executed directly — no shell
  args: string[];         // explicit argument vector
  cwd: string;            // explicit working directory
  envAllowlist: string[]; // NAMES; values pulled from process.env at call time
  timeoutMs: number;
  maxOutputBytes: number | null;
}
interface RunningProcess {
  readonly output: AsyncIterable<ProcessOutputLine>; // stdout+stderr, each line tagged
  cancel(): Promise<void>;        // signals the whole process GROUP
  readonly exit: Promise<ProcessExit>; // { code, signal, reason }
}
interface ProcessRunner { run(spec: ProcessRunSpec): RunningProcess; }
```

Termination reasons (`exited | timeout | cancelled | output_limit | spawn_error`)
are mapped by the normalizer onto the A1 error taxonomy.

- **`NodeProcessRunner` (production).** The ONLY file that imports
  `node:child_process`. `spawn` with `shell:false`, an explicit argv, a curated env
  built from the allowlist only, an explicit cwd, `windowsHide:true`, and
  `detached:true` on POSIX so the child leads its own process group. Output is line-
  split and byte-capped; a `timeoutMs` timer and `cancel()` both kill the group. It
  is exercised ONLY by the manual live smoke — never by unit tests or CI.
- **`FakeProcessRunner` (tests).** Replays a scripted sequence of tagged output
  lines + a terminal exit; deterministic; honors `cancel()` at the next line
  boundary. Spawns nothing, reads no env value, opens no socket, touches no file.

## 5. Normalizer contract

`normalizeProcess` (in `normalizerCore.ts`) turns a `RunningProcess` into an ordered
`AsyncGenerator<ProviderEvent>`. For EVERY run it guarantees:

- a leading `run.started` (first event is always valid);
- order preserved; one monotonic `sequenceNumber` from 0; ISO timestamps from the
  injected `Clock` (no real time);
- a non-secret `rawEvidenceRef` (`evidence://real/<executionId>/<seq>.jsonl`) on
  every event — derived from id + sequence, never from payload content;
- raw kinds mapped onto the 13 `ProviderEvent` types;
- a parse error → `warning.raised{code:"provider_parse_error"}` (never thrown);
- an UNKNOWN raw kind → `warning.raised{code:"unknown_provider_event"}` (never a
  crash, never an unknown discriminator);
- a runner/stream error downgraded to `warning.raised{code:"provider_stream_error"}`
  — `execute()`/iteration never throws out of the adapter boundary;
- exactly ONE terminal (`run.completed` / `run.failed`) closing the stream, with a
  normalized error code derived from the process exit reason and any provider-
  reported error condition;
- `partial:true` on a failed terminal iff real output (agent.message / plan / tool
  / file.changed) was emitted before the failure;
- usage/quota mapped where the provider exposes them, always with
  `isBillingAuthoritative:false`; omitted / `unknown` where not observable.

The only provider-specific piece is a pure `ProviderLineMapper.mapLine(line)` that
returns normalized intents for one raw line. It MUST be pure and never throw.

### 5.1 Assumed provider line formats (REQUIRES_VERIFICATION)

- **Codex** (`codex exec --json`): stdout carries one JSON object per line; stderr
  carries diagnostic logs (retained as evidence, not mapped). Mapped `type`s:
  `thread.started`/`turn.started` (lifecycle, ignored), `item.completed` with
  `item.type` `agent_message` → `agent.message`, `command_execution` →
  `tool.started`+`tool.completed`, `file_change`/`patch` → `file.changed`;
  `turn.completed`/`token_count` (usage) → `usage.updated`; `error{subtype}` → a
  normalized terminal error (+ `quota.updated` on a limit); `thread.completed` →
  completion.
- **Claude** (`claude -p --output-format stream-json --verbose`): stdout JSON lines.
  Mapped `type`s: `system{init}` (ignored), `assistant.message.content[]` text →
  `agent.message` / `tool_use` → `tool.started`, `user.message.content[]`
  `tool_result` → `tool.completed`, `result{subtype,is_error,usage,total_cost_usd}`
  → `usage.updated` then completion or a normalized terminal error.

Any unrecognized `type` becomes a `warning.raised`; the schemas are not frozen.

## 6. Per-adapter behavior

`RealAdapter` (shared) implements `ProviderAdapter`; the concrete adapters supply
only config. Provider differences are confined to: bin name, argv, the version/auth
parsers, the line mapper, and the capability fixture.

- **`checkAvailability`** runs `--version` via the runner → `available` (exit 0 +
  parseable version), `unavailable` (spawn error), else `unknown`.
- **`checkAuthentication`** runs a NON-secret auth probe and maps only the reported
  STATE (`authenticated | required | expired | unknown`). It never reads, stores,
  logs or transmits a credential (ADR 0029). The exact probe command is
  REQUIRES_VERIFICATION; unrecognized output maps to `unknown`. For Claude a
  reliable non-secret probe is an open question (CLI spec §23) — the default is
  conservative `unknown`.
- **`getCapabilities`** returns a version-bound `CapabilitySnapshot`. When the
  detected version equals the recorded `knownVersion` it uses the recorded fixture;
  any drift (or undetectable version) **invalidates** the snapshot and degrades all
  tri-state capabilities to `unknown`. Unobservable signals (usage/quota, the auth
  probe, Claude's read-only preset) stay `unknown`, never coerced to `yes`.
- **`execute`** first applies a **boundary guard** (Section 7) that REFUSES a
  request before any argv is built or the runner is touched: a writable request
  (`readOnly:false`) is rejected (A3 is read-only; writable is A5-gated), as is a
  flag-shaped (hyphen-leading) objective or sanitized argument (argv-injection
  guard). A refusal is surfaced as a normalized `run.started` + single `run.failed`
  terminal (no spawn). Otherwise it builds a read-only headless invocation and
  streams raw output through the normalizer → `AsyncIterable<ProviderEvent>`.
- **`cancel`** delegates to the running process group (idempotent; safe for an
  unknown / already-finished execution).

### 6.1 Recorded capability fixtures

| Capability | codex 0.101.0 | claude 2.1.195 | Basis (§20) |
|---|---|---|---|
| headlessSupport | yes | yes | `codex exec` / `-p` observed |
| structuredOutput | yes | yes | `-o`/`--output-schema` / `--output-format json` |
| eventStream | yes | yes | `--json` / `--output-format stream-json` |
| readOnly | yes | unknown | codex `--sandbox read-only`; claude preset unverified |
| write | yes | unknown | codex `--sandbox workspace-write`; claude preset unverified |
| cancellation | yes | yes | adapter-enforced via the process group |
| resume | yes | yes | `exec resume`/`--last` / `--resume`/`--session-id` |
| authProbe | unknown | unknown | non-secret STATE probe unverified |
| usageObservable | unknown | unknown | not observable via `--help` |
| quotaObservable | unknown | unknown | not observable via `--help` |

The `write` row records that the CLI *supports* a writable mode (flag observed), not
that A3 *uses* it: A3 refuses `readOnly:false` and never builds a writable argv
(Section 7). The writable flags are an A5-future note only.

## 7. Security model

Honors the A0.5 threat-model controls and the A0.4 §8.5 process model:

- **A3 refuses writable execution.** Writable execution (`readOnly:false`) is out of
  scope for A3 and gated on A0.5 + the per-capability binding (A5; ADR 0032 §11).
  `execute` REFUSES a `readOnly:false` request with a normalized failure
  (`run.failed`, message "writable provider execution is not authorized until A5;
  requires the A0.5 capability binding") and NEVER builds a writable argv. The
  documented writable flags (codex `--sandbox workspace-write`, claude
  `--permission-mode acceptEdits`) are retained only as an **A5-future spec note**,
  not a runtime path.
- **Read-only enforcement.** Read-only requests use the documented read-only flag
  where the CLI supports it — codex `--sandbox read-only`, claude
  `--permission-mode plan` (REQUIRES_VERIFICATION). The normalizer never fabricates
  a `file.changed`; a conformant read-only run emits none, and the harness's
  `NO_WRITE_UNDER_READ_ONLY` invariant (authority = `request.readOnly`) catches a
  reviewer that attempts a write under a read-only request (T-INT-14) — verified for
  the real adapter, not only the mock.
- **Argv-injection guard (`--` + hyphen-guard).** `buildExecArgs` places a `--`
  end-of-options marker immediately before the sanitized arguments and the objective,
  so everything after it is parsed positionally and a flag-shaped objective/arg
  cannot override the read-only/sandbox flag under last-wins argv parsing.
  REQUIRES_VERIFICATION that each CLI honors `--`; because that is unverified, the
  adapter ALSO rejects any objective or sanitized argument that begins with `-`
  (hyphen-leading positional input is not a legitimate objective) — defense in depth.
- **No `--bare`.** Claude `--bare` forces an API key and bypasses subscription OAuth
  (CLI spec §20, confirmed against 2.1.195); the adapter never uses it (ADR 0029).
- **Environment allowlist + credential denylist.** The env is an allowlist of NAMES;
  values are read from `process.env` only inside `NodeProcessRunner`. The full parent
  environment is never forwarded (T-EXE-09 / CLI spec §12). The runtime allowlist is
  repository-specific. As defense in depth, a credential-name **DENYLIST** is applied
  (case-insensitively) both when unioning the allowlists and inside `curateEnv`, so a
  credential-shaped NAME (`*_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_*KEY*`, `*TOKEN*`
  incl. `GH_TOKEN`/`GITHUB_TOKEN`/`AWS_SESSION_TOKEN`, `AWS_SECRET_ACCESS_KEY`,
  `*SECRET*`, `*PASSWORD*`, `*_PAT`) is dropped — and its value never read — even if a
  caller puts it on the allowlist.
- **No secret handling / leakage.** No credential is read, stored, logged or
  transmitted (TB-4). Terminal/warning messages are length-capped and generic;
  `rawEvidenceRef` carries only id+sequence (no payload). The harness secret scan
  hard-fails on credential-shaped content (T-CMP-09).
- **Process-group termination.** Cancellation/timeout signal the whole group —
  `process.kill(-pid, SIGTERM)` → bounded grace → `SIGKILL` on POSIX, `taskkill
  /PID <pid> /T /F` on win32 — because signalling the lead PID alone does not kill
  the tree (§8.5). No orphaned processes; partial evidence is preserved and the run
  still ends in exactly one terminal. The POSIX SIGKILL-grace timer handle is tracked
  on the run state and **cleared on settle**, and a second grace timer is never armed
  while one is pending, so a late timer can never escalate `SIGKILL` against a reused
  PID/PGID (collateral-kill avoidance).
- **No filesystem/network access** beyond the spawned CLI in production; tests/CI
  spawn nothing at all.

## 8. Version-bound capability snapshots

A `CapabilitySnapshot` is verified against a specific `cliVersion`. A new version
invalidates the prior snapshot (PROVIDER_CONTRACTS_SPEC; CLI spec §8/§20): a flag
observed in `--help` proves the flag *exists*, not its runtime behavior, so flag-
only evidence is reported conservatively and a drift degrades the snapshot to
`unknown`. This makes capability detection honest under CLI churn (T-CMP-02).

## 9. CI-safe fixtures vs manual live smoke

- **CI / unit tests** use `FakeProcessRunner` replaying synthetic fixtures of the
  documented format. They are pure and deterministic: no real CLI, time, process,
  network, credential or filesystem access. CI runs on ubuntu with neither Codex
  nor Claude installed/authed — only the fake is ever used. `NodeProcessRunner` is
  never invoked by tests.
- **Manual live smoke (REQUIRES_VERIFICATION).** A deliberate, human-run step on a
  machine with the authenticated CLIs installed, used to verify the assumed event
  schemas, flags and auth probes against the installed versions. It consumes real
  quota, so it is NOT run in CI and is invoked manually. Documented commands (run
  against the installed CLIs, read-only):

  ```text
  codex --version
  codex exec --json --sandbox read-only -- "summarize README.md"   # observe JSONL schema
  claude --version
  claude -p --output-format stream-json --verbose --permission-mode plan -- "summarize README.md"
  ```

  **Auth-probe verification (REQUIRES_VERIFICATION — do this FIRST, ADR 0029).** The
  assumed non-secret auth-state probe argvs (`codex login status`, `claude auth
  status`) MUST be confirmed **NON-INTERACTIVE and NON-SECRET** against the installed
  CLI before any wiring to `NodeProcessRunner` — a probe that prompts (e.g. a `login`
  verb that initiates an OAuth flow) or that prints a credential is disqualified.
  Verify, then prefer a clearly read-only status verb:

  ```text
  # WARNING: verify NON-INTERACTIVE first (run in a throwaway shell; ensure it cannot
  # prompt for input or print a token/cookie/credential). If it prompts, do NOT wire it.
  codex login status     # candidate; replace with a confirmed read-only status verb
  claude auth status     # candidate; Claude has no confirmed non-secret probe (§23)
  ```

  The live smoke confirms or corrects: the exact event `type`s and payload shapes;
  the usage/quota payloads; the read-only/sandbox flag behavior; whether each CLI
  honors the `--` end-of-options marker; and the non-secret auth-state probe
  (especially for Claude, CLI spec §23). Findings update the fixtures, the mappers
  and the capability fixtures, and bump `PROVIDER_CONTRACT_SCHEMA_VERSION` on any
  breaking change.

## 10. Acceptance criteria

- Both `CodexAdapter` and `ClaudeAdapter` implement the A1 `ProviderAdapter`
  interface and pass the A2.2 `runConformanceCheck` UNCHANGED (with a fake runner +
  `livenessTimeoutMs`) for conformant fixtures (normal, cancellation, timeout).
- `node:child_process` is used ONLY in `NodeProcessRunner` and is never invoked by a
  test; CI spawns no CLI.
- A read-only `execute` emits no `file.changed`; a `readOnly:false` request is
  REFUSED with a normalized `run.failed` (no spawn, no writable argv). A read-only
  request whose provider nonetheless emits a `file.changed` is caught by the harness
  `NO_WRITE_UNDER_READ_ONLY` invariant (proven for the real adapter, not only the
  mock).
- `buildExecArgs` emits a `--` end-of-options marker before the objective/arguments,
  and the adapter rejects any hyphen-leading objective or sanitized argument
  (argv-injection guard).
- A credential-shaped env NAME on the allowlist is dropped by the denylist (union +
  `curateEnv`) and its value is never forwarded.
- Normalizers preserve order, attach a non-secret `rawEvidenceRef`, surface parse
  errors and unknown kinds without crashing, end with exactly one terminal, map
  usage/quota (`isBillingAuthoritative:false`) and normalize error codes.
- Capability snapshots are version-bound and degrade to `unknown` on drift;
  unobservable signals stay `unknown`.
- No credential is read/stored; no dependency or `pnpm-lock.yaml` change.

## 11. Relations

- **A1** (`PROVIDER_CONTRACTS_SPEC`): the contracts the adapters implement and the
  normalizers target.
- **A2.1/A2.2** (`PROVIDER_MOCKS_HARNESS_QUOTA_SPEC`): the mock reference adapter
  and the black-box harness that validates the real adapters unchanged
  ("harness before trust").
- **A0.3** (`OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC`): the documented CLI invocation,
  structured-output format, auth-state model and API-key boundary.
- **A0.4** (`WINDOWS_WSL2_EXECUTION_SUBSTRATE_SPEC` §8.5): the process model
  (shell disabled, explicit argv, env allowlist, explicit cwd, process group).
- **A0.5** (`PROVIDER_REPOSITORY_THREAT_MODEL_SPEC`): the controls honored
  (T-EXE-09 env allowlist, T-INT-14 read-only, T-CMP-02/09 drift + secret leakage).
- **A4/A5**: collaboration runtime + controlled writable execution build on these
  read-only adapters; writable execution remains gated on A0.5 + the binding rule.

## 12. Open questions

- The exact Codex `exec --json` and Claude `stream-json` event schemas vs the
  installed versions (live smoke).
- A reliable non-secret auth-state probe for Claude Code (CLI spec §23).
- Which provider payload fields can carry secret-like values and need redaction
  before persisted evidence (A9).
- How usage/quota signals actually surface at runtime (CLI spec §20
  REQUIRES_VERIFICATION) and how they feed the quota manager (A2.3).
