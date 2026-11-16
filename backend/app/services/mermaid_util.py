"""Small helpers shared by the Mermaid generators."""
from __future__ import annotations

import html
import re


def label(text: str) -> str:
    """Escape text for use inside a quoted Mermaid label; newlines and <br> become <br/>."""
    marked = re.sub(r"<br\s*/?>|\n", "\0", text or "", flags=re.IGNORECASE)
    cleaned = html.unescape(re.sub(r"<[^>]+>", " ", marked))
    cleaned = re.sub(r"[ \t\r\f\v]+", " ", cleaned)
    cleaned = re.sub(r" ?\0 ?", "\0", cleaned).strip(" \0")
    cleaned = cleaned.replace("\\", "").replace('"', "#quot;").replace("<", "#lt;").replace(">", "#gt;")
    return cleaned.replace("\0", "<br/>")


def node(identifier: str, text: str, shape: str = "rect") -> str:
    """Render `identifier` with a quoted label in the given shape."""
    quoted = f'"{label(text)}"'
    shapes = {
        "rect": f"[{quoted}]",
        "round": f"({quoted})",
        "stadium": f"([{quoted}])",
        "circle": f"(({quoted}))",
        "diamond": f"{{{quoted}}}",
        "hexagon": f"{{{{{quoted}}}}}",
        "cylinder": f"[({quoted})]",
        "parallelogram": f"[/{quoted}/]",
        "subroutine": f"[[{quoted}]]",
    }
    return f"{identifier}{shapes[shape]}"


def edge(source: str, target: str, text: str | None = None, *, dotted: bool = False, arrow: bool = True) -> str:
    link = ("-.->" if arrow else "-.-") if dotted else ("-->" if arrow else "---")
    if text and label(text):
        return f'{source} {link}|"{label(text)}"| {target}'
    return f"{source} {link} {target}"
