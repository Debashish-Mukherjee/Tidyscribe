import os

from app.config import settings


def test_suite_never_points_at_the_application_database() -> None:
    assert settings.database_url.rsplit("/", 1)[-1].endswith("_test")
    assert os.environ["DATABASE_URL"] == settings.database_url


def test_exports_are_written_to_a_temporary_directory() -> None:
    from app import main

    assert not str(main.storage.base_dir).startswith("/app/data")
