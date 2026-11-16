from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.schemas import ConvertDiagramRequest
from app.services.diagram_service import convert_diagram_with_notes, expand_plantuml

router = APIRouter(prefix="/api", tags=["diagrams"])


class ConvertDiagramResponse(BaseModel):
    content: str
    target: str
    media_type: str
    extension: str
    warnings: list[str] = Field(default_factory=list)


class ExpandDiagramsRequest(BaseModel):
    markdown: str = Field(..., max_length=2_000_000)


class ExpandDiagramsResponse(BaseModel):
    markdown: str
    converted: int
    unsupported: int


@router.post("/convert-diagram", response_model=ConvertDiagramResponse)
def convert(payload: ConvertDiagramRequest) -> ConvertDiagramResponse:
    try:
        content, media_type, extension, warnings = convert_diagram_with_notes(payload.source, payload.target, payload.source_format)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return ConvertDiagramResponse(content=content, target=payload.target, media_type=media_type, extension=extension, warnings=warnings)


@router.post("/expand-diagrams", response_model=ExpandDiagramsResponse)
def expand(payload: ExpandDiagramsRequest) -> ExpandDiagramsResponse:
    """Replace convertible PlantUML blocks in markdown with Mermaid fences."""
    result = expand_plantuml(payload.markdown)
    return ExpandDiagramsResponse(markdown=result.markdown, converted=result.converted, unsupported=result.unsupported)
