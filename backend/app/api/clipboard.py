from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.common import join_tags, like_pattern, limit_query, not_found, split_tags, utcnow
from app.database import get_db
from app.models import ClipboardItem
from app.schemas import ClipboardItemCreate, ClipboardItemOut, ClipboardItemUpdate

router = APIRouter(prefix="/api/clipboard", tags=["clipboard"])

HISTORY_LIMIT = 100


def _out(item: ClipboardItem) -> ClipboardItemOut:
    return ClipboardItemOut(
        id=item.id,
        content=item.content,
        source=item.source,
        tags=split_tags(item.tags),
        pinned=item.pinned,
        created_at=item.created_at,
    )


def _get(db: Session, item_id: str, include_deleted: bool = False) -> ClipboardItem:
    query = db.query(ClipboardItem).filter(ClipboardItem.id == item_id)
    if not include_deleted:
        query = query.filter(ClipboardItem.deleted_at.is_(None))
    item = query.first()
    if item is None:
        raise not_found("Clipboard item")
    return item


def _trim_history(db: Session) -> None:
    """Keep only the newest HISTORY_LIMIT unpinned items; pinned items never expire."""
    overflow = (
        db.query(ClipboardItem)
        .filter(ClipboardItem.deleted_at.is_(None), ClipboardItem.pinned.is_(False))
        .order_by(ClipboardItem.created_at.desc(), ClipboardItem.id)
        .offset(HISTORY_LIMIT)
        .all()
    )
    for item in overflow:
        item.deleted_at = utcnow()


@router.get("", response_model=list[ClipboardItemOut])
def list_clipboard(
    q: str | None = None,
    tag: str | None = None,
    pinned: bool | None = None,
    limit: int = limit_query(HISTORY_LIMIT),
    db: Session = Depends(get_db),
) -> list[ClipboardItemOut]:
    query = db.query(ClipboardItem).filter(ClipboardItem.deleted_at.is_(None))
    if pinned is not None:
        query = query.filter(ClipboardItem.pinned.is_(pinned))
    if tag:
        wanted = join_tags([tag])
        if wanted:
            query = query.filter(func.concat(",", ClipboardItem.tags, ",").ilike(like_pattern(f",{wanted},"), escape="\\"))
    if q:
        query = query.filter(ClipboardItem.content.ilike(like_pattern(q), escape="\\"))
    items = query.order_by(ClipboardItem.pinned.desc(), ClipboardItem.created_at.desc(), ClipboardItem.id).limit(limit).all()
    return [_out(i) for i in items]


@router.post("", response_model=ClipboardItemOut, status_code=201)
def add_clipboard(payload: ClipboardItemCreate, db: Session = Depends(get_db)) -> ClipboardItemOut:
    item = ClipboardItem(content=payload.content, source=payload.source, tags=join_tags(payload.tags))
    db.add(item)
    db.flush()
    _trim_history(db)
    db.commit()
    db.refresh(item)
    return _out(item)


@router.get("/{item_id}", response_model=ClipboardItemOut)
def read_clipboard(item_id: str, db: Session = Depends(get_db)) -> ClipboardItemOut:
    return _out(_get(db, item_id))


@router.put("/{item_id}", response_model=ClipboardItemOut)
def update_clipboard(item_id: str, payload: ClipboardItemUpdate, db: Session = Depends(get_db)) -> ClipboardItemOut:
    item = _get(db, item_id)
    if payload.tags is not None:
        item.tags = join_tags(payload.tags)
    if payload.pinned is not None:
        item.pinned = payload.pinned
    db.commit()
    db.refresh(item)
    return _out(item)


@router.delete("/{item_id}", status_code=204)
def delete_clipboard(item_id: str, db: Session = Depends(get_db)) -> Response:
    _get(db, item_id).deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/{item_id}/restore", response_model=ClipboardItemOut)
def restore_clipboard(item_id: str, db: Session = Depends(get_db)) -> ClipboardItemOut:
    """Undo a delete."""
    item = _get(db, item_id, include_deleted=True)
    item.deleted_at = None
    db.flush()
    _trim_history(db)
    db.commit()
    db.refresh(item)
    return _out(item)
