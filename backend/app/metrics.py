from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
from prometheus_client.process_collector import ProcessCollector
from pydantic import BaseModel, Field

from app.database import SessionLocal
from app.services import queue_stats
from app.services.export_jobs import ALL_STATES

logger = logging.getLogger("app.metrics")

registry = CollectorRegistry()
ProcessCollector(registry=registry)
REQUESTS = Counter("http_requests_total", "HTTP requests", ["method", "path", "status"], registry=registry)
LATENCY = Histogram("http_request_duration_seconds", "HTTP request latency", ["method", "path"], registry=registry)
EXPORT_JOBS = Gauge("export_jobs", "Export jobs by status", ["status"], registry=registry)
QUEUE_DEPTH = Gauge("export_queue_depth", "Messages waiting in the broker queue", registry=registry)
OLDEST_QUEUED = Gauge("export_oldest_queued_seconds", "Age of the oldest queued export job", registry=registry)
STALE_JOBS = Gauge("export_stale_jobs", "Active export jobs whose heartbeat is overdue", registry=registry)
WORKERS = Gauge("export_workers_alive", "Worker processes that announced themselves recently", ["role"], registry=registry)
QUEUE_WAIT = Gauge("export_queue_wait_seconds", "Queue wait over the metrics window", ["quantile"], registry=registry)
DURATION = Gauge("export_duration_seconds", "Build duration of completed exports over the metrics window", ["format", "quantile"], registry=registry)
WORKER_RSS = Gauge("export_worker_rss_mb", "Largest worker memory seen at the end of a completed export", ["format"], registry=registry)

# Timings the browser measures about itself; the allow-list keeps label cardinality bounded.
CLIENT_METRICS = ("editor_render", "preview_render", "preview_diagrams", "typing_latency", "export_roundtrip", "paste_render")
CLIENT = Histogram(
    "client_duration_ms",
    "Timings reported by the browser, in milliseconds",
    ["name"],
    buckets=(1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 15000),
    registry=registry,
)


class ClientSample(BaseModel):
    name: str = Field(..., max_length=40)
    ms: float = Field(..., ge=0, le=600_000)


class ClientSamples(BaseModel):
    samples: list[ClientSample] = Field(..., max_length=200)


def _route_label(request: Request) -> str:
    # The route template keeps label cardinality bounded; unmatched paths share one label.
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


def _refresh_export_jobs() -> None:
    # Jobs run in the worker process, so counts come from the database rather than in-process counters.
    try:
        with SessionLocal() as db:
            snapshot = queue_stats.queue_snapshot(db)
            timings = queue_stats.recent_timings(db)
    except Exception:
        logger.warning("export job metrics unavailable", exc_info=True)
        return
    for state in ALL_STATES:
        EXPORT_JOBS.labels(state).set(snapshot["states"][state])
    QUEUE_DEPTH.set(snapshot["broker_depth"])
    OLDEST_QUEUED.set(snapshot["oldest_queued_seconds"])
    STALE_JOBS.set(snapshot["stale"])
    WORKERS.labels("export").set(snapshot["workers"])
    WORKERS.labels("maintenance").set(snapshot["maintenance_workers"])
    wait = timings["queue_wait"][0]
    QUEUE_WAIT.labels("0.5").set(wait["p50"])
    QUEUE_WAIT.labels("0.95").set(wait["p95"])
    DURATION.clear()
    WORKER_RSS.clear()
    for row in timings["duration"]:
        DURATION.labels(row["format"], "0.5").set(row["p50"])
        DURATION.labels(row["format"], "0.95").set(row["p95"])
        WORKER_RSS.labels(row["format"]).set(row["max_rss_mb"])


def install_metrics(app: FastAPI) -> None:
    @app.middleware("http")
    async def record_metrics(request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.url.path in ("/metrics", "/api/metrics"):
            return await call_next(request)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            path = _route_label(request)
            REQUESTS.labels(request.method, path, str(status)).inc()
            LATENCY.labels(request.method, path).observe(time.perf_counter() - started)

    @app.get("/metrics", include_in_schema=False)
    @app.get("/api/metrics", include_in_schema=False)
    def metrics() -> Response:
        _refresh_export_jobs()
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    @app.post("/api/metrics/client", status_code=204, include_in_schema=False)
    def client_metrics(payload: ClientSamples) -> Response:
        for sample in payload.samples:
            if sample.name in CLIENT_METRICS:
                CLIENT.labels(sample.name).observe(sample.ms)
        return Response(status_code=204)
