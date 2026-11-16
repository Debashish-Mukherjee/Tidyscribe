from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.common import like_pattern, limit_query, not_found, offset_query, utcnow
from app.database import get_db
from app.models import Template
from app.schemas import TemplateCreate, TemplateOut, TemplateUpdate

router = APIRouter(prefix="/api/templates", tags=["templates"])


def _out(template: Template) -> TemplateOut:
    return TemplateOut(id=template.id, name=template.name, category=template.category, body=template.body)


def _get(db: Session, template_id: str) -> Template:
    template = db.query(Template).filter(Template.id == template_id, Template.deleted_at.is_(None)).first()
    if template is None:
        raise not_found("Template")
    return template


@router.get("", response_model=list[TemplateOut])
def list_templates(
    q: str | None = None,
    category: str | None = None,
    limit: int = limit_query(),
    offset: int = offset_query(),
    db: Session = Depends(get_db),
) -> list[TemplateOut]:
    query = db.query(Template).filter(Template.deleted_at.is_(None))
    if category:
        query = query.filter(Template.category == category)
    if q:
        pattern = like_pattern(q)
        query = query.filter(or_(Template.name.ilike(pattern, escape="\\"), Template.body.ilike(pattern, escape="\\")))
    return [_out(t) for t in query.order_by(Template.created_at, Template.name).offset(offset).limit(limit).all()]


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(payload: TemplateCreate, db: Session = Depends(get_db)) -> TemplateOut:
    existing = db.query(Template).filter(Template.name == payload.name).first()
    if existing is not None and existing.deleted_at is None:
        raise HTTPException(status_code=409, detail=f"Template '{payload.name}' already exists")
    if existing is not None:
        existing.category, existing.body, existing.deleted_at = payload.category, payload.body, None
        template = existing
    else:
        template = Template(name=payload.name, category=payload.category, body=payload.body)
        db.add(template)
    db.commit()
    db.refresh(template)
    return _out(template)


@router.get("/{template_id}", response_model=TemplateOut)
def read_template(template_id: str, db: Session = Depends(get_db)) -> TemplateOut:
    return _out(_get(db, template_id))


@router.put("/{template_id}", response_model=TemplateOut)
def update_template(template_id: str, payload: TemplateUpdate, db: Session = Depends(get_db)) -> TemplateOut:
    template = _get(db, template_id)
    if payload.name is not None and payload.name != template.name:
        clash = db.query(Template).filter(Template.name == payload.name, Template.id != template.id).first()
        if clash is not None:
            raise HTTPException(status_code=409, detail=f"Template '{payload.name}' already exists")
        template.name = payload.name
    if payload.category is not None:
        template.category = payload.category
    if payload.body is not None:
        template.body = payload.body
    db.commit()
    db.refresh(template)
    return _out(template)


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db)) -> Response:
    _get(db, template_id).deleted_at = utcnow()
    db.commit()
    return Response(status_code=204)
