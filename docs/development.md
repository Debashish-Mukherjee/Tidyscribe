# Development Guide

## Local setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Validation

Backend tests run against the Compose Postgres. The image bakes the code in, so rebuild first:

```bash
docker compose build backend
docker compose run --rm --no-deps backend python -m pytest -q --cov=app --cov-report=term-missing
```

Frontend (Node 24 is required; `npx -p node@24 -c '...'` works if your system Node is older):

```bash
cd frontend
npm run lint        # ESLint
npm run test        # Vitest component/unit tests
npm run test:cov    # with coverage
npm run build       # production build (also type-checks)
```

End-to-end tests drive a real browser against the running stack:

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
