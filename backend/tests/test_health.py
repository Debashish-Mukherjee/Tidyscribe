from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_endpoint(monkeypatch) -> None:
    monkeypatch.setattr("app.services.queue_stats.redis_stats", lambda: {"redis": True, "workers": 1, "maintenance_workers": 1})
    response = client.get("/api/ready")
    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_readiness_rejects_missing_dependencies(monkeypatch) -> None:
    for stats in [
        {"redis": False, "workers": 0, "maintenance_workers": 0},
        {"redis": True, "workers": 0, "maintenance_workers": 1},
        {"redis": True, "workers": 1, "maintenance_workers": 0},
    ]:
        monkeypatch.setattr("app.services.queue_stats.redis_stats", lambda: stats)
        assert client.get("/api/ready").status_code == 503


def test_database_failure_is_unavailable(monkeypatch) -> None:
    from unittest.mock import MagicMock
    monkeypatch.setattr("app.main.SessionLocal", MagicMock(side_effect=ConnectionError("down")))
    assert client.get("/api/ready").status_code == 503
    assert client.get("/api/health").status_code == 503


def test_broker_failure_degrades_health(monkeypatch) -> None:
    monkeypatch.setattr("app.services.queue_stats.redis_stats", lambda: {"redis": False, "workers": 0, "maintenance_workers": 0})
    assert client.get("/api/health").json()["status"] == "degraded"
