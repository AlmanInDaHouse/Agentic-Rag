# Dependency Security Policy

## Official Package Manager

TriForge Agentic Lab uses pnpm as the only supported package manager.

Recommended setup:

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
pnpm install
```

## Adding a Dependency

1. Confirm the feature has a spec or ADR if the dependency affects architecture.
2. Prefer standard library APIs, existing dependencies or small local code.
3. Add runtime packages only to the package that executes them.
4. Add build/test-only packages to `devDependencies`.
5. Run:

```bash
pnpm install
pnpm lint:deps
pnpm audit
pnpm typecheck
pnpm test
```

## Acceptance Criteria

- Clear purpose in the consuming package.
- Active maintenance and recent compatible releases.
- No confusing package name or typosquatting signal.
- Reasonable dependency tree size for the MVP.
- Compatible license for project use.
- No lifecycle scripts unless explicitly justified.

## Rejection Criteria

- Unnecessary wrapper around a trivial API.
- Abandoned or unmaintained package for a critical path.
- Suspicious package name, maintainer history or release pattern.
- Unexpected `install`, `postinstall`, `preinstall`, `prepare` or network-fetching scripts.
- Large framework/tooling package where a small local implementation is enough.
- Known unresolved high or critical advisory in the required version range.

## Lifecycle Script Review

Direct dependencies with install-time scripts are blocked by policy unless an ADR documents:

- why the package is required,
- what the script does,
- whether the script touches network or filesystem outside package install,
- what safer alternatives were rejected.

Current approved transitive build script:

- `esbuild`: required by Vite/Vitest for native binary setup during install.

## Maintenance Review

Check release cadence, issue activity, maintainer continuity and compatibility with current Node/TypeScript versions.

## License Review

For MVP work, prefer permissive licenses such as MIT, Apache-2.0, BSD-2-Clause or BSD-3-Clause. Escalate copyleft, source-available or custom licenses before merging.

## Malicious Package Response

1. Stop installing/updating dependencies.
2. Identify package and affected versions from `pnpm-lock.yaml`.
3. Remove or pin away from the package.
4. Rotate any exposed secrets if install scripts could have accessed them.
5. Document impact and remediation in `docs/security/dependency-review.md`.
6. Regenerate the lockfile from a clean install.

## Safe Lockfile Regeneration

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
pnpm install --lockfile-only
pnpm install --frozen-lockfile
pnpm lint:deps
pnpm audit
```

Review `pnpm-lock.yaml` before merging.
