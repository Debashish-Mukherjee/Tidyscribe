"""PDF layout for bidirectional documents using Pango/HarfBuzz via WeasyPrint.

The input is generated from the same sanitized document tree as HTML exports.
Only diagram PNGs embedded by that writer may be loaded; network and local-file
resources are never fetched while a document is rendered.
"""
from __future__ import annotations

import base64
import binascii
import unicodedata
from collections.abc import Callable

from lxml import etree, html

from app.services.math_text import tex_to_text

_PRINT_CSS = """
@page { size: A4; margin: 22mm;
  @bottom-right { content: "Page " counter(page); font: 8pt "DejaVu Sans"; color: #59636e; }
}
body { font-family: "DejaVu Sans", "WenQuanYi Micro Hei", sans-serif;
  font-size: 10.5pt; line-height: 1.43; padding: 0; max-width: none; margin: 0; }
code, pre, kbd { font-family: "DejaVu Sans Mono", "WenQuanYi Micro Hei", monospace; }
[dir="auto"] { direction: rtl; text-align: right; }
th[dir="auto"], td[dir="auto"] { direction: rtl; text-align: right; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
pre, table, figure, blockquote { break-inside: auto; }
table { table-layout: fixed; }
th, td { overflow-wrap: anywhere; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.math { font-style: italic; }
figure.diagram img { max-height: 190mm; object-fit: contain; }
"""


def contains_rtl(text: str) -> bool:
    # Search the entire document, including mixed English/Arabic paragraphs.
    return any(unicodedata.bidirectional(char) in ("R", "AL") for char in text)


def embedded_png(url: str) -> bytes:
    prefix = "data:image/png;base64,"
    if not url.startswith(prefix):
        raise ValueError("PDF resources must be embedded PNG diagrams")
    encoded = url[len(prefix):]
    if len(encoded) > 7_000_000:
        raise ValueError("PDF diagram is too large")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid embedded PDF diagram") from exc
    if len(data) > 5_000_000 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Invalid embedded PDF diagram")
    return data


def render_rtl_pdf(document_html: str, clean_text: Callable[[str], str]) -> bytes:
    from weasyprint import HTML
    from weasyprint.urls import URLFetcher, URLFetcherResponse

    class PNGFetcher(URLFetcher):
        def fetch(self, url, headers=None):
            return URLFetcherResponse(url, embedded_png(url), {"Content-Type": "image/png"})

    document = html.document_fromstring(document_html)
    head = document.find("head")
    if head is not None:
        etree.SubElement(head, "meta", name="author", content="Tidyscribe")
    # PDFs carry readable Unicode math, matching the ReportLab and DOCX writers.
    for element in document.xpath("//*[@data-tex]"):
        formula = tex_to_text(element.attrib.pop("data-tex"))
        for child in list(element):
            element.remove(child)
        element.text = formula
    for checkbox in document.xpath('//li[contains(concat(" ", normalize-space(@class), " "), " task ")]//input[@type="checkbox"]'):
        marker = etree.Element("span")
        marker.text = "☑ " if "checked" in checkbox.attrib else "☐ "
        marker.tail = checkbox.tail
        checkbox.getparent().replace(checkbox, marker)
    for element in document.iter():
        if element.tag == "style":
            # This is the writer's fixed CSS, not arbitrary pasted styles.
            element.text = (element.text or "").replace("overflow-x:auto", "overflow:auto")
            continue
        if element.text:
            element.text = clean_text(element.text)
        if element.tail:
            element.tail = clean_text(element.tail)
    # Author styles must follow the HTML writer's styles. Passing these as user
    # stylesheets would give them lower cascade priority, even for RTL cells.
    if head is not None:
        etree.SubElement(head, "style").text = _PRINT_CSS
    source = html.tostring(document, encoding="unicode")
    fetcher = PNGFetcher(allowed_protocols=("data",), allow_redirects=False, fail_on_errors=True)
    return HTML(string=source, url_fetcher=fetcher).write_pdf()
