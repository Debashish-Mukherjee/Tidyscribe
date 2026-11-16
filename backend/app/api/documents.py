from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.common import like_pattern, limit_query, not_found, offset_query, utcnow
from app.database import get_db
from app.models import Document, DocumentVersion
from app.schemas import DocumentCreate, DocumentOut, DocumentRestore, DocumentUpdate, DocumentVersionOut

router = APIRouter(prefix="/api/documents", tags=["documents"])

MAX_VERSIONS = 50


def _out(document: Document) -> DocumentOut:
    return DocumentOut(
        id=document.id,
        title=document.title,
        content=document.content,
        preview_html=document.preview_html,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def get_document(db: Session, document_id: str, *, lock: bool = False) -> Document:
    query = db.query(Document).filter(Document.id == document_id, Document.deleted_at.is_(None))
    # Serialize mutations before checking the revision; two simultaneous stale saves
    # must not both pass the check. Refresh any identity-map entry after waiting.
    if lock:
        query = query.with_for_update().populate_existing()
    document = query.first()
    if document is None:
        raise not_found("Document")
    return document


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def check_revision(document: Document, expected: datetime | None) -> None:
    if expected is not None and document.updated_at is not None and _utc(expected) != _utc(document.updated_at):
        raise HTTPException(status_code=409, detail="This document was changed somewhere else after you opened it")


def _prune_versions(db: Session, document_id: str) -> None:
    stale = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.created_at.desc(), DocumentVersion.id)
        .offset(MAX_VERSIONS)
        .all()
    )
    for version in stale:
        db.delete(version)


@router.get("", response_model=list[DocumentOut])
def list_documents(
    q: str | None = None,
    limit: int = limit_query(),
    offset: int = offset_query(),
    db: Session = Depends(get_db),
) -> list[DocumentOut]:
    query = db.query(Document).filter(Document.deleted_at.is_(None))
    if q:
        pattern = like_pattern(q)
        query = query.filter(or_(Document.title.ilike(pattern, escape="\\"), Document.content.ilike(pattern, escape="\\")))
    documents = query.order_by(Document.updated_at.desc(), Document.id).offset(offset).limit(limit).all()
    return [_out(document) for document in documents]


@router.post("", response_model=DocumentOut)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db)) -> DocumentOut:
    document = Document(title=payload.title, content=payload.content)
    db.add(document)
    db.commit()
    db.refresh(document)
    return _out(document)


@router.get("/{document_id}", response_model=DocumentOut)
def read_document(document_id: str, db: Session = Depends(get_db)) -> DocumentOut:
    return _out(get_document(db, document_id))


@router.put("/{document_id}", response_model=DocumentOut)
def update_document(document_id: str, payload: DocumentUpdate, db: Session = Depends(get_db)) -> DocumentOut:
    document = get_document(db, document_id, lock=True)
    check_revision(document, payload.expected_updated_at)
    if payload.content is not None and payload.content != document.content:
        db.add(DocumentVersion(document_id=document.id, content=document.content))
        document.content = payload.content
        document.updated_at = func.clock_timestamp()
        db.flush()
        _prune_versions(db, document.id)
    if payload.title is not None:
        document.title = payload.title
    if db.is_modified(document):
        document.updated_at = func.clock_timestamp()
    db.commit()
    db.refresh(document)
    return _out(document)


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, db: Session = Depends(get_db)) -> Response:
    document = get_document(db, document_id, lock=True)
    document.deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.get("/{document_id}/versions", response_model=list[DocumentVersionOut])
def list_versions(document_id: str, db: Session = Depends(get_db)) -> list[DocumentVersionOut]:
    get_document(db, document_id)
    versions = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.created_at.desc(), DocumentVersion.id)
        .all()
    )
    return [
        DocumentVersionOut(id=v.id, document_id=v.document_id, content=v.content, created_at=v.created_at)
        for v in versions
    ]


@router.post("/{document_id}/versions/{version_id}/restore", response_model=DocumentOut)
def restore_version(document_id: str, version_id: str, payload: DocumentRestore | None = Body(default=None), db: Session = Depends(get_db)) -> DocumentOut:
    document = get_document(db, document_id, lock=True)
    check_revision(document, payload.expected_updated_at if payload else None)
    version = (
        db.query(DocumentVersion)
        .filter(DocumentVersion.id == version_id, DocumentVersion.document_id == document_id)
        .first()
    )
    if version is None:
        raise not_found("Version")
    if version.content != document.content:
        db.add(DocumentVersion(document_id=document.id, content=document.content))
        document.content = version.content
        document.updated_at = func.clock_timestamp()
        db.flush()
        _prune_versions(db, document.id)
    db.commit()
    db.refresh(document)
    return _out(document)
