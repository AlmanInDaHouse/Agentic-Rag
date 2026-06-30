# ADR 0055: Real isolation mechanism for provider/repo execution (A10.2)

## Date

2026-06-30

## Status

Accepted

Second decision of Milestone A10. Selects the isolation mechanism that confines a real
provider run to its worktree and records why WSL2 alone is insufficient. Mandate §6.
Spec: `REAL_PROVIDER_OPERATIONAL_CLOSURE_SPEC.md` §5.

## Context

A10.3 will let the real providers write. Before that, the runtime needs a verified
isolation boundary satisfying the 13 mandate-§6 invariants. A0.4 already decided WSL2 is
**not** a security sandbox (ADR 0030); the substrate gives us a POSIX kernel, not
confinement. We must pick the minimal mechanism that actually enforces the invariants and
is testable on this dev host + CI.

The existing primitives already enforce most invariants, verified against real fixtures:
allowed-path containment (A5.2: traversal / symlink / hardlink / `.git` / `/mnt/c` /
`$HOME` / sibling-worktree all denied), deny-by-default command policy with no shell
(A5.3: network / destructive / privileged / unknown refused), curated env with a
credential denylist (A5.3), and process-group supervision with timeout + output cap +
SIGTERM→SIGKILL (A5.3). The remaining gaps were: `.gitattributes` smudge/clean/diff
FILTER execution-on-checkout (T-FS-05, never closed by the hook/fsmonitor hardening), the
absence of a single consolidated, testable boundary, and undeclared resource limits.

## Decision

1. **Mechanism = in-process policy composition, not the OS distro.** The boundary is the
   composition of PathPolicyEngine + CommandPolicy + curated provider env +
   process-group supervision, surfaced as one module
   (`apps/api/src/execution/isolation/isolationBoundary.ts`) and proven by one invariant
   matrix (`isolation.invariants.test.ts`, 13 invariants + negative fixtures). This is the
   *minimal* mechanism that enforces all invariants on both the Windows dev host and CI
   Linux without privileged setup.

2. **Close T-FS-05.** Add `.gitattributes` filter neutralization: scan referenced
   filter/diff drivers and emit `git -c filter.<d>.smudge= …clean= …process= required=false`
   no-op overrides, applied alongside the existing hook hardening on every managed checkout.

3. **Declare resource limits.** `DEFAULT_ISOLATION_LIMITS` (timeout, output bytes, files)
   are enforced by the supervisor/path-policy. Memory/CPU/process-count caps are POSIX-only
   best-effort (`setrlimit`/cgroup at the substrate) and are declared as a **documented
   residual** on Windows/Node, never silently "enforced".

4. **WSL2 is not the sandbox (invariant 13).** Encoded as `WSL2_IS_NOT_A_SANDBOX` and
   asserted by the matrix, so a future change cannot regress into trusting the distro.

5. **OS-level confinement is future hardening, not 1.0-blocking.** Linux user namespaces /
   `unshare` / a rootless container / seccomp were evaluated. They add real defense (network
   namespace deny, mount isolation, syscall filtering) but require substrate-specific setup
   and are not portable to the Windows dev host. They are recorded as RR-4 residual and a
   post-1.0 hardening path; the in-process composition is sufficient for the governed,
   low-risk, fixture-repo pilots A10 runs.

## Alternatives

1. **Treat the worktree (or WSL2) as the boundary.** Rejected: mandate §6 invariant 13;
   worktrees share `.git/objects` and inherit the process env.
2. **Require a container/namespace before any real run.** Rejected for 1.0: not portable to
   the Windows dev host, heavy setup, and unnecessary for governed fixture-repo pilots. Kept
   as RR-4 future hardening.
3. **Modify the existing A5.2/A5.3 engines in place.** Rejected: they are well-tested and
   widely depended on; a separate composition module adds the A10.2 pieces without
   destabilizing them.

## Consequences

### Positive

- One auditable boundary + one invariant matrix; the `.gitattributes` execute-on-checkout
  vector is closed; limits are explicit and honest about residuals.

### Negative

- No OS-level syscall/network confinement in 1.0 (RR-4 residual). Mitigated by deny-by-
  default network/command policy and fixture-only, governed pilots.

## Risks

- **A real provider escaping via a syscall the policy does not model** — residual RR-4;
  bounded by running pilots only on disposable fixture repos and never on TriForge `main`.

## Conditions to Revisit

- A10.5 real pilots may surface a live escape vector → tighten the policy or escalate to a
  namespace/container.
- Post-1.0: evaluate rootless containers / user namespaces for stronger confinement.

## References

- `apps/api/src/execution/isolation/isolationBoundary.ts`; `isolation.invariants.test.ts`
- ADR 0030 (WSL2 not a sandbox); ADR 0054 (A10 boundary); A5.2/A5.3 (path/command policy)
- `PROVIDER_REPOSITORY_THREAT_MODEL_SPEC.md` (T-FS-05, T-EXE-09, RR-4); mandate §6
