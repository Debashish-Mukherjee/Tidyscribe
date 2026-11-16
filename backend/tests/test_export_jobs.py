import base64
import json
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import ExportJob
from app.storage import storage
from app.tasks import input_path, run_export

client = TestClient(app)

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\r" + b"IHDR" + b"\x00\x00\x00\x08\x00\x00\x00\x08" + b"\x08\x02\x00\x00\x00" + b"\x00" * 16).decode()


def _document(content: str = "# Jobs\n\ntext") -> str:
    return client.post("/api/documents", json={"title": f"Job doc {uuid.uuid4().hex[:6]}", "content": content}).json()["id"]


def _queue(document_id: str, fmt: str = "html", **extra):
    return client.post("/api/exports", json={"document_id": document_id, "format": fmt, **extra})


def test_export_response_describes_the_job() -> None:
    response = _queue(_document())
    assert response.status_code == 202
    body = response.json()
    assert {"job_id", "status", "type", "file_url", "error", "failure_reason", "queued_at", "started_at", "finished_at", "heartbeat_at"} == set(body)
    assert (body["status"], body["type"], body["error"]) == ("completed", "html", None)
    assert body["file_url"].endswith(f"/api/exports/{body['job_id']}/download")


def test_job_status_can_be_polled() -> None:
    job_id = _queue(_document()).json()["job_id"]
    polled = client.get(f"/api/exports/{job_id}")
    assert polled.status_code == 200 and polled.json()["status"] == "completed"
    assert client.get("/api/exports/nope").status_code == 404
    assert client.get("/api/exports/nope/download").status_code == 404


def test_queue_failure_returns_503_and_marks_the_job_failed() -> None:
    document_id = _document()
    with patch("app.api.exports.run_export.delay", side_effect=ConnectionError("redis down")):
        response = _queue(document_id, diagrams=[{"source": "graph TD", "png_base64": PNG}])
    assert response.status_code == 503
    assert response.json()["detail"] == "The export queue is unavailable"
    with SessionLocal() as db:
        job = db.query(ExportJob).filter(ExportJob.document_id == document_id).one()
        assert (job.status, job.error) == ("failed", "The export queue is unavailable")
        assert not storage.file_exists(input_path(job.id))  # uploaded diagrams are cleaned up


def test_download_before_completion_is_409_and_after_a_deferred_run_is_200() -> None:
    document_id = _document("# Deferred")
    with patch("app.api.exports.run_export.delay") as delay:  # accepted but not executed yet, like a busy worker
        job_id = _queue(document_id).json()["job_id"]
    delay.assert_called_once_with(job_id)
    assert client.get(f"/api/exports/{job_id}").json()["status"] == "queued"
    assert client.get(f"/api/exports/{job_id}/download").status_code == 409

    run_export(job_id)  # the worker picks it up
    assert client.get(f"/api/exports/{job_id}").json()["status"] == "completed"
    download = client.get(f"/api/exports/{job_id}/download")
    assert download.status_code == 200 and b"<h1>Deferred</h1>" in download.content


def test_worker_reads_uploaded_diagrams_and_removes_the_input_file() -> None:
    document_id = _document("```mermaid\ngraph TD\nA-->B\n```")
    with patch("app.api.exports.run_export.delay"):
        job_id = _queue(document_id, diagrams=[{"source": "graph TD\nA-->B", "png_base64": PNG}]).json()["job_id"]
    assert json.loads(storage.get_file(input_path(job_id)))[0]["png_base64"] == PNG

    run_export(job_id)
    assert not storage.file_exists(input_path(job_id))
    assert b"data:image/png;base64," in client.get(f"/api/exports/{job_id}/download").content


def test_worker_marks_failures_without_leaking_details() -> None:
    job_id = _queue(_document()).json()["job_id"]
    with SessionLocal() as db:
        db.get(ExportJob, job_id).status = "queued"
        db.commit()
    with patch("app.tasks.build_export", side_effect=RuntimeError("secret stack detail")):
        run_export(job_id)
    body = client.get(f"/api/exports/{job_id}").json()
    assert body["status"] == "failed"
    assert body["error"] == "The document could not be exported"
    assert "secret" not in json.dumps(body)
    assert client.get(f"/api/exports/{job_id}/download").status_code == 409


def test_worker_handles_a_document_deleted_after_queueing() -> None:
    document_id = _document()
    with patch("app.api.exports.run_export.delay"):
        job_id = _queue(document_id).json()["job_id"]
    client.delete(f"/api/documents/{document_id}")
    run_export(job_id)
    body = client.get(f"/api/exports/{job_id}").json()
    assert (body["status"], body["error"]) == ("failed", "The document no longer exists")


@pytest.mark.parametrize("status", ["completed", "failed"])
def test_worker_ignores_jobs_that_already_finished(status: str) -> None:
    job_id = _queue(_document()).json()["job_id"]
    with SessionLocal() as db:
        db.get(ExportJob, job_id).status = status
        db.commit()
    with patch("app.tasks.build_export") as build:
        run_export(job_id)
        run_export("does-not-exist")
    build.assert_not_called()
    assert client.get(f"/api/exports/{job_id}").json()["status"] == status


def test_invalid_diagram_uploads_are_rejected_before_queueing() -> None:
    document_id = _document()
    with patch("app.api.exports.run_export.delay") as delay:
        response = _queue(document_id, diagrams=[{"source": "x", "png_base64": "not-base64!"}])
    assert response.status_code == 400
    delay.assert_not_called()


def test_export_of_unsaved_text_does_not_create_a_document() -> None:
    before = len(client.get("/api/documents?limit=500").json())
    response = client.post("/api/exports", json={"title": "Scratch", "content": "# Scratch\n\ntext", "format": "html"})
    assert response.status_code == 202 and response.json()["status"] == "completed"
    download = client.get(f"/api/exports/{response.json()['job_id']}/download")
    assert download.status_code == 200 and "Scratch" in download.text
    assert len(client.get("/api/documents?limit=500").json()) == before
    job_id = response.json()["job_id"]
    assert not storage.file_exists(f"exports/{job_id}.source.json")


@pytest.mark.parametrize("body", [{}, {"document_id": "x", "content": "y"}])
def test_export_needs_exactly_one_source(body: dict) -> None:
    assert client.post("/api/exports", json={**body, "format": "html"}).status_code == 422
