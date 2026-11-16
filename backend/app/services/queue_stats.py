"""Read-only view of the export queue for /api/health and /api/metrics. Counts come from the database so every process agrees."""
from __future__ import annotations

import logging
import time
from datetime import timedelta
from functools import lru_cache

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ExportJob
from app.services.export_jobs import ACTIVE, ALL_STATES, QUEUED

logger = logging.getLogger("app.queue")


@lru_cache(maxsize=1)
def _redis():
    import redis

    return redis.Redis.from_url(settings.redis_url, socket_timeout=1, socket_connect_timeout=1)


_down_until = 0.0


def redis_stats() -> dict[str, int | bool]:
    """Broker queue depth and how many worker processes announced themselves recently."""
    global _down_until
    if time.monotonic() < _down_until:  # health probes must not each wait for a dead broker
        return {"redis": False, "broker_depth": 0, "workers": 0, "maintenance_workers": 0}
    try:
        client = _redis()
        depth = int(client.llen("celery"))
        workers = sum(1 for _ in client.scan_iter("workbench:worker:export:*", count=100))
        maintenance = sum(1 for _ in client.scan_iter("workbench:worker:maintenance:*", count=100))
        return {"redis": True, "broker_depth": depth, "workers": workers, "maintenance_workers": maintenance}
    except Exception:
        _down_until = time.monotonic() + 10
        logger.debug("redis stats unavailable", exc_info=True)
        return {"redis": False, "broker_depth": 0, "workers": 0, "maintenance_workers": 0}


def queue_snapshot(db: Session) -> dict:
    counts = dict(db.query(ExportJob.status, func.count()).group_by(ExportJob.status).all())
    oldest = db.scalar(select(func.extract("epoch", func.now() - func.min(ExportJob.queued_at))).where(ExportJob.status == QUEUED))
    stale = db.scalar(
        select(func.count()).where(
            ExportJob.status.in_(ACTIVE),
            func.coalesce(ExportJob.heartbeat_at, ExportJob.started_at, ExportJob.queued_at) < func.now() - timedelta(seconds=settings.export_heartbeat_stale_seconds),
        )
    )
    return {
        "states": {state: int(counts.get(state, 0)) for state in ALL_STATES},
        "oldest_queued_seconds": round(float(oldest), 1) if oldest is not None else 0.0,
        "stale": int(stale or 0),
        **redis_stats(),
    }


def recent_timings(db: Session) -> dict[str, list[dict]]:
    """Queue wait and build duration percentiles over the metrics window."""
    window = f"interval '{int(settings.metrics_window_minutes)} minutes'"
    wait = db.execute(
        text(
            "SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM started_at - queued_at)), "
            "percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM started_at - queued_at)) "
            f"FROM exports WHERE started_at IS NOT NULL AND started_at > now() - {window}"
        )
    ).one()
    durations = db.execute(
        text(
            "SELECT export_type, count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at)), "
            "percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM finished_at - started_at)), max(rss_mb) "
            f"FROM exports WHERE status = 'completed' AND started_at IS NOT NULL AND finished_at > now() - {window} GROUP BY export_type"
        )
    ).all()
    return {
        "queue_wait": [{"count": wait[0], "p50": float(wait[1] or 0), "p95": float(wait[2] or 0)}],
        "duration": [{"format": r[0], "count": r[1], "p50": float(r[2] or 0), "p95": float(r[3] or 0), "max_rss_mb": r[4] or 0} for r in durations],
    }
