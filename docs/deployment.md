# Deployment

## Requirements

- Docker with the Compose plugin; Linux (developed on Ubuntu).
- Ports 3000 (web), 8000 (API), 5432 and 6379 free (the last two can be removed from `docker-compose.yml` if you do not need host access).
- Behind a TLS-inspecting proxy, the images expect the root certificate at `Zscalar_root_CA.cer` in the build context named `certs` (see `additional_contexts` in `docker-compose.yml`). Remove those lines if you do not need a custom CA.

## Run

```bash
docker compose up -d --build
```

- Web UI: http://localhost:3000
- API docs: http://localhost:8000/docs

**Code is baked into the images.** There are no source bind mounts, so after changing code run `docker compose up -d --build backend worker frontend`; restarting alone keeps the old code. For frontend work with hot reload use the development override:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

## Services

| Service | Image | Purpose |
| --- | --- | --- |
| `frontend` | `frontend/Dockerfile`, target `runner` | Production Next.js server (standalone output, ~240 MB, non-root, health-checked). Target `dev` is the hot-reload server. |
| `backend` | `backend/Dockerfile` (Python 3.12) | FastAPI app; applies database migrations and seeds templates/snippets at startup. |
| `worker` | same as backend | Celery worker that builds exports (`app.tasks.run_export`). |
| `postgres` | `postgres:16-alpine` | Data, volume `postgres_data`. |
| `redis` | `redis:7-alpine` | Celery broker, volume `redis_data`. |

Generated files live in named volumes mounted at `/app/data/{uploads,exports,previews,diagrams,templates,generated}`. The backend and worker **must share** the `exports_data` volume: the API stores uploaded diagram images there for the worker and serves the finished file from it.

## Database migrations

Schema changes are Alembic migrations in `backend/alembic/versions`. The backend runs `alembic upgrade head` on startup, guarded by a Postgres advisory lock so several replicas can start together. A database created before migrations existed (tables present, no `alembic_version`) is adopted automatically: it is stamped at the baseline revision `0001` and then upgraded.

After changing a model, generate a migration and review it:

```bash
docker compose run --rm --no-deps -v "$PWD/backend/alembic:/app/alembic" backend alembic revision --autogenerate -m "describe the change"
```

A test fails if the models and the migrations disagree. Downgrade with `alembic downgrade -1` inside the backend container.

## Exports run in the background

`POST /api/exports` queues a job and returns `202`; the web UI polls `GET /api/exports/{job_id}` until it is `completed`, `failed`, `cancelled` or `timed_out`. If Redis rejects publication, `POST` returns `503` and the job is marked failed. If no worker is available, publication can still succeed and the job remains queued until recovery or expiry. A job that sits in `queued` means the worker is not running: check `docker compose logs worker`. See [api.md](api.md#exports).

## Configuration

Environment variables (backend, see `backend/app/config.py`; `.env.example` lists the common ones):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@localhost:5432/docworkbench` | SQLAlchemy URL. |
| `REDIS_URL` | `redis://localhost:6379/0` | Broker. |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed browser origin (a single value). |
| `API_BASE_URL` | `http://localhost:8000` | Public API URL used to build download links. |
| `DATA_DIR` | `/app/data` | Where uploads and exports are stored. |
| `CELERY_EAGER` | `false` | Run tasks inline instead of on the worker (used by tests). |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`. |
| `LOG_JSON` | `true` | `false` prints human-readable lines instead of JSON. |
| `SECRET_KEY` | placeholder | Replace before any real deployment. |
| `SENTRY_DSN` | empty | Enables Sentry for the API and worker (unhandled errors and failed exports). Request bodies and PII are not sent. |
| `EXPORT_ENGINE` | `python` | `pandoc` builds DOCX with Pandoc and PDF with LibreOffice when installed in the worker; any failure falls back to the built-in writers. |
| `SERVER_MERMAID` | `true` | Render Mermaid blocks that arrive without a browser-made image, when `mmdc` is installed. At most `SERVER_MERMAID_LIMIT` (20) per export. |
| `CLI_TIMEOUT_SECONDS` | `120` | Per Pandoc / LibreOffice / `mmdc` call. |

Frontend: `API_URL` is read when the container starts (`API_URL=https://api.example.com docker compose up -d frontend`) and must be the URL the **browser** uses to reach the API. No rebuild is needed. `NEXT_PUBLIC_API_URL` (build argument) remains as a fallback default when `API_URL` is empty.

## Logging

The backend writes one JSON object per line to stdout:

```json
{"ts": "2026-10-23T06:00:00.123+00:00", "level": "INFO", "logger": "app.request", "message": "request", "request_id": "9f2c...", "method": "POST", "path": "/api/exports", "status": 202, "duration_ms": 412.3, "client": "172.18.0.1"}
```

- Each request gets a request ID (returned as `X-Request-ID`, honouring a client-supplied one) that is attached to every log line emitted while handling it.
- 2xx/3xx log at INFO, 4xx at WARNING, 5xx at ERROR; `/api/health` and `/api/ready` log at DEBUG to keep probes quiet.
- Unhandled exceptions are logged with the stack trace; the client receives only `{"detail": "Internal server error", "request_id": "..."}`.

```bash
docker compose logs -f backend | jq -c 'select(.level != "INFO")'
```

## Optional export tools

The default image has no extra tools. To add Pandoc, LibreOffice and Mermaid CLI (about 1 GB, includes Chromium) to the worker:

```bash
INSTALL_DOC_TOOLS=true EXPORT_ENGINE=pandoc docker compose up -d --build worker
```

DOCX then comes from Pandoc and PDF from LibreOffice (converting that DOCX). Diagram images come from the browser upload, or from `mmdc` when none was uploaded (API-only clients). Pandoc runs without a shell; links to local files are stripped from the document tree before writing, so a `![](/etc/passwd)` cannot be embedded. Mermaid renders with `securityLevel: strict`.

## Metrics and error tracking

`GET /metrics` (Prometheus text format, not in the OpenAPI schema) exposes `http_requests_total` and `http_request_duration_seconds` labelled by method, route template and status, and `export_jobs{status}` counted from the database so worker activity is included. It has no authentication: keep it off the public proxy.

Set `SENTRY_DSN` to report unhandled API exceptions and failed export jobs.

## Health checks

`GET /api/health` (liveness) and `GET /api/ready` (readiness). Postgres has a Compose health check and the backend waits for it.

## Portable builds and network access

No personal directory or corporate certificate is required. Optional PEM roots can be placed in `certificates/` before building; see its README. `INSTALL_DOC_TOOLS` defaults to `false` so the standard worker uses the built-in writers.

Published ports bind to `127.0.0.1`. Set `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`, and `REDIS_PORT` to avoid collisions. Use a reverse proxy for remote access, and configure browser `API_URL`, build fallback `NEXT_PUBLIC_API_URL`, backend `API_BASE_URL`, and `CORS_ORIGINS` consistently. Database and Redis credentials in this Compose file remain development defaults.

## Export lifecycle

Compose starts an export worker (two processes consuming `celery`), a maintenance worker (one process consuming `maintenance`) and one Beat scheduler. Run only one scheduler per installation. Maintenance runs every 15 seconds; old generated files expire after `EXPORT_RETENTION_HOURS` (default 168). Job metadata remains available and download URLs are cleared after expiry.

`EXPORT_SOFT_TIMEOUT_SECONDS` defaults to 90 and `EXPORT_HARD_TIMEOUT_SECONDS` to 120. Cancelling is available through `POST /api/exports/{id}/cancel` and the browser's Cancel export button. Failed and cancelled exports are not automatically retried; orphaned queued work is re-dispatched before its expiry.

Liveness (`/api/health`) returns 503 for database failure and reports `degraded` when the broker is down or jobs are stale. Readiness (`/api/ready`) returns 503 unless the database, broker, export worker and maintenance worker are available. Workers wait for backend startup and migrations before consuming tasks.

## Backups

Use a new backup directory:

```bash
scripts/backup.sh backups/2026-11-16
```

The script creates a PostgreSQL custom-format dump and an archive of generated exports. Stop writers first when taking a consistent point-in-time backup under load. Browser-only drafts are local to each browser and are not included.

Restore into a fresh Compose project with an empty database:

```bash
COMPOSE_PROJECT_NAME=tidyscribe-restored docker compose up -d postgres redis
COMPOSE_PROJECT_NAME=tidyscribe-restored docker compose build backend
COMPOSE_PROJECT_NAME=tidyscribe-restored scripts/restore.sh backups/2026-11-16
COMPOSE_PROJECT_NAME=tidyscribe-restored docker compose up -d --build
```

Stop the original project first, or configure different published ports. The restore script refuses to overwrite a database that already has public tables. It does not remove an existing installation.

## Not yet production-ready

Authentication, rate limiting and security headers are not implemented (deferred), and the API trusts every caller. Put it behind an authenticating reverse proxy and do not expose it publicly as is. See [roadmap.md](roadmap.md).
