"""Markdown to HTML / DOCX / PDF. One parsed tree feeds all three writers."""
from __future__ import annotations

import base64
import binascii
import html
import io
import os
import re
import struct
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from app.services.doc_tree import Node, _fence_ascii_diagrams, parse_document, parse_markdown
from app.services.math_text import tex_to_text

SyntaxTreeNode = Node

# The browser rasterises Mermaid diagrams at this multiple of their CSS size.
PNG_SCALE = 3
MAX_DIAGRAM_BYTES = 5_000_000

FORMATS: dict[str, tuple[str, str]] = {
    "markdown": ("md", "text/markdown; charset=utf-8"),
    "html": ("html", "text/html; charset=utf-8"),
    "docx": ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "pdf": ("pdf", "application/pdf"),
}

# label, accent colour, background
CALLOUTS: dict[str, tuple[str, str, str]] = {
    "warning": ("Warning", "#9a6700", "#fff8c5"),
    "caution": ("Caution", "#cf222e", "#ffebe9"),
    "tip": ("Tip", "#1a7f37", "#dafbe1"),
    "note": ("Note", "#0969da", "#ddf4ff"),
    "important": ("Important", "#8250df", "#fbefff"),
}

@dataclass(frozen=True)
class Diagram:
    png: bytes
    width_px: int
    height_px: int


def _diagram_key(source: str) -> str:
    return "\n".join(line.rstrip() for line in source.strip().splitlines())


def load_diagrams(items: list[tuple[str, str]]) -> dict[str, Diagram]:
    """Validate base64 PNG uploads and index them by normalised Mermaid source."""
    diagrams: dict[str, Diagram] = {}
    for source, encoded in items:
        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Diagram image is not valid base64") from exc
        if len(data) > MAX_DIAGRAM_BYTES:
            raise ValueError("Diagram image is too large")
        if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
            raise ValueError("Diagram image must be a PNG")
        width, height = struct.unpack(">II", data[16:24])
        if not (0 < width <= 10_000 and 0 < height <= 10_000):
            raise ValueError("Diagram image has invalid dimensions")
        diagrams[_diagram_key(source)] = Diagram(data, width, height)
    return diagrams


def _text(node: SyntaxTreeNode) -> str:
    if node.type in ("text", "code_inline"):
        return node.content
    if node.type == "math_inline":
        return tex_to_text(node.content)
    if node.type == "footnote_ref":
        return node.content
    if node.type in ("softbreak", "hardbreak"):
        return " "
    if node.type == "image":
        return node.content
    return "".join(_text(child) for child in node.children)


def _heading_level(node: SyntaxTreeNode) -> int:
    return min(max(int(node.tag[1]), 1), 6)


def _mermaid_diagram(node: SyntaxTreeNode, diagrams: dict[str, Diagram]) -> Diagram | None:
    if node.info.strip().split(" ")[0].lower() != "mermaid":
        return None
    return diagrams.get(_diagram_key(node.content))


def _is_mermaid(node: SyntaxTreeNode) -> bool:
    return node.type == "fence" and node.info.strip().split(" ")[0].lower() == "mermaid"


# ---------------------------------------------------------------- HTML

_HTML_CSS = """
body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;line-height:1.65;color:#1f2328;max-width:900px;margin:0 auto;padding:32px 24px}
h1,h2,h3,h4,h5,h6{color:#1f2328;font-weight:600;line-height:1.25;margin:1.6em 0 .6em}
h1{font-size:2em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
h3{font-size:1.25em}
p,ul,ol,table,pre,blockquote,figure{margin:0 0 1em}
ul,ol{padding-left:2em}
li.task{list-style:none;margin-left:-1.4em}
li.task input{margin-right:.5em}
a{color:#0969da}
hr{border:0;border-top:1px solid #d1d9e0;margin:2em 0}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #d1d9e0;padding:6px 13px;text-align:left}
th{background:#f6f8fa;font-weight:600}
tr:nth-child(even) td{background:#fafbfc}
blockquote{border-left:4px solid #d1d9e0;padding:.25em 1em;color:#59636e}
blockquote.callout{border-radius:0 6px 6px 0;color:#1f2328}
.callout-title{font-weight:600;margin:0 0 .25em}
pre{background:#f6f8fa;border:1px solid #d1d9e0;border-radius:6px;padding:12px 16px;overflow:auto;font-size:85%;line-height:1.45}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
:not(pre)>code{background:#eff1f3;padding:.2em .4em;border-radius:6px;font-size:85%}
figure{text-align:center}
figure.diagram{overflow-x:auto}
figure.diagram img{max-width:100%;height:auto;cursor:zoom-in}
figure.diagram input:checked+img{max-width:none;cursor:zoom-out}
figcaption{color:#59636e;font-size:.85em;margin-top:.4em}
details{margin:0 0 1em;border:1px solid #d1d9e0;border-radius:6px;padding:.5em 1em}
summary{cursor:pointer;font-weight:600}
kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:85%;padding:.15em .4em;border:1px solid #d1d9e0;border-bottom-width:2px;border-radius:4px;background:#f6f8fa}
mark{background:#fff8c5;padding:0 .15em}
dt{font-weight:600}
dd{margin:0 0 .5em 1.5em}
.footnotes{font-size:.9em;color:#59636e}
.footnotes ol{padding-left:1.6em}
.math-block{text-align:center;margin:1em 0;overflow-x:auto}
caption{caption-side:top;font-weight:600;padding-bottom:.4em;text-align:left}
@media print{body{max-width:none;padding:0}pre,table,figure,blockquote{break-inside:avoid}figure.diagram img{max-width:100%;height:auto}}
"""


def _esc(value: str) -> str:
    return html.escape(value, quote=True)


def _is_rtl(text: str) -> bool:
    """True when the first strongly directional character is right-to-left (Arabic, Hebrew, ...)."""
    for char in text:
        kind = unicodedata.bidirectional(char)
        if kind in ("R", "AL"):
            return True
        if kind == "L":
            return False
    return False


def _dir(node: SyntaxTreeNode) -> str:
    """`dir="auto"` on right-to-left blocks, so the browser lays them out as the Preview does (other blocks need nothing)."""
    return ' dir="auto"' if _is_rtl(_text(node)) else ""


def _html_inline(node: SyntaxTreeNode) -> str:
    parts: list[str] = []
    for child in node.children:
        kind = child.type
        if kind == "text":
            parts.append(_esc(child.content))
        elif kind in ("softbreak", "hardbreak"):
            parts.append("<br>")
        elif kind == "code_inline":
            parts.append(f"<code>{_esc(child.content)}</code>")
        elif kind == "strong":
            parts.append(f"<strong>{_html_inline(child)}</strong>")
        elif kind == "em":
            parts.append(f"<em>{_html_inline(child)}</em>")
        elif kind == "s":
            parts.append(f"<s>{_html_inline(child)}</s>")
        elif kind == "link":
            href = _esc(str(child.attrGet("href") or ""))
            parts.append(f'<a href="{href}" rel="noopener noreferrer">{_html_inline(child)}</a>')
        elif kind == "image":
            parts.append(_esc(child.content))
        elif kind in ("sub", "sup", "kbd", "mark", "u", "small"):
            parts.append(f"<{kind}>{_html_inline(child)}</{kind}>")
        elif kind == "math_inline":
            parts.append(_math_html(child.content, display=False))
        elif kind == "footnote_ref":
            number = _esc(child.content)
            parts.append(f'<sup class="footnote-ref"><a href="#fnote-{number}" id="fnref-{number}">{number}</a></sup>')
        else:
            parts.append(_html_inline(child) if child.children else _esc(child.content))
    return "".join(parts)


def _math_html(tex: str, display: bool) -> str:
    """MathML when the converter understands the formula; otherwise the TeX source, so nothing is dropped."""
    tag, klass = ("div", "math math-block") if display else ("span", "math math-inline")
    try:
        from latex2mathml.converter import convert

        body = convert(tex, display="block" if display else "inline")
    except Exception:  # noqa: BLE001 - any converter failure falls back to source
        body = f"<code>{_esc(tex)}</code>"
    return f'<{tag} class="{klass}" data-tex="{_esc(tex)}">{body}</{tag}>'


def _html_blocks(nodes: list[SyntaxTreeNode], diagrams: dict[str, Diagram]) -> str:
    return "\n".join(_html_block(node, diagrams) for node in nodes)


def _html_block(node: SyntaxTreeNode, diagrams: dict[str, Diagram]) -> str:
    kind = node.type
    if kind == "heading":
        level = _heading_level(node)
        return f"<h{level}{_dir(node)}>{_html_inline(node.children[0])}</h{level}>"
    if kind == "paragraph":
        return f"<p{_dir(node)}>{_html_inline(node.children[0])}</p>"
    if kind == "blockquote":
        callout = node.meta.get("callout")
        inner = _html_blocks(node.children, diagrams)
        if callout in CALLOUTS:
            label, accent, background = CALLOUTS[callout]
            return (
                f'<blockquote class="callout callout-{callout}" '
                f'style="border-left-color:{accent};background:{background}">'
                f'<p class="callout-title" style="color:{accent}">{label}</p>{inner}</blockquote>'
            )
        return f"<blockquote>{inner}</blockquote>"
    if kind in ("bullet_list", "ordered_list"):
        tag = "ul" if kind == "bullet_list" else "ol"
        start = node.attrGet("start")
        start_attr = f' start="{int(start)}"' if kind == "ordered_list" and start not in (None, 1, "1") else ""
        items = "".join(_html_list_item(item, diagrams) for item in node.children)
        return f"<{tag}{start_attr}>{items}</{tag}>"
    if kind in ("fence", "code_block"):
        if _is_mermaid(node):
            diagram = _mermaid_diagram(node, diagrams)
            if diagram:
                encoded = base64.b64encode(diagram.png).decode("ascii")
                width = max(1, diagram.width_px // PNG_SCALE)
                return (
                    f'<figure class="diagram"><label title="Click to toggle full size"><input type="checkbox" hidden>'
                    f'<img alt="Mermaid diagram" width="{width}" src="data:image/png;base64,{encoded}"></label></figure>'
                )
            return (
                f'<figure><pre><code class="language-mermaid">{_esc(node.content)}</code></pre>'
                "<figcaption>Mermaid diagram (rendered image not available)</figcaption></figure>"
            )
        language = node.info.strip().split(" ")[0] if kind == "fence" else ""
        class_attr = f' class="language-{_esc(language)}"' if language else ""
        return f"<pre><code{class_attr}>{_esc(node.content)}</code></pre>"
    if kind == "hr":
        return "<hr>"
    if kind == "table":
        return _html_table(node, diagrams)
    if kind == "details":
        summary = node.meta.get("summary")
        head = f"<summary>{_html_inline(summary)}</summary>" if summary is not None else ""
        open_attr = " open" if node.attrs.get("open") else ""
        return f"<details{open_attr}>{head}{_html_blocks(node.children, diagrams)}</details>"
    if kind == "dl":
        parts = []
        for entry in node.children:
            if entry.type == "dt":
                parts.append(f"<dt{_dir(entry)}>{_html_inline(entry.children[0])}</dt>")
            else:
                parts.append(f"<dd>{_html_blocks(entry.children, diagrams)}</dd>")
        return f"<dl>{''.join(parts)}</dl>"
    if kind == "footnotes":
        items = "".join(
            f'<li id="fnote-{_esc(item.content)}">{_html_blocks(item.children, diagrams)}'
            f' <a class="footnote-backref" href="#fnref-{_esc(item.content)}">\u21a9</a></li>'
            for item in node.children
        )
        return f'<section class="footnotes"><hr><ol>{items}</ol></section>'
    if kind == "math_block":
        return _math_html(node.content, display=True)
    return _html_blocks(node.children, diagrams) if node.children else ""


def _html_list_item(item: SyntaxTreeNode, diagrams: dict[str, Diagram]) -> str:
    task = item.meta.get("task")
    pieces: list[str] = []
    for index, child in enumerate(item.children):
        if child.type == "paragraph":
            text = _html_inline(child.children[0])
            pieces.append(text if child.hidden else f"<p{_dir(child)}>{text}</p>")
        else:
            pieces.append(_html_block(child, diagrams))
        if index == 0 and task is not None:
            box = '<input type="checkbox" disabled' + (" checked" if task else "") + ">"
            pieces[0] = box + pieces[0]
    direction = _dir(item)
    if task is None:
        return f"<li{direction}>{''.join(pieces)}</li>"
    return f'<li class="task"{direction}>{"".join(pieces)}</li>'


@dataclass
class TableCell:
    node: Node
    row: int
    col: int
    rowspan: int
    colspan: int
    header: bool


def table_layout(node: Node) -> tuple[list[TableCell], int, int, int]:
    """Place cells on a grid, honouring colspan/rowspan. Returns (cells, rows, columns, header rows)."""
    cells: list[TableCell] = []
    taken: set[tuple[int, int]] = set()
    row_index = 0
    columns = 0
    header_rows = 0
    for section in node.children:
        for row in section.children:
            col = 0
            for cell in row.children:
                while (row_index, col) in taken:
                    col += 1
                colspan = int(cell.attrs.get("colspan", 1) or 1)
                rowspan = int(cell.attrs.get("rowspan", 1) or 1)
                cells.append(TableCell(cell, row_index, col, rowspan, colspan, section.type == "thead"))
                for dr in range(rowspan):
                    for dc in range(colspan):
                        taken.add((row_index + dr, col + dc))
                col += colspan
            columns = max(columns, col)
            if section.type == "thead":
                header_rows += 1
            row_index += 1
    rows = row_index
    for cell in cells:  # a rowspan cannot reach past the last row
        cell.rowspan = max(1, min(cell.rowspan, rows - cell.row))
    return cells, rows, columns, header_rows


def _is_inline_cell(cell: Node) -> bool:
    return bool(cell.children) and cell.children[0].type == "inline" or not cell.children


def _html_table(node: SyntaxTreeNode, diagrams: dict[str, Diagram]) -> str:
    out: list[str] = ["<table>"]
    caption = node.meta.get("caption")
    if caption:
        out.append(f"<caption>{_esc(caption)}</caption>")
    for section in node.children:
        out.append(f"<{section.type}>")
        for row in section.children:
            cells = []
            for cell in row.children:
                attrs = "".join(f' {name}="{int(cell.attrs[name])}"' for name in ("colspan", "rowspan") if int(cell.attrs.get(name, 1) or 1) > 1)
                if cell.attrs.get("align") in ("center", "right"):
                    attrs += f' style="text-align:{cell.attrs["align"]}"'
                body = _html_inline(cell.children[0]) if _is_inline_cell(cell) and cell.children else _html_blocks(cell.children, diagrams)
                cells.append(f"<{cell.type}{attrs}{_dir(cell)}>{body}</{cell.type}>")
            out.append(f"<tr>{''.join(cells)}</tr>")
        out.append(f"</{section.type}>")
    out.append("</table>")
    return "".join(out)


def render_html(title: str, markdown: str, diagrams: dict[str, Diagram], html_source: str | None = None) -> str:
    tree = parse_document(markdown, html_source)
    body = _html_blocks(tree.children, diagrams)
    return (
        "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{_esc(title)}</title><style>{_HTML_CSS}</style></head><body>\n{body}\n</body></html>"
    )


# ---------------------------------------------------------------- DOCX

def render_docx(title: str, markdown: str, diagrams: dict[str, Diagram], html_source: str | None = None) -> bytes:
    from docx import Document
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.enum.text import WD_COLOR_INDEX
    from docx.shared import Inches, Mm, Pt, RGBColor
    from docx.text.paragraph import Paragraph

    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
        setattr(section, side, Inches(1))
    max_width_in = 6.2
    document.core_properties.title = title

    normal = document.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    for level, size in ((1, 22), (2, 17), (3, 14), (4, 12), (5, 11), (6, 11)):
        style = document.styles[f"Heading {level}"]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(0x1F, 0x23, 0x28)
        style.paragraph_format.space_before = Pt(14 if level > 1 else 18)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.keep_with_next = True

    ppr_after_bdr = (
        "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct",
        "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd", "w:snapToGrid",
        "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
        "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId",
        "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
    )

    def hex_color(value: str) -> str:
        return value.lstrip("#").upper()

    # python-docx scans every sibling, relationship and style per call, which made large documents quadratic.
    body_end = document.element.body.sectPr
    style_ids: dict[str, str] = {}
    link_ids: dict[str, str] = {}

    def new_paragraph(container, style: str | None = None):
        if container is not document:
            paragraph = container.add_paragraph()
        else:
            element = OxmlElement("w:p")
            body_end.addprevious(element)
            paragraph = Paragraph(element, container)
        if style:
            if style not in style_ids:
                style_ids[style] = document.styles[style].style_id
            paragraph._p.style = style_ids[style]
        return paragraph

    def hyperlink_id(part, url: str) -> str:
        if url not in link_ids:
            rels = part.rels
            number = len(rels) + 1
            while f"rId{number}" in rels:
                number += 1
            link_ids[url] = rels.add_relationship(RT.HYPERLINK, url, f"rId{number}", is_external=True).rId
        return link_ids[url]

    def last_child(container):
        return body_end.getprevious() if container is document else next(container._element.iterchildren(reversed=True), None)

    def paragraphs_after(container, marker):
        parent = container._element.body if container is document else container._element
        node = marker.getnext() if marker is not None else (parent[0] if len(parent) else None)
        while node is not None and node is not body_end:
            if node.tag == qn("w:p"):
                yield Paragraph(node, container)
            node = node.getnext()

    def shade(paragraph, fill: str) -> None:
        ppr = paragraph._p.get_or_add_pPr()
        for old in ppr.findall(qn("w:shd")):
            ppr.remove(old)
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hex_color(fill))
        ppr.insert_element_before(shd, *ppr_after_bdr[1:])

    def border(paragraph, side: str, color: str, size: int = 24, space: int = 6) -> None:
        ppr = paragraph._p.get_or_add_pPr()
        borders = ppr.find(qn("w:pBdr"))
        if borders is None:
            borders = OxmlElement("w:pBdr")
            ppr.insert_element_before(borders, *ppr_after_bdr)
        edge = OxmlElement(f"w:{side}")
        edge.set(qn("w:val"), "single")
        edge.set(qn("w:sz"), str(size))
        edge.set(qn("w:space"), str(space))
        edge.set(qn("w:color"), hex_color(color))
        borders.append(edge)

    def style_run(run, *, bold=False, italic=False, strike=False, mono=False, color: str | None = None, underline=False, size: float | None = None, sub=False, sup=False, mark=False, keycap=False) -> None:
        run.bold = bold or None
        run.italic = italic or None
        run.font.strike = strike or None
        run.font.underline = underline or None
        if sub:
            run.font.subscript = True
        elif sup:
            run.font.superscript = True
        if mark:
            run.font.highlight_color = WD_COLOR_INDEX.YELLOW
        if mono or keycap:
            run.font.name = "Consolas"
            run._r.get_or_add_rPr().rFonts.set(qn("w:cs"), "Consolas")
        if keycap:
            shading = OxmlElement("w:shd")
            shading.set(qn("w:val"), "clear")
            shading.set(qn("w:color"), "auto")
            shading.set(qn("w:fill"), "EFF1F3")
            run._r.get_or_add_rPr().insert_element_before(shading, "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath")
        if color:
            run.font.color.rgb = RGBColor.from_string(hex_color(color))
        if size:
            run.font.size = Pt(size)

    run_wrappers = {"strong": "bold", "em": "italic", "s": "strike", "sub": "sub", "sup": "sup", "u": "underline", "mark": "mark", "kbd": "keycap", "small": "small"}

    def add_runs(paragraph, node: SyntaxTreeNode, **inherited) -> None:
        fmt = {"bold": False, "italic": False, "strike": False, "link": None, "size": None, "sub": False, "sup": False,
               "underline": False, "mark": False, "keycap": False, "small": False, **inherited}
        for child in node.children:
            kind = child.type
            if kind in ("softbreak", "hardbreak"):
                paragraph.add_run().add_break()
            elif kind in ("text", "code_inline", "image", "math_inline", "footnote_ref"):
                text = tex_to_text(child.content) if kind == "math_inline" else child.content
                if not text:
                    continue
                run = paragraph.add_run(text)
                link = fmt["link"]
                style_run(
                    run, bold=fmt["bold"], italic=fmt["italic"] or kind == "math_inline", strike=fmt["strike"],
                    mono=kind == "code_inline", color="#0969DA" if link else None, underline=fmt["underline"] or bool(link),
                    size=9 if fmt["small"] else fmt["size"], sub=fmt["sub"], sup=fmt["sup"] or kind == "footnote_ref",
                    mark=fmt["mark"], keycap=fmt["keycap"],
                )
                if link:
                    anchor = OxmlElement("w:hyperlink")
                    anchor.set(qn("r:id"), hyperlink_id(paragraph.part, link))
                    anchor.append(run._r)
                    paragraph._p.append(anchor)
            elif kind == "link":
                add_runs(paragraph, child, **{**fmt, "link": str(child.attrGet("href") or "") or None})
            elif kind in run_wrappers:
                add_runs(paragraph, child, **{**fmt, run_wrappers[kind]: True})
            elif child.children:
                add_runs(paragraph, child, **fmt)

    def mark_rtl(paragraph, node: SyntaxTreeNode) -> None:
        if not _is_rtl(_text(node)):
            return
        ppr = paragraph._p.get_or_add_pPr()
        ppr.insert_element_before(OxmlElement("w:bidi"), *ppr_after_bdr[ppr_after_bdr.index("w:bidi") + 1:])
        for run in paragraph.runs:
            run._r.get_or_add_rPr().insert_element_before(OxmlElement("w:rtl"), "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath")

    def indent(paragraph, inches: float) -> None:
        if inches:
            current = paragraph.paragraph_format.left_indent or Inches(0)
            paragraph.paragraph_format.left_indent = current + Inches(inches)

    def add_code(container, code: str, left: float) -> None:
        paragraph = new_paragraph(container)
        paragraph.paragraph_format.space_after = Pt(8)
        indent(paragraph, left)
        shade(paragraph, "#F6F8FA")
        run = paragraph.add_run(code.rstrip("\n"))
        style_run(run, mono=True, size=9)

    def add_image(container, diagram: Diagram, left: float) -> None:
        paragraph = new_paragraph(container)
        paragraph.alignment = 1
        width = min(diagram.width_px / PNG_SCALE / 96, max_width_in - left)
        paragraph.add_run().add_picture(io.BytesIO(diagram.png), width=Inches(max(width, 0.5)))

    def add_list(container, node: SyntaxTreeNode, depth: int, left: float) -> None:
        ordered = node.type == "ordered_list"
        number = int(node.attrGet("start") or 1)
        for item in node.children:
            task = item.meta.get("task")
            first = True
            for child in item.children:
                if child.type == "paragraph":
                    if task is None and not ordered:
                        style = "List Bullet" if depth == 0 else f"List Bullet {min(depth + 1, 3)}"
                        paragraph = new_paragraph(container, style)
                        indent(paragraph, left)
                    else:
                        paragraph = new_paragraph(container)
                        paragraph.paragraph_format.left_indent = Inches(left + 0.3 + 0.25 * depth)
                        paragraph.paragraph_format.first_line_indent = Inches(-0.25)
                        if first:
                            marker = ("\u2611 " if task else "\u2610 ") if task is not None else f"{number}. "
                            paragraph.add_run(marker)
                    paragraph.paragraph_format.space_after = Pt(2)
                    add_runs(paragraph, child.children[0])
                elif child.type in ("bullet_list", "ordered_list"):
                    add_list(container, child, depth + 1, left)
                else:
                    add_block(container, child, left + 0.3 + 0.25 * depth)
                first = False
            number += 1
        spacer = new_paragraph(container)
        spacer.paragraph_format.space_after = Pt(2)

    def fill_cell(cell, cell_node: SyntaxTreeNode, header: bool) -> None:
        if _is_inline_cell(cell_node):
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(2)
            paragraph.alignment = {"center": 1, "right": 2}.get(cell_node.attrs.get("align"))
            if cell_node.children:
                add_runs(paragraph, cell_node.children[0], bold=header)
            return
        for child in cell_node.children:
            add_block(cell, child, 0.0)
        first = cell.paragraphs[0]
        if not first.text and len(cell.paragraphs) > 1:
            first._p.getparent().remove(first._p)
        if header:
            for paragraph in cell.paragraphs:
                for run in paragraph.runs:
                    run.bold = True

    def add_table(container, node: SyntaxTreeNode) -> None:
        cells, rows, columns, header_rows = table_layout(node)
        if not cells:
            return
        table = container.add_table(rows=rows, cols=columns)
        table.style = "Table Grid"
        caption = node.meta.get("caption")
        # Table.cell() rebuilds the whole grid on every call (quadratic); spans never overlap, so one lookup grid stays valid across merges.
        grid = table._cells
        for cell_info in cells:
            target = grid[cell_info.row * columns + cell_info.col]
            if cell_info.rowspan > 1 or cell_info.colspan > 1:
                far = grid[(cell_info.row + cell_info.rowspan - 1) * columns + cell_info.col + cell_info.colspan - 1]
                target = target.merge(far)
            fill_cell(target, cell_info.node, cell_info.header)
            if cell_info.header:
                tc_pr = target._tc.get_or_add_tcPr()
                shd = OxmlElement("w:shd")
                shd.set(qn("w:val"), "clear")
                shd.set(qn("w:color"), "auto")
                shd.set(qn("w:fill"), "F6F8FA")
                tc_pr.append(shd)
        if caption:
            note = new_paragraph(container)
            style_run(note.add_run(caption), italic=True, color="#59636E")
        spacer = new_paragraph(container)
        spacer.paragraph_format.space_after = Pt(4)

    def add_quote(container, node: SyntaxTreeNode, left: float) -> None:
        callout = node.meta.get("callout")
        label, accent, background = CALLOUTS.get(callout, ("", "#D1D9E0", ""))
        marker = last_child(container)
        if callout:
            heading = new_paragraph(container)
            style_run(heading.add_run(label), bold=True, color=accent)
            heading.paragraph_format.space_after = Pt(2)
        for child in node.children:
            add_block(container, child, left)
        for paragraph in paragraphs_after(container, marker):
            indent(paragraph, 0.15)
            border(paragraph, "left", accent)
            if background:
                shade(paragraph, background)

    def add_block(container, node: SyntaxTreeNode, left: float = 0.0) -> None:
        kind = node.type
        if kind == "heading":
            paragraph = new_paragraph(container, f"Heading {_heading_level(node)}")
            add_runs(paragraph, node.children[0])
            mark_rtl(paragraph, node)
        elif kind == "paragraph":
            paragraph = new_paragraph(container)
            indent(paragraph, left)
            add_runs(paragraph, node.children[0])
            mark_rtl(paragraph, node)
        elif kind == "blockquote":
            add_quote(container, node, left)
        elif kind in ("bullet_list", "ordered_list"):
            add_list(container, node, 0, left)
        elif kind in ("fence", "code_block"):
            if _is_mermaid(node):
                diagram = _mermaid_diagram(node, diagrams)
                if diagram:
                    add_image(container, diagram, left)
                    return
                note = new_paragraph(container)
                style_run(note.add_run("Mermaid diagram (rendered image not available)"), italic=True, color="#59636E")
                note.paragraph_format.space_after = Pt(2)
            add_code(container, node.content, left)
        elif kind == "hr":
            rule = new_paragraph(container)
            border(rule, "bottom", "#D1D9E0", size=6, space=1)
        elif kind == "table":
            add_table(container, node)
        elif kind == "details":
            summary = node.meta.get("summary")
            if summary is not None:
                heading = new_paragraph(container)
                indent(heading, left)
                heading.paragraph_format.space_after = Pt(2)
                heading.paragraph_format.keep_with_next = True
                add_runs(heading, summary, bold=True)
            for child in node.children:
                add_block(container, child, left + 0.25)
        elif kind == "dl":
            for entry in node.children:
                if entry.type == "dt":
                    term = new_paragraph(container)
                    indent(term, left)
                    term.paragraph_format.space_after = Pt(1)
                    term.paragraph_format.keep_with_next = True
                    add_runs(term, entry.children[0], bold=True)
                else:
                    for child in entry.children:
                        add_block(container, child, left + 0.35)
        elif kind == "footnotes":
            title = new_paragraph(container)
            style_run(title.add_run("Footnotes"), bold=True, color="#59636E", size=10)
            for item in node.children:
                lead = item.children[0] if item.children and item.children[0].type == "paragraph" else None
                paragraph = new_paragraph(container)
                paragraph.paragraph_format.left_indent = Inches(0.3)
                paragraph.paragraph_format.first_line_indent = Inches(-0.3)
                paragraph.paragraph_format.space_after = Pt(2)
                style_run(paragraph.add_run(f"{item.content}. "), size=9.5)
                if lead is not None:
                    add_runs(paragraph, lead.children[0], size=9.5)
                for child in item.children[1:] if lead is not None else item.children:
                    add_block(container, child, 0.3)
        elif kind == "math_block":
            paragraph = new_paragraph(container)
            paragraph.alignment = 1
            indent(paragraph, left)
            style_run(paragraph.add_run(tex_to_text(node.content)), italic=True, size=12)
        else:
            for child in node.children:
                add_block(container, child, left)

    tree = parse_document(markdown, html_source)
    for node in tree.children:
        add_block(document, node)

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------- PDF

_FONT_DIRS = ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/usr/share/fonts/TTF")
_CJK_FONT_FILES = ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc")
CJK_FONT = "WenQuanYiMicroHei"
# Standard Adobe CID fonts: not embedded, shown only if the viewer has East Asian fonts. Used when no CJK TTF is installed.
_CJK_RANGES = (
    (re.compile(r"([\u3040-\u30ff\u31f0-\u31ff]+)"), "HeiseiMin-W3"),
    (re.compile(r"([\uac00-\ud7af\u1100-\u11ff]+)"), "HYSMyeongJo-Medium"),
    (re.compile(r"([\u2e80-\u2fdf\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]+)"), "STSong-Light"),
)
_CJK_RUN = re.compile(r"([\u1100-\u11ff\u2e80-\u2fdf\u3000-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]+)")
_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u2060\ufeff\ufe0e\ufe0f"))
# Emoji that AI-written documents use constantly, mapped to symbols DejaVu does have.
_SYMBOL_FALLBACKS = {
    ord("\u2705"): "\u2714", ord("\u274c"): "\u2718", ord("\u2b50"): "\u2605",
    ord("\u27a1"): "\u2192", ord("\u2b05"): "\u2190", ord("\u2139"): "i",
}
_EMOJI = re.compile("[\u2600-\u27bf\u2b00-\u2bff\u2300-\u23ff]")
_ASTRAL = re.compile("[\U00010000-\U0010ffff]")


@lru_cache(maxsize=1)
def _pdf_fonts() -> tuple[str, str, bool]:
    """Return (sans, mono, unicode_ok); falls back to built-in Latin-only fonts when DejaVu is missing."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont

    def find(name: str) -> str | None:
        for directory in _FONT_DIRS:
            path = os.path.join(directory, name)
            if os.path.exists(path):
                return path
        return None

    families = {
        "DejaVuSans": ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"),
        "DejaVuSansMono": ("DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono-Oblique.ttf", "DejaVuSansMono-BoldOblique.ttf"),
    }
    for family, (regular, bold, italic, bold_italic) in families.items():
        regular_path = find(regular)
        if regular_path is None:
            return "Helvetica", "Courier", False
        # Italic files are optional (fonts-dejavu-extra); fall back to the closest available face.
        faces = {
            "normal": regular_path,
            "bold": find(bold) or regular_path,
            "italic": find(italic) or regular_path,
            "boldItalic": find(bold_italic) or find(bold) or regular_path,
        }
        for style, path in faces.items():
            pdfmetrics.registerFont(TTFont(f"{family}-{style}", path))
        pdfmetrics.registerFontFamily(family, **{style: f"{family}-{style}" for style in faces})

    cjk_path = next((path for path in _CJK_FONT_FILES if os.path.exists(path)), None)
    if cjk_path:
        pdfmetrics.registerFont(TTFont(CJK_FONT, cjk_path, subfontIndex=0))
        pdfmetrics.registerFontFamily(CJK_FONT, normal=CJK_FONT, bold=CJK_FONT, italic=CJK_FONT, boldItalic=CJK_FONT)
    else:
        for _, cid in _CJK_RANGES:
            pdfmetrics.registerFont(UnicodeCIDFont(cid))
    return "DejaVuSans-normal", "DejaVuSansMono-normal", True


def _has_embedded_cjk() -> bool:
    from reportlab.pdfbase import pdfmetrics

    return CJK_FONT in pdfmetrics.getRegisteredFontNames()


def _pdf_text(value: str) -> str:
    """Remove characters the PDF fonts cannot draw (they would show as empty boxes or corrupt text extraction)."""
    value = value.translate(_INVISIBLE).translate(_SYMBOL_FALLBACKS)
    # reportlab embeds TrueType fonts through 16-bit codes, so anything above U+FFFF (emoji) breaks the text map.
    value = _ASTRAL.sub("", value)
    return _EMOJI.sub(lambda match: match.group(0) if _dejavu_has(match.group(0)) else "", value)


@lru_cache(maxsize=4096)
def _dejavu_has(char: str) -> bool:
    from reportlab.pdfbase import pdfmetrics

    try:
        return ord(char) in pdfmetrics.getFont("DejaVuSans-normal").face.charToGlyph
    except (KeyError, AttributeError):
        return False


def _wrap_cjk(markup: str) -> str:
    if _has_embedded_cjk():
        return _CJK_RUN.sub(rf'<font name="{CJK_FONT}">\1</font>', markup)
    for pattern, font in _CJK_RANGES:
        markup = pattern.sub(rf'<font name="{font}">\1</font>', markup)
    return markup


def _display_columns(text: str) -> int:
    """Monospace width of a string: East Asian characters take two columns."""
    return sum(2 if _CJK_RUN.fullmatch(char) else 1 for char in text)


def render_pdf(title: str, markdown: str, diagrams: dict[str, Diagram], html_source: str | None = None) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.platypus import (
        CondPageBreak,
        HRFlowable,
        Image,
        Indenter,
        Paragraph,
        Preformatted,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
        XPreformatted,
    )

    margin = 22 * mm
    page_width = A4[0] - 2 * margin
    ink = colors.HexColor("#1F2328")
    sans, mono, unicode_ok = _pdf_fonts()
    sans_bold = "DejaVuSans-bold" if unicode_ok else "Helvetica-Bold"

    body = ParagraphStyle("body", fontName=sans, bulletFontName=sans, fontSize=10.5, leading=15, textColor=ink, spaceAfter=6)
    headings = {
        level: ParagraphStyle(
            f"h{level}", parent=body, fontName=sans_bold, fontSize=size, leading=size * 1.25,
            spaceBefore=16 if level > 1 else 20, spaceAfter=8,
        )
        for level, size in ((1, 22), (2, 17), (3, 14), (4, 12), (5, 11), (6, 10.5))
    }
    code_style = ParagraphStyle(
        "code", fontName=mono, fontSize=8, leading=10.5, textColor=ink,
        backColor=colors.HexColor("#F6F8FA"), borderColor=colors.HexColor("#D1D9E0"), borderWidth=0.5,
        borderPadding=6, spaceBefore=4, spaceAfter=12, leftIndent=6, rightIndent=6,
    )
    cell_style = ParagraphStyle("cell", parent=body, fontSize=9.5, leading=12, spaceAfter=0)
    cell_head = ParagraphStyle("cellhead", parent=cell_style, fontName=sans_bold)

    def latin(value: str) -> str:
        if unicode_ok:
            return _pdf_text(value)
        # Built-in PDF fonts only cover Windows-1252.
        return value.encode("cp1252", "replace").decode("cp1252")

    def esc(value: str) -> str:
        text = html.escape(latin(value), quote=False)
        return _wrap_cjk(text) if unicode_ok else text

    def inline(node: SyntaxTreeNode) -> str:
        parts: list[str] = []
        for child in node.children:
            kind = child.type
            if kind == "text" or kind == "image":
                parts.append(esc(child.content))
            elif kind in ("softbreak", "hardbreak"):
                parts.append("<br/>")
            elif kind == "code_inline":
                parts.append(f'<font face="{mono}" color="#B3243A">{esc(child.content)}</font>')
            elif kind == "strong":
                parts.append(f"<b>{inline(child)}</b>")
            elif kind == "em":
                parts.append(f"<i>{inline(child)}</i>")
            elif kind == "s":
                parts.append(f"<strike>{inline(child)}</strike>")
            elif kind == "link":
                href = html.escape(str(child.attrGet("href") or ""), quote=True)
                parts.append(f'<a href="{href}" color="#0969DA">{inline(child)}</a>')
            elif kind == "sub":
                parts.append(f"<sub>{inline(child)}</sub>")
            elif kind == "sup":
                parts.append(f"<super>{inline(child)}</super>")
            elif kind == "u":
                parts.append(f"<u>{inline(child)}</u>")
            elif kind == "mark":
                parts.append(f'<font backColor="#FFF8C5">{inline(child)}</font>')
            elif kind == "kbd":
                parts.append(f'<font face="{mono}" backColor="#EFF1F3">{inline(child)}</font>')
            elif kind == "small":
                parts.append(f'<font size="8">{inline(child)}</font>')
            elif kind == "math_inline":
                parts.append(f"<i>{esc(tex_to_text(child.content))}</i>")
            elif kind == "footnote_ref":
                parts.append(f"<super>{esc(child.content)}</super>")
            elif child.children:
                parts.append(inline(child))
        return "".join(parts)

    def split_columns(line: str, limit: int) -> list[str]:
        parts: list[str] = []
        current, used = "", 0
        for char in line:
            columns = _display_columns(char)
            if used + columns > limit and current:
                parts.append(current)
                current, used = "", 0
            current += char
            used += columns
        parts.append(current)
        return parts

    def code_flowable(code: str, width: float):
        limit = max(30, int(width / (0.6 * code_style.fontSize)) - 2)
        lines: list[str] = []
        for line in latin(code.rstrip("\n")).expandtabs(4).split("\n"):
            lines.extend(split_columns(line, limit))
        text = "\n".join(lines)
        if unicode_ok and _CJK_RUN.search(text):
            return XPreformatted(_wrap_cjk(html.escape(text, quote=False)), code_style)
        return Preformatted(text, code_style)

    def measure(text: str, font: str, size: float) -> float:
        # Text in the CJK font is one em wide per character; the base fonts cannot measure it.
        wide = _CJK_RUN.findall(text)
        return stringWidth(_CJK_RUN.sub("", text), font, size) + size * sum(len(run) for run in wide)

    def boxed(flowables: list, accent: str, background: str | None, width: float) -> Table:
        # splitInRow lets a callout or quote taller than a page continue on the next one.
        table = Table([[flowables]], colWidths=[width], splitInRow=1)
        commands = [
            ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor(accent)),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ]
        if background:
            commands.append(("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(background)))
        table.setStyle(TableStyle(commands))
        return table

    def column_widths(rows: list[list[SyntaxTreeNode | None]], header_rows: int, width: float) -> list[float]:
        """Give each column at least its longest word (so headers do not break mid-word), then share the rest."""
        padding = 14
        columns = max(len(row) for row in rows)
        natural = [0.0] * columns
        minimum = [0.0] * columns
        for row_index, row in enumerate(rows):
            font = sans_bold if row_index < header_rows else sans
            for column, cell in enumerate(row):
                if cell is None:
                    continue
                text = latin(_text(cell))
                natural[column] = max(natural[column], measure(text, font, cell_style.fontSize) + padding)
                longest = max((measure(word, font, cell_style.fontSize) for word in text.split()), default=0.0)
                minimum[column] = max(minimum[column], longest + padding)
        minimum = [min(value, width * 0.45) for value in minimum]  # one long URL must not claim the page
        if sum(minimum) > width:
            # Shrink only the widest columns (a long URL may break) so short words in other columns stay whole.
            low, high = 0.0, max(minimum)
            for _ in range(40):
                cap = (low + high) / 2
                low, high = (cap, high) if sum(min(value, cap) for value in minimum) <= width else (low, cap)
            minimum = [min(value, low) for value in minimum]
        natural = [max(n, m) for n, m in zip(natural, minimum)]
        if sum(natural) <= width:
            extra = (width - sum(natural)) / columns
            return [value + extra for value in natural]
        share = (width - sum(minimum)) / (sum(natural) - sum(minimum))
        return [m + (n - m) * share for m, n in zip(minimum, natural)]

    def cell_content(cell_node: SyntaxTreeNode, style: ParagraphStyle, width: float):
        if _is_inline_cell(cell_node):
            align = {"center": 1, "right": 2}.get(cell_node.attrs.get("align"))
            if align:
                style = ParagraphStyle(f"{style.name}-{align}", parent=style, alignment=align)
            return Paragraph(inline(cell_node.children[0]) if cell_node.children else "", style)
        return blocks(cell_node.children, width, 1) or ""

    def table_flowable(node: SyntaxTreeNode, width: float) -> Table:
        cells, rows, columns, header_rows = table_layout(node)
        data: list[list] = [["" for _ in range(columns)] for _ in range(rows)]
        measured: list[list[SyntaxTreeNode | None]] = [[None] * columns for _ in range(rows)]
        spans: list[tuple] = []
        for cell in cells:
            style = cell_head if cell.header else cell_style
            data[cell.row][cell.col] = cell_content(cell.node, style, width / max(columns, 1))
            if cell.colspan == 1:
                measured[cell.row][cell.col] = cell.node
            if cell.colspan > 1 or cell.rowspan > 1:
                spans.append(("SPAN", (cell.col, cell.row), (cell.col + cell.colspan - 1, cell.row + cell.rowspan - 1)))
        table = Table(data, colWidths=column_widths(measured, header_rows, width), repeatRows=header_rows, splitInRow=1)
        commands = [
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D1D9E0")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            *spans,
        ]
        if header_rows:
            commands.append(("BACKGROUND", (0, 0), (-1, header_rows - 1), colors.HexColor("#F6F8FA")))
        table.setStyle(TableStyle(commands))
        return table

    def list_flowables(node: SyntaxTreeNode, depth: int, width: float) -> list:
        out: list = []
        ordered = node.type == "ordered_list"
        number = int(node.attrGet("start") or 1)
        checked, unchecked = ("\u2611", "\u2610") if unicode_ok else ("[x]", "[ ]")

        def marker(item: SyntaxTreeNode, position: int) -> str:
            task = item.meta.get("task")
            if task is not None:
                return checked if task else unchecked
            return f"{number + position}." if ordered else "\u2022"

        markers = [marker(item, position) for position, item in enumerate(node.children)]
        # The gutter must fit the widest marker, otherwise "100." runs into the text.
        left = max(18.0, max((measure(m, sans, body.fontSize) for m in markers), default=0.0) + 8)
        item_style = ParagraphStyle(f"li{depth}", parent=body, leftIndent=left, bulletIndent=0, spaceAfter=2)
        for position, item in enumerate(node.children):
            bullet = markers[position]
            first = True
            for child in item.children:
                if child.type == "paragraph":
                    if first:
                        out.append(Paragraph(inline(child.children[0]), item_style, bulletText=bullet))
                    else:
                        out.extend([Indenter(left=left), Paragraph(inline(child.children[0]), body), Indenter(left=-left)])
                else:
                    if first:
                        out.append(Paragraph("&nbsp;", item_style, bulletText=bullet))
                    out.append(Indenter(left=left))
                    out.extend(blocks([child], width - left, depth + 1))
                    out.append(Indenter(left=-left))
                first = False
        out.append(Spacer(1, 4))
        return out

    def blocks(nodes: list[SyntaxTreeNode], width: float, depth: int = 0) -> list:
        out: list = []
        for node in nodes:
            kind = node.type
            if kind == "heading":
                level = _heading_level(node)
                # Keep a heading with the content after it without forcing whole tables onto a new page.
                out.append(CondPageBreak(120 if level <= 2 else 90))
                out.append(Paragraph(inline(node.children[0]), headings[level]))
            elif kind == "paragraph":
                out.append(Paragraph(inline(node.children[0]), body))
            elif kind == "blockquote":
                callout = node.meta.get("callout")
                label, accent, background = CALLOUTS.get(callout, ("", "#D1D9E0", ""))
                inner: list = []
                if callout:
                    inner.append(Paragraph(f'<font color="{accent}"><b>{label}</b></font>', body))
                inner.extend(blocks(node.children, width - 20, depth + 1))
                out.extend([boxed(inner, accent, background or None, width), Spacer(1, 8)])
            elif kind in ("bullet_list", "ordered_list"):
                out.extend(list_flowables(node, depth, width))
            elif kind in ("fence", "code_block"):
                if _is_mermaid(node):
                    diagram = _mermaid_diagram(node, diagrams)
                    if diagram:
                        natural_w = diagram.width_px / PNG_SCALE * 0.75
                        scale = min(1.0, width / natural_w, 560 / (diagram.height_px / PNG_SCALE * 0.75))
                        image = Image(
                            io.BytesIO(diagram.png), width=natural_w * scale,
                            height=diagram.height_px / PNG_SCALE * 0.75 * scale,
                        )
                        image.hAlign = "CENTER"
                        out.extend([image, Spacer(1, 10)])
                        continue
                    out.append(Paragraph("<i>Mermaid diagram (rendered image not available)</i>", body))
                out.append(code_flowable(node.content, width))
            elif kind == "hr":
                out.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#D1D9E0"), spaceBefore=8, spaceAfter=12))
            elif kind == "table":
                caption = node.meta.get("caption")
                if caption:
                    out.append(Paragraph(f"<i>{esc(caption)}</i>", body))
                out.extend([table_flowable(node, width), Spacer(1, 10)])
            elif kind == "details":
                summary = node.meta.get("summary")
                if summary is not None:
                    out.append(Paragraph(f"<b>{inline(summary)}</b>", body))
                out.append(Indenter(left=14))
                out.extend(blocks(node.children, width - 14, depth + 1))
                out.append(Indenter(left=-14))
            elif kind == "dl":
                for entry in node.children:
                    if entry.type == "dt":
                        out.append(Paragraph(f"<b>{inline(entry.children[0])}</b>", ParagraphStyle("dt", parent=body, spaceAfter=1)))
                    else:
                        out.append(Indenter(left=18))
                        out.extend(blocks(entry.children, width - 18, depth + 1))
                        out.append(Indenter(left=-18))
            elif kind == "footnotes":
                note_style = ParagraphStyle("footnote", parent=body, fontSize=9, leading=12, spaceAfter=2, leftIndent=16, firstLineIndent=-16)
                out.append(Paragraph('<font color="#59636E"><b>Footnotes</b></font>', body))
                for item in node.children:
                    lead = item.children[0] if item.children and item.children[0].type == "paragraph" else None
                    text = inline(lead.children[0]) if lead is not None else ""
                    out.append(Paragraph(f"{esc(item.content)}. {text}", note_style))
                    out.extend(blocks(item.children[1:] if lead is not None else item.children, width - 16, depth + 1))
            elif kind == "math_block":
                centered = ParagraphStyle("math", parent=body, alignment=1, fontSize=11.5)
                out.append(Paragraph(f"<i>{esc(tex_to_text(node.content))}</i>", centered))
            elif node.children:
                out.extend(blocks(node.children, width, depth))
        return out

    def footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#59636E"))
        canvas.drawRightString(A4[0] - margin, 12 * mm, f"Page {doc.page}")
        canvas.restoreState()

    buffer = io.BytesIO()
    template = SimpleDocTemplate(
        buffer, pagesize=A4, leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=latin(title), author="Tidyscribe",
    )
    story = blocks(parse_document(markdown, html_source).children, page_width) or [Paragraph(" ", body)]
    template.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


# ---------------------------------------------------------------- entry point

def build_export(title: str, content: str, export_format: str, diagrams: dict[str, Diagram], html_source: str | None = None) -> tuple[str, str, bytes]:
    """Return (file extension, media type, bytes). `html_source` is the Preview's HTML when the client sent it."""
    extension, media_type = FORMATS[export_format]
    text = content if content.strip() else f"# {title}"
    if export_format == "markdown":
        return extension, media_type, text.encode("utf-8")
    if export_format == "html":
        return extension, media_type, render_html(title, text, diagrams, html_source).encode("utf-8")
    if export_format == "docx":
        return extension, media_type, render_docx(title, text, diagrams, html_source)
    return extension, media_type, render_pdf(title, text, diagrams, html_source)
