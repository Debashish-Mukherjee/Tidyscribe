"""Clean AI Text (UAT D15): every change is a named rule, reported, and never applied to code."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.cleaning import clean_ai_text
from app.services.parser_service import normalize_pasted_content
from app.services.transform_service import transform_document

client = TestClient(app)


def _rules(changes) -> dict[str, int]:
    return {change.rule: change.count for change in changes}


@pytest.mark.parametrize(
    "text",
    [
        "Sure! Here's a design doc:\n\n# Design\n\nBody.",
        "Absolutely — here you go:\n\n# Design\n\nBody.",
        "Great question!\n\n# Design\n\nBody.",
        "Certainly! Below is the document.\n\n# Design\n\nBody.",
        "Of course! I've put together the design:\n\n# Design\n\nBody.",
        "Sure, here's the design:\n\n# Design\n\nBody.",
    ],
)
def test_openers_and_lead_ins_are_removed_with_the_content_kept(text: str) -> None:
    cleaned, changes = clean_ai_text(text)
    assert cleaned == "# Design\n\nBody."
    assert _rules(changes).get("preamble", 0) >= 1


def test_the_report_names_what_was_removed() -> None:
    _, changes = clean_ai_text("Certainly! Great question!\n\nAs an AI language model, I cannot browse. Real content.\n\nLet me know if you'd like me to expand!")
    by_rule = {change.rule: change for change in changes}
    assert by_rule["preamble"].examples and "Certainly!" in by_rule["preamble"].examples[0]
    assert by_rule["disclaimer"].examples[0].startswith("As an AI language model, I cannot browse.")
    assert by_rule["closer"].count == 1 and "Let me know" in by_rule["closer"].examples[0]


def test_real_content_that_merely_starts_like_a_lead_in_is_kept() -> None:
    text = "Here is how the retry policy works, step by step, with exponential backoff and jitter applied to every attempt.\n\n## Steps"
    cleaned, changes = clean_ai_text(text)
    assert cleaned == text and not changes


def test_a_document_that_is_only_chatter_is_not_emptied() -> None:
    cleaned, changes = clean_ai_text("Certainly!")
    assert cleaned == "Certainly!" and changes == []


def test_closers_are_only_removed_at_the_end() -> None:
    text = "# Runbook\n\nLet me know if latency exceeds 200 ms, then page on-call.\n\nSecond paragraph."
    cleaned, changes = clean_ai_text(text)
    assert cleaned == text and not changes
    cleaned, changes = clean_ai_text("# T\n\nBody.\n\nHope this helps!")
    assert cleaned == "# T\n\nBody." and _rules(changes) == {"closer": 1}


@pytest.mark.parametrize(
    ("text", "kept"),
    [
        ("Fact 【4†source】 stated.", "Fact  stated."),
        ("Fact \ue200cite\ue202turn0search0\ue201 stated.", "Fact  stated."),
        ("[cite_start]Fact stated [cite: 12, 14].", "Fact stated ."),
        ("Fact[^1^] stated.", "Fact stated."),
        ("<cite index=\"1-2\">Fact</cite> stated.", "Fact stated."),
    ],
)
def test_citation_markers_from_every_tool_are_removed(text: str, kept: str) -> None:
    cleaned, changes = clean_ai_text(text)
    assert cleaned == kept
    assert _rules(changes).get("citations", 0) >= 1


def test_chat_labels_and_copy_code_bars() -> None:
    cleaned, changes = clean_ai_text("ChatGPT said:\n# Title\n\npython\nCopy code\nprint(1)\n")
    assert "ChatGPT said" not in cleaned and "Copy code" not in cleaned
    assert {"speaker", "chrome"} <= set(_rules(changes))


def test_fenced_code_is_never_touched() -> None:
    text = "Sure! Here you go:\n\n```python\n# Certainly! Let me know\nprint('Copy code')\n【4†source】\n```\n\nHope this helps!"
    cleaned, _ = clean_ai_text(text)
    assert cleaned == "```python\n# Certainly! Let me know\nprint('Copy code')\n【4†source】\n```"


def test_clean_text_reports_nothing() -> None:
    text = "# Title\n\nParagraph.\n\n- a\n- b"
    cleaned, changes = clean_ai_text(text)
    assert cleaned == text and changes == []


def test_style_vocabulary_is_reported_not_silent() -> None:
    result = transform_document("# Overview\n\nSummary of things.\n\n```\nOverview\n```", "HLD")
    rules = {change["rule"]: change for change in result["changes"]}
    assert rules["style"]["count"] == 1 and "Overview -> Context" in rules["style"]["examples"]
    assert "Summary of things." in result["cleaned_text"]
    assert "```\nOverview\n```" in result["cleaned_text"]
    assert result["changed"] is True


def test_transform_endpoint_returns_the_report_and_flags_no_ops() -> None:
    noisy = client.post("/api/transform", json={"text": "Certainly! # Overview\n\nBody.\n\nHope this helps!", "tone": "Solution Design"}).json()
    assert noisy["changed"] is True and noisy["removed"] == 2
    assert [c["rule"] for c in noisy["changes"]] == ["preamble", "closer"]
    clean = client.post("/api/transform", json={"text": "# Title\n\nBody.", "tone": "Solution Design"}).json()
    assert clean["changed"] is False and clean["changes"] == []


def test_transform_rejects_unbounded_input() -> None:
    assert client.post("/api/transform", json={"text": "x" * 2_000_001, "tone": "Solution Design"}).status_code == 422


def test_smart_paste_uses_the_same_rules_and_keeps_indentation() -> None:
    out = normalize_pasted_content("Sure! Here you go:\n\n    indented\n\n```\nCertainly!\n```")
    assert out.startswith("    indented") and "Certainly!" in out and "Sure" not in out
