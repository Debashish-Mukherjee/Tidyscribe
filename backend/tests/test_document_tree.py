"""Fidelity of the shared document tree and of every export writer (UAT D6, D16 and the table/HTML parts of D2)."""
import io

import pytest
from docx import Document as DocxDocument
from pypdf import PdfReader

from app.services.doc_tree import Node, html_to_tree, markdown_to_html, parse_markdown
from app.services.export_service import build_export
from app.services.math_text import tex_to_text


def _types(node: Node, kind: str) -> list[Node]:
    return [n for n in node.walk() if n.type == kind]


def _html(markdown: str, html_source: str | None = None) -> str:
    return build_export("T", markdown, "html", {}, html_source)[2].decode()


def _docx(markdown: str, html_source: str | None = None) -> DocxDocument:
    return DocxDocument(io.BytesIO(build_export("T", markdown, "docx", {}, html_source)[2]))


def _docx_text(document: DocxDocument) -> str:
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.extend(cell.text for cell in row.cells)
    return "\n".join(parts)


def _pdf_text(markdown: str, html_source: str | None = None) -> str:
    reader = PdfReader(io.BytesIO(build_export("T", markdown, "pdf", {}, html_source)[2]))
    return "\n".join(page.extract_text() for page in reader.pages)


RAW_HTML_DOC = (
    "# Raw HTML\n\n"
    "Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to copy H<sub>2</sub>O at 10<sup>3</sup> degrees.<br>Second line.\n\n"
    "<details>\n<summary>More detail</summary>\n\nHidden **markdown** body.\n\n</details>\n\n"
    "<table><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td><b>Engineer</b></td></tr></table>\n"
)


def test_raw_html_is_preserved_by_every_renderer() -> None:
    html = _html(RAW_HTML_DOC)
    assert "<kbd>Ctrl</kbd>" in html and "<sub>2</sub>" in html and "<sup>3</sup>" in html
    assert "<details><summary>More detail</summary>" in html and "<strong>markdown</strong>" in html
    assert "<th>Name</th>" in html and "<strong>Engineer</strong>" in html
    assert "&lt;kbd&gt;" not in html and "&lt;details&gt;" not in html

    docx = _docx(RAW_HTML_DOC)
    text = _docx_text(docx)
    for expected in ("Ctrl", "More detail", "Hidden markdown body.", "Name", "Engineer", "Second line."):
        assert expected in text
    assert "<kbd>" not in text and "<details>" not in text
    runs = [run for paragraph in docx.paragraphs for run in paragraph.runs]
    assert any(run.text == "2" and run.font.subscript for run in runs)
    assert any(run.text == "3" and run.font.superscript for run in runs)

    pdf = _pdf_text(RAW_HTML_DOC)
    for expected in ("Ctrl", "More detail", "Hidden markdown body.", "Engineer"):
        assert expected in pdf
    assert "<kbd>" not in pdf and "&lt;" not in pdf


def test_unsafe_html_is_removed_but_its_text_survives_in_every_format() -> None:
    markdown = (
        'Safe text <script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">click</a> '
        '<img src=x onerror="alert(3)"><iframe src="https://evil.example"></iframe><style>p{display:none}</style>'
        '<form action="https://evil.example"><input name=q><button>Go</button></form>'
    )
    html = _html(markdown)
    assert "Safe text" in html and "click" in html
    for bad in ("<script", "javascript:", "onclick", "onerror", "<iframe", "evil.example", "<form", "<input", "display:none"):
        assert bad not in html
    assert "Safe text" in _docx_text(_docx(markdown))
    assert "Safe text" in _pdf_text(markdown)


def test_html_tables_keep_merged_cells_and_block_content() -> None:
    markdown = (
        "<table><tr><th colspan=\"2\">Team</th><th>Score</th></tr>"
        "<tr><td rowspan=\"2\">Ops</td><td>Ada</td><td>9</td></tr>"
        "<tr><td><ul><li>Bob</li><li>Cy</li></ul></td><td>7</td></tr></table>"
    )
    tree = parse_markdown(markdown)
    table = _types(tree, "table")[0]
    spans = [(c.attrs["colspan"], c.attrs["rowspan"]) for c in _types(table, "th") + _types(table, "td")]
    assert (2, 1) in spans and (1, 2) in spans
    assert _types(table, "bullet_list"), "a list inside a cell must stay a list"

    html = _html(markdown)
    assert 'colspan="2"' in html and 'rowspan="2"' in html and "<li>Bob</li>" in html

    document = _docx(markdown)
    text = _docx_text(document)
    assert "Team" in text and "Bob" in text and "Cy" in text
    grid = document.tables[0]
    assert len(grid.rows) == 3 and len(grid.columns) == 3
    assert grid.cell(0, 0)._tc is grid.cell(0, 1)._tc, "colspan must merge the cells"
    assert grid.cell(1, 0)._tc is grid.cell(2, 0)._tc, "rowspan must merge the cells"

    pdf = _pdf_text(markdown)
    for expected in ("Team", "Score", "Ada", "Bob", "Cy"):
        assert expected in pdf


def test_pipe_table_still_works_and_nested_tables_keep_their_own_rows() -> None:
    assert len(_types(parse_markdown("| a | b |\n|---|---|\n| 1 | 2 |"), "tr")) == 2
    outer = "<table><tr><td><table><tr><td>inner</td></tr></table></td><td>outer</td></tr></table>"
    tables = _types(parse_markdown(outer), "table")
    assert len(tables) == 2
    assert [len(t.children[0].children) for t in tables] == [1, 1]


FOOTNOTE_DOC = "Claim[^a] and another[^b].\n\n[^a]: First note.\n[^b]: Second note with `code`.\n"


def test_footnotes_render_everywhere() -> None:
    tree = parse_markdown(FOOTNOTE_DOC)
    assert [r.content for r in _types(tree, "footnote_ref")] == ["1", "2"]
    assert len(_types(tree, "footnote")) == 2

    html = _html(FOOTNOTE_DOC)
    assert 'href="#fnote-1"' in html and 'id="fnote-2"' in html and "Second note with" in html
    assert "[^a]" not in html and "[^b]:" not in html

    text = _docx_text(_docx(FOOTNOTE_DOC))
    assert "Footnotes" in text and "1. First note." in text and "[^" not in text
    pdf = _pdf_text(FOOTNOTE_DOC)
    assert "First note." in pdf and "[^" not in pdf


DEFLIST_DOC = "Term\n: The definition.\n\nOther\n: Second\n: Third\n"


def test_definition_lists_render_everywhere() -> None:
    tree = parse_markdown(DEFLIST_DOC)
    assert [t.children[0].children[0].content for t in _types(tree, "dt")] == ["Term", "Other"]
    assert len(_types(tree, "dd")) == 3
    html = _html(DEFLIST_DOC)
    assert "<dl><dt>Term</dt><dd><p>The definition.</p></dd>" in html or "<dd>The definition." in html or "The definition." in html
    assert "<dt>Other</dt>" in html
    assert "Third" in _docx_text(_docx(DEFLIST_DOC)) and "Third" in _pdf_text(DEFLIST_DOC)


def test_emoji_shortcodes_become_unicode_and_code_is_left_alone() -> None:
    markdown = "Ship it :rocket: :tada: and :not_an_emoji: `:rocket:`\n\n```\n:rocket:\n```"
    html = _html(markdown)
    assert "\U0001f680" in html and "\U0001f389" in html and ":not_an_emoji:" in html
    assert "<code>:rocket:</code>" in html and ":rocket:\n</code>" in html


MATH_DOC = "Inline $E=mc^2$ and \\(a^2+b^2=c^2\\).\n\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$\n\n\\[\\sum_{i=1}^{n} i\\]\n\nCosts $5 and $10 stay text.\n"


def test_math_in_all_notations_and_currency_left_alone() -> None:
    tree = parse_markdown(MATH_DOC)
    assert [n.content for n in _types(tree, "math_inline")] == ["E=mc^2", "a^2+b^2=c^2"]
    assert [n.content for n in _types(tree, "math_block")] == [r"\int_0^1 x\,dx = \frac{1}{2}", r"\sum_{i=1}^{n} i"]
    html = _html(MATH_DOC)
    assert "<math" in html and 'data-tex="E=mc^2"' in html
    assert "Costs $5 and $10 stay text." in html
    text = _docx_text(_docx(MATH_DOC))
    assert "E=mc²" in text and "a²+b²=c²" in text and "∫" in text and "(1)/(2)" in text and "∑" in text
    assert "$" in text  # the currency sentence
    assert "E=mc²" in _pdf_text(MATH_DOC)


def test_math_is_not_parsed_inside_code() -> None:
    tree = parse_markdown("`$x$` and\n\n```\n\\(y\\) $z$\n```\n")
    assert not _types(tree, "math_inline") and not _types(tree, "math_block")


@pytest.mark.parametrize(
    ("tex", "expected"),
    [
        (r"\alpha + \beta", "α + β"),
        (r"x^{2}", "x²"),
        (r"x_{i+1}", "x_(i+1)"),
        (r"\sqrt{x+1}", "√(x+1)"),
        (r"\mathbb{R}", "ℝ"),
        (r"a \leq b \neq c", "a ≤ b ≠ c"),
        (r"\frac{a}{b}", "(a)/(b)"),
    ],
)
def test_tex_to_text(tex: str, expected: str) -> None:
    assert tex_to_text(tex) == expected


def test_callouts_and_tasks_come_from_both_markdown_and_preview_html() -> None:
    markdown = "> [!WARNING]\n> Needs review.\n\n- [x] Done\n- [ ] Todo\n"
    from_markdown = parse_markdown(markdown)
    preview_html = (
        '<blockquote class="callout callout-warning" data-callout="warning"><p><strong>Warning</strong><br>Needs review.</p></blockquote>'
        '<ul><li><span class="md-task" role="checkbox" aria-checked="true"></span> Done</li>'
        '<li><span class="md-task" role="checkbox" aria-checked="false"></span> Todo</li></ul>'
    )
    from_preview = html_to_tree(preview_html)

    def signature(tree: Node) -> tuple:
        return (
            [q.meta.get("callout") for q in _types(tree, "blockquote")],
            [i.meta.get("task") for i in _types(tree, "list_item")],
            [t.content for t in _types(tree, "text")],
        )

    assert signature(from_markdown) == signature(from_preview) == (["warning"], [True, False], ["Needs review.", "Done", "Todo"])


def test_exports_follow_the_preview_html_when_the_client_sends_it() -> None:
    markdown = "# Source says one thing"
    preview = "<h1>Preview says another</h1><p>with <kbd>K</kbd></p>"
    html = _html(markdown, preview)
    assert "Preview says another" in html and "Source says" not in html
    assert "Preview says another" in _docx_text(_docx(markdown, preview))
    assert "Preview says another" in _pdf_text(markdown, preview)


def test_preview_html_mermaid_and_code_blocks_round_trip() -> None:
    preview = '<div class="mermaid">flowchart LR\nA --&gt; B</div><pre><code class="language-python">print(1)\n</code></pre>'
    tree = html_to_tree(preview)
    fences = _types(tree, "fence")
    assert [(f.info, f.content.strip()) for f in fences] == [("mermaid", "flowchart LR\nA --> B"), ("python", "print(1)")]


def test_markdown_to_html_keeps_blank_lines_inside_details_markdown() -> None:
    html = markdown_to_html("<details>\n<summary>S</summary>\n\n- a\n- b\n\n</details>")
    tree = html_to_tree(html)
    details = _types(tree, "details")[0]
    assert details.meta["summary"].children[0].content == "S"
    assert len(_types(details, "list_item")) == 2


def test_rtl_blocks_get_auto_direction_and_docx_bidi() -> None:
    markdown = "# שלום עולם\n\nمرحبا بالعالم\n\nHello world\n"
    html = _html(markdown)
    assert html.count('dir="auto"') == 2 and '<h1 dir="auto">' in html
    document = _docx(markdown)
    flags = ["w:bidi" in paragraph._p.xml.replace("<w:bidi/>", "w:bidi") for paragraph in document.paragraphs if paragraph.text]
    assert flags == [True, True, False]


def test_column_alignment_survives_in_every_format_and_from_preview_html() -> None:
    markdown = "| Left | Mid | Right |\n|:-----|:---:|------:|\n| a | b | c |\n"
    html = _html(markdown)
    assert '<th style="text-align:center">Mid</th>' in html and '<td style="text-align:right">c</td>' in html
    table = _docx(markdown).tables[0]
    assert [cell.paragraphs[0].alignment for cell in table.rows[1].cells] == [None, 1, 2]
    preview = '<table><thead><tr><th align="center">Mid</th></tr></thead><tbody><tr><td align="right">c</td></tr></tbody></table>'
    assert 'style="text-align:center"' in _html("x", preview) and 'style="text-align:right"' in _html("x", preview)
    assert "Mid" in _pdf_text(markdown)
