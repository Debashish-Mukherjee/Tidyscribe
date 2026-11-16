"""Export entry point: optional server-side Mermaid rendering and the Pandoc/LibreOffice engine.

The pure-Python writers in export_service are always the fallback, so a missing or failing tool never fails an export.
"""
from __future__ import annotations

import base64
import logging
import re

from markdown_it import MarkdownIt

from app.config import settings
from app.services import cli_pipeline
from app.services.diagram_service import expand_plantuml
from app.services.export_service import (
    FORMATS,
    Diagram,
    _diagram_key,
    _fence_ascii_diagrams,
    build_export as build_python_export,
    load_diagrams,
    parse_document,
)

logger = logging.getLogger("app.export")


def mermaid_sources(markdown: str, html_source: str | None = None) -> list[str]:
    """Normalised source of every distinct Mermaid fence, in document order (PlantUML already expanded)."""
    seen: dict[str, None] = {}
    for node in parse_document(markdown, html_source).walk():
        if node.type == "fence" and node.info.strip().split(" ")[0].lower() == "mermaid":
            seen.setdefault(_diagram_key(node.content), None)
    return list(seen)


def with_server_diagrams(markdown: str, diagrams: dict[str, Diagram], html_source: str | None = None) -> dict[str, Diagram]:
    """Add images for Mermaid blocks the client did not upload, when the Mermaid CLI is installed."""
    if not settings.server_mermaid or not cli_pipeline.has_mermaid_cli():
        return diagrams
    missing = [source for source in mermaid_sources(markdown, html_source) if source not in diagrams][: settings.server_mermaid_limit]
    if not missing:
        return diagrams
    merged = dict(diagrams)
    for source in missing:
        try:
            png = cli_pipeline.mermaid_png(source)
            merged.update(load_diagrams([(source, base64.b64encode(png).decode("ascii"))]))
        except (cli_pipeline.ToolError, ValueError) as exc:
            logger.warning("server-side mermaid render failed", extra={"error": str(exc)})
    return merged


def markdown_with_inline_diagrams(markdown: str, diagrams: dict[str, Diagram]) -> str:
    """Swap Mermaid fences that have an image for `![](data:...)` lines; other fences stay as code blocks."""
    source = _fence_ascii_diagrams(expand_plantuml(markdown.replace("\r\n", "\n")).markdown)
    lines = source.split("\n")
    tokens = MarkdownIt("gfm-like", options_update={"html": False}).parse(source)
    for token in reversed(tokens):
        if token.type != "fence" or token.map is None or token.info.strip().split(" ")[0].lower() != "mermaid":
            continue
        diagram = diagrams.get(_diagram_key(token.content))
        if diagram is None:
            continue
        indent = re.match(r"[ \t]*", lines[token.map[0]]).group(0)  # type: ignore[union-attr]
        lines[token.map[0]:token.map[1]] = [f"{indent}![Diagram]({cli_pipeline.png_data_uri(diagram.png)})"]
    return "\n".join(lines)


def _pandoc_export(content: str, export_format: str, diagrams: dict[str, Diagram]) -> tuple[str, str, bytes] | None:
    if not cli_pipeline.has_pandoc() or (export_format == "pdf" and not cli_pipeline.has_libreoffice()):
        return None
    docx = cli_pipeline.pandoc_docx(markdown_with_inline_diagrams(content, diagrams))
    extension, media_type = FORMATS[export_format]
    return extension, media_type, docx if export_format == "docx" else cli_pipeline.libreoffice_pdf(docx)


def build_export(title: str, content: str, export_format: str, diagrams: dict[str, Diagram], html_source: str | None = None) -> tuple[str, str, bytes]:
    """Return (file extension, media type, bytes)."""
    text = content if content.strip() else f"# {title}"
    diagrams = with_server_diagrams(text, diagrams, html_source)
    if settings.export_engine == "pandoc" and export_format in ("docx", "pdf"):
        try:
            result = _pandoc_export(text, export_format, diagrams)
            if result is not None:
                return result
            logger.warning("pandoc engine selected but tools are missing; using the built-in writer", extra={"format": export_format})
        except cli_pipeline.ToolError as exc:
            logger.warning("pandoc engine failed; using the built-in writer", extra={"format": export_format, "error": str(exc)})
    return build_python_export(title, content, export_format, diagrams, html_source)
