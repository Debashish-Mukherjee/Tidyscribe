import base64
import struct
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_export_requires_existing_document() -> None:
    response = client.post("/api/exports", json={"document_id": "missing-doc", "format": "docx"})
    assert response.status_code == 400
    assert "document" in response.json()["detail"].lower()


def test_export_creates_job_for_existing_document() -> None:
    document_response = client.post("/api/documents", json={"title": "Export Test", "content": "# Export Test"})
    assert document_response.status_code == 200
    document_id = document_response.json()["id"]

    response = client.post("/api/exports", json={"document_id": document_id, "format": "docx"})
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "completed"
    assert body["type"] == "docx"
    assert "/api/exports/" in body["file_url"]
    assert body["file_url"].endswith("/download")


def test_export_generates_file_for_document() -> None:
    document_response = client.post("/api/documents", json={"title": "File Export Test", "content": "# File Export Test"})
    assert document_response.status_code == 200
    document_id = document_response.json()["id"]

    response = client.post("/api/exports", json={"document_id": document_id, "format": "pdf"})
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "completed"
    assert "/api/exports/" in body["file_url"]
    assert body["file_url"].endswith("/download")


def test_html_export_preserves_markdown_structure() -> None:
    document_response = client.post(
        "/api/documents",
        json={
            "title": "Structured Export",
            "content": "# Overview\n\n- First item\n- Second item\n\n> Important note",
        },
    )
    assert document_response.status_code == 200
    document_id = document_response.json()["id"]

    response = client.post("/api/exports", json={"document_id": document_id, "format": "html"})
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "completed"

    file_response = client.get(body["file_url"])
    assert file_response.status_code == 200
    content = file_response.text
    assert "<h1>Overview</h1>" in content
    assert "<li>First item</li>" in content
    assert "<blockquote><p>Important note</p></blockquote>" in content


SAMPLE = (Path(__file__).parent / "fixtures" / "order_platform.md").read_text()


def _export(fmt: str, **extra):
    document = client.post("/api/documents", json={"title": "Order Processing Platform", "content": SAMPLE})
    assert document.status_code == 200
    created = client.post("/api/exports", json={"document_id": document.json()["id"], "format": fmt, **extra})
    return created, (client.get(created.json()["file_url"]) if created.status_code == 202 else None)


@pytest.mark.parametrize(
    ("fmt", "media_type", "filename", "magic"),
    [
        ("html", "text/html", "order-processing-platform.html", b"<!DOCTYPE html>"),
        ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "order-processing-platform.docx", b"PK"),
        ("pdf", "application/pdf", "order-processing-platform.pdf", b"%PDF-"),
        ("markdown", "text/markdown", "order-processing-platform.md", b"# Order Processing Platform"),
    ],
)
def test_download_has_correct_type_name_and_content(fmt, media_type, filename, magic) -> None:
    created, download = _export(fmt)
    assert created.status_code == 202
    assert download.status_code == 200
    assert download.headers["content-type"].startswith(media_type)
    assert filename in download.headers["content-disposition"]
    assert download.content.startswith(magic)


def test_export_accepts_rendered_diagrams_and_rejects_bad_ones() -> None:
    flowchart = SAMPLE.split("```mermaid\n", 1)[1].split("```", 1)[0]
    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", 8, 8) + b"\x08\x02\x00\x00\x00" + b"\x00" * 16).decode()

    created, download = _export("html", diagrams=[{"source": flowchart, "png_base64": png}])
    assert created.status_code == 202
    assert "data:image/png;base64," in download.text

    rejected, _ = _export("html", diagrams=[{"source": flowchart, "png_base64": base64.b64encode(b"not a png at all, sorry").decode()}])
    assert rejected.status_code == 400


def test_requests_do_not_leak_database_connections() -> None:
    # The pool holds 15 connections; a leak makes the 16th call block for 30s and then fail.
    started = time.monotonic()
    for _ in range(40):
        assert client.get("/api/templates").status_code == 200
    assert time.monotonic() - started < 20
