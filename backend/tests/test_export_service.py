import base64
import io
import struct
import zipfile
import zlib
from pathlib import Path

import pytest
from docx import Document as DocxDocument
from lxml import etree
from pypdf import PdfReader

from app.services.export_service import _pdf_fonts, build_export, load_diagrams

SAMPLE = (Path(__file__).parent / "fixtures" / "order_platform.md").read_text()
FLOWCHART = SAMPLE.split("```mermaid\n", 1)[1].split("```", 1)[0]


def _png(width: int = 400, height: int = 200) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + b"\xff\x00\x00" * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


def _diagrams() -> dict:
    return load_diagrams([(FLOWCHART, base64.b64encode(_png()).decode())])


def _html(diagrams=None) -> str:
    return build_export("Order Processing Platform", SAMPLE, "html", diagrams or {})[2].decode()


def test_html_renders_every_construct_as_markup() -> None:
    html = _html()
    assert "<h1>Order Processing Platform</h1>" in html
    assert html.count("<h2>") == 12
    assert "<th>Requirement</th>" in html and "<td>Order Capture</td>" in html
    assert '<input type="checkbox" disabled checked>' in html
    assert '<input type="checkbox" disabled>' in html
    assert "<li>Authentication</li>" in html
    assert '<code class="language-python">' in html
    assert '<code class="language-yaml">' in html
    assert 'href="https://redis.io"' in html
    assert html.count("<hr>") >= 5
    # No raw markdown syntax may leak into the output.
    assert "## " not in html and "```" not in html and "[!WARNING]" not in html


def test_html_callouts_and_ascii_diagram() -> None:
    html = _html()
    assert 'class="callout callout-warning"' in html and ">Warning</p>" in html
    assert 'class="callout callout-tip"' in html
    assert "<blockquote><p>Inventory synchronization" in html
    ascii_block = html.split("<h2>ASCII Diagram</h2>")[1].split("</pre>")[0]
    assert "<pre>" in ascii_block
    assert "| API Gateway |" in ascii_block and "\n       |\n" in ascii_block


def test_html_mermaid_uses_image_when_available_else_source() -> None:
    without_images = _html()
    assert "data:image/png" not in without_images
    assert without_images.count("language-mermaid") == 2

    with_image = _html(_diagrams())
    assert with_image.count("data:image/png;base64,") == 1
    assert "Mermaid diagram (rendered image not available)" in with_image  # sequence diagram has no PNG


def test_html_escapes_raw_html() -> None:
    html = build_export("t", "<script>alert(1)</script>\n\n[x](javascript:alert(1))", "html", {})[2].decode()
    assert "<script>alert" not in html
    assert 'href="javascript' not in html


def test_docx_has_real_structure() -> None:
    _, media_type, data = build_export("Order Processing Platform", SAMPLE, "docx", _diagrams())
    assert "wordprocessingml" in media_type
    doc = DocxDocument(io.BytesIO(data))

    styles = [p.style.name for p in doc.paragraphs]
    assert styles.count("Heading 1") == 1
    assert styles.count("Heading 2") == 12
    assert "Heading 3" in styles
    assert "List Bullet" in styles

    assert len(doc.tables) == 1
    table = doc.tables[0]
    assert len(table.rows) == 6
    assert [c.text for c in table.rows[0].cells] == ["Requirement", "Priority", "Status"]
    assert table.rows[1].cells[0].text == "Order Capture"

    text = "\n".join(p.text for p in doc.paragraphs)
    assert "\u2611 Define APIs" in text and "\u2610 Build dashboard" in text
    assert "Warning" in text and "[!WARNING]" not in text
    assert "| API Gateway |" in text
    assert "## " not in text and "```" not in text
    assert len(doc.inline_shapes) == 1  # the flowchart PNG


def test_docx_is_valid_without_diagrams() -> None:
    data = build_export("t", SAMPLE, "docx", {})[2]
    doc = DocxDocument(io.BytesIO(data))
    assert len(doc.inline_shapes) == 0
    assert any("Mermaid diagram (rendered image not available)" in p.text for p in doc.paragraphs)


def test_docx_paragraph_properties_follow_schema_order() -> None:
    # Word rejects out-of-order pPr children that python-docx itself tolerates.
    order = [
        "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr",
        "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "spacing", "ind",
        "contextualSpacing", "jc", "outlineLvl", "rPr", "sectPr",
    ]
    data = build_export("t", SAMPLE, "docx", _diagrams())[2]
    root = etree.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml"))
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    for properties in root.iter(namespace + "pPr"):
        indexes = [order.index(child.tag.replace(namespace, "")) for child in properties]
        assert indexes == sorted(indexes)


def test_pdf_is_multipage_with_real_text() -> None:
    _, media_type, data = build_export("Order Processing Platform", SAMPLE, "pdf", _diagrams())
    assert media_type == "application/pdf" and data.startswith(b"%PDF-")
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) >= 3
    text = "\n".join(page.extract_text() for page in reader.pages)
    for expected in ("Order Processing Platform", "Order Capture", "Payment Validation", "class OrderProcessor"):
        assert expected in text
    assert "\u2611 Define APIs" in text and "\u2610 Build dashboard" in text
    assert "[x]" not in text and "[ ]" not in text
    assert "Warning" in text and "[!WARNING]" not in text
    assert "\\n" not in text and "## " not in text and "```" not in text
    assert "| API Gateway |" in text


def test_pdf_survives_unsupported_characters_and_long_lines() -> None:
    content = "# T\n\nArrow \u2192 and CJK \u4e2d\u6587\n\n```\n" + "x" * 500 + "\n```\n"
    data = build_export("t", content, "pdf", {})[2]
    assert len(PdfReader(io.BytesIO(data)).pages) >= 1


@pytest.mark.skipif(not _pdf_fonts()[2], reason="DejaVu fonts are not installed")
def test_pdf_keeps_unicode_text_with_dejavu() -> None:
    content = "# Caf\u00e9 \u2192 \u03a9\n\nStatus \u2714 \u041f\u0440\u0438\u0432\u0435\u0442 and **bold \u2192** *italic \u2264* `code \u2260`\n\n- \u2022 item \u2192 next\n"
    data = build_export("t", content, "pdf", {})[2]
    text = PdfReader(io.BytesIO(data)).pages[0].extract_text()
    for expected in ("Caf\u00e9 \u2192 \u03a9", "\u2714", "\u041f\u0440\u0438\u0432\u0435\u0442", "bold \u2192", "italic \u2264", "code \u2260"):
        assert expected in text
    assert "?" not in text


def test_plantuml_blocks_are_converted_in_every_format() -> None:
    content = "# T\n\n```plantuml\nA -> B: hi\n```\n\n```plantuml\nstart\n:x;\nstop\n```\n"
    html = build_export("t", content, "html", {})[2].decode()
    assert "sequenceDiagram" in html and "A-&gt;&gt;B: hi" in html
    assert "language-plantuml" not in html.split("sequenceDiagram")[0]
    diagram = load_diagrams([("sequenceDiagram\n    participant A\n    participant B\n    A->>B: hi", base64.b64encode(_png()).decode())])
    assert "data:image/png" in build_export("t", content, "html", diagram)[2].decode()
    docx = DocxDocument(io.BytesIO(build_export("t", content, "docx", diagram)[2]))
    assert len(docx.inline_shapes) == 1
    assert len(PdfReader(io.BytesIO(build_export("t", content, "pdf", diagram)[2])).pages) >= 1


@pytest.mark.parametrize("fmt", ["html", "docx", "pdf", "markdown"])
def test_empty_content_falls_back_to_title(fmt: str) -> None:
    assert build_export("Only Title", "   ", fmt, {})[2]


@pytest.mark.parametrize(
    "encoded",
    ["not base64!!", base64.b64encode(b"GIF89a-not-a-png-at-all-padding").decode()],
)
def test_load_diagrams_rejects_bad_images(encoded: str) -> None:
    with pytest.raises(ValueError):
        load_diagrams([("graph TD", encoded)])
