from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.common import not_found
from app.config import settings
from app.database import get_db
from app.models import Document, ExportJob
from app.schemas import ExportJobOut, ExportRequest
from app.services import export_jobs
from app.services.export_service import FORMATS, load_diagrams
from app.storage import storage
from app.tasks import input_path, output_path, run_export, source_path

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/exports", tags=["exports"])


def _out(job: ExportJob) -> ExportJobOut:
    return ExportJobOut(
        job_id=job.id, status=job.status, type=job.export_type, file_url=job.file_url, error=job.error,
        failure_reason=job.failure_reason, queued_at=job.queued_at, started_at=job.started_at,
        finished_at=job.finished_at, heartbeat_at=job.heartbeat_at,
    )


def _download_name(title: str, extension: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-").lower()[:80] or "document"
    return f"{slug}.{extension}"


@router.post("", response_model=ExportJobOut, status_code=202)
def create_export(payload: ExportRequest, db: Session = Depends(get_db)) -> ExportJobOut:
    """Queue an export. Poll GET /api/exports/{job_id} until status is `completed`, `failed`, `timed_out` or `cancelled`."""
    document = None
    if payload.document_id is not None:
        document = db.query(Document).filter(Document.id == payload.document_id, Document.deleted_at.is_(None)).first()
        if document is None:
            raise HTTPException(status_code=400, detail=f"Document '{payload.document_id}' not found")

    uploads = [(d.source, d.png_base64) for d in payload.diagrams]
    try:
        load_diagrams(uploads)  # reject bad uploads now rather than in the worker
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    job = ExportJob(document_id=document.id if document else None, export_type=payload.format, status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)

    if payload.content is not None:
        source = {"title": payload.title or "Document", "content": payload.content, "html": payload.html}
        storage.save_file(source_path(job.id), json.dumps(source).encode())
    if uploads:
        storage.save_file(input_path(job.id), json.dumps([{"source": s, "png_base64": p} for s, p in uploads]).encode())
    try:
        run_export.delay(job.id)
    except Exception as exc:
        logger.exception("could not queue export", extra={"job_id": job.id})
        storage.delete_file(input_path(job.id))
        storage.delete_file(source_path(job.id))
        export_jobs.fail_unqueued(db, job.id, "queue_unavailable")
        raise HTTPException(status_code=503, detail="The export queue is unavailable") from exc

    db.refresh(job)
    return _out(job)


@router.get("/{job_id}", response_model=ExportJobOut)
def read_export(job_id: str, db: Session = Depends(get_db)) -> ExportJobOut:
    job = db.get(ExportJob, job_id)
    if job is None:
        raise not_found("Export job")
    if job.status in export_jobs.ACTIVE:
        export_jobs.reap_if_stale(db, job_id)  # a polled job never stays "processing" after its worker died
        db.refresh(job)
    return _out(job)


@router.post("/{job_id}/cancel", response_model=ExportJobOut)
def cancel_export(job_id: str, db: Session = Depends(get_db)) -> ExportJobOut:
    """Stop a queued or running export. A finished job is returned unchanged."""
    if db.get(ExportJob, job_id) is None:
        raise not_found("Export job")
    export_jobs.cancel(db, job_id)
    job = db.get(ExportJob, job_id)
    db.refresh(job)
    return _out(job)


@router.get("/{job_id}/download")
def download_export(job_id: str, db: Session = Depends(get_db)):
    job = db.get(ExportJob, job_id)
    if job is None or job.export_type not in FORMATS:
        raise not_found("Export job")
    if job.status != "completed":
        raise HTTPException(status_code=409, detail=f"Export is {job.status}")

    extension, media_type = FORMATS[job.export_type]
    if not storage.file_exists(output_path(job.id, extension)):
        raise not_found("Export file")

    document = db.get(Document, job.document_id) if job.document_id else None
    return FileResponse(
        path=str(storage.base_dir / output_path(job.id, extension)),
        media_type=media_type,
        filename=_download_name(document.title if document else "document", extension),
    )
