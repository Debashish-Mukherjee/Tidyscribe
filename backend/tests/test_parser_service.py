from app.services.parser_service import convert_ascii_diagram_to_mermaid, detect_content_type, normalize_pasted_content


def test_detect_content_type_finds_mermaid_and_tables() -> None:
    text = "Certainly!\n\n# Overview\n\n```mermaid\nflowchart TD\n    A[Input] --> B[Output]\n```\n\n| Name | Value |\n| --- | --- |\n| API | v1 |"

    types = detect_content_type(text)

    assert "mermaid" in types
    assert "table" in types


def test_normalize_pasted_content_removes_ai_noise_and_preserves_structure() -> None:
    text = "Absolutely!\n\n# Design Notes\n\n- This is a bullet\n- This is another bullet\n\n```mermaid\nsequenceDiagram\n    Client->>API: Request\n```"

    normalized = normalize_pasted_content(text)

    assert "Absolutely!" not in normalized
    assert "# Design Notes" in normalized
    assert "```mermaid" in normalized
    assert "sequenceDiagram" in normalized


def test_convert_ascii_diagram_to_mermaid() -> None:
    text = "+------------+\n| API Layer  |\n+------------+\n|\nV\n+------------+\n| Queue      |\n+------------+"

    converted = convert_ascii_diagram_to_mermaid(text)

    assert converted is not None
    assert "flowchart TD" in converted
    assert "API Layer" in converted
    assert "Queue" in converted
