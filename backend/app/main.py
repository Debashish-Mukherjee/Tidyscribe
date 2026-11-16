from __future__ import annotations

import logging
import time

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.api import clipboard, diagrams, documents, exports, snippets, templates
from app.api import settings as settings_api
from app.config import settings
from app.database import SessionLocal, get_db
from app.error_tracking import init_error_tracking
from app.logging_config import configure_logging, install_request_logging
from app.metrics import install_metrics
from app.migrations import run_migrations
from app.models import ExportJob
from app.schemas import HealthResponse, TransformRequest, TransformResponse
from app.seed import seed_defaults
from app.services import export_jobs, queue_stats
from app.services.export_jobs import current_rss_mb
from app.services.parser_service import convert_ascii_diagram_to_mermaid, detect_content_type, normalize_pasted_content
from app.services.transform_service import transform_document
from app.storage import storage  # noqa: F401  (re-exported for tests)

configure_logging(settings.log_level, settings.log_json)
init_error_tracking(settings.sentry_dsn, settings.env, "api")
logger = logging.getLogger("app")
STARTED = time.monotonic()


app = FastAPI(
    title="Tidyscribe API",
    version="0.1.0",
    description="REST API for the Tidyscribe product.",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "Content-Disposition"],
)
install_request_logging(app)
install_metrics(app)

for module in (documents, templates, snippets, clipboard, settings_api, diagrams, exports):
    app.include_router(module.router)


@app.on_event("startup")
def startup() -> None:
    run_migrations()
    with SessionLocal() as db:
        seed_defaults(db)
    try:
        from app.tasks import run_export

        with SessionLocal() as db:
            export_jobs.recover_jobs(db, dispatch=run_export.delay)
    except Exception:
        logger.warning("export recovery at startup failed", exc_info=True)
    logger.info("startup complete", extra={"service": settings.app_name, "env": settings.env})


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse | JSONResponse:
    """Liveness plus a cheap look at the export queue; 503 only when the database is unreachable."""
    base = {"service": settings.app_name, "uptime_seconds": round(time.monotonic() - STARTED, 1), "memory_mb": current_rss_mb()}
    try:
        with SessionLocal() as db:
            queue = queue_stats.queue_snapshot(db)
    except Exception:
        logger.warning("health check cannot reach the database", exc_info=True)
        return JSONResponse(status_code=503, content={**base, "status": "unavailable", "database": "down"})
    # Queued work with no worker alive, or jobs past their heartbeat, are visible here before users notice.
    degraded = not queue["redis"] or queue["stale"] > 0 or (queue["states"]["queued"] > 0 and queue["workers"] == 0)
    return HealthResponse(status="degraded" if degraded else "ok", database="ok", queue=queue, **base)


@app.get("/api/ready", response_model=None)
def ready() -> dict | JSONResponse:
    """Ready to accept document and export requests, including their dependencies."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "down"})
    queue = queue_stats.redis_stats()
    if not queue["redis"] or not queue["workers"] or not queue["maintenance_workers"]:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "ok", "queue": queue})
    return {"status": "ready", "service": settings.app_name}


@app.post("/api/transform", response_model=TransformResponse)
def transform_text(payload: TransformRequest) -> TransformResponse:
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
    result = transform_document(payload.text, payload.tone)
    return TransformResponse(**result)


@app.post("/api/parse-paste")
def parse_paste(payload: dict) -> dict[str, object]:
    text = str(payload.get("text", "") or "")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    normalized = normalize_pasted_content(text)
    detected_types = detect_content_type(normalized)
    converted_mermaid = convert_ascii_diagram_to_mermaid(normalized)
    return {
        "normalized_markdown": normalized,
        "detected_types": detected_types,
        "converted_mermaid": converted_mermaid,
        "summary": f"Detected {', '.join(detected_types)} content types.",
    }


@app.get("/api/jobs")
def list_jobs(db: Session = Depends(get_db)) -> list[dict[str, str]]:
    jobs = db.query(ExportJob).order_by(ExportJob.created_at.desc()).limit(200).all()
    return [{"id": j.id, "status": j.status, "type": j.export_type, "file_url": j.file_url or ""} for j in jobs]


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "status": "running"}
