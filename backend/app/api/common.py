from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, Query

PAGE_LIMIT_MAX = 500


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


def like_pattern(query: str) -> str:
    """Escape LIKE wildcards so user input is matched literally (use with escape="\\")."""
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def join_tags(tags: list[str]) -> str:
    cleaned: list[str] = []
    for tag in tags:
        value = tag.replace(",", " ").strip().lower()[:40]
        if value and value not in cleaned:
            cleaned.append(value)
    return ",".join(cleaned)


def split_tags(stored: str | None) -> list[str]:
    return [tag for tag in (stored or "").split(",") if tag]


def limit_query(default: int = 100) -> int:
    return Query(default=default, ge=1, le=PAGE_LIMIT_MAX)


def offset_query() -> int:
    return Query(default=0, ge=0)
