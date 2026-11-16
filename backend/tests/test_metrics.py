from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_metrics_report_requests_by_route_template() -> None:
    client.get("/api/health")
    client.get("/api/documents/does-not-exist")
    body = client.get("/metrics").text
    assert 'http_requests_total{method="GET",path="/api/health",status="200"}' in body
    assert 'path="/api/documents/{document_id}"' in body
    assert "does-not-exist" not in body
    assert "http_request_duration_seconds_bucket" in body


def test_metrics_do_not_count_themselves() -> None:
    client.get("/metrics")
    assert 'path="/metrics"' not in client.get("/metrics").text


def test_metrics_include_export_jobs_by_status() -> None:
    body = client.get("/metrics").text
    for status in ("queued", "processing", "completed", "failed"):
        assert f'export_jobs{{status="{status}"}}' in body


def test_error_tracking_is_off_without_dsn() -> None:
    from app.error_tracking import init_error_tracking

    assert init_error_tracking("", "test", "api") is False
