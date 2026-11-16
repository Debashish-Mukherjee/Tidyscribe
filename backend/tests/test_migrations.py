import os

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from app.config import settings
from app.database import Base, engine
from app.migrations import BASELINE_REVISION, alembic_config, run_migrations


def _scratch_url(suffix: str) -> str:
    url = make_url(settings.database_url)
    return url.set(database=f"{url.database}_{suffix}").render_as_string(hide_password=False)


@pytest.fixture
def scratch_db():
    created: list[str] = []

    def make(suffix: str) -> str:
        url = _scratch_url(suffix)
        name = make_url(url).database
        admin = create_engine(make_url(url).set(database="postgres"), isolation_level="AUTOCOMMIT")
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            connection.execute(text(f'CREATE DATABASE "{name}"'))
        admin.dispose()
        created.append(name)
        return url

    yield make

    admin = create_engine(make_url(settings.database_url).set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        for name in created:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
    admin.dispose()


def test_models_and_migrations_agree() -> None:
    """Fails when someone changes a model without adding a migration."""
    with engine.connect() as connection:
        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    assert differences == []


def test_test_database_is_at_head_revision() -> None:
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0003"


def test_upgrade_and_full_downgrade_roundtrip(scratch_db) -> None:
    url = scratch_db("roundtrip")
    config = alembic_config(url)
    command.upgrade(config, "head")
    scratch = create_engine(url)
    assert {"documents", "exports", "snippets", "alembic_version"} <= set(inspect(scratch).get_table_names())
    assert "error" in {column["name"] for column in inspect(scratch).get_columns("exports")}

    command.downgrade(config, "0002")
    assert "heartbeat_at" not in {column["name"] for column in inspect(scratch).get_columns("exports")}
    command.downgrade(config, "0001")
    assert "error" not in {column["name"] for column in inspect(scratch).get_columns("exports")}
    command.downgrade(config, "base")
    assert set(inspect(scratch).get_table_names()) == {"alembic_version"}
    scratch.dispose()


def test_database_created_before_alembic_is_adopted_without_data_loss(scratch_db) -> None:
    url = scratch_db("legacy")
    legacy = create_engine(url)
    command.upgrade(alembic_config(url), BASELINE_REVISION)  # same schema create_all produced
    with legacy.begin() as connection:
        connection.execute(text("DROP TABLE alembic_version"))
        connection.execute(text("INSERT INTO documents (id, title, content) VALUES ('d1', 'Keep me', 'body')"))

    run_migrations(url)

    with legacy.connect() as connection:
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0003"
        assert connection.execute(text("SELECT title FROM documents WHERE id = 'd1'")).scalar() == "Keep me"
        assert "error" in {column["name"] for column in inspect(connection).get_columns("exports")}
    legacy.dispose()


def test_fresh_database_and_repeated_runs_are_safe(scratch_db) -> None:
    url = scratch_db("fresh")
    run_migrations(url)
    run_migrations(url)  # idempotent
    fresh = create_engine(url)
    assert "documents" in inspect(fresh).get_table_names()
    fresh.dispose()


def test_programmatic_runs_keep_application_logging() -> None:
    import logging

    before = list(logging.getLogger().handlers)
    run_migrations()
    assert logging.getLogger().handlers == before
    assert os.environ["DATABASE_URL"].endswith("_test")
