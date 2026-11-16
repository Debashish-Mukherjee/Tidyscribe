"""Diagram conversions: ASCII boxes -> Mermaid/SVG/Draw.io; PlantUML, Draw.io, Terraform and Kubernetes -> Mermaid."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from app.services.ascii_diagram import Box, Diagram, parse_ascii_diagram
from app.services.drawio_import import drawio_to_mermaid
from app.services.infra_diagrams import kubernetes_to_mermaid, terraform_to_mermaid
from app.services.plantuml_extra import looks_like_activity, looks_like_component, plantuml_activity, plantuml_component

# ---------------------------------------------------------------- ASCII and Unicode box diagrams

CHAR_W, CHAR_H, PAD = 9, 22, 24


def ascii_nodes(text: str) -> list[str]:
    """Box labels in reading order; a box spanning several rows becomes one label."""
    return [box.label for box in parse_ascii_diagram(text).boxes if box.label]


def _mermaid_label(label: str) -> str:
    return label.replace('"', "#quot;")


def _centre(box: Box) -> tuple[float, float]:
    return (box.left + box.right) / 2, (box.top + box.bottom) / 2


def diagram_to_mermaid(diagram: Diagram) -> str:
    boxes = diagram.boxes
    containers = {b.index for b in boxes if any(b.contains(o) for o in boxes)}
    horizontal = sum(abs(_centre(boxes[e.target])[0] - _centre(boxes[e.source])[0]) > abs(_centre(boxes[e.target])[1] - _centre(boxes[e.source])[1]) * 2.2 for e in diagram.edges)
    direction = "LR" if horizontal > len(diagram.edges) - horizontal else "TD"
    lines = [f"flowchart {direction}"]

    def ref(index: int) -> str:
        box = boxes[index]
        return f"N{index + 1}" if index in containers else f'N{index + 1}["{_mermaid_label(box.label or f"Box {index + 1}")}"]'

    edge_nodes = {e.source for e in diagram.edges} | {e.target for e in diagram.edges}

    def emit(parent: int | None, depth: int) -> None:
        pad = "    " * (depth + 1)
        for box in boxes:
            if box.parent != parent:
                continue
            if box.index in containers:
                lines.append(f'{pad}subgraph N{box.index + 1}["{_mermaid_label(box.label or f"Group {box.index + 1}")}"]')
                emit(box.index, depth + 1)
                lines.append(f"{pad}end")
            elif parent is not None or box.index not in edge_nodes:
                lines.append(f"{pad}{ref(box.index)}")

    emit(None, 0)
    arrows = {"forward": "-->", "none": "---", "both": "<-->"}
    for edge in sorted(diagram.edges, key=lambda e: (e.source, e.target)):
        label = f"|{edge.label.replace('|', '/').replace(chr(34), '#quot;')}|" if edge.label else ""
        lines.append(f"    {ref(edge.source)} {arrows[edge.arrow]}{label} {ref(edge.target)}")
    return "\n".join(lines)


def ascii_to_mermaid(text: str) -> str | None:
    diagram = parse_ascii_diagram(text)
    if diagram.problem or not diagram.edges:
        return None
    return diagram_to_mermaid(diagram)


def ascii_warnings(text: str) -> list[str]:
    return parse_ascii_diagram(text).warnings


def ascii_problem(text: str) -> str | None:
    """Why a box diagram cannot be converted, in words the author can act on (None when it can)."""
    diagram = parse_ascii_diagram(text)
    if diagram.problem:
        return diagram.problem
    return None if diagram.edges else "Found the boxes but no connections between them. Join two boxes with a line or an arrow (--> or ─▶)."


def _rect(box: Box) -> tuple[float, float, float, float]:
    return box.left * CHAR_W + PAD, box.top * CHAR_H + PAD, (box.width) * CHAR_W, box.height * CHAR_H


def _edge_points(source: Box, target: Box) -> tuple[tuple[float, float], tuple[float, float]]:
    sx, sy, sw, sh = _rect(source)
    tx, ty, tw, th = _rect(target)
    scx, scy, tcx, tcy = sx + sw / 2, sy + sh / 2, tx + tw / 2, ty + th / 2
    dx, dy = tcx - scx, tcy - scy

    def clip(cx: float, cy: float, w: float, h: float, vx: float, vy: float) -> tuple[float, float]:
        scale = min((w / 2) / abs(vx) if vx else float("inf"), (h / 2) / abs(vy) if vy else float("inf"))
        return cx + vx * scale, cy + vy * scale

    return clip(scx, scy, sw, sh, dx, dy), clip(tcx, tcy, tw, th, -dx, -dy)


def ascii_to_svg(text: str) -> str | None:
    diagram = parse_ascii_diagram(text)
    if diagram.problem or not diagram.edges:
        return None
    boxes = diagram.boxes
    width = max(_rect(b)[0] + _rect(b)[2] for b in boxes) + PAD
    height = max(_rect(b)[1] + _rect(b)[3] for b in boxes) + PAD
    containers = {b.index for b in boxes if any(b.contains(o) for o in boxes)}
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{height:g}" viewBox="0 0 {width:g} {height:g}" font-family="Arial, Helvetica, sans-serif" font-size="14">',
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#57606a"/></marker></defs>',
        f'<rect width="{width:g}" height="{height:g}" fill="#ffffff"/>',
    ]
    for box in sorted(boxes, key=lambda b: b.width * b.height, reverse=True):
        x, y, w, h = _rect(box)
        fill = "#f6f8fa" if box.index in containers else "#ddf4ff"
        parts.append(f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="8" fill="{fill}" stroke="#0969da" stroke-width="1.5"/>')
        label_y = y + 16 if box.index in containers else y + h / 2 + 5
        parts.append(f'<text x="{x + w / 2:g}" y="{label_y:g}" text-anchor="middle" fill="#1f2328">{html.escape(box.label)}</text>')
    for edge in diagram.edges:
        (x1, y1), (x2, y2) = _edge_points(boxes[edge.source], boxes[edge.target])
        markers = ' marker-end="url(#arrow)"' if edge.arrow in ("forward", "both") else ""
        markers += ' marker-start="url(#arrow)"' if edge.arrow == "both" else ""
        parts.append(f'<line x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" stroke="#57606a" stroke-width="1.5"{markers}/>')
        if edge.label:
            parts.append(f'<text x="{(x1 + x2) / 2 + 6:g}" y="{(y1 + y2) / 2 - 4:g}" fill="#57606a" font-size="12">{html.escape(edge.label)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def ascii_to_drawio(text: str) -> str | None:
    diagram = parse_ascii_diagram(text)
    if diagram.problem or not diagram.edges:
        return None
    file = ET.Element("mxfile", host="Tidyscribe")
    page = ET.SubElement(file, "diagram", name="Page-1", id="page-1")
    model = ET.SubElement(page, "mxGraphModel", grid="1", gridSize="10", page="1", pageWidth="827", pageHeight="1169")
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", id="0")
    ET.SubElement(root, "mxCell", id="1", parent="0")
    containers = {b.index for b in diagram.boxes if any(b.contains(o) for o in diagram.boxes)}
    for box in sorted(diagram.boxes, key=lambda b: b.width * b.height, reverse=True):
        x, y, w, h = _rect(box)
        style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#f6f8fa;strokeColor=#6c8ebf;verticalAlign=top;" if box.index in containers else "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
        cell = ET.SubElement(root, "mxCell", id=f"n{box.index + 1}", value=box.label, vertex="1", parent="1", style=style)
        ET.SubElement(cell, "mxGeometry", x=f"{x:g}", y=f"{y:g}", width=f"{w:g}", height=f"{h:g}", **{"as": "geometry"})
    for number, edge in enumerate(diagram.edges, start=1):
        ends = {"forward": "endArrow=classic;", "both": "endArrow=classic;startArrow=classic;", "none": "endArrow=none;"}[edge.arrow]
        cell = ET.SubElement(
            root, "mxCell", id=f"e{number}", value=edge.label, edge="1", parent="1", source=f"n{edge.source + 1}", target=f"n{edge.target + 1}",
            style=f"edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;{ends}",
        )
        ET.SubElement(cell, "mxGeometry", relative="1", **{"as": "geometry"})
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(file, encoding="unicode")


# ---------------------------------------------------------------- PlantUML

_IGNORED = re.compile(
    r"^(skinparam|hide|show|title|header|footer|legend|endlegend|scale|newpage|left to right direction|top to bottom direction|set\s|!|'|\.\.\.|\|\|\||==|return\b|destroy\b)",
    re.IGNORECASE,
)
_DECL = re.compile(
    r'^(?P<kind>participant|actor|boundary|control|entity|database|collections|queue)\s+(?P<first>"[^"]+"|\S+)(?:\s+as\s+(?P<second>"[^"]+"|\S+))?(?:\s+#\w+)?\s*$',
    re.IGNORECASE,
)
_ARROWS = {
    "-->>": ("-->>", False), "->>": ("->>", False), "-->x": ("--x", False), "->x": ("-x", False),
    "-->": ("-->>", False), "->": ("->>", False),
    "<<--": ("-->>", True), "<<-": ("->>", True), "<--": ("-->>", True), "<-": ("->>", True),
}
_MESSAGE = re.compile(
    r'^(?P<a>"[^"]+"|[^\s:]+?)\s*(?P<arrow>-->>|->>|-->x|->x|-->|->|<<--|<<-|<--|<-)\s*(?P<b>"[^"]+"|[^\s:]+?)\s*(?::\s*(?P<text>.*))?$'
)
_NOTE = re.compile(r"^(?:note|rnote|hnote)\s+(?P<pos>left of|right of|over|left|right)\s+(?P<who>[^:]+?)\s*(?::\s*(?P<text>.*))?$", re.IGNORECASE)
_BLOCKS = {"alt", "else", "opt", "loop", "par", "and", "critical", "break", "group"}


def _unquote(value: str) -> str:
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] == '"' else value


def _clean(lines: list[str]) -> list[str]:
    out: list[str] = []
    in_block_comment = False
    for raw in lines:
        line = raw.strip()
        if in_block_comment:
            in_block_comment = "'/" not in line
            continue
        if line.startswith("/'"):
            in_block_comment = "'/" not in line
            continue
        if not line or re.match(r"^@(startuml|enduml)", line, re.IGNORECASE):
            continue
        out.append(line)
    return out


def _plantuml_sequence(lines: list[str]) -> str | None:
    participants: dict[str, tuple[str, str]] = {}  # id -> (kind, display)
    body: list[str] = []
    messages = 0

    def ident(token: str, kind: str = "participant", display: str | None = None) -> str:
        name = _unquote(token.strip())
        key = re.sub(r"[^A-Za-z0-9_]", "_", name) or "P"
        if key not in participants:
            participants[key] = (kind, display or name)
        elif display or kind != "participant":
            old_kind, old_display = participants[key]
            participants[key] = (kind if kind != "participant" else old_kind, display or old_display)
        return key

    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        if _IGNORED.match(line):
            continue
        if line.lower() == "autonumber":
            body.append("autonumber")
            continue
        decl = _DECL.match(line)
        if decl:
            first, second = decl.group("first"), decl.group("second")
            kind = "actor" if decl.group("kind").lower() == "actor" else "participant"
            if second is None:
                ident(first, kind)
            elif second.startswith('"'):
                ident(first, kind, _unquote(second))
            else:
                ident(second, kind, _unquote(first))
            continue
        word = line.split(None, 1)[0].lower()
        if word in {"activate", "deactivate"} and len(line.split(None, 1)) == 2:
            body.append(f"{word} {ident(line.split(None, 1)[1])}")
            continue
        note = _NOTE.match(line)
        if note:
            text = note.group("text")
            if text is None:
                collected: list[str] = []
                while index < len(lines) and not re.match(r"^(end\s*note|endnote|end rnote|end hnote)$", lines[index], re.IGNORECASE):
                    collected.append(lines[index])
                    index += 1
                index += 1
                text = "<br/>".join(collected)
            pos = note.group("pos").lower()
            pos = {"left": "left of", "right": "right of"}.get(pos, pos)
            who = ",".join(ident(w) for w in note.group("who").split(","))
            body.append(f"Note {pos} {who}: {text}")
            continue
        if word in _BLOCKS and not _MESSAGE.match(line):
            rest = line.split(None, 1)[1] if len(line.split(None, 1)) == 2 else ""
            body.append(f"{'opt' if word == 'group' else word} {rest}".rstrip())
            continue
        if line.lower() == "end":
            body.append("end")
            continue
        message = _MESSAGE.match(line)
        if message:
            arrow, swap = _ARROWS[message.group("arrow")]
            a, b = ident(message.group("a")), ident(message.group("b"))
            if swap:
                a, b = b, a
            text = (message.group("text") or "").strip()
            body.append(f"{a}{arrow}{b}: {text}" if text else f"{a}{arrow}{b}: ")
            messages += 1
    if messages == 0:
        return None
    out = ["sequenceDiagram"]
    for key, (kind, display) in participants.items():
        out.append(f"    {kind} {key}" + (f" as {display}" if display != key else ""))
    out.extend(f"    {line}" for line in body)
    return "\n".join(out)


_CLASS_DECL = re.compile(
    r"^(?P<kind>abstract class|abstract|class|interface|enum|annotation)\s+(?P<name>[\w.]+)(?:<[^>]*>)?(?:\s+<<(?P<st>[^>]+)>>)?"
    r"(?:\s+(?P<rel>extends|implements)\s+(?P<parent>[\w.]+))?\s*(?P<open>\{)?\s*$",
    re.IGNORECASE,
)
_CONTAINER = re.compile(r"^(package|namespace|folder|node|frame|rectangle|cloud|database)\b.*\{\s*$", re.IGNORECASE)
_RELATION = re.compile(
    r'^(?P<a>[\w.]+)\s*(?P<ca>"[^"]*")?\s*(?P<arrow>[<|*o]{0,2}[-.]+(?:left|right|up|down|l|r|u|d)?[-.]*[|>*o]{0,2})\s*(?P<cb>"[^"]*")?\s*(?P<b>[\w.]+)\s*(?::\s*(?P<label>.*))?$',
    re.IGNORECASE,
)
_STEREOTYPES = {"interface": "interface", "abstract": "abstract", "abstract class": "abstract", "enum": "enumeration", "annotation": "annotation"}
_MERMAID_ARROWS = {"<|--", "*--", "o--", "-->", "<--", "..>", "<..", "..|>", "<|..", "--", "..", "--*", "--o", "--|>", "..|>"}


def _normalize_arrow(arrow: str) -> str | None:
    cleaned = re.sub(r"(?<=[-.])(?:left|right|up|down|l|r|u|d)(?=[-.]|$)", "", arrow, flags=re.IGNORECASE)
    cleaned = re.sub(r"-{2,}", "--", cleaned)
    cleaned = re.sub(r"\.{2,}", "..", cleaned)
    if cleaned == "->":
        cleaned = "-->"
    elif cleaned == "<-":
        cleaned = "<--"
    elif cleaned == ".>":
        cleaned = "..>"
    return cleaned if cleaned in _MERMAID_ARROWS else None


def _plantuml_class(lines: list[str]) -> str | None:
    out: list[str] = ["classDiagram"]
    stack: list[str] = []
    declared = relations = 0
    for line in lines:
        if stack and stack[-1] == "class":
            if line == "}":
                stack.pop()
                out.append("    }")
            elif not re.match(r"^(--|\.\.|==|__)", line):
                out.append("        " + re.sub(r"\{(static|abstract|field|method)\}\s*", "", line))
            continue
        if _IGNORED.match(line):
            continue
        if line == "}":
            if stack:
                stack.pop()
            continue
        if _CONTAINER.match(line):
            stack.append("container")
            continue
        decl = _CLASS_DECL.match(line)
        if decl:
            declared += 1
            name = decl.group("name").split(".")[-1]
            stereotype = decl.group("st") or _STEREOTYPES.get(decl.group("kind").lower())
            if decl.group("open"):
                out.append(f"    class {name} {{")
                if stereotype:
                    out.append(f"        <<{stereotype}>>")
                stack.append("class")
            else:
                out.append(f"    class {name}")
                if stereotype:
                    out.append(f"    <<{stereotype}>> {name}")
            if decl.group("parent"):
                arrow = "<|.." if (decl.group("rel") or "").lower() == "implements" else "<|--"
                out.append(f"    {decl.group('parent').split('.')[-1]} {arrow} {name}")
                relations += 1
            continue
        relation = _RELATION.match(line)
        if relation:
            arrow = _normalize_arrow(relation.group("arrow"))
            if arrow is None:
                continue
            parts = [relation.group("a").split(".")[-1]]
            if relation.group("ca"):
                parts.append(relation.group("ca"))
            parts.append(arrow)
            if relation.group("cb"):
                parts.append(relation.group("cb"))
            parts.append(relation.group("b").split(".")[-1])
            text = " ".join(parts)
            if relation.group("label"):
                text += f" : {relation.group('label').strip()}"
            out.append(f"    {text}")
            relations += 1
    return "\n".join(out) if declared or relations else None


def _plantuml_state(lines: list[str]) -> str | None:
    out = ["stateDiagram-v2"]
    transitions = 0
    for line in lines:
        if _IGNORED.match(line) and not line.startswith("--"):
            continue
        converted = re.sub(r"-+(?:up|down|left|right|u|d|l|r)?-*>", "-->", line, flags=re.IGNORECASE)
        if "-->" in converted:
            transitions += 1
        out.append(f"    {converted}")
    return "\n".join(out) if transitions else None


def plantuml_to_mermaid(source: str) -> str | None:
    """Convert common PlantUML activity, component, sequence, class and state diagrams; None when unsupported."""
    lines = _clean(source.splitlines())
    if not lines:
        return None
    if looks_like_activity(lines):
        return plantuml_activity(lines)
    if looks_like_component(lines):
        return plantuml_component(lines)
    joined = "\n".join(lines)
    if re.search(r"(?im)^(abstract class|abstract|class|interface|enum)\s+\w", joined):
        return _plantuml_class(lines)
    if re.search(r"(?m)\[\*\]", joined) or re.search(r"(?im)^state\s", joined):
        return _plantuml_state(lines)
    return _plantuml_sequence(lines)


@dataclass(frozen=True)
class ExpandResult:
    markdown: str
    converted: int
    unsupported: int


_FENCE_OPEN = re.compile(r"^(?P<indent>[ \t]*)(?P<fence>`{3,}|~{3,})[ \t]*(?P<lang>[^\s`]*)")


def expand_plantuml(markdown: str) -> ExpandResult:
    """Replace PlantUML fences and bare @startuml blocks with Mermaid fences where convertible."""
    lines = markdown.split("\n")
    out: list[str] = []
    converted = unsupported = 0
    index = 0

    def emit(source: list[str], indent: str) -> None:
        nonlocal converted, unsupported
        mermaid = plantuml_to_mermaid("\n".join(source))
        if mermaid is None:
            unsupported += 1
            out.extend([f"{indent}```plantuml", *source, f"{indent}```"])
        else:
            converted += 1
            out.extend([f"{indent}```mermaid", *mermaid.split("\n"), f"{indent}```"])

    while index < len(lines):
        line = lines[index]
        opening = _FENCE_OPEN.match(line)
        if opening:
            fence, indent, lang = opening.group("fence"), opening.group("indent"), opening.group("lang").lower()
            end = index + 1
            while end < len(lines) and not re.match(rf"^[ \t]*{re.escape(fence[0])}{{{len(fence)},}}[ \t]*$", lines[end]):
                end += 1
            if lang in {"plantuml", "puml", "uml"}:
                emit(lines[index + 1:end], indent)
            else:
                out.extend(lines[index:end + 1])
            index = end + 1
        elif re.match(r"^\s*@startuml\b", line, re.IGNORECASE):
            end = index + 1
            while end < len(lines) and not re.match(r"^\s*@enduml\b", lines[end], re.IGNORECASE):
                end += 1
            emit(lines[index:end + 1], "")
            index = end + 1
        else:
            out.append(line)
            index += 1
    return ExpandResult("\n".join(out), converted, unsupported)


# ---------------------------------------------------------------- entry points

_TARGETS = {
    "mermaid": ("text/plain; charset=utf-8", "mmd"),
    "svg": ("image/svg+xml", "svg"),
    "drawio": ("application/vnd.jgraph.mxfile", "drawio"),
}


def detect_source_format(source: str) -> str:
    if re.search(r"<(mxfile|mxGraphModel)\b", source):
        return "drawio"
    if re.search(r"(?m)^apiVersion:\s*\S+", source) and re.search(r"(?m)^kind:\s*\w+", source):
        return "kubernetes"
    if re.search(r'(?m)^[ \t]*(?:resource|data)[ \t]+"[^"\n]+"[ \t]+"[^"\n]+"[ \t]*\{|^[ \t]*module[ \t]+"[^"\n]+"[ \t]*\{', source):
        return "terraform"
    if re.search(r"(?im)^\s*@startuml\b", source) or re.search(r"(?im)^\s*(participant|actor|class|interface|state|component)\s+\S", source):
        return "plantuml"
    return "ascii"


_TO_MERMAID_ONLY = {
    "plantuml": plantuml_to_mermaid,
    "drawio": drawio_to_mermaid,
    "terraform": terraform_to_mermaid,
    "kubernetes": kubernetes_to_mermaid,
}


def convert_diagram_with_notes(source: str, target: str, source_format: str = "auto") -> tuple[str, str, str, list[str]]:
    """(content, media type, extension, warnings); raises ValueError with an actionable message when not convertible."""
    fmt = detect_source_format(source) if source_format == "auto" else source_format
    media_type, extension = _TARGETS[target]
    warnings: list[str] = []
    if fmt in _TO_MERMAID_ONLY:
        if target != "mermaid":
            names = {"plantuml": "PlantUML", "drawio": "Draw.io", "terraform": "Terraform", "kubernetes": "Kubernetes"}
            raise ValueError(f"{names[fmt]} can only be converted to Mermaid")
        result = _TO_MERMAID_ONLY[fmt](source)
        if result is None:
            raise ValueError(f"This {fmt} diagram could not be converted (unsupported structure)")
    else:
        result = {"mermaid": ascii_to_mermaid, "svg": ascii_to_svg, "drawio": ascii_to_drawio}[target](source)
        if result is None:
            raise ValueError(ascii_problem(source) or "This diagram could not be converted (unsupported structure)")
        warnings = ascii_warnings(source)
    return result, media_type, extension, warnings


def convert_diagram(source: str, target: str, source_format: str = "auto") -> tuple[str, str, str]:
    """Return (content, media type, file extension); raises ValueError when not convertible."""
    content, media_type, extension, _ = convert_diagram_with_notes(source, target, source_format)
    return content, media_type, extension
