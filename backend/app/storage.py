from __future__ import annotations

import os
from pathlib import Path
from typing import Protocol

from app.config import settings


class StorageProvider(Protocol):
    def save_file(self, relative_path: str, content: bytes) -> str:
        ...

    def get_file(self, relative_path: str) -> bytes:
        ...

    def delete_file(self, relative_path: str) -> None:
        ...

    def file_exists(self, relative_path: str) -> bool:
        ...

    def generate_download_url(self, relative_path: str) -> str:
        ...


class LocalFilesystemStorageProvider:
    def __init__(self, base_dir: str = "/app/data") -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save_file(self, relative_path: str, content: bytes) -> str:
        target = self.base_dir / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        # Write then rename so a killed worker never leaves a half-written file at the final path.
        partial = target.with_name(f"{target.name}.{os.getpid()}.part")
        partial.write_bytes(content)
        os.replace(partial, target)
        return str(target)

    def get_file(self, relative_path: str) -> bytes:
        target = self.base_dir / relative_path
        if not target.exists():
            raise FileNotFoundError(relative_path)
        return target.read_bytes()

    def delete_file(self, relative_path: str) -> None:
        target = self.base_dir / relative_path
        if target.exists():
            target.unlink()

    def file_exists(self, relative_path: str) -> bool:
        return (self.base_dir / relative_path).exists()

    def generate_download_url(self, relative_path: str) -> str:
        return f"file://{(self.base_dir / relative_path).as_posix()}"


storage = LocalFilesystemStorageProvider(settings.data_dir)
