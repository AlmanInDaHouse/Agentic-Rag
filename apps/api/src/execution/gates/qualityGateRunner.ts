/**
 * Quality Gate Runner (A5.6) — runs the project's quality gates and reports a
 * STRUCTURED result computed from the REAL exit codes, never from a provider's claim
 * that "the tests pass" (mandate §A5.6; threat-model T-INT-04, gate spoofing).
 *
 * Gate commands come from TRUSTED configuration (the repo/run config), not from
 * provider output, and run through the A5.3 `CommandSupervisor` (policy + process
 * supervision). A gate passes iff its command exits 0; a denied/timed-out/flooded
 * command is NOT passed. The result aligns with the A1 `QualityGateResult` contract,
 * carries each gate's exit code + an output-artifact hash, and is bound to the tested
 * diff hash (A5.5) so a result cannot be replayed against a different diff.
 *
 * Gate-tampering detection (`gateTampering.ts`) is separate: it flags deleted tests
 * and weakened CI/gate config in the worktree changes.
 */

import { createHash } from "node:crypto";
import type { QualityGateName, QualityGateStatus } from "@triforge/shared";
import type { CommandSpec } from "../command/index.js";
import type { CommandSupervisor } from "../command/index.js";

export interface GateSpec {
  name: QualityGateName;
  /** The trusted command to run for this gate. */
  command: CommandSpec;
}

export interface GateOutcome {
  name: QualityGateName;
  status: QualityGateStatus;
  exitCode: number | null;
  /** sha256 of the captured stdout+stderr (artifact reference; not the raw output). */
  outputHash: string;
  detail: string;
  startedAt: string;
  endedAt: string;
}

export interface QualityGateRunResult {
  overallStatus: QualityGateStatus;
  gates: GateOutcome[];
  /** The A5.5 diff hash the gates were run against (binds result ↔ diff). */
  testedDiffHash: string | null;
}

export interface QualityGateRunnerOptions {
  supervisor: CommandSupervisor;
  /** The worktree root the gates run in. */
  cwd: string;
  gates: GateSpec[];
  clock: { iso(): string };
  /** The diff hash the gates are validating (A5.5). */
  testedDiffHash?: string | null;
  onAudit?: (outcome: GateOutcome) => void;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class QualityGateRunner {
  private readonly opts: QualityGateRunnerOptions;

  constructor(options: QualityGateRunnerOptions) {
    this.opts = options;
  }

  /** Run every configured gate in order and reduce to a structured result. */
  async run(): Promise<QualityGateRunResult> {
    const gates: GateOutcome[] = [];
    for (const gate of this.opts.gates) {
      gates.push(await this.runGate(gate));
    }
    return {
      overallStatus: overall(gates.map((g) => g.status)),
      gates,
      testedDiffHash: this.opts.testedDiffHash ?? null
    };
  }

  private async runGate(gate: GateSpec): Promise<GateOutcome> {
    const startedAt = this.opts.clock.iso();
    const result = await this.opts.supervisor.run(gate.command, this.opts.cwd);
    const outputHash = sha256(`${result.stdout}
${result.stderr}`);

    let status: QualityGateStatus;
    let detail: string;
    if (!result.allowed) {
      // A gate whose command the policy refuses cannot be trusted as passed.
      status = "failed";
      detail = `gate command rejected by policy: ${result.denyReason ?? "denied"}`;
    } else if (result.terminationReason === "timeout") {
      status = "failed";
      detail = "gate timed out";
    } else if (result.terminationReason === "output_limit") {
      status = "failed";
      detail = "gate output exceeded the limit";
    } else if (result.exitCode === 0) {
      status = "passed";
      detail = "exit 0";
    } else {
      status = "failed";
      detail = `exit ${result.exitCode ?? "null"}`;
    }

    const outcome: GateOutcome = {
      name: gate.name,
      status,
      exitCode: result.exitCode,
      outputHash,
      detail,
      startedAt,
      endedAt: this.opts.clock.iso()
    };
    try {
      this.opts.onAudit?.(outcome);
    } catch {
      /* audit must not break the run */
    }
    return outcome;
  }
}

/** Reduce per-gate statuses: any fail → failed; all pass → passed; else unknown. */
function overall(statuses: QualityGateStatus[]): QualityGateStatus {
  if (statuses.some((s) => s === "failed")) {
    return "failed";
  }
  if (statuses.length > 0 && statuses.every((s) => s === "passed")) {
    return "passed";
  }
  return "unknown";
}
