import base64
import io
import shutil
import struct
import zlib
from unittest.mock import patch

import pytest
from docx import Document as DocxDocument

from app.config import settings
from app.services import cli_pipeline, export_pipeline
from app.services.export_service import load_diagrams


def _png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)
    rows = b"".join(b"\x00" + b"\xff\x00\x00" * 8 for _ in range(8))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


MERMAID = "flowchart LR\n  A --> B"
DOC = f"# Title\n\n```mermaid\n{MERMAID}\n```\n\n- item\n"


def _diagrams() -> dict:
    return load_diagrams([(MERMAID, base64.b64encode(_png()).decode())])


def test_mermaid_fences_with_images_become_data_uri_images_and_others_stay_code() -> None:
    other = "```mermaid\nflowchart TD\n  X --> Y\n```"
    markdown = export_pipeline.markdown_with_inline_diagrams(f"{DOC}\n{other}\n\n+---+\n| A |\n+---+\n", _diagrams())
    assert "![Diagram](data:image/png;base64," in markdown
    assert "```mermaid\nflowchart LR" not in markdown
    assert other in markdown
    assert "```text\n+---+" in markdown  # ASCII boxes are fenced like in the built-in writers


def test_indentation_of_a_fence_inside_a_list_is_kept() -> None:
    markdown = export_pipeline.markdown_with_inline_diagrams(f"- step\n\n  ```mermaid\n  {MERMAID.replace(chr(10), chr(10) + '  ')}\n  ```\n", _diagrams())
    assert "\n  ![Diagram](data:image/png" in markdown


def test_mermaid_sources_are_distinct_and_include_expanded_plantuml() -> None:
    markdown = f"```mermaid\n{MERMAID}\n```\n```mermaid\n{MERMAID}\n```\n```plantuml\nA -> B: hi\n```"
    sources = export_pipeline.mermaid_sources(markdown)
    assert len(sources) == 2 and sources[0] == MERMAID and sources[1].startswith("sequenceDiagram")


def test_server_side_rendering_fills_only_missing_diagrams() -> None:
    calls: list[str] = []

    def fake(source: str) -> bytes:
        calls.append(source)
        return _png()

    with patch.object(cli_pipeline, "has_mermaid_cli", return_value=True), patch.object(cli_pipeline, "mermaid_png", side_effect=fake):
        merged = export_pipeline.with_server_diagrams(f"{DOC}\n```mermaid\nflowchart TD\n  X --> Y\n```", _diagrams())
    assert calls == ["flowchart TD\n  X --> Y"]
    assert len(merged) == 2


def test_server_side_rendering_is_skipped_without_the_cli_or_when_disabled(monkeypatch) -> None:
    with patch.object(cli_pipeline, "has_mermaid_cli", return_value=False), patch.object(cli_pipeline, "mermaid_png") as render:
        assert export_pipeline.with_server_diagrams(DOC, {}) == {}
    render.assert_not_called()
    monkeypatch.setattr(settings, "server_mermaid", False)
    with patch.object(cli_pipeline, "has_mermaid_cli", return_value=True), patch.object(cli_pipeline, "mermaid_png") as render:
        export_pipeline.with_server_diagrams(DOC, {})
    render.assert_not_called()


def test_a_failed_server_render_is_skipped_not_fatal() -> None:
    with patch.object(cli_pipeline, "has_mermaid_cli", return_value=True), patch.object(cli_pipeline, "mermaid_png", side_effect=cli_pipeline.ToolError("boom")):
        assert export_pipeline.with_server_diagrams(DOC, {}) == {}


def test_python_engine_is_the_default_and_ignores_the_tools(monkeypatch) -> None:
    assert settings.export_engine == "python"
    with patch.object(cli_pipeline, "pandoc_docx") as pandoc:
        _, _, data = export_pipeline.build_export("t", DOC, "docx", {})
    pandoc.assert_not_called()
    assert DocxDocument(io.BytesIO(data)).paragraphs


def test_pandoc_engine_builds_docx_and_pdf_through_the_tools(monkeypatch) -> None:
    monkeypatch.setattr(settings, "export_engine", "pandoc")
    with (
        patch.object(cli_pipeline, "has_pandoc", return_value=True),
        patch.object(cli_pipeline, "has_libreoffice", return_value=True),
        patch.object(cli_pipeline, "pandoc_docx", return_value=b"DOCX") as pandoc,
        patch.object(cli_pipeline, "libreoffice_pdf", return_value=b"%PDF") as office,
    ):
        assert export_pipeline.build_export("t", DOC, "docx", _diagrams()) == ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b"DOCX")
        assert export_pipeline.build_export("t", DOC, "pdf", _diagrams())[2] == b"%PDF"
        sent = pandoc.call_args_list[0].args[0]
        assert "data:image/png;base64," in sent
        office.assert_called_once_with(b"DOCX")
        # Markdown and HTML never go through the tools.
        pandoc.reset_mock()
        export_pipeline.build_export("t", DOC, "html", {})
        pandoc.assert_not_called()


@pytest.mark.parametrize("failure", [cli_pipeline.ToolError("exploded"), cli_pipeline.ToolUnavailable("gone")])
def test_a_failing_tool_falls_back_to_the_builtin_writer(monkeypatch, failure) -> None:
    monkeypatch.setattr(settings, "export_engine", "pandoc")
    with patch.object(cli_pipeline, "has_pandoc", return_value=True), patch.object(cli_pipeline, "pandoc_docx", side_effect=failure):
        _, _, data = export_pipeline.build_export("t", DOC, "docx", {})
    assert DocxDocument(io.BytesIO(data)).paragraphs


def test_missing_tools_fall_back_to_the_builtin_writer(monkeypatch) -> None:
    monkeypatch.setattr(settings, "export_engine", "pandoc")
    with patch.object(cli_pipeline, "has_pandoc", return_value=False):
        _, _, data = export_pipeline.build_export("t", DOC, "pdf", {})
    assert data.startswith(b"%PDF")
    monkeypatch.setattr(settings, "export_engine", "pandoc")
    with patch.object(cli_pipeline, "has_pandoc", return_value=True), patch.object(cli_pipeline, "has_libreoffice", return_value=False):
        assert export_pipeline.build_export("t", DOC, "pdf", {})[2].startswith(b"%PDF")


def test_run_reports_failures_and_timeouts(monkeypatch) -> None:
    with pytest.raises(cli_pipeline.ToolError, match="exited with"):
        cli_pipeline._run(["sh", "-c", "echo bad >&2; exit 3"])
    monkeypatch.setattr(settings, "cli_timeout_seconds", 1)
    with pytest.raises(cli_pipeline.ToolError, match="timed out"):
        cli_pipeline._run(["sleep", "5"])


def test_missing_binaries_raise_tool_unavailable() -> None:
    with patch("shutil.which", return_value=None), pytest.raises(cli_pipeline.ToolUnavailable):
        cli_pipeline.pandoc_docx("# x")


def test_foreign_images_are_replaced_by_alt_text_and_png_data_uris_kept() -> None:
    def image(url: str, alt: str) -> dict:
        return {"t": "Image", "c": [["", [], []], [{"t": "Str", "c": alt}], [url, ""]]}

    tree = {"blocks": [{"t": "Para", "c": [image("/etc/passwd", "secret"), image("data:image/png;base64,AAAA", "ok"), image("http://x/y.png", "remote")]}]}
    cleaned = cli_pipeline._keep_only_png_data_images(tree)
    inlines = cleaned["blocks"][0]["c"]  # type: ignore[index]
    assert [item["t"] for item in inlines] == ["Str", "Image", "Str"]
    assert [item["c"] for item in inlines if item["t"] == "Str"] == ["secret", "remote"]


@pytest.mark.skipif(not cli_pipeline.has_mermaid_cli(), reason="mermaid-cli not installed")
def test_real_mermaid_cli_renders_a_png_and_rejects_bad_source() -> None:
    png = cli_pipeline.mermaid_png(MERMAID)
    assert png.startswith(b"\x89PNG")
    with pytest.raises(cli_pipeline.ToolError):
        cli_pipeline.mermaid_png("this is not mermaid")


@pytest.mark.skipif(not cli_pipeline.has_pandoc(), reason="pandoc not installed")
def test_real_pandoc_builds_docx_with_tables_and_diagrams_and_cannot_read_local_files(tmp_path) -> None:
    secret = tmp_path / "secret.png"
    secret.write_bytes(_png())
    markdown = export_pipeline.markdown_with_inline_diagrams(f"{DOC}\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![x]({secret})\n", _diagrams())
    document = DocxDocument(io.BytesIO(cli_pipeline.pandoc_docx(markdown)))
    assert len(document.tables) == 1
    media = [rel for rel in document.part.rels.values() if "image" in rel.reltype]
    assert len(media) == 1  # the diagram, not the local file


@pytest.mark.skipif(shutil.which("soffice") is None and shutil.which("libreoffice") is None, reason="LibreOffice not installed")
def test_real_libreoffice_converts_docx_to_pdf() -> None:
    pdf = cli_pipeline.libreoffice_pdf(export_pipeline.build_python_export("t", "# Hi\n\ntext", "docx", {})[2])
    assert pdf.startswith(b"%PDF")
