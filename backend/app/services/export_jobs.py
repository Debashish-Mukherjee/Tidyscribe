"""Export job lifecycle: atomic state transitions, worker heartbeats and recovery of jobs whose worker disappeared.

States: queued -> starting -> processing -> completed | failed | cancelled | timed_out.
Every transition is a conditional UPDATE, so a worker, the reaper and a cancel request can race safely: the first one wins
and the others see zero affected rows. Timestamps come from the database clock so skew between hosts cannot matter.
"""
from __future__ import annotations

import ctypes
import logging
import os
import re
import socket
import threading
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import ExportJob
from app.storage import storage

logger = logging.getLogger("app.export.jobs")

QUEUED, STARTING, PROCESSING = "queued", "starting", "processing"
COMPLETED, FAILED, CANCELLED, TIMED_OUT = "completed", "failed", "cancelled", "timed_out"
ACTIVE = (STARTING, PROCESSING)
TERMINAL = (COMPLETED, FAILED, CANCELLED, TIMED_OUT)
ALL_STATES = (QUEUED, *ACTIVE, *TERMINAL)

MESSAGES = {
    "soft_timeout": "The export took longer than {seconds} seconds and was stopped. Try a smaller document or another format.",
    "hard_timeout": "The export took longer than {seconds} seconds and was stopped. Try a smaller document or another format.",
    "stale_heartbeat": "The export worker stopped responding. Please try again.",
    "abandoned": "No export worker picked this job up. Please try again.",
    "cancelled": "The export was cancelled.",
    "document_missing": "The document no longer exists",
    "export_error": "The document could not be exported",
    "queue_unavailable": "The export queue is unavailable",
}


def message_for(reason: str) -> str:
    seconds = settings.export_hard_timeout_seconds if reason == "hard_timeout" else settings.export_soft_timeout_seconds
    return MESSAGES[reason].format(seconds=seconds)


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def current_rss_mb() -> int | None:
    try:
        with open("/proc/self/statm") as handle:
            return int(handle.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") // (1024 * 1024)
    except (OSError, ValueError, IndexError):
        return None


def claim(job_id: str) -> bool:
    """Move queued -> starting. False means someone else already took, finished or cancelled the job."""
    with SessionLocal() as db:
        result = db.execute(
            update(ExportJob)
            .where(ExportJob.id == job_id, ExportJob.status == QUEUED)
            .values(status=STARTING, started_at=func.now(), heartbeat_at=func.now(), worker_id=worker_id())
        )
        db.commit()
        return result.rowcount == 1


def mark_processing(job_id: str) -> bool:
    with SessionLocal() as db:
        result = db.execute(
            update(ExportJob).where(ExportJob.id == job_id, ExportJob.status == STARTING).values(status=PROCESSING, heartbeat_at=func.now())
        )
        db.commit()
        return result.rowcount == 1


def finish(job_id: str, status: str, *, reason: str | None = None, error: str | None = None, file_url: str | None = None) -> bool:
    """Record the outcome of a running job. False means the job was already finished by someone else (reaper, cancel)."""
    values = {"status": status, "finished_at": func.now(), "failure_reason": reason, "error": error, "file_url": file_url, "rss_mb": current_rss_mb()}
    with SessionLocal() as db:
        result = db.execute(update(ExportJob).where(ExportJob.id == job_id, ExportJob.status.in_(ACTIVE)).values(**values))
        db.commit()
        return result.rowcount == 1


def fail_unqueued(db: Session, job_id: str, reason: str) -> None:
    """The job never reached a worker (queue unavailable)."""
    db.execute(
        update(ExportJob)
        .where(ExportJob.id == job_id, ExportJob.status == QUEUED)
        .values(status=FAILED, finished_at=func.now(), failure_reason=reason, error=message_for(reason))
    )
    db.commit()


def cancel(db: Session, job_id: str) -> str | None:
    """Cancel a job that has not finished. Returns the resulting status, or None if the job does not exist."""
    db.execute(
        update(ExportJob)
        .where(ExportJob.id == job_id, ExportJob.status.in_((QUEUED, *ACTIVE)))
        .values(status=CANCELLED, finished_at=func.now(), failure_reason="cancelled", error=message_for("cancelled"))
    )
    db.commit()
    return db.scalar(select(ExportJob.status).where(ExportJob.id == job_id))


class JobInterrupted(BaseException):
    """Raised inside the worker's main thread to stop a build; BaseException so broad `except Exception` blocks cannot swallow it."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Heartbeat:
    """Keeps `heartbeat_at` fresh while a job builds, and stops the build on soft timeout or cancellation."""

    def __init__(self, job_id: str, *, interval: float | None = None, soft_timeout: float | None = None) -> None:
        self.job_id = job_id
        self.interval = interval if interval is not None else settings.export_heartbeat_interval_seconds
        self.soft_timeout = soft_timeout if soft_timeout is not None else settings.export_soft_timeout_seconds
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._stopped = False
        self._target = threading.get_ident()
        self._thread = threading.Thread(target=self._run, name=f"heartbeat-{job_id[:8]}", daemon=True)
        self.beats = 0

    def __enter__(self) -> Heartbeat:
        self._target = threading.get_ident()
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        with self._lock:
            self._stopped = True
        self._stop.set()
        self._thread.join(timeout=5)

    def _interrupt(self, reason: str) -> None:
        with self._lock:
            if self._stopped:
                return
            self._stopped = True
            ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(self._target), ctypes.py_object(_EXCEPTIONS[reason]))

    def _run(self) -> None:
        elapsed = 0.0
        while not self._stop.wait(self.interval):
            elapsed += self.interval
            if elapsed >= self.soft_timeout:
                logger.warning("export exceeded the soft time limit", extra={"job_id": self.job_id, "seconds": elapsed})
                self._interrupt("soft_timeout")
                return
            try:
                with SessionLocal() as db:
                    alive = db.execute(
                        update(ExportJob).where(ExportJob.id == self.job_id, ExportJob.status.in_(ACTIVE)).values(heartbeat_at=func.now())
                    ).rowcount
                    db.commit()
            except Exception:
                logger.warning("heartbeat write failed", exc_info=True)
                continue
            self.beats += 1
            if not alive:  # cancelled or reaped while we were working
                self._interrupt("cancelled")
                return


# One exception class per reason keeps the reason available without any shared state in the main thread.
class _SoftTimeout(JobInterrupted):
    def __init__(self) -> None:
        super().__init__("soft_timeout")


class _Cancelled(JobInterrupted):
    def __init__(self) -> None:
        super().__init__("cancelled")


_EXCEPTIONS = {"soft_timeout": _SoftTimeout, "cancelled": _Cancelled}


def recover_jobs(db: Session, dispatch: Callable[[str], object] | None = None) -> dict[str, int]:
    """Fail jobs whose worker vanished, and re-dispatch or abandon jobs nobody picked up. Safe to run from several processes."""
    summary = {"timed_out": 0, "stale": 0, "requeued": 0, "abandoned": 0}

    overrun = timedelta(seconds=settings.export_hard_timeout_seconds + 30)
    summary["timed_out"] = db.execute(
        update(ExportJob)
        .where(ExportJob.status.in_(ACTIVE), ExportJob.started_at < func.now() - overrun)
        .values(status=TIMED_OUT, finished_at=func.now(), failure_reason="hard_timeout", error=message_for("hard_timeout"))
    ).rowcount

    last_sign_of_life = func.coalesce(ExportJob.heartbeat_at, ExportJob.started_at, ExportJob.queued_at)
    summary["stale"] = db.execute(
        update(ExportJob)
        .where(ExportJob.status.in_(ACTIVE), last_sign_of_life < func.now() - timedelta(seconds=settings.export_heartbeat_stale_seconds))
        .values(status=FAILED, finished_at=func.now(), failure_reason="stale_heartbeat", error=message_for("stale_heartbeat"))
    ).rowcount

    summary["abandoned"] = db.execute(
        update(ExportJob)
        .where(ExportJob.status == QUEUED, ExportJob.queued_at < func.now() - timedelta(seconds=settings.export_queued_expiry_seconds))
        .values(status=FAILED, finished_at=func.now(), failure_reason="abandoned", error=message_for("abandoned"))
    ).rowcount

    if dispatch is not None:
        quiet = func.coalesce(ExportJob.heartbeat_at, ExportJob.queued_at) < func.now() - timedelta(seconds=settings.export_requeue_after_seconds)
        orphans = db.scalars(select(ExportJob.id).where(ExportJob.status == QUEUED, quiet).limit(50)).all()
        for job_id in orphans:
            db.execute(update(ExportJob).where(ExportJob.id == job_id, ExportJob.status == QUEUED).values(heartbeat_at=func.now(), attempts=ExportJob.attempts + 1))
        db.commit()
        for job_id in orphans:
            try:
                dispatch(job_id)  # claim() is atomic, so a duplicate message is harmless
                summary["requeued"] += 1
            except Exception:
                logger.warning("could not re-dispatch export", extra={"job_id": job_id}, exc_info=True)
    db.commit()
    if any(summary.values()):
        logger.warning("export jobs recovered", extra=summary)
    return summary


def reap_if_stale(db: Session, job_id: str) -> None:
    """Cheap, targeted version of recover_jobs for one job, used when a client polls it."""
    last_sign_of_life = func.coalesce(ExportJob.heartbeat_at, ExportJob.started_at, ExportJob.queued_at)
    db.execute(
        update(ExportJob)
        .where(ExportJob.id == job_id, ExportJob.status.in_(ACTIVE), last_sign_of_life < func.now() - timedelta(seconds=settings.export_heartbeat_stale_seconds))
        .values(status=FAILED, finished_at=func.now(), failure_reason="stale_heartbeat", error=message_for("stale_heartbeat"))
    )
    db.commit()


def cleanup_files(db: Session) -> int:
    """Expire generated files while retaining job metadata and protecting active exports.

    Only UUID-named export artifacts belong to this lifecycle. Failed unlinks are retried
    on the next maintenance pass; a download URL is cleared only after its file is gone.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.export_retention_hours)
    directory = storage.base_dir / "exports"
    if not directory.exists():
        return 0
    removed = 0
    artifact = re.compile(r"^([0-9a-f-]{36})\.(?:md|html|docx|pdf|input\.json|source\.json)(?:\.\d+\.part)?$")
    jobs = {}
    for path in directory.iterdir():
        match = artifact.fullmatch(path.name)
        if not match or path.is_dir():
            continue
        job_id = match[1]
        if job_id not in jobs:
            jobs[job_id] = db.get(ExportJob, job_id)
        job = jobs[job_id]
        if job is not None:
            if job.status not in TERMINAL or job.finished_at is None:
                continue
            finished = job.finished_at.replace(tzinfo=timezone.utc) if job.finished_at.tzinfo is None else job.finished_at
            if finished >= cutoff:
                continue
        try:
            if job is None and path.lstat().st_mtime >= cutoff.timestamp():
                continue
            path.unlink(missing_ok=True)
            removed += 1
        except OSError:
            logger.warning("could not remove expired export", extra={"job_id": job_id}, exc_info=True)
    for job in jobs.values():
        if job is not None and job.file_url and job.status in TERMINAL and job.finished_at is not None:
            finished = job.finished_at.replace(tzinfo=timezone.utc) if job.finished_at.tzinfo is None else job.finished_at
            if finished < cutoff and not any(directory.glob(f"{job.id}.[a-z]*")):
                job.file_url = None
    db.commit()
    return removed
