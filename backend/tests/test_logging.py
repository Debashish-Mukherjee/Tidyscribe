import json
import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.logging_config import JsonFormatter, install_request_logging, request_id_var

mini = FastAPI()
install_request_logging(mini)


@mini.get("/ok")
def ok() -> dict[str, str]:
    logging.getLogger("app.test").info("inside handler")
    return {"status": "ok"}


@mini.get("/missing")
def missing() -> None:
    from fastapi import HTTPException

    raise HTTPException(status_code=404, detail="nope")


@mini.get("/boom")
def boom() -> None:
    raise RuntimeError("secret internal detail")


@mini.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


client = TestClient(mini, raise_server_exceptions=False)


def _records(caplog, name="app.request"):
    return [r for r in caplog.records if r.name == name]


def test_request_log_has_structured_fields_and_request_id_header(caplog) -> None:
    with caplog.at_level(logging.INFO):
        response = client.get("/ok")
    record = _records(caplog)[0]
    assert (record.method, record.path, record.status) == ("GET", "/ok", 200)
    assert record.duration_ms >= 0
    assert response.headers["x-request-id"] and len(response.headers["x-request-id"]) == 32


def test_request_id_is_shared_with_handler_logs_and_echoed(caplog) -> None:
    formatter = JsonFormatter()
    seen: dict[str, str] = {}

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            seen[record.name] = formatter.format(record)

    handler = Capture()
    logging.getLogger().addHandler(handler)
    try:
        with caplog.at_level(logging.INFO):
            response = client.get("/ok", headers={"X-Request-ID": "trace-abc-12345"})
    finally:
        logging.getLogger().removeHandler(handler)
    assert response.headers["x-request-id"] == "trace-abc-12345"
    assert json.loads(seen["app.test"])["request_id"] == "trace-abc-12345"
    assert json.loads(seen["app.request"])["request_id"] == "trace-abc-12345"
    assert request_id_var.get() == "-"  # context is reset after the request


def test_unsafe_request_ids_are_replaced(caplog) -> None:
    response = client.get("/ok", headers={"X-Request-ID": "bad id\twith spaces"})
    assert response.headers["x-request-id"] != "bad id\twith spaces"


def test_client_errors_log_warning_and_server_errors_log_error_without_leaking(caplog) -> None:
    with caplog.at_level(logging.DEBUG):
        not_found = client.get("/missing")
        failed = client.get("/boom")
    assert not_found.status_code == 404
    levels = {r.path: r.levelname for r in _records(caplog)}
    assert levels["/missing"] == "WARNING" and levels["/boom"] == "ERROR"
    assert failed.status_code == 500
    body = failed.json()
    assert body["detail"] == "Internal server error" and body["request_id"] == failed.headers["x-request-id"]
    assert "secret internal detail" not in failed.text
    crash = [r for r in caplog.records if r.getMessage() == "unhandled_exception"]
    assert crash and crash[0].exc_info is not None


def test_health_checks_are_debug_level(caplog) -> None:
    with caplog.at_level(logging.DEBUG):
        client.get("/api/health")
    assert _records(caplog)[0].levelname == "DEBUG"


def test_json_formatter_output_is_valid_json_with_extras_and_exceptions() -> None:
    try:
        raise ValueError("bad")
    except ValueError:
        import sys

        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "msg %s", ("a",), sys.exc_info())
    record.document_id = "abc"
    payload = json.loads(JsonFormatter().format(record))
    assert payload["message"] == "msg a" and payload["level"] == "ERROR"
    assert payload["document_id"] == "abc" and "ValueError" in payload["exception"]
    assert payload["ts"].endswith("+00:00")
