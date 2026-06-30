# Runbook — Real Provider Setup inside WSL2 (owner action)

This is the **one manual sequence** that unblocks the final operational 1.0. It
provisions the WSL2 substrate and **authenticates** the real Codex / Claude CLIs. The
autonomous loop is forbidden to perform authentication (mandate §18–§19): no automated
login, no token/credential extraction, no copying auth state from Windows. **You run the
auth steps; TriForge never reads your credentials.**

After you complete this runbook, the loop resumes the auth-dependent verification
(A10.5–A10.8), flips the affected entries in
`docs/evidence/TRIFORGE_CAPABILITY_EVIDENCE.json` to `verified_real_provider`, and — when
the final gate reports ready — tags `v1.0.0`.

## 0. Reconstructed starting state (2026-06-30)

- WSL2 Ubuntu (v2) present, **Stopped**; `git 2.43.0` present; **node / pnpm / psql /
  codex / claude absent** in WSL2.
- Repo currently on `/mnt/c` (Windows fs). Providers present on the *Windows host*
  (`codex-cli 0.101.0`, `claude 2.1.195`), auth **unknown**.

## 1. Provision the Linux toolchain (safe; no credentials)

```bash
wsl -d Ubuntu
# inside Ubuntu:
sudo apt-get update
sudo apt-get install -y curl ca-certificates postgresql
# Node 22 LTS via nvm (user-scoped; no sudo for the runtime):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh"
nvm install 22 && nvm use 22
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

## 2. Put the repo on the Linux filesystem (not /mnt/c)

```bash
mkdir -p "$HOME/src" && cd "$HOME/src"
git clone https://github.com/AlmanInDaHouse/Agentic-Rag.git
cd Agentic-Rag
pnpm install --frozen-lockfile
```

## 3. Install the provider CLIs in WSL2 (safe; no auth yet)

Install per each vendor's official Linux instructions inside Ubuntu, then confirm:

```bash
codex --version    # expect codex-cli 0.101.0 (or record the actual version)
claude --version   # expect 2.1.195 (Claude Code) (or record the actual version)
```

> A version different from the recorded snapshot **invalidates** the prior capability
> snapshot (ADR 0054 §4). Record the real version; the adapter re-probes.

## 4. Authenticate — MANUAL, owner-only (the hard stop)

Run the official login for each CLI yourself and complete any browser/MFA step:

```bash
codex login      # or the official Codex auth command for your install
claude           # complete the official Claude Code sign-in flow
```

Do **not** paste tokens into TriForge, the repo, or this chat. TriForge probes auth
**non-invasively** (`codex login status` / `claude auth status`-style, read-only) and
never reads the credential store.

## 5. Hand back to the loop

With both CLIs authenticated in WSL2 and the repo on the Linux fs, tell the loop to
resume A10 verification. It will: snapshot the *writable* capability for each current
version; run the writable conformance harness against the real adapters; run the two
pilots (Codex-owner/Claude-reviewer and the reverse) and the collaboration modes on
**fixture** repos; observe real quota/usage; run the integrated UI+backend real E2E;
update the evidence registry; and evaluate the final gate.

## Guardrails (enforced regardless)

- The provider runs only inside an isolated worktree of a **fixture** repo; the TriForge
  repo's `main` is never touched by a provider.
- No `/mnt/c`, `$HOME`, credential-path, `.git`, or out-of-worktree access; no extra
  network; process-group supervision + resource limits (see A10.2 isolation boundary).
- Competitive mode may be recorded `blocked_by_quota` and formally excluded from 1.0 if
  real quota does not permit it — never falsified.
