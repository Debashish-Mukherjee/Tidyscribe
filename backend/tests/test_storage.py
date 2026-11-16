from pathlib import Path

from app.storage import LocalFilesystemStorageProvider


def test_local_filesystem_storage_round_trip(tmp_path: Path) -> None:
    storage = LocalFilesystemStorageProvider(base_dir=str(tmp_path / "storage"))

    payload = b"hello world"
    path = storage.save_file("uploads/demo.txt", payload)

    assert path.endswith("uploads/demo.txt")
    assert storage.file_exists("uploads/demo.txt") is True
    assert storage.get_file("uploads/demo.txt") == payload

    storage.delete_file("uploads/demo.txt")
    assert storage.file_exists("uploads/demo.txt") is False


def test_local_filesystem_storage_generates_download_url(tmp_path: Path) -> None:
    storage = LocalFilesystemStorageProvider(base_dir=str(tmp_path / "storage"))

    storage.save_file("exports/report.pdf", b"pdf")

    url = storage.generate_download_url("exports/report.pdf")
    assert url.endswith("/exports/report.pdf")
