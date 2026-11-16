import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# ------------------------------------------------------------------ documents

def test_document_crud_versions_and_soft_delete() -> None:
    created = client.post("/api/documents", json={"title": "Doc", "content": "v1"}).json()
    doc_id = created["id"]
    assert created["created_at"]

    assert client.get(f"/api/documents/{doc_id}").json()["content"] == "v1"

    updated = client.put(f"/api/documents/{doc_id}", json={"content": "v2", "title": "Renamed"}).json()
    assert (updated["title"], updated["content"]) == ("Renamed", "v2")
    client.put(f"/api/documents/{doc_id}", json={"content": "v2"})  # unchanged content adds no version
    client.put(f"/api/documents/{doc_id}", json={"content": "v3"})

    versions = client.get(f"/api/documents/{doc_id}/versions").json()
    assert [v["content"] for v in versions] == ["v2", "v1"]

    restored = client.post(f"/api/documents/{doc_id}/versions/{versions[1]['id']}/restore").json()
    assert restored["content"] == "v1"
    assert [v["content"] for v in client.get(f"/api/documents/{doc_id}/versions").json()][0] == "v3"

    assert client.delete(f"/api/documents/{doc_id}").status_code == 204
    assert client.get(f"/api/documents/{doc_id}").status_code == 404
    assert client.put(f"/api/documents/{doc_id}", json={"title": "x"}).status_code == 404
    assert doc_id not in [d["id"] for d in client.get("/api/documents").json()]
    assert client.post("/api/exports", json={"document_id": doc_id, "format": "html"}).status_code == 400


def test_document_search_treats_wildcards_literally() -> None:
    marker = _name("zq")
    client.post("/api/documents", json={"title": f"{marker} 100% done", "content": "a"})
    client.post("/api/documents", json={"title": f"{marker} plain", "content": "b"})
    assert len(client.get("/api/documents", params={"q": f"{marker} 100%"}).json()) == 1
    assert len(client.get("/api/documents", params={"q": marker}).json()) == 2
    assert len(client.get("/api/documents", params={"q": marker, "limit": 1}).json()) == 1


def test_document_validation() -> None:
    assert client.post("/api/documents", json={"title": ""}).status_code == 422
    assert client.get("/api/documents", params={"limit": 0}).status_code == 422


# ------------------------------------------------------------------ templates

def test_template_crud_conflicts_and_revive() -> None:
    name = _name("tpl")
    created = client.post("/api/templates", json={"name": name, "category": "doc", "body": "# T"})
    assert created.status_code == 201
    tpl_id = created.json()["id"]
    assert client.post("/api/templates", json={"name": name}).status_code == 409

    other = client.post("/api/templates", json={"name": _name("tpl")}).json()
    assert client.put(f"/api/templates/{other['id']}", json={"name": name}).status_code == 409
    assert client.put(f"/api/templates/{tpl_id}", json={"body": "# New"}).json()["body"] == "# New"

    assert client.delete(f"/api/templates/{tpl_id}").status_code == 204
    assert client.get(f"/api/templates/{tpl_id}").status_code == 404
    revived = client.post("/api/templates", json={"name": name, "body": "again"})
    assert revived.status_code == 201 and revived.json()["id"] == tpl_id


def test_template_filters() -> None:
    category = _name("cat")
    client.post("/api/templates", json={"name": _name("t"), "category": category, "body": "findme"})
    assert len(client.get("/api/templates", params={"category": category}).json()) == 1
    assert len(client.get("/api/templates", params={"category": category, "q": "nomatch"}).json()) == 0


# ------------------------------------------------------------------ snippets

def test_snippet_tags_search_favourite_archive_delete() -> None:
    marker = _name("sn")
    created = client.post(
        "/api/snippets",
        json={"title": f"{marker} one", "body": "select 1", "category": "SQL", "tags": ["DB", " perf ", "db", "a,b"]},
    ).json()
    snippet_id = created["id"]
    assert created["tags"] == ["db", "perf", "a b"]

    assert [s["id"] for s in client.get("/api/snippets", params={"q": marker}).json()] == [snippet_id]
    assert [s["id"] for s in client.get("/api/snippets", params={"tag": "PERF", "q": marker}).json()] == [snippet_id]
    assert client.get("/api/snippets", params={"tag": "pe", "q": marker}).json() == []  # whole-tag match only

    fav = client.put(f"/api/snippets/{snippet_id}", json={"favorite": True}).json()
    assert fav["favorite"] is True and fav["title"] == f"{marker} one"
    assert len(client.get("/api/snippets", params={"favorite": True, "q": marker}).json()) == 1

    client.put(f"/api/snippets/{snippet_id}", json={"archived": True})
    assert client.get("/api/snippets", params={"q": marker}).json() == []
    assert len(client.get("/api/snippets", params={"q": marker, "archived": True}).json()) == 1

    assert client.put(f"/api/snippets/{snippet_id}", json={"tags": ["x"]}).json()["tags"] == ["x"]
    assert client.delete(f"/api/snippets/{snippet_id}").status_code == 204
    assert client.get(f"/api/snippets/{snippet_id}").status_code == 404
    assert client.get("/api/snippets", params={"q": marker, "archived": True}).json() == []


# ------------------------------------------------------------------ clipboard

def test_clipboard_pin_tag_delete_restore() -> None:
    marker = _name("clip")
    item = client.post("/api/clipboard", json={"content": f"{marker} text", "tags": ["Work"]}).json()
    item_id = item["id"]
    assert item["tags"] == ["work"] and item["pinned"] is False

    assert len(client.get("/api/clipboard", params={"q": marker}).json()) == 1
    assert len(client.get("/api/clipboard", params={"tag": "work", "q": marker}).json()) == 1
    assert client.put(f"/api/clipboard/{item_id}", json={"pinned": True}).json()["pinned"] is True
    assert len(client.get("/api/clipboard", params={"pinned": True, "q": marker}).json()) == 1

    assert client.delete(f"/api/clipboard/{item_id}").status_code == 204
    assert client.get("/api/clipboard", params={"q": marker}).json() == []
    assert client.post(f"/api/clipboard/{item_id}/restore").json()["id"] == item_id
    assert len(client.get("/api/clipboard", params={"q": marker}).json()) == 1
    assert client.post("/api/clipboard", json={"content": ""}).status_code == 422


def test_clipboard_history_is_capped_but_pinned_items_survive() -> None:
    from app.api.clipboard import HISTORY_LIMIT
    from app.database import SessionLocal
    from app.models import ClipboardItem

    with SessionLocal() as db:
        db.query(ClipboardItem).delete()
        db.commit()
    pinned = client.post("/api/clipboard", json={"content": "keep me"}).json()["id"]
    client.put(f"/api/clipboard/{pinned}", json={"pinned": True})
    for index in range(HISTORY_LIMIT + 5):
        client.post("/api/clipboard", json={"content": f"item {index}"})

    items = client.get("/api/clipboard").json()
    assert len(items) <= HISTORY_LIMIT
    assert items[0]["id"] == pinned  # pinned sorts first
    unpinned = [i for i in items if not i["pinned"]]
    assert "item 0" not in [i["content"] for i in unpinned]
    assert f"item {HISTORY_LIMIT + 4}" in [i["content"] for i in unpinned]


# ------------------------------------------------------------------ settings

def test_settings_roundtrip_and_validation() -> None:
    key = f"test.{uuid.uuid4().hex[:8]}"
    assert client.get(f"/api/settings/{key}").status_code == 404
    assert client.put(f"/api/settings/{key}", json={"value": "dark"}).json() == {"value": "dark"}
    assert client.put(f"/api/settings/{key}", json={"value": "light"}).status_code == 200
    assert client.get(f"/api/settings/{key}").json() == {"value": "light"}
    assert client.get("/api/settings").json()[key] == "light"
    assert client.delete(f"/api/settings/{key}").status_code == 204
    assert client.delete(f"/api/settings/{key}").status_code == 404
    assert client.put("/api/settings/BAD KEY!", json={"value": "x"}).status_code in (404, 422)


@pytest.mark.parametrize("path", ["/api/documents/nope", "/api/templates/nope", "/api/snippets/nope", "/api/clipboard/nope"])
def test_unknown_ids_return_404(path: str) -> None:
    assert client.get(path).status_code == 404


def test_update_with_a_stale_timestamp_is_rejected_and_keeps_the_newer_content() -> None:
    created = client.post("/api/documents", json={"title": "Conflict", "content": "v1"}).json()
    first = client.put(f"/api/documents/{created['id']}", json={"content": "v2", "expected_updated_at": created["updated_at"]})
    assert first.status_code == 200 and first.json()["content"] == "v2"

    stale = client.put(f"/api/documents/{created['id']}", json={"content": "stale", "expected_updated_at": created["updated_at"]})
    assert stale.status_code == 409
    assert client.get(f"/api/documents/{created['id']}").json()["content"] == "v2"

    fresh = client.put(f"/api/documents/{created['id']}", json={"content": "v3", "expected_updated_at": first.json()["updated_at"]})
    assert fresh.status_code == 200


def test_update_without_a_timestamp_still_overwrites() -> None:
    created = client.post("/api/documents", json={"title": "Plain", "content": "a"}).json()
    assert client.put(f"/api/documents/{created['id']}", json={"content": "b"}).status_code == 200


def test_simultaneous_saves_with_the_same_revision_only_allow_one_writer() -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    created = client.post("/api/documents", json={"title": "Concurrent", "content": "original"}).json()
    barrier = Barrier(2)

    def save(text):
        barrier.wait(timeout=5)
        isolated = TestClient(app)
        return isolated.put(f"/api/documents/{created['id']}", json={"content": text, "expected_updated_at": created["updated_at"]})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, ["writer A", "writer B"]))
    assert sorted(result.status_code for result in results) == [200, 409]
    versions = client.get(f"/api/documents/{created['id']}/versions").json()
    assert [version["content"] for version in versions] == ["original"]


def test_restore_with_a_stale_revision_preserves_newer_work() -> None:
    created = client.post("/api/documents", json={"title": "Restore conflict", "content": "old"}).json()
    client.put(f"/api/documents/{created['id']}", json={"content": "new"})
    version = client.get(f"/api/documents/{created['id']}/versions").json()[0]
    response = client.post(f"/api/documents/{created['id']}/versions/{version['id']}/restore", json={"expected_updated_at": created["updated_at"]})
    assert response.status_code == 409
    assert client.get(f"/api/documents/{created['id']}").json()["content"] == "new"
