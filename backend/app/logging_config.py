from __future__ import annotations

import json
import logging
import re
import sys
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.error_tracking import capture_exception

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

_STANDARD_ATTRS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime", "taskName", "color_message"}
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_QUIET_PATHS = {"/api/health", "/api/ready"}

logger = logging.getLogger("app.request")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        payload.update({k: v for k, v in record.__dict__.items() if k not in _STANDARD_ATTRS and not k.startswith("_")})
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)-7s %(name)s [%(request_id)s] %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        record.request_id = request_id_var.get()
        return super().format(record)


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if json_logs else TextFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Route uvicorn through the same handler; request logging below replaces its access log.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        named = logging.getLogger(name)
        named.handlers = []
        named.propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def install_request_logging(app: FastAPI) -> None:
    @app.middleware("http")
    async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
        supplied = request.headers.get("x-request-id", "")
        request_id = supplied if _SAFE_REQUEST_ID.match(supplied) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            logger.exception("unhandled_exception", extra={"method": request.method, "path": request.url.path})
            capture_exception()
            response = JSONResponse({"detail": "Internal server error", "request_id": request_id}, status_code=500)
        finally:
            level = logging.DEBUG if request.url.path in _QUIET_PATHS and status < 400 else (
                logging.ERROR if status >= 500 else logging.WARNING if status >= 400 else logging.INFO
            )
            logger.log(
                level,
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "client": request.client.host if request.client else None,
                },
            )
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        return response
