from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.common import join_tags, like_pattern, limit_query, not_found, offset_query, split_tags, utcnow
from app.database import get_db
from app.models import Snippet
from app.schemas import SnippetCreate, SnippetOut, SnippetUpdate

router = APIRouter(prefix="/api/snippets", tags=["snippets"])


def _out(snippet: Snippet) -> SnippetOut:
    return SnippetOut(
        id=snippet.id,
        title=snippet.title,
        body=snippet.body,
        category=snippet.category,
        tags=split_tags(snippet.tags),
        favorite=snippet.favorite,
        archived=snippet.archived,
    )


def _get(db: Session, snippet_id: str) -> Snippet:
    snippet = db.query(Snippet).filter(Snippet.id == snippet_id, Snippet.deleted_at.is_(None)).first()
    if snippet is None:
        raise not_found("Snippet")
    return snippet


@router.get("", response_model=list[SnippetOut])
def list_snippets(
    q: str | None = None,
    category: str | None = None,
    tag: str | None = None,
    favorite: bool | None = None,
    archived: bool = False,
    limit: int = limit_query(),
    offset: int = offset_query(),
    db: Session = Depends(get_db),
) -> list[SnippetOut]:
    query = db.query(Snippet).filter(Snippet.deleted_at.is_(None), Snippet.archived.is_(archived))
    if category:
        query = query.filter(Snippet.category == category)
    if favorite is not None:
        query = query.filter(Snippet.favorite.is_(favorite))
    if tag:
        wanted = join_tags([tag])
        if wanted:
            query = query.filter(func.concat(",", Snippet.tags, ",").ilike(like_pattern(f",{wanted},"), escape="\\"))
    if q:
        pattern = like_pattern(q)
        query = query.filter(
            or_(
                Snippet.title.ilike(pattern, escape="\\"),
                Snippet.body.ilike(pattern, escape="\\"),
                Snippet.tags.ilike(pattern, escape="\\"),
                Snippet.category.ilike(pattern, escape="\\"),
            )
        )
    snippets = query.order_by(Snippet.favorite.desc(), Snippet.created_at.desc(), Snippet.id).offset(offset).limit(limit).all()
    return [_out(s) for s in snippets]


@router.post("", response_model=SnippetOut, status_code=201)
def create_snippet(payload: SnippetCreate, db: Session = Depends(get_db)) -> SnippetOut:
    snippet = Snippet(
        title=payload.title,
        body=payload.body,
        category=payload.category,
        tags=join_tags(payload.tags),
        favorite=payload.favorite,
    )
    db.add(snippet)
    db.commit()
    db.refresh(snippet)
    return _out(snippet)


@router.get("/{snippet_id}", response_model=SnippetOut)
def read_snippet(snippet_id: str, db: Session = Depends(get_db)) -> SnippetOut:
    return _out(_get(db, snippet_id))


@router.put("/{snippet_id}", response_model=SnippetOut)
def update_snippet(snippet_id: str, payload: SnippetUpdate, db: Session = Depends(get_db)) -> SnippetOut:
    snippet = _get(db, snippet_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "tags" in changes:
        changes["tags"] = join_tags(changes["tags"])
    for field, value in changes.items():
        setattr(snippet, field, value)
    db.commit()
    db.refresh(snippet)
    return _out(snippet)


@router.delete("/{snippet_id}", status_code=204)
def delete_snippet(snippet_id: str, db: Session = Depends(get_db)) -> Response:
    _get(db, snippet_id).deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)
