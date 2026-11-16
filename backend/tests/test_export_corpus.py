"""Semantic output checks over the same corpus used by the browser renderer."""
import io
import json
from pathlib import Path

import pytest
from docx import Document
from pypdf import PdfReader

from app.services.export_pipeline import build_export

ROOT = Path(__file__).resolve().parents[2] / "test-fixtures/exports"
# The standard backend-only image does not copy fixtures outside its build context.
if not ROOT.exists():
    ROOT = Path("/fixtures/exports")


@pytest.mark.parametrize("name", ["technical-report.md", "international.md"])
def test_export_corpus_preserves_document_text(name):
    expectations = json.loads((ROOT / "manifest.json").read_text())[name]
    source = (ROOT / name).read_text()
    for fmt in ("html", "docx", "pdf"):
        _, _, data = build_export("Corpus", source, fmt, {})
        if fmt == "html":
            text = data.decode()
            for expected in expectations["html"]:
                assert expected in text, (name, fmt, expected)
        elif fmt == "docx":
            document = Document(io.BytesIO(data))
            text = "\n".join(p.text for p in document.paragraphs)
            text += "\n".join(cell.text for table in document.tables for row in table.rows for cell in row.cells)
        else:
            text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(data)).pages)
        for expected in expectations["text"]:
            assert expected in text, (name, fmt, expected)
