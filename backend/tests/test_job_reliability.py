"""Export job reliability: lifecycle states, heartbeats, timeouts, cancellation and recovery of orphaned jobs."""
import threading
import time
import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models import ExportJob
from app.services import export_jobs
from app.storage import storage
from app.tasks import output_path, run_export, source_path

client = TestClient(app)


def _job(status: str = "queued", **columns) -> str:
    """Insert a job directly, with timestamps given as 'seconds ago'."""
    ago = {name: columns.pop(name) for name in ("queued_at", "started_at", "heartbeat_at", "finished_at") if name in columns}
    with SessionLocal() as db:
        job = ExportJob(export_type="html", status=status, **columns)
        db.add(job)
        db.flush()
        for name, seconds in ago.items():
            setattr(job, name, func.now() - timedelta(seconds=seconds))
        db.commit()
        return job.id


def _read(job_id: str) -> ExportJob:
    with SessionLocal() as db:
        job = db.get(ExportJob, job_id)
        db.expunge(job)
        return job


def _queue_text(content: str = "# Reliability") -> str:
    with patch("app.api.exports.run_export.delay"):
        response = client.post("/api/exports", json={"title": "Reliability", "content": content, "format": "html"})
    assert response.status_code == 202
    return response.json()["job_id"]


def _delete_all_jobs() -> None:
    with SessionLocal() as db:
        db.execute(ExportJob.__table__.delete())
        db.commit()


@pytest.fixture(autouse=True)
def _empty_job_table():
    """Health reads the whole table, so each test starts and ends with no jobs."""
    _delete_all_jobs()
    yield
    _delete_all_jobs()


@pytest.fixture
def fast_heartbeat(monkeypatch):
    monkeypatch.setattr(settings, "export_heartbeat_interval_seconds", 0.1)


def test_a_finished_job_records_its_lifecycle() -> None:
    job_id = _queue_text()
    assert _read(job_id).status == "queued"
    run_export(job_id)
    job = _read(job_id)
    assert job.status == "completed"
    assert job.queued_at <= job.started_at <= job.finished_at
    assert job.heartbeat_at is not None and job.failure_reason is None and job.worker_id
    body = client.get(f"/api/exports/{job_id}").json()
    assert body["status"] == "completed" and body["started_at"] and body["finished_at"]


def test_only_one_worker_can_claim_a_job() -> None:
    job_id = _queue_text()
    assert export_jobs.claim(job_id) is True
    assert export_jobs.claim(job_id) is False
    with patch("app.tasks.build_export") as build:
        run_export(job_id)  # a duplicate message for a job someone else already runs
    build.assert_not_called()


def test_heartbeat_keeps_a_running_job_alive(fast_heartbeat) -> None:
    job_id = _queue_text()

    def slow(*_args, **_kwargs):
        time.sleep(0.45)
        return "html", "text/html", b"<p>ok</p>"

    with patch("app.tasks.build_export", side_effect=slow):
        before = time.time()
        run_export(job_id)
    job = _read(job_id)
    assert job.status == "completed"
    assert job.heartbeat_at.timestamp() >= before  # refreshed by the heartbeat thread, not just at claim time


def test_soft_timeout_stops_the_build_and_says_why(fast_heartbeat, monkeypatch) -> None:
    monkeypatch.setattr(settings, "export_soft_timeout_seconds", 0.3)
    job_id = _queue_text()

    def hang(*_args, **_kwargs):
        while True:
            time.sleep(0.02)

    started = time.time()
    with patch("app.tasks.build_export", side_effect=hang):
        run_export(job_id)
    assert time.time() - started < 5
    body = client.get(f"/api/exports/{job_id}").json()
    assert body["status"] == "timed_out" and body["failure_reason"] == "soft_timeout"
    assert "took longer than" in body["error"]
    assert client.get(f"/api/exports/{job_id}/download").status_code == 409


def test_cancelling_a_queued_job_means_it_never_runs() -> None:
    job_id = _queue_text()
    assert client.post(f"/api/exports/{job_id}/cancel").json()["status"] == "cancelled"
    with patch("app.tasks.build_export") as build:
        run_export(job_id)
    build.assert_not_called()
    assert _read(job_id).failure_reason == "cancelled"


def test_cancelling_a_running_job_interrupts_the_build(fast_heartbeat) -> None:
    job_id = _queue_text()
    running = threading.Event()

    def hang(*_args, **_kwargs):
        running.set()
        while True:
            time.sleep(0.02)

    def cancel_when_running() -> None:
        running.wait(5)
        assert client.post(f"/api/exports/{job_id}/cancel").json()["status"] == "cancelled"

    canceller = threading.Thread(target=cancel_when_running)
    canceller.start()
    with patch("app.tasks.build_export", side_effect=hang):
        run_export(job_id)
    canceller.join()
    assert _read(job_id).status == "cancelled"
    assert not storage.file_exists(source_path(job_id))


def test_cancel_leaves_finished_jobs_alone_and_unknown_jobs_404() -> None:
    job_id = _queue_text()
    run_export(job_id)
    assert client.post(f"/api/exports/{job_id}/cancel").json()["status"] == "completed"
    assert client.post("/api/exports/nope/cancel").status_code == 404


def test_a_worker_cannot_overwrite_a_job_the_reaper_already_failed() -> None:
    job_id = _queue_text()

    def reaped_midway(*_args, **_kwargs):
        with SessionLocal() as db:
            db.execute(ExportJob.__table__.update().where(ExportJob.id == job_id).values(status="failed", failure_reason="stale_heartbeat"))
            db.commit()
        return "html", "text/html", b"<p>late</p>"

    with patch("app.tasks.build_export", side_effect=reaped_midway):
        run_export(job_id)
    job = _read(job_id)
    assert (job.status, job.failure_reason) == ("failed", "stale_heartbeat")
    assert not storage.file_exists(output_path(job_id, "html"))


def test_one_failing_export_does_not_affect_the_next_one() -> None:
    bad, good = _queue_text(), _queue_text("# Fine")
    with patch("app.tasks.build_export", side_effect=RuntimeError("boom")):
        run_export(bad)
    run_export(good)
    assert (_read(bad).status, _read(bad).failure_reason) == ("failed", "export_error")
    assert _read(good).status == "completed"


def test_a_killed_workers_job_is_failed_when_its_heartbeat_goes_stale() -> None:
    job_id = _job("processing", started_at=100, heartbeat_at=300)
    with SessionLocal() as db:
        summary = export_jobs.recover_jobs(db)
    assert summary["stale"] >= 1
    job = _read(job_id)
    assert (job.status, job.failure_reason) == ("failed", "stale_heartbeat") and job.finished_at is not None
    assert "stopped responding" in job.error


def test_polling_a_stale_job_repairs_it_without_the_periodic_task() -> None:
    job_id = _job("starting", started_at=300, heartbeat_at=300)
    assert client.get(f"/api/exports/{job_id}").json()["status"] == "failed"


def test_a_healthy_job_is_not_touched_by_recovery() -> None:
    job_id = _job("processing", started_at=10, heartbeat_at=2)
    with SessionLocal() as db:
        export_jobs.recover_jobs(db)
    assert _read(job_id).status == "processing"


def test_a_job_running_past_the_hard_limit_is_timed_out_even_with_a_fresh_heartbeat() -> None:
    job_id = _job("processing", started_at=settings.export_hard_timeout_seconds + 60, heartbeat_at=1)
    with SessionLocal() as db:
        export_jobs.recover_jobs(db)
    job = _read(job_id)
    assert (job.status, job.failure_reason) == ("timed_out", "hard_timeout")


def test_legacy_processing_rows_without_any_heartbeat_are_recovered() -> None:
    job_id = _job("processing", queued_at=3600)
    with SessionLocal() as db:
        export_jobs.recover_jobs(db)
    assert _read(job_id).status == "failed"


def test_orphaned_queued_jobs_are_redispatched_then_abandoned() -> None:
    orphan = _job("queued", queued_at=settings.export_requeue_after_seconds + 30)
    fresh = _job("queued", queued_at=1)
    expired = _job("queued", queued_at=settings.export_queued_expiry_seconds + 60)
    dispatch = MagicMock()
    with SessionLocal() as db:
        export_jobs.recover_jobs(db, dispatch=dispatch)
    dispatched = {call.args[0] for call in dispatch.call_args_list}
    assert orphan in dispatched and fresh not in dispatched and expired not in dispatched
    assert _read(orphan).attempts == 1 and _read(orphan).status == "queued"
    assert (_read(expired).status, _read(expired).failure_reason) == ("failed", "abandoned")

    dispatch.reset_mock()
    with SessionLocal() as db:
        export_jobs.recover_jobs(db, dispatch=dispatch)  # just touched: not re-sent on every pass
    assert orphan not in {call.args[0] for call in dispatch.call_args_list}


def test_dispatch_failure_does_not_stop_recovery() -> None:
    _job("queued", queued_at=settings.export_requeue_after_seconds + 30)
    with SessionLocal() as db:
        summary = export_jobs.recover_jobs(db, dispatch=MagicMock(side_effect=ConnectionError("redis down")))
    assert summary["requeued"] == 0


def test_old_files_and_leftover_inputs_are_removed() -> None:
    job_id = _queue_text()
    run_export(job_id)
    with SessionLocal() as db:
        db.execute(ExportJob.__table__.update().where(ExportJob.id == job_id).values(finished_at=func.now() - timedelta(hours=settings.export_retention_hours + 1)))
        db.commit()
    storage.save_file(f"exports/{job_id}.input.json", b"[]")
    assert storage.file_exists(output_path(job_id, "html"))
    with SessionLocal() as db:
        assert export_jobs.cleanup_files(db) >= 1
    assert not storage.file_exists(output_path(job_id, "html")) and not storage.file_exists(f"exports/{job_id}.input.json")
    assert _read(job_id).file_url is None


def test_the_periodic_task_runs_both_recovery_and_cleanup() -> None:
    from app.tasks import maintain_exports

    job_id = _job("processing", started_at=100, heartbeat_at=300)
    summary = maintain_exports()
    assert {"stale", "timed_out", "requeued", "abandoned", "files_removed"} <= set(summary)
    assert _read(job_id).status == "failed"


def test_health_reports_the_queue_and_degrades_when_jobs_are_stale() -> None:
    body = client.get("/api/health").json()
    assert body["database"] == "ok" and body["memory_mb"] is not None
    assert set(body["queue"]["states"]) == set(export_jobs.ALL_STATES)
    _job("processing", started_at=100, heartbeat_at=300)
    assert client.get("/api/health").json()["status"] == "degraded"
    with SessionLocal() as db:
        export_jobs.recover_jobs(db)
    assert client.get("/api/health").json()["status"] == "ok"


def test_metrics_expose_queue_state_and_timings() -> None:
    run_export(_queue_text())
    for path in ("/metrics", "/api/metrics"):
        body = client.get(path).text
        for needle in ('export_jobs{status="timed_out"}', 'export_jobs{status="cancelled"}', "export_queue_depth", "export_oldest_queued_seconds",
                       "export_stale_jobs", 'export_workers_alive{role="export"}', 'export_queue_wait_seconds{quantile="0.95"}',
                       'export_duration_seconds{format="html",quantile="0.5"}', "process_resident_memory_bytes"):
            assert needle in body, (path, needle)


def test_browser_timings_are_accepted_and_unknown_names_ignored() -> None:
    response = client.post("/api/metrics/client", json={"samples": [{"name": "preview_render", "ms": 12.5}, {"name": f"evil-{uuid.uuid4().hex}", "ms": 1}]})
    assert response.status_code == 204
    body = client.get("/api/metrics").text
    assert 'client_duration_ms_count{name="preview_render"}' in body and "evil-" not in body
    assert client.post("/api/metrics/client", json={"samples": [{"name": "preview_render", "ms": -1}]}).status_code == 422


def test_recovery_after_an_export_process_is_actually_killed(monkeypatch) -> None:
    import multiprocessing
    from app.database import engine

    context = multiprocessing.get_context("fork")
    building = context.Event()
    job_id = _queue_text()

    def child():
        # A forked worker must create its own database connections.
        engine.dispose(close=False)
        def hang(*_args, **_kwargs):
            building.set()
            while True:
                time.sleep(0.02)
        with patch("app.tasks.build_export", side_effect=hang):
            run_export(job_id)

    process = context.Process(target=child)
    process.start()
    try:
        assert building.wait(10)
        assert _read(job_id).status == "processing"
        process.kill()
        process.join(timeout=5)
        assert process.exitcode == -9
        # Let a real heartbeat expire; recovery does not depend on a client polling.
        monkeypatch.setattr(settings, "export_heartbeat_stale_seconds", 0.2)
        time.sleep(0.3)
        with SessionLocal() as db:
            export_jobs.recover_jobs(db)
        assert (_read(job_id).status, _read(job_id).failure_reason) == ("failed", "stale_heartbeat")
        next_job = _queue_text("# The next job still works")
        run_export(next_job)
        assert _read(next_job).status == "completed"
    finally:
        if process.is_alive():
            process.kill()
        process.join(timeout=5)


def test_retention_preserves_active_and_recent_artifacts() -> None:
    active = _job("processing", started_at=1, heartbeat_at=1)
    recent = _queue_text()
    run_export(recent)
    storage.save_file(output_path(active, "pdf"), b"active")
    with SessionLocal() as db:
        export_jobs.cleanup_files(db)
    assert storage.file_exists(output_path(active, "pdf"))
    assert storage.file_exists(output_path(recent, "html"))
