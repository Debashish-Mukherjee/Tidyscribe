import re
from dataclasses import asdict

from app.services.cleaning import Change, clean_ai_text

_STYLE_WORDS: dict[str, dict[str, str]] = {
    "HLD": {"Overview": "Context", "Summary": "Architecture"},
    "LLD": {"Overview": "Modules", "Summary": "Interfaces"},
    "ADR": {"Problem": "Context"},
    "RFC": {"Background": "Proposal"},
    "Runbook": {"Summary": "Purpose"},
}

_FENCE = re.compile(r"^\s*(```|~~~)")


def remove_ai_preamble(text: str) -> str:
    """Kept for callers that only want the cleaned text."""
    return clean_ai_text(text)[0]


def _apply_style(text: str, tone: str) -> tuple[str, Change | None]:
    """Whole-word heading vocabulary for the chosen style, outside code, reported like every other change."""
    words = _STYLE_WORDS.get(tone)
    if not words:
        return text, None
    change = Change("style", f"Applied the {tone} vocabulary")
    fence: tuple[str, int] | None = None
    lines: list[str] = []
    for line in text.split("\n"):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
        if marker:
            run, tail = marker.groups()
            if fence is None:
                fence = (run[0], len(run))
            elif run[0] == fence[0] and len(run) >= fence[1] and not tail.strip():
                fence = None
        elif fence is None and re.match(r"^ {0,3}#{1,6}\s+", line):
            for old, new in words.items():
                line, count = re.subn(rf"\b{old}\b", new, line)
                for _ in range(count):
                    change.add(f"{old} -> {new}")
        lines.append(line)
    return "\n".join(lines), change if change.count else None


def convert_writing_style(text: str, tone: str = "Solution Design") -> str:
    return _apply_style(text, tone)[0]


def transform_document(text: str, tone: str = "Solution Design") -> dict:
    cleaned, changes = clean_ai_text(text)
    styled, style_change = _apply_style(cleaned, tone)
    if style_change:
        changes.append(style_change)
    changed = styled.strip() != (text or "").replace("\r\n", "\n").strip()
    removed = sum(change.count for change in changes if change.rule in ("preamble", "closer", "disclaimer", "speaker", "citations", "chrome"))
    summary = f"Prepared for {tone.lower()} with {len(styled.split())} words after cleanup."
    return {
        "cleaned_text": styled,
        "summary": summary,
        "changes": [asdict(change) for change in changes],
        "removed": removed,
        "changed": changed,
    }
