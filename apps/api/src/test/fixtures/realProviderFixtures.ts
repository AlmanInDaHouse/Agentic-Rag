/**
 * Synthetic raw-output fixtures for the real provider adapters (A3 tests).
 *
 * These replay the DOCUMENTED-ASSUMED Codex (`codex exec --json`) and Claude
 * (`claude -p --output-format stream-json`) output formats through a
 * `FakeProcessRunner`. They are the CI-safe substitute for a live CLI: nothing here
 * spawns a process, reads a credential, or touches the network/filesystem. The
 * exact event schemas are versioned assumptions (REQUIRES_VERIFICATION against the
 * installed CLI — OFFICIAL_CLI_PROVIDER_INTEGRATION_SPEC §20); the live smoke, not
 * CI, confirms them.
 *
 * Each fixture is a `FakeProcessScript` (ordered tagged lines + a terminal exit).
 * `makeFixtureRunner` returns a `FakeProcessRunner` that branches on the argv so a
 * single runner serves version/auth probes and the execute stream for one adapter.
 */

import {
  FakeProcessRunner,
  type FakeProcessScript,
  type ProcessExit,
  type ProcessOutputLine,
  type ProcessRunSpec
} from "../../providers/real/index.js";

const out = (line: string): ProcessOutputLine => ({ stream: "stdout", line });
const err = (line: string): ProcessOutputLine => ({ stream: "stderr", line });
const EXIT_OK: ProcessExit = { code: 0, signal: null, reason: "exited" };
const EXIT_ERR: ProcessExit = { code: 1, signal: null, reason: "exited" };
const EXIT_TIMEOUT: ProcessExit = { code: null, signal: "SIGKILL", reason: "timeout" };
const EXIT_SPAWN: ProcessExit = { code: null, signal: null, reason: "spawn_error", detail: "ENOENT" };
const j = (value: unknown): string => JSON.stringify(value);

// --- version probe scripts -----------------------------------------------

export const codexVersionScript: FakeProcessScript = { lines: [out("codex-cli 0.142.4")], exit: EXIT_OK };
export const claudeVersionScript: FakeProcessScript = {
  lines: [out("2.1.195 (Claude Code)")],
  exit: EXIT_OK
};
/** A drifted version (invalidates the version-bound capability fixture). */
export const codexVersionDriftScript: FakeProcessScript = {
  lines: [out("codex-cli 0.200.0")],
  exit: EXIT_OK
};
/** Binary not installed → spawn_error. */
export const notInstalledScript: FakeProcessScript = { lines: [], exit: EXIT_SPAWN };

// --- auth probe scripts ---------------------------------------------------

export const authAuthenticatedScript: FakeProcessScript = { lines: [out("Logged in.")], exit: EXIT_OK };
export const authRequiredScript: FakeProcessScript = { lines: [out("Not logged in.")], exit: EXIT_OK };
export const authExpiredScript: FakeProcessScript = { lines: [out("Session expired.")], exit: EXIT_OK };
/** claude 2.1.195 `auth status` JSON shape (A10-W.6 real-host observation; PII omitted). */
export const claudeAuthJsonScript: FakeProcessScript = {
  lines: [out(j({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }))],
  exit: EXIT_OK
};
export const claudeAuthJsonLoggedOutScript: FakeProcessScript = {
  lines: [out(j({ loggedIn: false }))],
  exit: EXIT_OK
};

// --- Codex execute scripts ------------------------------------------------

export const codexSuccessScript: FakeProcessScript = {
  lines: [
    err("[codex] starting exec (this stderr line is evidence, not an event)"),
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(j({ type: "turn.started" })),
    out(
      j({
        type: "item.completed",
        item: { id: "i1", type: "agent_message", text: "Reviewed the auth module; no issues found." }
      })
    ),
    out(j({ type: "turn.completed", usage: { input_tokens: 1200, output_tokens: 256 } })),
    out(j({ type: "thread.completed" }))
  ],
  exit: EXIT_OK
};

export const codexToolUseScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(
      j({
        type: "item.completed",
        item: { id: "i1", type: "agent_message", text: "Searching for TODOs." }
      })
    ),
    out(
      j({
        type: "item.completed",
        item: { id: "i2", type: "command_execution", command: "rg TODO", exit_code: 0 }
      })
    ),
    out(j({ type: "turn.completed", usage: { input_tokens: 800, output_tokens: 90 } })),
    out(j({ type: "thread.completed" }))
  ],
  exit: EXIT_OK
};

/**
 * A fixture where the CLI emits a `file_change` item (mapped to `file.changed`).
 * Used to prove the runtime read-only contract is harness-detectable: replayed under
 * a `readOnly:true` request it MUST trip the A2.2 harness `NO_WRITE_UNDER_READ_ONLY`
 * invariant (a reviewer/provider that attempts a write under read-only, T-INT-14).
 */
export const codexWritableFileChangeScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(j({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Patching." } })),
    out(
      j({
        type: "item.completed",
        item: { id: "i2", type: "file_change", path: "src/feature.ts", change_type: "modified" }
      })
    ),
    out(j({ type: "thread.completed" }))
  ],
  exit: EXIT_OK
};

/**
 * codex 0.142.4 writable shape (A10-W.6 real-host observation): an `item.started`
 * (lifecycle, ignored) then an `item.completed` carrying `changes: [{ path, kind }]`
 * — one item, possibly many files. No `thread.completed` (clean exit → run.completed
 * synthesized). Exercises the real shape, not only the legacy single-path form.
 */
export const codexWritableChangesScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(j({ type: "turn.started" })),
    out(
      j({
        type: "item.started",
        item: { id: "i1", type: "file_change", changes: [{ path: "src/added.ts", kind: "add" }], status: "in_progress" }
      })
    ),
    out(
      j({
        type: "item.completed",
        item: {
          id: "i1",
          type: "file_change",
          changes: [
            { path: "src/added.ts", kind: "add" },
            { path: "src/old.ts", kind: "delete" }
          ],
          status: "completed"
        }
      })
    ),
    out(j({ type: "item.completed", item: { id: "i2", type: "agent_message", text: "Done." } })),
    out(j({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } }))
  ],
  exit: EXIT_OK
};

export const codexUnknownKindScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(j({ type: "diagnostic.note", note: "an unmodeled event kind" })),
    out(j({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Ok." } })),
    out(j({ type: "thread.completed" }))
  ],
  exit: EXIT_OK
};

export const codexParseErrorScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out("this is not valid json"),
    out(j({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Recovered." } })),
    out(j({ type: "thread.completed" }))
  ],
  exit: EXIT_OK
};

export const codexRateLimitedScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(j({ type: "error", subtype: "rate_limited", message: "Rate limit reached." }))
  ],
  exit: EXIT_ERR
};

export const codexTimeoutScript: FakeProcessScript = {
  lines: [
    out(j({ type: "thread.started", thread_id: "t1" })),
    out(j({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Working…" } }))
  ],
  exit: EXIT_TIMEOUT
};

// --- Claude execute scripts -----------------------------------------------

export const claudeSuccessScript: FakeProcessScript = {
  lines: [
    err("[claude] session starting (stderr evidence, not an event)"),
    out(j({ type: "system", subtype: "init", session_id: "s1", model: "claude", tools: ["Read"] })),
    out(
      j({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Analyzed the module." }] }
      })
    ),
    out(
      j({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Analysis complete.",
        session_id: "s1",
        usage: { input_tokens: 900, output_tokens: 120, cache_read_input_tokens: 50 },
        total_cost_usd: 0.012,
        num_turns: 1
      })
    )
  ],
  exit: EXIT_OK
};

export const claudeToolUseScript: FakeProcessScript = {
  lines: [
    out(j({ type: "system", subtype: "init", session_id: "s1", model: "claude", tools: ["Read"] })),
    out(
      j({
        type: "assistant",
        message: {
          id: "m1",
          role: "assistant",
          content: [
            { type: "text", text: "Reading the file." },
            { type: "tool_use", id: "tu1", name: "Read", input: { path: "src/index.ts" } }
          ]
        }
      })
    ),
    out(
      j({
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] }
      })
    ),
    out(
      j({
        type: "assistant",
        message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Done." }] }
      })
    ),
    out(
      j({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Reviewed.",
        usage: { input_tokens: 500, output_tokens: 80 },
        total_cost_usd: 0.004,
        num_turns: 2
      })
    )
  ],
  exit: EXIT_OK
};

export const claudeUnknownKindScript: FakeProcessScript = {
  lines: [
    out(j({ type: "system", subtype: "init", session_id: "s1" })),
    out(j({ type: "telemetry", foo: "bar" })),
    out(
      j({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Ok." }] }
      })
    ),
    out(j({ type: "result", subtype: "success", is_error: false, result: "Done." }))
  ],
  exit: EXIT_OK
};

export const claudeParseErrorScript: FakeProcessScript = {
  lines: [
    out(j({ type: "system", subtype: "init", session_id: "s1" })),
    out("<<< not json >>>"),
    out(
      j({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Recovered." }] }
      })
    ),
    out(j({ type: "result", subtype: "success", is_error: false, result: "Done." }))
  ],
  exit: EXIT_OK
};

/**
 * claude 2.1.195 stream including a `rate_limit_event` (A10-W.6 real-host observation):
 * normalized to a quota.updated signal (status/window/utilization/resetsAt). Not an
 * error stream — the run still completes successfully.
 */
export const claudeRateLimitEventScript: FakeProcessScript = {
  lines: [
    out(j({ type: "system", subtype: "init", session_id: "s1", model: "claude", tools: ["Read"] })),
    out(
      j({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          resetsAt: 1782993600,
          rateLimitType: "seven_day",
          utilization: 0.79,
          isUsingOverage: false
        }
      })
    ),
    out(
      j({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Working." }] }
      })
    ),
    out(
      j({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done.",
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.001,
        num_turns: 1
      })
    )
  ],
  exit: EXIT_OK
};

export const claudeRateLimitedScript: FakeProcessScript = {
  lines: [
    out(j({ type: "system", subtype: "init", session_id: "s1" })),
    out(j({ type: "result", subtype: "error_rate_limit", is_error: true, result: "Rate limited." }))
  ],
  exit: EXIT_ERR
};

export const claudeTimeoutScript: FakeProcessScript = {
  lines: [
    out(j({ type: "system", subtype: "init", session_id: "s1" })),
    out(
      j({
        type: "assistant",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Working…" }] }
      })
    )
  ],
  exit: EXIT_TIMEOUT
};

// --- runner factory -------------------------------------------------------

export interface FixtureRunnerScripts {
  version?: FakeProcessScript;
  auth?: FakeProcessScript;
  exec?: FakeProcessScript;
}

/** True when this spec is a `--version` probe. */
function isVersionProbe(spec: ProcessRunSpec): boolean {
  return spec.args.includes("--version");
}

/** True when this spec is the (non-version) auth probe. */
function isAuthProbe(spec: ProcessRunSpec): boolean {
  if (isVersionProbe(spec)) {
    return false;
  }
  const first = spec.args[0];
  return first === "login" || first === "auth";
}

const EMPTY_SCRIPT: FakeProcessScript = { lines: [], exit: EXIT_OK };

/**
 * Build a `FakeProcessRunner` that serves the version probe, auth probe and
 * execute stream for ONE adapter from the supplied scripts, selecting by argv.
 */
export function makeFixtureRunner(scripts: FixtureRunnerScripts): FakeProcessRunner {
  return new FakeProcessRunner((spec) => {
    if (isVersionProbe(spec)) {
      return scripts.version ?? EMPTY_SCRIPT;
    }
    if (isAuthProbe(spec)) {
      return scripts.auth ?? EMPTY_SCRIPT;
    }
    return scripts.exec ?? EMPTY_SCRIPT;
  });
}
