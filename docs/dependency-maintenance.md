# Dependency maintenance

The dependency cleanup on 16 November 2026 separates the application runtime from validation tools and addresses the advisories found in the earlier audit. Full npm and frozen-image Python package audits report zero known vulnerabilities; see [validation.md](validation.md) for checks and the pre-existing fidelity/styling failures found by expanded regression coverage.

## Backend

`requirements.txt` contains runtime dependencies. `requirements-test.txt` includes it and adds HTTPX, pytest, coverage tooling and pypdf. `constraints.txt` records the resolved versions from the audited Python 3.12 images; a constraint limits a version but does not install that package. Update direct requirements and their constraints together, then re-resolve and audit before committing a new constraint set.

FastAPI is updated to 0.163.1 with Starlette 1.10.0, and python-dotenv to 1.2.2. The image installer is updated to pip 26.3. Pytest 9.0.3 and pypdf 6.21.4 are installed only in the test target. Unused PyJWT, passlib, python-multipart and pytest-asyncio are removed. HTTPX is test-only. No application route consumes multipart forms or files, so removing the multipart parser does not remove an existing upload API.

The Dockerfile has `runtime`, `test`, and `production` targets. Its default final target is production. Production images copy only application and migration sources, and exclude tests, benchmarks and developer scripts. Optional document-conversion CLI tools remain controlled by `INSTALL_DOC_TOOLS`.

## Frontend

Vitest and its V8 coverage provider are updated together to 4.1.12. Vite 8.3.8, React's Vite plugin 6.3.0 and eslint-config-next 16.4.6 are pinned. The Vitest config uses `.mts` to identify its ES module format. Clean installs use `npm ci` with peer dependency checks enabled.

A scoped npm override selects minimatch 11.0.1 only for `@typescript-eslint/typescript-estree`. The upstream package's normal minimatch 10.x range remains affected by [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Its use of the supported `minimatch()` function was inspected, and lint, TypeScript, unit tests and builds validate the integration. This override does not replace unrelated minimatch versions used by other tools. Remove it when the upstream dependency range selects a patched version without an override.

## Repeat the audit

Build both backend image targets first:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test build backend backend-test
```

Then pass their image names to the audit script (replace `PROJECT` with the Compose project name):

```bash
scripts/audit-dependencies.sh PROJECT-backend PROJECT-backend-test
```

The script audits the complete npm tree and its production subset, checks installed Python dependency consistency, checks runtime/test separation, and audits full package snapshots from both Python images. The auditor runs in a separate environment so installing it cannot change the dependencies being checked. This audits package advisories, not OS packages or optional global conversion tools; it does not establish that the application has no security defects.

Run the backend and frontend validation commands in [development.md](development.md), then browser regression suites against a dedicated Compose project. Authentication and CI remain deferred.
