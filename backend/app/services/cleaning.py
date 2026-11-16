"""Clean AI Text as a list of named transformation rules.

Every rule reports what it changed, so the user can review the result before it is applied (see the Clean AI Text
dialog). Code fences are never touched, and nothing is removed unless a rule recognises it as chat-tool scaffolding.
"""
from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass, field

_FENCE = re.compile(r"^\s*(```|~~~)")


@dataclass
class Change:
    rule: str
    label: str
    count: int = 0
    examples: list[str] = field(default_factory=list)

    def add(self, example: str) -> None:
        self.count += 1
        shown = " ".join(example.split())
        if shown and shown not in self.examples and len(self.examples) < 5:
            self.examples.append(shown if len(shown) <= 90 else shown[:87] + "...")


class Report:
    def __init__(self) -> None:
        self._changes: "OrderedDict[str, Change]" = OrderedDict()

    def note(self, rule: str, label: str, example: str) -> None:
        self._changes.setdefault(rule, Change(rule, label)).add(example)

    @property
    def changes(self) -> list[Change]:
        return list(self._changes.values())


# ---------------------------------------------------------------- rules

_OPENER = re.compile(
    r"^(?:certainly|sure|absolutely|of course|great question|good question|excellent question|happy to help|"
    r"i'?d be (?:happy|glad) to help|no problem|got it|understood|definitely)\b[^\n.!?:]{0,50}?(?:[!.]|\s[—–-])\s*",
    re.IGNORECASE,
)
# A sentence that only announces the content that follows ("Here's a design doc:", "Below is the document.").
_LEAD_IN = re.compile(
    r"^(?:(?:sure|certainly|absolutely|of course)[,!]?\s+)?(?:here(?:'s| is| are| you go)|below (?:is|are)|the following (?:is|are)|"
    r"i(?:'ve| have) (?:put together|written|prepared|created|drafted)|you can find|please find)\b[^\n]{0,200}?[:.]\s*",
    re.IGNORECASE,
)
_STRUCTURE_START = re.compile(r"^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|```|~~~)")

_CLOSER = re.compile(
    r"^(?:let me know|feel free to (?:ask|reach out|let me know|tell me)|hope this helps|i hope this helps|would you like me to|"
    r"do you want me to|if you(?:'d| would) like,? i can|happy to (?:help|expand|elaborate)|"
    r"i can also (?:provide|generate|create|write|expand|help|draft|add|convert|turn)|just let me know|is there anything else)\b",
    re.IGNORECASE,
)
_HOPE_LINE = re.compile(r"^\s*(?:i )?hope this helps[!.]*\s*$", re.IGNORECASE)

_DISCLAIMER = re.compile(r"(?:^|(?<=[.!?]\s))(?:as an ai(?: language model| assistant)?|i(?:'m| am) (?:just )?an ai(?: language model| assistant)?)\b[^.!?\n]*[.!?]\s*", re.IGNORECASE | re.MULTILINE)

_SPEAKER = re.compile(r"^\s*(?:ChatGPT said|Claude responded|Gemini said|Copilot said)\s*:?\s*$", re.IGNORECASE)
_SPEAKER_INLINE = re.compile(r"^(\s*)(?:ChatGPT said|Claude responded|Gemini said|Copilot said)\s*:\s+(?=\S)", re.IGNORECASE)

_CITATIONS = (
    ("ChatGPT", re.compile(r"\ue200[^\ue201]*\ue201|【[^】\n]{1,60}】")),
    ("Gemini", re.compile(r"\[cite_start\]|\[cite:\s*[\d,\s]+\]")),
    ("Copilot", re.compile(r"\[\^\d+\^\]")),
    ("Claude", re.compile(r"</?(?:antml:)?cite[^>]*>")),
)

_LANGUAGE_LINE = re.compile(r"^(?:python|javascript|typescript|json|yaml|yml|bash|shell|sh|sql|html|css|java|c|c\+\+|c#|go|rust|ruby|php|xml|markdown|text|plaintext|powershell|terraform|hcl|dockerfile|kotlin|swift|mermaid|http)$", re.IGNORECASE)
_COPY_LINE = re.compile(r"^(?:copy(?: code)?|copied!?)$", re.IGNORECASE)


_ARTIFACT = re.compile(
    r"\b(?:summary|document|doc|design|plan|outline|overview|version|draft|template|guide|runbook|readme|code|example|table|list|answer|report|"
    r"breakdown|response|diagram|spec|specification|proposal|write-?up|content)\b",
    re.IGNORECASE,
)
_EXPLANATION = re.compile(r"^(?:sure|certainly|absolutely|of course)?[,!]?\s*here(?:'s| is) (?:how|why|what|when|where|the reason)\b", re.IGNORECASE)


def _is_announcement(sentence: str) -> bool:
    """A lead-in that only introduces an artefact ("Here's a design doc:"), not a sentence of the document itself."""
    if sentence.endswith(":"):
        return True
    return len(sentence) <= 120 and bool(_ARTIFACT.search(sentence)) and not _EXPLANATION.match(sentence)


def _strip_citations(text: str, report: Report) -> str:
    for source, pattern in _CITATIONS:
        def drop(match: re.Match[str], source: str = source) -> str:
            report.note("citations", "Removed citation markers", f"{source}: {match.group(0).strip() or 'marker'}")
            return ""

        text = pattern.sub(drop, text)
    return text


def _strip_speaker_labels(text: str, report: Report) -> str:
    out: list[str] = []
    for line in text.split("\n"):
        if _SPEAKER.match(line):
            report.note("speaker", "Removed chat speaker labels", line)
            continue
        inline = _SPEAKER_INLINE.match(line)
        if inline:
            report.note("speaker", "Removed chat speaker labels", line[: inline.end()])
            line = _SPEAKER_INLINE.sub(r"\1", line, count=1)
        out.append(line)
    return "\n".join(out)


def _strip_code_chrome(text: str, report: Report) -> str:
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        if _LANGUAGE_LINE.match(stripped) and i + 1 < len(lines) and _COPY_LINE.match(lines[i + 1].strip()):
            report.note("chrome", "Removed Copy-code bars", f"{stripped} / {lines[i + 1].strip()}")
            i += 2
            continue
        if _COPY_LINE.match(stripped) and stripped.lower() != "copied":
            report.note("chrome", "Removed Copy-code bars", stripped)
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def _strip_openers(first: str, report: Report) -> str:
    """Leading chatter of the first paragraph; whatever real content follows it stays."""
    text = first
    for _ in range(3):
        opener = _OPENER.match(text)
        if opener:
            report.note("preamble", "Removed AI openers and lead-ins", opener.group(0))
            text = text[opener.end():]
            continue
        lead = _LEAD_IN.match(text)
        if lead and _is_announcement(lead.group(0).strip()):
            report.note("preamble", "Removed AI openers and lead-ins", lead.group(0))
            text = text[lead.end():]
            continue
        break
    return text.lstrip()


def _strip_closers(body: str, report: Report) -> str:
    for _ in range(2):
        stripped = body.rstrip("\n")
        cut = stripped.rfind("\n\n")
        last = stripped[cut + 2:] if cut >= 0 else stripped
        text = last.strip()
        if text and len(text) <= 300 and not _STRUCTURE_START.match(text) and (_CLOSER.match(text) or _HOPE_LINE.match(text)):
            report.note("closer", "Removed AI sign-offs", text)
            body = stripped[:cut] if cut >= 0 else ""
        else:
            break
    return body


def _strip_disclaimers(text: str, report: Report) -> str:
    def drop(match: re.Match[str]) -> str:
        report.note("disclaimer", "Removed AI self-references", match.group(0))
        return ""

    return _DISCLAIMER.sub(drop, text)


def _tidy(text: str, report: Report) -> str:
    tidied = re.sub(r"[ \t]+\n", "\n", text)
    tidied = re.sub(r"\n{3,}", "\n\n", tidied)
    if tidied != text:
        report.note("whitespace", "Tidied blank lines and trailing spaces", "extra blank lines")
    return tidied


# ---------------------------------------------------------------- driver

def _split_fences(text: str) -> list[tuple[bool, str]]:
    """(is_code, text) pieces; code fences keep their delimiters and are never edited."""
    pieces: list[tuple[bool, list[str]]] = [(False, [])]
    in_fence = False
    for line in text.split("\n"):
        if _FENCE.match(line):
            if not in_fence:
                pieces.append((True, [line]))
                in_fence = True
            else:
                pieces[-1][1].append(line)
                pieces.append((False, []))
                in_fence = False
            continue
        pieces[-1][1].append(line)
    return [(code, "\n".join(lines)) for code, lines in pieces if lines]


def clean_ai_text(text: str, *, tidy: bool = True) -> tuple[str, list[Change]]:
    """Returns (cleaned text, what each rule changed). Prose is cleaned; fenced code is left exactly as it is."""
    report = Report()
    source = (text or "").replace("\r\n", "\n")
    pieces = _split_fences(source)

    first_prose = next((i for i, (code, body) in enumerate(pieces) if not code and body.strip()), None)
    last_prose = next((i for i in range(len(pieces) - 1, -1, -1) if not pieces[i][0] and pieces[i][1].strip()), None)

    cleaned: list[str] = []
    for index, (is_code, body) in enumerate(pieces):
        if is_code:
            cleaned.append(body)
            continue
        body = _strip_citations(body, report)
        body = _strip_speaker_labels(body, report)
        body = _strip_code_chrome(body, report)
        body = _strip_disclaimers(body, report)
        if index == first_prose and not any(c for c, _ in pieces[:first_prose]):
            head, separator, rest = body.lstrip("\n").partition("\n\n")
            new_head = _strip_openers(head, report)
            body = new_head + separator + rest if new_head.strip() else rest
        if index == last_prose and not any(c for c, _ in pieces[last_prose + 1:]):
            body = _strip_closers(body, report)
        if body.strip() or index not in (first_prose, last_prose):
            cleaned.append(body)

    result = "\n".join(part for part in cleaned if part != "")
    result = _tidy(result, report) if tidy else result
    result = result.strip("\n")
    if not result.strip() and source.strip():
        return source.strip("\n"), []  # a document that is nothing but chatter is left for the user to decide about
    return result, report.changes
