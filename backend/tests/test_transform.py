from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_transform_endpoint_removes_ai_preamble() -> None:
    payload = {"text": "Certainly! Here is a summary. # Overview", "tone": "Solution Design"}
    response = client.post("/api/transform", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert "Certainly" not in body["cleaned_text"]
    assert "# Overview" in body["cleaned_text"]
    assert "Prepared for" in body["summary"]


def test_transform_keeps_heading_levels_lists_tables_and_code_blocks() -> None:
    text = (
        "# Title\n\n## Objective\n\n### Detail\n\n* one\n* two\n\n1. first\n2. second\n\n"
        "| A | B |\n|---|---|\n| `x` | y |\n\n```text\n## not a heading\n  | indented\n```\n"
    )
    response = client.post("/api/transform", json={"text": text, "tone": "Solution Design"})
    assert response.status_code == 200
    assert response.json()["cleaned_text"] == text.strip()
