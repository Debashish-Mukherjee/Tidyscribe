"""Document tree shared by the HTML, DOCX and PDF writers.

Markdown is rendered to HTML (markdown-it, raw HTML allowed) and the HTML is converted here, through the shared
policy in html_policy.py, into a small tree. The web UI sends the HTML its Preview shows, so the Preview is the
source of truth; API-only clients get the same tree from the server-side Markdown renderer.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Iterator

from lxml import html as lxml_html
from markdown_it import MarkdownIt
from mdit_py_plugins.deflist import deflist_plugin
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.footnote import footnote_plugin

from app.services.diagram_service import expand_plantuml
from app.services.html_policy import ALLOWED_TAGS, DROPPED_WITH_CONTENT, SAFE_LINK_SCHEMES

CALLOUT_KINDS = ("warning", "tip", "note", "important", "caution")
_CALLOUT_RE = re.compile(r"^\s*\[!(WARNING|TIP|NOTE|IMPORTANT|CAUTION)\]\s*", re.IGNORECASE)
_TASK_RE = re.compile(r"^\[([ xX])\]\s+")
_ASCII_BOX_RE = re.compile(r"^\s*(?:\+[-=]{2,}\+|[┌╔╭┏][─═━]{2,}[┐╗╮┓])(?:[\s─━═\-=<>▶►→←]*(?:\+[-=]{2,}\+|[┌╔╭┏][─═━]{2,}[┐╗╮┓]))*\s*$")
_WS = re.compile(r"\s+")
_FENCE_LINE = re.compile(r"^\s*(```|~~~)")


@dataclass
class Node:
    type: str
    children: list["Node"] = field(default_factory=list)
    content: str = ""
    tag: str = ""
    info: str = ""
    meta: dict = field(default_factory=dict)
    attrs: dict = field(default_factory=dict)
    hidden: bool = False

    def attrGet(self, name: str):  # noqa: N802 - same accessor name the writers already use
        return self.attrs.get(name)

    def walk(self) -> Iterator["Node"]:
        yield self
        for child in self.children:
            yield from child.walk()


# ------------------------------------------------------------------ Markdown to HTML

@lru_cache(maxsize=1)
def emoji_map() -> dict[str, str]:
    return json.loads((Path(__file__).resolve().parent.parent / "data" / "emoji.json").read_text(encoding="utf-8"))


def _fence_ascii_diagrams(markdown: str) -> str:
    """Wrap bare `+---+` box drawings in a code fence so spacing survives."""
    lines = markdown.split("\n")
    out: list[str] = []
    in_fence = False
    i = 0
    while i < len(lines):
        line = lines[i]
        if _FENCE_LINE.match(line):
            in_fence = not in_fence
            out.append(line)
            i += 1
        elif not in_fence and _ASCII_BOX_RE.match(line.strip()):
            block: list[str] = []
            while i < len(lines) and lines[i].strip() and not _FENCE_LINE.match(lines[i]):
                block.append(lines[i])
                i += 1
            out.extend(["```text", *block, "```"])
        else:
            out.append(line)
            i += 1
    return "\n".join(out)


_CODE_SPAN = re.compile(r"(`+)[\s\S]*?\1")
_PAREN_MATH = re.compile(r"\\\((.+?)\\\)")
_BRACKET_MATH = re.compile(r"\\\[([\s\S]+?)\\\]")


def _bracket_math_to_dollars(markdown: str) -> str:
    """`\\(x\\)` and `\\[x\\]` become `$x$` and `$$x$$`, outside code, so one math grammar serves both renderers."""

    def convert_plain(text: str) -> str:
        text = _BRACKET_MATH.sub(lambda m: f"\n$$\n{m.group(1).strip()}\n$$\n", text)
        return _PAREN_MATH.sub(lambda m: f"${m.group(1).strip()}$", text)

    def convert(segment: str) -> str:
        parts: list[str] = []
        last = 0
        for span in _CODE_SPAN.finditer(segment):
            parts.append(convert_plain(segment[last:span.start()]))
            parts.append(span.group(0))
            last = span.end()
        parts.append(convert_plain(segment[last:]))
        return "".join(parts)

    out: list[str] = []
    segment: list[str] = []
    in_fence = False

    def flush() -> None:
        if segment:
            text = "\n".join(segment)
            out.append(text if in_fence else convert(text))
            segment.clear()

    for line in markdown.split("\n"):
        if _FENCE_LINE.match(line):
            flush()
            out.append(line)
            in_fence = not in_fence
        else:
            segment.append(line)
    flush()
    return "\n".join(out)


_EMOJI_RE = re.compile(r":([a-z0-9_+-]+):")


def _emoji_rule(state) -> None:
    mapping = emoji_map()
    for token in state.tokens:
        if token.type != "inline" or not token.children:
            continue
        for child in token.children:
            if child.type == "text" and ":" in child.content:
                child.content = _EMOJI_RE.sub(lambda m: mapping.get(m.group(1), m.group(0)), child.content)


def _math_renderer(content: str, options: dict) -> str:
    from html import escape

    display = bool(options.get("display_mode"))
    tag, klass = ("div", "math math-block") if display else ("span", "math math-inline")
    return f'<{tag} class="{klass}" data-tex="{escape(content.strip(), quote=True)}">{escape(content.strip())}</{tag}>'


def _markdown_engine() -> MarkdownIt:
    md = MarkdownIt("gfm-like", {"html": True, "breaks": True})
    md.use(footnote_plugin)
    md.use(deflist_plugin)
    md.use(dollarmath_plugin, allow_space=False, allow_digits=False, double_inline=False, renderer=_math_renderer)
    md.core.ruler.push("workbench_emoji", _emoji_rule)
    return md


def markdown_to_html(markdown: str) -> str:
    source = expand_plantuml(markdown.replace("\r\n", "\n")).markdown
    source = _bracket_math_to_dollars(_fence_ascii_diagrams(source))
    return _markdown_engine().render(source)


# ------------------------------------------------------------------ HTML to tree

def _collapse(text: str) -> str:
    return _WS.sub(" ", text)


def _safe_href(value: str | None) -> str | None:
    href = (value or "").strip()
    return href if href.lower().startswith(SAFE_LINK_SCHEMES) else None


def _classes(element) -> set[str]:
    return set((element.get("class") or "").split())


def _tag(element) -> str:
    return element.tag.lower() if isinstance(element.tag, str) else ""


def _tex_of(element) -> str:
    tex = element.get("data-tex")
    if tex:
        return tex
    for annotation in element.iter("annotation"):
        if (annotation.get("encoding") or "").lower() == "application/x-tex":
            return (annotation.text_content() or "").strip()
    return element.text_content().strip()


def _finish_inline(nodes: list[Node]) -> list[Node]:
    """Merge adjacent text, trim edges and drop spaces next to line breaks."""
    merged: list[Node] = []
    for node in nodes:
        if node.type == "text" and merged and merged[-1].type == "text":
            merged[-1] = Node("text", content=merged[-1].content + node.content)
        else:
            merged.append(node)
    for index, node in enumerate(merged):
        if node.type != "text":
            continue
        text = node.content
        if index == 0 or merged[index - 1].type == "hardbreak":
            text = text.lstrip()
        if index == len(merged) - 1 or merged[index + 1].type == "hardbreak":
            text = text.rstrip()
        node.content = text
    return [node for node in merged if node.type != "text" or node.content]


_INLINE_WRAPPERS = {
    "strong": "strong", "b": "strong", "em": "em", "i": "em", "cite": "em", "var": "em",
    "del": "s", "s": "s", "u": "u", "ins": "u", "sub": "sub", "sup": "sup", "kbd": "kbd", "samp": "kbd",
    "mark": "mark", "small": "small", "abbr": "abbr", "q": "q",
}


def _inline(element, in_pre: bool = False) -> list[Node]:
    out: list[Node] = []
    if element.text:
        out.append(Node("text", content=element.text if in_pre else _collapse(element.text)))
    for child in element:
        out.extend(_inline_element(child))
        if child.tail:
            out.append(Node("text", content=child.tail if in_pre else _collapse(child.tail)))
    return out


def _inline_element(child) -> list[Node]:
    tag = _tag(child)
    if not tag or tag in DROPPED_WITH_CONTENT:
        return []
    classes = _classes(child)
    if "math" in classes or tag == "math":
        return [Node("math_inline", content=_tex_of(child))]
    if tag == "br":
        return [Node("hardbreak")]
    if tag == "code":
        return [Node("code_inline", content=child.text_content())]
    if tag == "input":
        return [Node("task_marker", meta={"checked": child.get("checked") is not None})] if (child.get("type") or "").lower() == "checkbox" else []
    if "md-task" in classes:
        return [Node("task_marker", meta={"checked": (child.get("aria-checked") or "").lower() == "true"})]
    if tag == "sup" and "footnote-ref" in classes:
        return [Node("footnote_ref", content=child.text_content().strip().strip("[]"), attrs={"target": ((child.find(".//a") is not None and child.find(".//a").get("href")) or "").lstrip("#")})]
    if tag == "img":
        alt = child.get("alt") or ""
        return [Node("image", content=alt)] if alt else []
    if tag == "a":
        href = _safe_href(child.get("href"))
        inner = _inline(child)
        if href is None:
            return inner
        return [Node("link", children=inner, attrs={"href": href})]
    if tag in _INLINE_WRAPPERS:
        node_type = _INLINE_WRAPPERS[tag]
        inner = _inline(child)
        if node_type in ("abbr", "q"):
            if tag == "abbr" and child.get("title"):
                return inner + [Node("text", content=f" ({child.get('title')})")]
            if tag == "q":
                return [Node("text", content="\u201c")] + inner + [Node("text", content="\u201d")]
            return inner
        return [Node(node_type, children=inner)]
    if tag == "span":
        return _inline(child)
    # Unknown or block element reached inline context: keep its text.
    return _inline(child) if tag in ALLOWED_TAGS or tag else []


def _inline_node(nodes: list[Node]) -> Node:
    return Node("inline", children=_finish_inline(nodes))


def _blank(nodes: list[Node]) -> bool:
    return all(n.type == "text" and not n.content.strip() for n in nodes)


_BLOCK_TAGS_HANDLED = {
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "dl", "table", "hr",
    "details", "div", "section", "li", "dt", "dd", "caption", "summary", "thead", "tbody", "tfoot", "tr", "th", "td",
}


def _blocks(element, tight: bool = False) -> list[Node]:
    """Children of a container as blocks; loose text and inline elements become paragraphs."""
    out: list[Node] = []
    buffer: list[Node] = []

    def flush() -> None:
        nonlocal buffer
        if buffer and not _blank(buffer):
            node = Node("paragraph", children=[_inline_node(buffer)], hidden=tight)
            if node.children[0].children:
                out.append(node)
        buffer = []

    if element.text:
        buffer.append(Node("text", content=_collapse(element.text)))
    for child in element:
        tag = _tag(child)
        if tag in DROPPED_WITH_CONTENT or not tag:
            pass
        elif tag in _BLOCK_TAGS_HANDLED:
            flush()
            out.extend(_block(child))
        else:
            buffer.extend(_inline_element(child))
        if child.tail:
            buffer.append(Node("text", content=_collapse(child.tail)))
    flush()
    return out


def _callout_from_blockquote(element, children: list[Node]) -> tuple[str | None, list[Node]]:
    kind = (element.get("data-callout") or "").lower()
    kind = kind if kind in CALLOUT_KINDS else ""
    first = children[0] if children else None
    inline = first.children[0] if first is not None and first.type == "paragraph" and first.children else None
    if inline is not None and inline.children:
        lead = inline.children
        if kind:
            # Preview form: <strong>Label</strong><br> then the text.
            if lead[0].type == "strong" and "".join(c.content for c in lead[0].children if c.type == "text").strip().lower() == kind:
                del lead[0]
                if lead and lead[0].type == "hardbreak":
                    del lead[0]
        elif lead[0].type == "text":
            match = _CALLOUT_RE.match(lead[0].content)
            if match:
                kind = match.group(1).lower()
                lead[0].content = lead[0].content[match.end():]
                if not lead[0].content:
                    del lead[0]
                if lead and lead[0].type == "hardbreak":
                    del lead[0]
        if not lead:
            children = children[1:]
    return (kind or None), children


def _list_item(element, ordered: bool) -> Node:
    children = _blocks(element, tight=True)
    task = None
    if children and children[0].type == "paragraph" and children[0].children:
        inline = children[0].children[0]
        if inline.children and inline.children[0].type == "task_marker":
            task = bool(inline.children[0].meta["checked"])
            del inline.children[0]
        elif inline.children and inline.children[0].type == "text":
            match = _TASK_RE.match(inline.children[0].content)
            if match:
                task = match.group(1).lower() == "x"
                inline.children[0].content = inline.children[0].content[match.end():]
        if task is not None:
            inline.children = _finish_inline(inline.children)
    node = Node("list_item", children=children)
    if task is not None:
        node.meta["task"] = task
    return node


def _own_rows(table) -> list:
    """Rows of this table only; a table nested in a cell keeps its own."""
    rows: list = []
    for child in table:
        if _tag(child) == "tr":
            rows.append(child)
        elif _tag(child) in ("thead", "tbody", "tfoot"):
            rows.extend(row for row in child if _tag(row) == "tr")
    return rows


def _table(element) -> Node:
    rows = _own_rows(element)
    if not rows:
        return Node("table")
    head_rows = [r for r in rows if _tag(r.getparent()) == "thead"]
    if not head_rows and rows and all(_tag(c) == "th" for c in rows[0]) and len(rows[0]):
        head_rows = [rows[0]]
    body_rows = [r for r in rows if r not in head_rows]
    table = Node("table")
    for section_type, section_rows in (("thead", head_rows), ("tbody", body_rows)):
        if not section_rows:
            continue
        section = Node(section_type)
        for row in section_rows:
            tr = Node("tr")
            for cell in row:
                if _tag(cell) not in ("td", "th"):
                    continue
                blocks = _blocks(cell, tight=True)
                simple = all(b.type == "paragraph" for b in blocks) and len(blocks) <= 1
                if simple:
                    inline = blocks[0].children[0] if blocks else Node("inline")
                    children = [inline]
                else:
                    children = blocks
                attrs: dict = {}
                align = (cell.get("align") or (re.search(r"text-align\s*:\s*(left|right|center)", cell.get("style") or "", re.IGNORECASE) or [None, ""])[1] or "").lower()
                if align in ("left", "right", "center"):
                    attrs["align"] = align
                for name in ("colspan", "rowspan"):
                    try:
                        attrs[name] = max(1, min(int(cell.get(name) or 1), 200))
                    except ValueError:
                        attrs[name] = 1
                tr.children.append(Node("th" if section_type == "thead" or _tag(cell) == "th" else "td", children=children, attrs=attrs))
            if tr.children:
                section.children.append(tr)
        table.children.append(section)
    caption = element.find("caption")
    if caption is not None and caption.text_content().strip():
        table.meta["caption"] = caption.text_content().strip()
    return table


def _footnotes(element) -> Node:
    items = Node("footnotes")
    for number, li in enumerate(element.iter("li"), start=1):
        for backref in list(li.iter("a")):
            if "footnote-backref" in _classes(backref) or (backref.text_content() or "").strip() in ("\u21a9", "\u21a9\ufe0e"):
                backref.getparent().remove(backref)
        items.children.append(Node("footnote", children=_blocks(li), attrs={"id": (li.get("id") or "").strip()}, content=str(number)))
    return items


def _block(element) -> list[Node]:
    tag = _tag(element)
    classes = _classes(element)
    if tag in ("p", "caption", "summary"):
        if tag != "p":
            return []
        inline = _inline_node(_inline(element))
        return [Node("paragraph", children=[inline])] if inline.children else []
    if tag in tuple(f"h{n}" for n in range(1, 7)):
        inline = _inline_node(_inline(element))
        return [Node("heading", tag=tag, children=[inline])] if inline.children else []
    if tag == "hr":
        return [] if "footnotes-sep" in classes else [Node("hr")]
    if tag == "pre":
        code = element.find(".//code")
        match = re.search(r"language-([\w+#.-]+)", (code.get("class") if code is not None else "") or "")
        return [Node("fence", info=match.group(1) if match else "", content=element.text_content())]
    if tag == "blockquote":
        children = _blocks(element)
        kind, children = _callout_from_blockquote(element, children)
        node = Node("blockquote", children=children)
        if kind:
            node.meta["callout"] = kind
        return [node]
    if tag in ("ul", "ol"):
        node = Node("bullet_list" if tag == "ul" else "ordered_list")
        if tag == "ol" and element.get("start"):
            node.attrs["start"] = element.get("start")
        node.children = [_list_item(li, tag == "ol") for li in element if _tag(li) == "li"]
        return [node]
    if tag == "dl":
        node = Node("dl")
        for child in element:
            if _tag(child) == "dt":
                node.children.append(Node("dt", children=[_inline_node(_inline(child))]))
            elif _tag(child) == "dd":
                node.children.append(Node("dd", children=_blocks(child, tight=True)))
        return [node]
    if tag == "table":
        return [_table(element)]
    if tag == "details":
        summary = next((c for c in element if _tag(c) == "summary"), None)
        node = Node("details", attrs={"open": element.get("open") is not None})
        if summary is not None:
            node.meta["summary"] = _inline_node(_inline(summary))
            element.remove(summary)
        node.children = _blocks(element)
        return [node]
    if tag == "section" and ("footnotes" in classes or element.get("data-footnotes") is not None):
        return [_footnotes(element)]
    if tag == "div":
        if "mermaid" in classes:
            return [Node("fence", info="mermaid", content=element.text_content())]
        if "math" in classes:
            return [Node("math_block", content=_tex_of(element))]
        return _blocks(element)
    if tag == "math":
        return [Node("math_block", content=_tex_of(element))] if element.get("display") == "block" else [Node("paragraph", children=[Node("inline", children=[Node("math_inline", content=_tex_of(element))])])]
    if tag in ("li", "dt", "dd", "thead", "tbody", "tfoot", "tr", "th", "td"):
        return _blocks(element)
    return _blocks(element)


def html_to_tree(html: str) -> Node:
    root = Node("root")
    if not html.strip():
        return root
    document = lxml_html.document_fromstring(html)
    body = document.find("body")
    root.children = _blocks(body if body is not None else document)
    return root


def parse_markdown(markdown: str) -> Node:
    return html_to_tree(markdown_to_html(markdown))


def parse_document(markdown: str, html: str | None = None) -> Node:
    """The tree for an export: the Preview's own HTML when the client supplied it, else the server-rendered Markdown."""
    return html_to_tree(html) if html and html.strip() else parse_markdown(markdown)
