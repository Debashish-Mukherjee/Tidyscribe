"""Test isolation: run against a dedicated `<db>_test` database, a temporary data directory and inline Celery.

This module must configure the environment before any `app.*` import, because settings and the engine are built at import time.
"""
import os
import tempfile

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def _use_test_database() -> None:
    url = make_url(os.environ.get("DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/docworkbench"))
    name = url.database or "docworkbench"
    test_name = name if name.endswith("_test") else f"{name}_test"
    if not test_name.endswith("_test"):  # pragma: no cover - defensive
        raise RuntimeError("Refusing to run tests against a non-test database")

    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        exists = connection.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": test_name}).scalar()
        if not exists:
            connection.execute(text(f'CREATE DATABASE "{test_name}"'))
    admin.dispose()
    os.environ["DATABASE_URL"] = url.set(database=test_name).render_as_string(hide_password=False)


_use_test_database()
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="docworkbench-test-")
os.environ["CELERY_EAGER"] = "true"


@pytest.fixture(scope="session", autouse=True)
def _fresh_schema():
    from app.database import engine
    from app.migrations import run_migrations

    # Wipe the whole throwaway schema; dropping "known" tables would depend on which models happen to be imported.
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    run_migrations()
    yield
    engine.dispose()
