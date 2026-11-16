# Development Guide

## Local setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-test.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

## Validation

Backend tests run against the Compose Postgres. The dedicated test image includes tools that are excluded from production. It bakes the code in, so rebuild first:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test build backend-test
docker compose -f docker-compose.yml -f docker-compose.test.yml --profile test run --rm backend-test
```

Frontend (Node 24 is required; `npx -p node@24 -c '...'` works if your system Node is older):

```bash
cd frontend
npm run lint        # ESLint
npm run test        # Vitest component/unit tests
npm run test:cov    # with coverage
npm run build       # production build (also type-checks)
```

End-to-end tests drive a real browser against the running stack. Install `poppler-utils` (PDF inspection) and `unzip` on the host first:

```bash
docker compose up -d --build
cd frontend
npx playwright install chromium   # once
npm run test:e2e
```

## Working conventions

- Containers contain a copy of the code: after editing, `docker compose up -d --build backend worker frontend` (the worker runs the same image as the backend). For hot reload while working on the UI, add `-f docker-compose.dev.yml`.
- Changing a model needs a migration (`docs/deployment.md#database-migrations`); `tests/test_migrations.py` fails if they drift.
- Tests run Celery inline (`CELERY_EAGER`) against a throwaway database and data directory, so they need Postgres but not Redis or the worker.
- Add new resources as a router under `backend/app/api/` and include it in `main.py`.
- Handlers must use `db: Session = Depends(get_db)`; never call `next(get_db())` (it leaks connections).
- Deletes are soft (`deleted_at`); every query must filter `deleted_at.is_(None)`.
- Backend logs are JSON; use `logging.getLogger(__name__)` and pass context via `extra={...}`.

## Contract and conversion checks

Regenerate API schema types after changing Pydantic schemas:

```bash
docker compose run --rm --no-deps -v "$PWD:/workspace" backend python /workspace/backend/scripts/generate_api_types.py
# Add --check to fail if the committed types drift from OpenAPI.
```

The shared conversion corpus is in `test-fixtures/exports/`. Backend tests check semantic text in HTML, DOCX and PDF; frontend tests check the same source in Preview. The manifest records expected behavior and known format losses. Add a representative case when fixing fidelity bugs.

Browser suites must run against a dedicated Compose project with disposable data. The UAT teardown deletes records created during its run and restores settings; do not run it against a shared installation.

## Dependency boundaries and audits

`backend/requirements.txt` contains runtime dependencies. `requirements-test.txt` adds HTTP test clients, pytest, coverage and PDF inspection. `pytest-asyncio`, authentication libraries and multipart parsing are not installed because the code does not use them. Docker's default `production` target copies application code and migrations only; its `test` target adds test dependencies, tests, benchmarks and scripts. The test Compose override mounts the shared fixtures.

Use Python 3.12 for backend development, matching the container. Frontend validation uses Node.js 24. Clean frontend installs use `npm ci` with normal peer dependency checks.

```bash
cd frontend
npm audit
npm audit --omit=dev
```

For Python, audit a `pip freeze --all` taken from each built image, using a separate pip-audit environment. Auditing the actual resolved packages covers transitive dependencies; installing the auditor into the application environment can change the packages being audited. See [dependency-maintenance.md](dependency-maintenance.md) for the audited versions and the scoped npm override.
