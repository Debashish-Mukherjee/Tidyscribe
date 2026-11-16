"""RTL must retain logical text and use a shaping engine, including mixed content."""
import base64
import io
from unittest.mock import patch

import pytest
from pypdf import PdfReader

from app.services.export_service import build_export
from app.services.rtl_pdf import contains_rtl, embedded_png


def text_of(source: str) -> str:
    data = build_export("RTL sample", source, "pdf", {})[2]
    reader = PdfReader(io.BytesIO(data))
    assert reader.metadata.author == "Tidyscribe"
    return "\n".join(page.extract_text() for page in reader.pages)


def test_mixed_document_keeps_arabic_hebrew_latin_cjk_and_structure():
    source = """# Mixed report

مرحبا بالعالم — العربية

שלום עולם — עברית

English with العربية and API-123.

日本語のテキスト

- שלום
- مرحبا

| Name | Value |
| --- | --- |
| עברית | שלום |
| العربية | مرحبا |

```text
API-123 = שלום
```

Equation: $x^2$.
"""
    text = text_of(source)
    for expected in ["مرحبا", "שלום", "API-123", "日本語", "x²", "Mixed report"]:
        assert expected in text


def test_arabic_with_inline_formatting_does_not_lose_words():
    text = text_of("مرحبا **بالعالم** مع `API-123` و[رابط](https://example.com).")
    for expected in ["مرحبا", "بالعالم", "API-123", "رابط"]:
        assert expected in text


def test_rtl_inside_code_uses_shaping_even_when_prose_is_english():
    with patch("app.services.rtl_pdf.render_rtl_pdf", return_value=b"shaped") as render:
        assert build_export("Code", "English\n\n```text\nשלום\n```", "pdf", {})[2] == b"shaped"
        render.assert_called_once()


def test_rtl_document_continues_across_pages_and_keeps_final_text():
    data = build_export("Long RTL", "\n\n".join([f"שלום עולם API-{i}" for i in range(150)]), "pdf", {})[2]
    reader = PdfReader(io.BytesIO(data))
    assert len(reader.pages) > 1
    text = "\n".join(page.extract_text() for page in reader.pages)
    for index in range(150):
        assert f"API-{index}" in text


def test_direction_detection_handles_embedded_rtl():
    assert contains_rtl("English العربية")
    assert contains_rtl("English שלום")
    assert not contains_rtl("Latin 日本語 123")


@pytest.mark.parametrize("url", ["https://example.com/pixel.png", "http://localhost/private", "file:///etc/passwd", "data:text/html;base64,eA==", "data:image/png;base64,AAAA", "data:image/png;base64,!!!!"])
def test_pdf_fetcher_rejects_external_local_and_invalid_resources(url):
    with pytest.raises(ValueError):
        embedded_png(url)


def test_pdf_fetcher_only_returns_embedded_png_bytes():
    data = b"\x89PNG\r\n\x1a\n" + b"example"
    assert embedded_png("data:image/png;base64," + base64.b64encode(data).decode()) == data


def test_rtl_pdf_embeds_uploaded_diagrams_without_loading_remote_images():
    from PIL import Image
    from app.services.export_service import load_diagrams

    png = io.BytesIO()
    Image.new("RGB", (24, 24), "blue").save(png, "PNG")
    source = "flowchart LR\n A-->B"
    diagrams = load_diagrams([(source, base64.b64encode(png.getvalue()).decode())])
    data = build_export("Diagram", f"שלום\n\n```mermaid\n{source}\n```\n\n![Remote alt](https://example.com/secret.png)", "pdf", diagrams)[2]
    reader = PdfReader(io.BytesIO(data))
    assert sum(len(page.images) for page in reader.pages) >= 1
    assert "Remote alt" in "\n".join(page.extract_text() for page in reader.pages)


def test_rtl_table_cell_taller_than_a_page_keeps_all_words_and_following_text():
    words = " ".join(f"word{i}" for i in range(1500))
    data = build_export("Long table", f"שלום\n\n| A | B |\n|---|---|\n| {words} | שלום |\n\nAFTER-MARKER", "pdf", {})[2]
    reader = PdfReader(io.BytesIO(data))
    text = "\n".join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) > 1
    assert text.count("word") == 1500 and "AFTER-MARKER" in text


def test_actual_renderer_refuses_external_images_without_opening_a_connection():
    from app.services.rtl_pdf import render_rtl_pdf
    from weasyprint.urls import FatalURLFetchingError

    with patch("urllib.request.OpenerDirector.open") as open_url:
        with pytest.raises(FatalURLFetchingError):
            render_rtl_pdf('<html><body><p>שלום</p><img src="https://example.com/private.png"></body></html>', lambda text: text)
        open_url.assert_not_called()


@pytest.mark.parametrize("source", [
    '<details><summary>&#1513;&#1500;&#1493;&#1501;</summary><p>English body</p></details>',
    '<table><caption>مرحبا</caption><tr><td>English cell</td></tr></table>',
])
def test_rtl_in_document_metadata_also_selects_the_shaping_writer(source):
    with patch("app.services.rtl_pdf.render_rtl_pdf", return_value=b"shaped"):
        assert build_export("English title", source, "pdf", {})[2] == b"shaped"
