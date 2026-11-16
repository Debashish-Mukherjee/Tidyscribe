from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import settings

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE_REVISION = "0001"
_LOCK_KEY = 7351001  # arbitrary; serialises concurrent app starts


def alembic_config(url: str | None = None) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    config.attributes["url"] = url or settings.database_url
    config.attributes["configure_logger"] = False
    return config


def run_migrations(url: str | None = None) -> None:
    """Bring the database to the latest revision; adopt databases created before Alembic was introduced."""
    target = url or settings.database_url
    engine = create_engine(target, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as lock:
            lock.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _LOCK_KEY})
            try:
                tables = set(inspect(lock).get_table_names())
                config = alembic_config(target)
                if "alembic_version" not in tables and "documents" in tables:
                    logger.info("adopting existing schema", extra={"revision": BASELINE_REVISION})
                    command.stamp(config, BASELINE_REVISION)
                command.upgrade(config, "head")
            finally:
                lock.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _LOCK_KEY})
    finally:
        engine.dispose()
