/**
 * A10-W.5 — Windows safe command policy (mandate §10). `classifyCommand` is pure
 * and structural (no shell), so this runs on any host.
 */

import { describe, expect, it } from "vitest";
import { classifyCommand } from "../execution/command/commandPolicy.js";

const cat = (bin: string, args: string[] = []) => classifyCommand({ bin, args }).category;

describe("A10-W.5 windows command policy", () => {
  it("classifies Windows system-mutating tools as privileged", () => {
    for (const bin of ["reg", "reg.exe", "regedit", "sc", "schtasks", "netsh", "bcdedit", "diskpart", "takeown", "icacls", "cacls", "net", "wmic", "runas", "regsvr32", "rundll32", "vssadmin", "dism", "fsutil", "auditpol", "secedit", "shutdown"]) {
      expect(cat(bin), bin).toBe("privileged");
    }
  });

  it("classifies Windows destructive tools as destructive", () => {
    for (const bin of ["del", "erase", "format", "rd"]) {
      expect(cat(bin), bin).toBe("destructive");
    }
  });

  it("classifies Windows download/network tools as network", () => {
    for (const bin of ["bitsadmin", "certutil", "tftp", "curl.exe"]) {
      expect(cat(bin), bin).toBe("network");
    }
  });

  it("blocks shells, script hosts and provider CLIs by default", () => {
    for (const bin of ["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "wscript", "cscript", "mshta", "codex", "claude", "bash"]) {
      expect(cat(bin), bin).toBe("blocked");
    }
  });

  it("an encoded PowerShell command is blocked regardless of args", () => {
    expect(cat("powershell", ["-NoProfile", "-EncodedCommand", "ZQBjAGgAbwA="])).toBe("blocked");
  });

  it("still allows the safe Windows dev commands (no false denial)", () => {
    expect(cat("git", ["status"])).toBe("read_only");
    expect(cat("git", ["commit", "-m", "x"])).toBe("write_local");
    expect(cat("vitest", ["run"])).toBe("test");
    expect(cat("tsc", ["-p", "."])).toBe("build");
    expect(cat("git.exe", ["push", "--force"])).toBe("destructive");
  });
});
