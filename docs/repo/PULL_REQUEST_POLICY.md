# Pull Request Policy

## Required Flow

- All changes enter through pull requests.
- Do not commit directly to `main`.
- Do not merge if the `Validate` check fails.
- Prefer squash merge for a clean mainline history.
- Use Conventional Commits for commit messages.

## Required Updates

- Update `docs/context/PROJECT_CONTEXT.md` when project state, commands, risks or architecture change.
- Update the relevant spec in `docs/specs/` when behavior changes.
- Add or update an ADR when architecture changes.
- Update dependency review documentation when adding or removing dependencies.
- Add or update harness coverage when touching agentic flows.

## Validation

Before asking for review, run the relevant local checks:

```bash
pnpm lint:deps
pnpm typecheck
pnpm test
pnpm test:harness
pnpm harness:mvp
pnpm build
pnpm audit
```

The pull request must also pass the GitHub Actions `Validate` check.

## Security And Data Safety

- Do not commit secrets.
- Do not commit real `.env` files.
- Keep DB migrations versioned.
- Consider rollback or cleanup for migrations, scripts and harness changes.
- Product runtime must not depend on `tooling/harness`.
