from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "Tidyscribe API"
    uptime_seconds: float | None = None
    memory_mb: int | None = None
    database: str | None = None
    queue: dict | None = None


class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    content: str = Field(default="", max_length=2_000_000)


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, max_length=2_000_000)
    # The `updated_at` the client last saw; a different current value means someone else saved in between.
    expected_updated_at: datetime | None = None


class DocumentOut(BaseModel):
    id: str
    title: str
    content: str
    preview_html: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DocumentVersionOut(BaseModel):
    id: str
    document_id: str
    content: str
    created_at: datetime | None = None


class TemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(default="general", min_length=1, max_length=100)
    body: str = Field(default="", max_length=500_000)


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    body: str | None = Field(default=None, max_length=500_000)


class TemplateOut(BaseModel):
    id: str
    name: str
    category: str
    body: str


class SnippetCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    body: str = Field(default="", max_length=500_000)
    category: str = Field(default="general", min_length=1, max_length=120)
    tags: list[str] = Field(default_factory=list, max_length=20)
    favorite: bool = False


class SnippetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    body: str | None = Field(default=None, max_length=500_000)
    category: str | None = Field(default=None, min_length=1, max_length=120)
    tags: list[str] | None = Field(default=None, max_length=20)
    favorite: bool | None = None
    archived: bool | None = None


class SnippetOut(BaseModel):
    id: str
    title: str
    body: str
    category: str
    tags: list[str] = Field(default_factory=list)
    favorite: bool = False
    archived: bool = False


class ClipboardItemCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=500_000)
    source: str | None = Field(default=None, max_length=255)
    tags: list[str] = Field(default_factory=list, max_length=20)


class ClipboardItemUpdate(BaseModel):
    tags: list[str] | None = Field(default=None, max_length=20)
    pinned: bool | None = None


class ClipboardItemOut(BaseModel):
    id: str
    content: str
    source: str | None = None
    tags: list[str] = Field(default_factory=list)
    pinned: bool = False
    created_at: datetime | None = None


class SettingValue(BaseModel):
    value: str = Field(..., max_length=10_000)


class ConvertDiagramRequest(BaseModel):
    source: str = Field(..., min_length=1, max_length=100_000)
    target: Literal["mermaid", "svg", "drawio"] = "mermaid"
    source_format: Literal["auto", "ascii", "plantuml", "drawio", "terraform", "kubernetes"] = "auto"


class TransformRequest(BaseModel):
    text: str = Field(..., max_length=2_000_000)
    tone: Literal["Solution Design", "HLD", "LLD", "ADR", "RFC", "Runbook", "Operational Guide"] = "Solution Design"


class ChangeOut(BaseModel):
    rule: str
    label: str
    count: int
    examples: list[str] = Field(default_factory=list)


class TransformResponse(BaseModel):
    changes: list[ChangeOut] = Field(default_factory=list)
    removed: int = 0
    changed: bool = False
    cleaned_text: str
    summary: str


class DiagramImage(BaseModel):
    source: str = Field(..., max_length=100_000)
    png_base64: str = Field(..., max_length=7_000_000)


class ExportJobOut(BaseModel):
    job_id: str
    status: Literal["queued", "starting", "processing", "completed", "failed", "cancelled", "timed_out"]
    type: str
    file_url: str | None = None
    error: str | None = None
    failure_reason: str | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    heartbeat_at: datetime | None = None


class ExportRequest(BaseModel):
    document_id: str | None = None
    # Alternative to `document_id`: export this text without saving a document.
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = Field(default=None, max_length=2_000_000)
    # The HTML the Preview showed for `content`; exports follow it so they match what the user saw.
    html: str | None = Field(default=None, max_length=6_000_000)
    format: Literal["markdown", "docx", "pdf", "html"] = "markdown"
    diagrams: list[DiagramImage] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "ExportRequest":
        if (self.document_id is None) == (self.content is None):
            raise ValueError("Provide either document_id or content")
        if self.html is not None and self.content is None:
            raise ValueError("html is only accepted together with content")
        return self
