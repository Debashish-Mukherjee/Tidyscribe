"""PlantUML activity and component diagrams -> Mermaid flowcharts.

Both converters receive lines already stripped of blank lines, comments and @startuml/@enduml.
"""
from __future__ import annotations

import re

from app.services.mermaid_util import edge, label, node

_SKIP = re.compile(r"^(skinparam|hide|show|title|header|footer|caption|scale|!|'|set\s|left to right direction|top to bottom direction)", re.IGNORECASE)
_BLOCK_ENDS = {
    "legend": r"end\s*legend", "note": r"end\s*note", "rnote": r"end\s*r?note", "hnote": r"end\s*h?note",
    "title": r"end\s*title", "header": r"end\s*header", "footer": r"end\s*footer",
}
_BARE_BLOCKS = {"title", "header", "footer"}
_ACTION = re.compile(r"^(?:#\w+)?:(?P<text>.*)$")
_ACTION_END = re.compile(r"[;|<>/\\\]}]$")


# ------------------------------------------------------------------ activity


def looks_like_activity(lines: list[str]) -> bool:
    return any(_ACTION.match(line) for line in lines) or (
        any(line.lower() == "start" for line in lines) and any(line.lower() in {"stop", "end"} for line in lines)
    )


def plantuml_activity(lines: list[str]) -> str | None:
    nodes: list[str] = []
    edges: list[str] = []
    counter = 0
    tails: list[tuple[str, str | None]] = []
    stack: list[dict] = []
    waiting_for_entry: list[dict] = []
    actions = 0

    def add(text: str, shape: str = "rect") -> str:
        nonlocal counter, tails
        counter += 1
        identifier = f"A{counter}"
        nodes.append("    " + node(identifier, text, shape))
        for source, text_label in tails:
            edges.append("    " + edge(source, identifier, text_label))
        tails = [(identifier, None)]
        for frame in waiting_for_entry:
            frame["entry"] = identifier
        waiting_for_entry.clear()
        return identifier

    def link(source: str, target: str, text: str | None = None) -> None:
        edges.append("    " + edge(source, target, text))

    def top(kind: str) -> dict | None:
        return stack[-1] if stack and stack[-1]["kind"] == kind else None

    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        lowered = line.lower()
        first_word = lowered.split(None, 1)[0]
        action = _ACTION.match(line)

        if action:
            text = action.group("text")
            while not _ACTION_END.search(text.strip()) and index < len(lines):
                text += "\n" + lines[index]
                index += 1
            add(text.strip()[:-1].strip() if _ACTION_END.search(text.strip()) else text.strip())
            actions += 1
            continue
        multiline = first_word in _BLOCK_ENDS and ((lowered == first_word) if first_word in _BARE_BLOCKS else (":" not in line))
        if multiline:
            while index < len(lines) and not re.match(rf"^{_BLOCK_ENDS[first_word]}\b", lines[index], re.IGNORECASE):
                index += 1
            index += 1
            continue
        if _SKIP.match(line) or lowered.startswith(("note ", "rnote ", "hnote ")) or line.startswith(("->", "|")) or line == "}":
            continue
        if re.match(r"^(partition|group|rectangle|package|card)\b.*\{$", lowered):
            continue

        if lowered == "start":
            add("Start", "stadium")
        elif lowered in {"stop", "end"}:
            add("End", "stadium")
            tails = []
        elif lowered in {"detach", "kill"}:
            tails = []
        elif match := re.match(r"^if\s*\((?P<c>.*)\)\s*then\s*(?:\((?P<l>[^)]*)\))?\s*$", line, re.IGNORECASE):
            condition = add(match.group("c"), "diamond")
            stack.append({"kind": "if", "cond": condition, "done": [], "has_else": False})
            tails = [(condition, match.group("l") or None)]
        elif match := re.match(r"^else\s*if\s*\((?P<c>.*)\)\s*then\s*(?:\((?P<l>[^)]*)\))?\s*$", line, re.IGNORECASE):
            frame = top("if")
            if frame is None:
                return None
            frame["done"] += tails
            tails = [(frame["cond"], "no")]
            frame["cond"] = add(match.group("c"), "diamond")
            tails = [(frame["cond"], match.group("l") or None)]
        elif match := re.match(r"^else\s*(?:\((?P<l>[^)]*)\))?\s*$", line, re.IGNORECASE):
            frame = top("if")
            if frame is None:
                return None
            frame["done"] += tails
            frame["has_else"] = True
            tails = [(frame["cond"], match.group("l") or "no")]
        elif re.match(r"^end\s*if$", lowered):
            frame = top("if")
            if frame is None:
                return None
            stack.pop()
            tails = frame["done"] + tails + ([] if frame["has_else"] else [(frame["cond"], "no")])
        elif match := re.match(r"^while\s*\((?P<c>.*?)\)(?:\s*is\s*\((?P<l>[^)]*)\))?\s*$", line, re.IGNORECASE):
            condition = add(match.group("c"), "diamond")
            stack.append({"kind": "while", "cond": condition})
            tails = [(condition, match.group("l") or "yes")]
        elif match := re.match(r"^end\s*while\s*(?:\((?P<l>[^)]*)\))?\s*$", line, re.IGNORECASE):
            frame = top("while")
            if frame is None:
                return None
            stack.pop()
            for source, text_label in tails:
                link(source, frame["cond"], text_label)
            tails = [(frame["cond"], match.group("l") or "no")]
        elif lowered == "repeat":
            frame = {"kind": "repeat", "entry": None}
            stack.append(frame)
            waiting_for_entry.append(frame)
        elif match := re.match(
            r"^repeat\s*while\s*\((?P<c>.*?)\)(?:\s*is\s*\((?P<l>[^)]*)\))?(?:\s*not\s*\((?P<n>[^)]*)\))?\s*$", line, re.IGNORECASE
        ):
            frame = top("repeat")
            if frame is None:
                return None
            stack.pop()
            condition = add(match.group("c"), "diamond")
            if frame["entry"] and frame["entry"] != condition:
                link(condition, frame["entry"], match.group("l") or "yes")
            tails = [(condition, match.group("n") or "no")]
        elif first_word in {"fork", "split"} and lowered.endswith(("fork", "split")) and not lowered.startswith("end"):
            stack.append({"kind": "fork", "start": list(tails), "done": []})
        elif lowered in {"fork again", "split again"}:
            frame = top("fork")
            if frame is None:
                return None
            frame["done"] += tails
            tails = list(frame["start"])
        elif lowered in {"end fork", "end split", "end merge", "endfork", "endsplit"}:
            frame = top("fork")
            if frame is None:
                return None
            stack.pop()
            tails = frame["done"] + tails

    if actions == 0 or not nodes:
        return None
    return "\n".join(["flowchart TD", *nodes, *edges])


# ----------------------------------------------------------------- component

_CONTAINERS = {"package", "node", "cloud", "rectangle", "folder", "frame", "database", "storage", "namespace", "component"}
_LEAF_KINDS = {"component", "interface", "database", "node", "cloud", "queue", "storage", "artifact", "rectangle", "folder", "frame", "package", "actor", "agent", "card", "file", "boundary", "control", "entity", "collections"}
_SHAPES = {"database": "cylinder", "interface": "circle", "cloud": "round", "queue": "subroutine", "actor": "round", "storage": "cylinder"}
_ENDPOINT = r'(?:\[[^\]\n]+\]|\(\)\s*[\w.]+|"[^"\n]+"|\w+)'
_ARROW = r"<?[-.=]+(?:\[[^\]\n]*\])?(?:(?:left|right|up|down|l|r|u|d)[-.=]*)?>?"
_LINK = re.compile(rf"^(?P<a>{_ENDPOINT})\s*(?P<ca>\"[^\"]*\")?\s*(?P<arrow>{_ARROW})\s*(?P<cb>\"[^\"]*\")?\s*(?P<b>{_ENDPOINT})\s*(?::\s*(?P<text>.*))?$")
_DECL = re.compile(
    rf"^(?P<kind>{'|'.join(sorted(_LEAF_KINDS, key=len, reverse=True))})\s+(?P<name>\[[^\]\n]+\]|\"[^\"\n]+\"|[\w.]+)"
    r"(?:\s+as\s+(?P<alias>\"[^\"\n]+\"|[\w.]+))?(?:\s*<<[^>]*>>)?(?:\s+#\w+)?\s*(?P<open>\{)?\s*$",
    re.IGNORECASE,
)
_BARE_BRACKET = re.compile(r"^(?P<name>\[[^\]\n]+\])(?:\s+as\s+(?P<alias>[\w.]+))?\s*$", re.IGNORECASE)
_LOLLIPOP = re.compile(r"^\(\)\s*(?P<name>\"[^\"\n]+\"|[\w.]+)(?:\s+as\s+(?P<alias>[\w.]+))?\s*$")


def looks_like_component(lines: list[str]) -> bool:
    joined = "\n".join(lines)
    return bool(re.search(r"(?im)^\s*component\b", joined) or re.search(r"(?m)^\s*\[(?![*\-])[^\]\n]+\]", joined))


def _strip(value: str) -> str:
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        value = value[1:-1]
    return value[1:-1] if len(value) >= 2 and value[0] == value[-1] == '"' else value


def plantuml_component(lines: list[str]) -> str | None:
    # id -> (kind, display, parent container id)
    nodes: dict[str, tuple[str, str, str | None]] = {}
    containers: dict[str, tuple[str, str | None]] = {}
    aliases: dict[str, str] = {}
    stack: list[str | None] = []
    links: list[str] = []

    def key_for(name: str) -> str:
        return re.sub(r"[^A-Za-z0-9_]", "_", name) or "N"

    def resolve(token: str) -> str:
        """Id for an endpoint, creating an implicit component when it was never declared."""
        raw = token.strip()
        if raw.startswith("()"):
            raw = raw[2:].strip()
            kind = "interface"
        else:
            kind = "component"
        name = _strip(raw)
        identifier = aliases.get(name) or key_for(name)
        if identifier not in nodes and identifier not in containers:
            nodes[identifier] = (kind, name, None)
        return identifier

    def declare(kind: str, name: str, alias: str | None, opens: bool) -> None:
        display = _strip(name)
        identifier = key_for(alias or display)
        if alias:
            aliases[_strip(alias)] = identifier
        aliases.setdefault(display, identifier)
        parent = stack[-1] if stack else None
        if opens:
            containers[identifier] = (display, parent)
            nodes.pop(identifier, None)
            stack.append(identifier)
        else:
            nodes[identifier] = (kind, display, parent)

    for line in lines:
        if _SKIP.match(line):
            continue
        if line == "}":
            if stack:
                stack.pop()
            continue
        decl = _DECL.match(line)
        if decl:
            kind = decl.group("kind").lower()
            opens = bool(decl.group("open"))
            if opens and kind not in _CONTAINERS:
                stack.append(stack[-1] if stack else None)  # unknown block: keep nesting balanced
                continue
            declare(kind, decl.group("name"), decl.group("alias"), opens)
            continue
        bare = _BARE_BRACKET.match(line)
        if bare:
            declare("component", bare.group("name"), bare.group("alias"), False)
            continue
        lollipop = _LOLLIPOP.match(line)
        if lollipop:
            declare("interface", lollipop.group("name"), lollipop.group("alias"), False)
            continue
        found = _LINK.match(line)
        if found:
            arrow = found.group("arrow")
            if "-" not in arrow and "." not in arrow:
                continue
            source, target = resolve(found.group("a")), resolve(found.group("b"))
            forward, backward = arrow.endswith(">"), arrow.startswith("<")
            if backward and not forward:
                source, target = target, source
            text = found.group("text")
            head = re.sub(r"\[[^\]]*\]", "", arrow)
            dotted = "." in head and "-" not in head
            rendered = edge(source, target, text, dotted=dotted, arrow=forward or backward)
            if forward and backward:
                rendered = rendered.replace("-->", "<-->", 1).replace("-.->", "<-.->", 1)
            links.append("    " + rendered)

    if not links and len(nodes) + len(containers) < 2:
        return None

    out = ["flowchart LR"]

    def emit(parent: str | None, depth: int) -> None:
        pad = "    " * (depth + 1)
        for identifier, (_, container_parent) in containers.items():
            if container_parent == parent:
                out.append(f'{pad}subgraph {identifier}["{label(containers[identifier][0])}"]')
                emit(identifier, depth + 1)
                out.append(f"{pad}end")
        for identifier, (kind, display, node_parent) in nodes.items():
            if node_parent == parent:
                out.append(pad + node(identifier, display, _SHAPES.get(kind, "rect")))

    emit(None, 0)
    out.extend(links)
    return "\n".join(out)
