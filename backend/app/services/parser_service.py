import re

from app.services.cleaning import clean_ai_text
from app.services.diagram_service import ascii_to_mermaid, expand_plantuml

MERMAID_KEYWORDS = (
    "flowchart",
    "graph ",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram",
    "erDiagram",
    "journey",
    "gitGraph",
    "pie",
    "gantt",
    "mindmap",
    "timeline",
    "quadrantChart",
)


def detect_content_type(text: str) -> list[str]:
    source = (text or "").strip()
    if not source:
        return ["text"]

    lowered = source.lower()
    detected: list[str] = []

    if "```mermaid" in lowered or "```mmd" in lowered or any(keyword in lowered for keyword in MERMAID_KEYWORDS):
        detected.append("mermaid")
    if re.search(r"(?im)^\s*```\s*plantuml\s*$", source) or re.search(r"(?im)^\s*@startuml\s*$", source):
        detected.append("plantuml")
    if re.search(r"(?im)^\s*\|.*\|\s*$", source):
        detected.append("table")
    if re.search(r"(?im)^\s*[-*+]\s+\S+", source):
        detected.append("list")
    if re.search(r"(?im)^\s*>\s+.+", source):
        detected.append("blockquote")
    if re.search(r"(?im)^\s*#+\s+.+", source):
        detected.append("markdown")
    if re.search(r"(?im)^\s*```\s*(python|bash|json|yaml|sql|javascript|typescript|text)?\s*$", source):
        detected.append("code")
    if re.search(r"(?m)^\s*(?:\+[-=]{2,}\+|[┌╔╭┏][─═━]{2,}[┐╗╮┓])(?:[\s─━═\-=<>▶►→←]*(?:\+[-=]{2,}\+|[┌╔╭┏][─═━]{2,}[┐╗╮┓]))*\s*$", source):
        detected.append("ascii_diagram")

    return detected or ["text"]


def convert_ascii_diagram_to_mermaid(text: str) -> str | None:
    return ascii_to_mermaid(text)


_FENCE_LINE = re.compile(r"^\s*(```|~~~)")


def normalize_pasted_content(text: str) -> str:
    """Drop AI chatter and collapse blank lines, keeping indentation and code blocks intact."""
    # The same rules as Clean AI Text decide what is chatter, so the two features cannot disagree.
    cleaned, _ = clean_ai_text(text or "", tidy=False)
    lines = [line.rstrip() for line in cleaned.split("\n")]
    normalized: list[str] = []
    in_fence = False
    previous_blank = False

    for line in lines:
        if _FENCE_LINE.match(line):
            in_fence = not in_fence
            normalized.append(line)
            previous_blank = False
            continue
        if in_fence:
            normalized.append(line)
            continue
        if not line.strip():
            if not previous_blank and normalized:
                normalized.append("")
            previous_blank = True
            continue
        normalized.append(line)
        previous_blank = False

    result = "\n".join(normalized).strip("\n")
    return expand_plantuml(result).markdown
