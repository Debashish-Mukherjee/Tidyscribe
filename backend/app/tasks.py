from __future__ import annotations

import json
import logging
import os
import socket
import threading

from celery import Celery
from celery.signals import worker_ready

from app.config import settings
from app.database import SessionLocal
from app.error_tracking import capture_exception, init_error_tracking
from app.logging_config import configure_logging
from app.models import Document, ExportJob
from app.services import export_jobs
from app.services.export_pipeline import build_export
from app.services.export_service import load_diagrams
from app.storage import storage

configure_logging(settings.log_level, settings.log_json)
init_error_tracking(settings.sentry_dsn, settings.env, "worker")
logger = logging.getLogger(__name__)

celery = Celery(
    "doc_workbench",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks"],
)
celery.conf.update(
    task_always_eager=settings.celery_eager,
    task_eager_propagates=False,
    worker_hijack_root_logger=False,
    task_acks_late=True,
    result_expires=3600,
    # One task per process at a time: a long export must not hold prefetched jobs hostage behind it.
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=100,
    worker_max_memory_per_child=700_000,
    # Longer than the hard limit, so a killed worker's message is not redelivered while a healthy job still runs.
    broker_transport_options={"visibility_timeout": settings.export_hard_timeout_seconds * 3},
    task_routes={"app.tasks.maintain_exports": {"queue": "maintenance"}},
    beat_schedule={"maintain-exports": {"task": "app.tasks.maintain_exports", "schedule": 15.0}},
)


def input_path(job_id: str) -> str:
    return f"exports/{job_id}.input.json"


def output_path(job_id: str, extension: str) -> str:
    return f"exports/{job_id}.{extension}"


def source_path(job_id: str) -> str:
    return f"exports/{job_id}.source.json"


def _load_inputs(job_id: str, document_id: str | None) -> tuple[str, str, str | None, list[tuple[str, str]]]:
    if document_id is not None:
        with SessionLocal() as db:
            document = db.query(Document).filter(Document.id == document_id, Document.deleted_at.is_(None)).first()
            if document is None:
                raise LookupError("document no longer exists")
            title, body, html_source = document.title, document.content or "", None
    else:
        # Exports of unsaved text carry their source in a temporary file instead of a document row.
        if not storage.file_exists(source_path(job_id)):
            raise LookupError("export source is missing")
        source = json.loads(storage.get_file(source_path(job_id)))
        title, body, html_source = source["title"], source["content"], source.get("html")

    uploads: list[tuple[str, str]] = []
    if storage.file_exists(input_path(job_id)):
        raw = json.loads(storage.get_file(input_path(job_id)))
        uploads = [(item["source"], item["png_base64"]) for item in raw]
    return title, body, html_source, uploads


@celery.task(name="app.tasks.run_export", ignore_result=True, time_limit=settings.export_hard_timeout_seconds)
def run_export(job_id: str) -> None:
    """Build the file for an export job. The job row always ends in a terminal state, whatever happens here."""
    if not export_jobs.claim(job_id):
        return
    with SessionLocal() as db:
        job = db.get(ExportJob, job_id)
        export_format, document_id = job.export_type, job.document_id

    extension = ""
    try:
        with export_jobs.Heartbeat(job_id):
            title, body, html_source, uploads = _load_inputs(job_id, document_id)
            export_jobs.mark_processing(job_id)
            extension, _, content = build_export(title, body, export_format, load_diagrams(uploads), html_source)
            storage.save_file(output_path(job_id, extension), content)
        recorded = export_jobs.finish(job_id, export_jobs.COMPLETED, file_url=f"{settings.api_base_url}/api/exports/{job_id}/download")
        if not recorded:  # cancelled or reaped while the file was being written
            storage.delete_file(output_path(job_id, extension))
    except export_jobs.JobInterrupted as stop:
        status = export_jobs.TIMED_OUT if stop.reason == "soft_timeout" else export_jobs.CANCELLED
        export_jobs.finish(job_id, status, reason=stop.reason, error=export_jobs.message_for(stop.reason))
    except LookupError:
        export_jobs.finish(job_id, export_jobs.FAILED, reason="document_missing", error=export_jobs.message_for("document_missing"))
    except Exception:
        logger.exception("export failed", extra={"job_id": job_id, "format": export_format})
        capture_exception()
        export_jobs.finish(job_id, export_jobs.FAILED, reason="export_error", error=export_jobs.message_for("export_error"))
    finally:
        storage.delete_file(input_path(job_id))
        storage.delete_file(source_path(job_id))
    logger.info("export finished", extra={"job_id": job_id, "format": export_format})


@celery.task(name="app.tasks.maintain_exports", ignore_result=True)
def maintain_exports() -> dict[str, int]:
    """Periodic recovery: fail jobs whose worker died, re-dispatch orphaned ones, remove old files."""
    with SessionLocal() as db:
        summary = export_jobs.recover_jobs(db, dispatch=run_export.delay)
        summary["files_removed"] = export_jobs.cleanup_files(db)
    return summary


def _announce_presence() -> None:
    """Publish a short-lived Redis key so /api/health can tell whether any worker is alive."""
    import redis

    role = os.environ.get("WORKER_ROLE", "export")
    key = f"workbench:worker:{role}:{socket.gethostname()}:{os.getpid()}"
    client = redis.Redis.from_url(settings.redis_url, socket_timeout=2)
    while True:
        try:
            client.set(key, "up", ex=45)
        except Exception:
            logger.debug("worker presence not published", exc_info=True)
        threading.Event().wait(15)


@worker_ready.connect
def _on_worker_ready(**_: object) -> None:
    threading.Thread(target=_announce_presence, name="worker-presence", daemon=True).start()
    try:
        maintain_exports()
    except Exception:
        logger.warning("startup recovery failed", exc_info=True)
