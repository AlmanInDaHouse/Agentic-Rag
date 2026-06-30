/**
 * A10-W.4 — Native Windows process-tree supervision via Job Objects (mandate §7).
 *
 * POSIX uses a detached process GROUP + `kill(-pid, SIG…)`. Windows has no process
 * groups; killing the lead PID orphans the tree, and `taskkill /T` can miss a
 * process that has detached. The robust native mechanism is a **Job Object** with
 * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: every process assigned to the job — and its
 * future children — is terminated the moment the last job handle closes.
 *
 * Implementation WITHOUT any install or opaque binary: a small PowerShell "job
 * holder" with an embedded C# `Add-Type` P/Invoke block (the in-box .NET Framework
 * `csc` is always present on Windows). Source is fully auditable below. The holder
 * creates a kill-on-close job, assigns the already-spawned child by PID, and then
 * holds the only job handle while blocking on stdin. To reap the whole tree, the
 * supervisor either writes `kill` to the holder (TerminateJobObject) or simply kills
 * the holder — either way the job handle closes and kill-on-close reaps the tree
 * (children, grandchildren, detached processes). `taskkill /T /F` remains a
 * documented FALLBACK only.
 *
 * Residual (RR): a grandchild spawned by the child in the brief window BEFORE the
 * holder assigns the child to the job is not in the job; the taskkill fallback and
 * the kill-on-close of everything-after-assignment bound this. The race is absent
 * for the normal provider-CLI workload (work happens over time, not in the first ms).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ManagedProcess,
  ManagedProcessRequest,
  TerminationReason,
  TerminationResult
} from "@triforge/shared";

/** The PowerShell + embedded-C# job holder. Takes -TargetPid; prints ASSIGNED|FAILED. */
export const JOB_HOLDER_PS1 = String.raw`param([int]$TargetPid)
$ErrorActionPreference = 'Stop'
$src = @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
  public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit;
  public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
  public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
}
[StructLayout(LayoutKind.Sequential)]
public struct IO_COUNTERS {
  public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
  public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
}
[StructLayout(LayoutKind.Sequential)]
public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
  public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
  public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
  public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
}
public static class TfJob {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateJobObjectW(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint len);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);

  const int JobObjectExtendedLimitInformation = 9;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
  // PROCESS_TERMINATE | PROCESS_SET_QUOTA (enough to assign + terminate).
  const uint ACCESS = 0x0001 | 0x0100;
  static IntPtr _job = IntPtr.Zero;

  public static bool Attach(int pid) {
    _job = CreateJobObjectW(IntPtr.Zero, null);
    if (_job == IntPtr.Zero) return false;
    var ext = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    ext.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    int len = Marshal.SizeOf(ext);
    IntPtr p = Marshal.AllocHGlobal(len);
    try {
      Marshal.StructureToPtr(ext, p, false);
      if (!SetInformationJobObject(_job, JobObjectExtendedLimitInformation, p, (uint)len)) return false;
    } finally { Marshal.FreeHGlobal(p); }
    IntPtr proc = OpenProcess(ACCESS, false, (uint)pid);
    if (proc == IntPtr.Zero) return false;
    bool ok = AssignProcessToJobObject(_job, proc);
    CloseHandle(proc);
    return ok;
  }
  public static void Kill() { if (_job != IntPtr.Zero) TerminateJobObject(_job, 1); }
  public static void Close() { if (_job != IntPtr.Zero) { CloseHandle(_job); _job = IntPtr.Zero; } }
}
"@
Add-Type -TypeDefinition $src -Language CSharp | Out-Null
if ([TfJob]::Attach($TargetPid)) { Write-Output 'ASSIGNED' } else { Write-Output 'ATTACH_FAILED'; exit 2 }
try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }            # stdin closed -> release (kill-on-close reaps)
    if ($line -eq 'kill') { [TfJob]::Kill(); break }
  }
} finally {
  [TfJob]::Close()                            # closing the last job handle reaps the tree
}
`;

let cachedHolderPath: string | null = null;

/** Materialize the holder script once under a temp dir; reused across runs. */
function holderScriptPath(): string {
  if (cachedHolderPath !== null) return cachedHolderPath;
  const dir = mkdtempSync(path.join(os.tmpdir(), "tf-jobholder-"));
  const file = path.join(dir, "triforge-job-holder.ps1");
  writeFileSync(file, JOB_HOLDER_PS1, "utf8");
  cachedHolderPath = file;
  return file;
}

/** A live job holder bound to a child PID. */
export interface JobHolder {
  /** Resolves true once the child is assigned to the kill-on-close job. */
  readonly assigned: Promise<boolean>;
  /** Reap the whole tree (TerminateJobObject) then release. Idempotent. */
  reap(): void;
  /** Release the job handle without an explicit terminate (kill-on-close still reaps if anything remains). */
  release(): void;
}

/**
 * Attach a kill-on-close Job Object to an already-spawned child PID via the holder.
 * `taskkill /T /F` on the child PID is the documented fallback used by `reap()`.
 */
export function attachJobObject(pid: number, powershellExe = "powershell"): JobHolder {
  const holder = spawn(powershellExe, ["-NoProfile", "-NonInteractive", "-File", holderScriptPath(), "-TargetPid", String(pid)], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true
  });
  let settled = false;
  let resolveAssigned!: (v: boolean) => void;
  const assigned = new Promise<boolean>((r) => (resolveAssigned = r));
  let buf = "";
  holder.stdout.on("data", (c: Buffer) => {
    buf += c.toString("utf8");
    if (/ASSIGNED/.test(buf)) resolveAssigned(true);
    else if (/ATTACH_FAILED/.test(buf)) resolveAssigned(false);
  });
  holder.on("error", () => resolveAssigned(false));
  holder.on("close", () => {
    if (!settled) resolveAssigned(false);
  });

  const taskkillFallback = (): void => {
    const k = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    k.on("error", () => {
      /* best-effort */
    });
  };
  const end = (sendKill: boolean): void => {
    if (settled) return;
    settled = true;
    try {
      if (sendKill && holder.stdin.writable) holder.stdin.write("kill\n");
      holder.stdin.end();
    } catch {
      /* holder may be gone */
    }
    // Belt-and-suspenders: also walk the tree with taskkill (covers a pre-assignment race).
    if (sendKill) taskkillFallback();
  };
  return {
    assigned,
    reap: () => end(true),
    release: () => end(false)
  };
}

// --- ManagedProcess implementation over Node spawn + the Job Object holder --------

interface OutRec {
  stream: "stdout" | "stderr";
  line: string;
}

class LineQueue {
  private readonly items: OutRec[] = [];
  private readonly waiters: ((v: IteratorResult<OutRec>) => void)[] = [];
  private done = false;
  push(rec: OutRec): void {
    const w = this.waiters.shift();
    if (w) w({ value: rec, done: false });
    else this.items.push(rec);
  }
  close(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as unknown as OutRec, done: true });
  }
  iterable(): AsyncIterable<OutRec> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<OutRec>> {
            const item = self.items.shift();
            if (item) return Promise.resolve({ value: item, done: false });
            if (self.done) return Promise.resolve({ value: undefined as unknown as OutRec, done: true });
            return new Promise((resolve) => self.waiters.push(resolve));
          }
        };
      }
    };
  }
}

/**
 * Spawn a supervised Windows process: Node owns stdio; a kill-on-close Job Object
 * (via {@link attachJobObject}) owns the process TREE. Emits exactly one terminal
 * result after output drains. `cancel()` reaps the whole tree.
 */
export function runManagedWindowsProcess(request: ManagedProcessRequest): ManagedProcess {
  const queue = new LineQueue();
  let settled = false;
  let pendingReason: TerminationReason | null = null;
  let outBytes = 0;
  const bufs = { stdout: { rest: "" }, stderr: { rest: "" } };

  const child: ChildProcess = spawn(request.executable, [...request.args], {
    cwd: request.cwd,
    env: { ...request.env },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const holder = child.pid !== undefined ? attachJobObject(child.pid) : null;

  let resolveTerminal!: (r: TerminationResult) => void;
  const terminal = new Promise<TerminationResult>((r) => (resolveTerminal = r));

  const reap = (reason: TerminationReason): void => {
    if (pendingReason === null) pendingReason = reason;
    if (holder) holder.reap();
    else {
      const k = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      k.on("error", () => {});
    }
  };

  const timeoutMs = request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : 0;
  const timer = timeoutMs > 0 ? setTimeout(() => reap("timeout"), timeoutMs) : null;
  if (timer && typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();

  const consume = (stream: "stdout" | "stderr", chunk: Buffer): void => {
    if (request.maxOutputBytes) outBytes += chunk.byteLength;
    const text = bufs[stream].rest + chunk.toString("utf8");
    const parts = text.split("\n");
    bufs[stream].rest = parts.pop() ?? "";
    for (const p of parts) queue.push({ stream, line: p.replace(/\r$/, "") });
    if (request.maxOutputBytes && outBytes > request.maxOutputBytes && pendingReason === null) reap("output_limit");
  };
  child.stdout?.on("data", (c: Buffer) => consume("stdout", c));
  child.stderr?.on("data", (c: Buffer) => consume("stderr", c));

  const settle = (result: TerminationResult): void => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    // Release the job handle (the child has ended; nothing left to reap on normal exit).
    if (holder) holder.release();
    const flush = (stream: "stdout" | "stderr"): void => {
      if (bufs[stream].rest.length > 0) {
        queue.push({ stream, line: bufs[stream].rest.replace(/\r$/, "") });
        bufs[stream].rest = "";
      }
    };
    flush("stdout");
    flush("stderr");
    queue.close();
    resolveTerminal(result);
  };

  child.on("error", (err: Error) => {
    settle({ reason: "spawn_error", exitCode: null, treeReaped: false, detail: err.name });
  });
  child.on("close", (code: number | null) => {
    const reason: TerminationReason = pendingReason ?? "exited";
    settle({
      reason,
      exitCode: reason === "exited" ? code : null,
      treeReaped: pendingReason !== null && pendingReason !== "exited",
      detail: reason === "exited" ? `exit ${code}` : reason
    });
  });

  return {
    processId: String(child.pid ?? "unknown"),
    output: queue.iterable(),
    terminal,
    cancel: async (reason: TerminationReason): Promise<void> => {
      reap(reason);
    }
  };
}
