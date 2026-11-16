import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.diagram_service import (
    ascii_nodes,
    ascii_to_drawio,
    ascii_to_mermaid,
    ascii_to_svg,
    convert_diagram,
    expand_plantuml,
    plantuml_to_mermaid,
)
from app.services.parser_service import normalize_pasted_content

ASCII = """+-------------+
| API Gateway |
+-------------+
       |
       v
+-------------+
| Order API   |
| (v2)        |
+-------------+
       |
       v
+-------------+
| Event "Bus" |
+-------------+"""

client = TestClient(app)


def test_ascii_nodes_in_order_and_multirow_boxes_merge() -> None:
    assert ascii_nodes(ASCII) == ["API Gateway", "Order API (v2)", 'Event "Bus"']
    assert ascii_nodes("just text") == []


def test_ascii_to_mermaid_is_valid_and_escapes_quotes() -> None:
    mermaid = ascii_to_mermaid(ASCII)
    assert mermaid is not None
    lines = mermaid.split("\n")
    assert lines[0] == "flowchart TD"
    assert lines[1] == '    N1["API Gateway"] --> N2["Order API (v2)"]'
    assert "#quot;" in lines[2] and '"Bus"' not in mermaid
    assert ascii_to_mermaid("+--+\n| A |\n+--+") is None  # a single box is not a diagram


def test_ascii_to_svg_is_well_formed_and_escaped() -> None:
    svg = ascii_to_svg(ASCII.replace("Order API", "A & B <x>"))
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")
    assert svg.count("<rect x=") == 3 and svg.count("<line") == 2
    assert "A &amp; B &lt;x&gt;" in svg


def test_ascii_to_drawio_is_valid_mxfile() -> None:
    xml = ascii_to_drawio(ASCII)
    root = ET.fromstring(xml.split("?>", 1)[1])
    assert root.tag == "mxfile"
    cells = {c.get("id"): c for c in root.iter("mxCell")}
    assert cells["n1"].get("value") == "API Gateway" and cells["n1"].get("vertex") == "1"
    assert cells["e1"].get("source") == "n1" and cells["e1"].get("target") == "n2"
    assert len([c for c in cells.values() if c.get("edge") == "1"]) == 2


SEQUENCE = """@startuml
title Ordering
actor User
participant "Order API" as API
database DB
User -> API: Submit order
API ->> DB: save
DB --> API: ok
API <-- User: ack
activate API
alt valid
  API -> User: accepted
else invalid
  API -> User: rejected
end
note right of API: validated
note over User, API
 two
 lines
end note
@enduml"""


def test_plantuml_sequence_to_mermaid() -> None:
    result = plantuml_to_mermaid(SEQUENCE)
    lines = [line.strip() for line in result.split("\n")]
    assert lines[0] == "sequenceDiagram"
    assert "actor User" in lines and "participant API as Order API" in lines and "participant DB" in lines
    assert "User->>API: Submit order" in lines
    assert "API->>DB: save" in lines and "DB-->>API: ok" in lines
    assert "User-->>API: ack" in lines  # reversed arrow keeps direction
    assert "alt valid" in lines and "else invalid" in lines and "end" in lines
    assert "Note right of API: validated" in lines
    assert "Note over User,API: two<br/>lines" in lines
    assert "activate API" in lines
    assert "@startuml" not in result and "title" not in result


def test_plantuml_class_to_mermaid() -> None:
    source = """class Order {
  +id: int
  {static} +create(): Order
}
interface Repo
abstract class Base
Base <|-- Order
Order --> Repo : uses
Customer "1" *-- "many" Order
Order -right-> Repo
package shop {
  class Item
}
"""
    lines = [line.strip() for line in plantuml_to_mermaid(source).split("\n")]
    assert lines[0] == "classDiagram"
    assert "class Order {" in lines and "+id: int" in lines and "+create(): Order" in lines
    assert "<<interface>> Repo" in lines and "<<abstract>> Base" in lines
    assert "Base <|-- Order" in lines
    assert "Order --> Repo : uses" in lines
    assert 'Customer "1" *-- "many" Order' in lines
    assert lines.count("Order --> Repo") == 1
    assert "class Item" in lines


def test_plantuml_state_to_mermaid() -> None:
    result = plantuml_to_mermaid("[*] --> Idle\nIdle -down-> Running : start\nRunning --> [*]")
    assert result.split("\n")[0] == "stateDiagram-v2"
    assert "Idle --> Running : start" in result


@pytest.mark.parametrize("source", ["", "@startuml\n@enduml", "@startuml\nsalt\n{\n}\n@enduml", "hello"])
def test_plantuml_unsupported_returns_none(source: str) -> None:
    assert plantuml_to_mermaid(source) is None


def test_expand_plantuml_in_markdown_only_touches_plantuml() -> None:
    markdown = (
        "# T\n\n```plantuml\nA -> B: hi\n```\n\n```python\nprint('@startuml')\n```\n\n"
        "@startuml\nX -> Y: raw\n@enduml\n\n```plantuml\nsalt\n{\n}\n```\n"
    )
    result = expand_plantuml(markdown)
    assert (result.converted, result.unsupported) == (2, 1)
    assert result.markdown.count("```mermaid") == 2
    assert "A->>B: hi" in result.markdown and "X->>Y: raw" in result.markdown
    assert "print('@startuml')" in result.markdown  # other fences untouched
    assert "```plantuml\nsalt" in result.markdown  # unsupported kept as-is


def test_convert_diagram_dispatch_and_errors() -> None:
    content, media_type, ext = convert_diagram(ASCII, "drawio")
    assert ext == "drawio" and "<mxfile" in content and media_type.startswith("application/")
    assert convert_diagram("A -> B: x\nB -> A: y", "mermaid", "plantuml")[0].startswith("sequenceDiagram")
    with pytest.raises(ValueError):
        convert_diagram("A -> B: x", "svg", "plantuml")
    with pytest.raises(ValueError):
        convert_diagram("plain words", "mermaid")


def test_convert_and_expand_endpoints() -> None:
    ok = client.post("/api/convert-diagram", json={"source": ASCII, "target": "svg"})
    assert ok.status_code == 200 and ok.json()["extension"] == "svg" and ok.json()["content"].startswith("<svg")
    assert client.post("/api/convert-diagram", json={"source": "nothing here", "target": "mermaid"}).status_code == 422
    assert client.post("/api/convert-diagram", json={"source": ASCII, "target": "png"}).status_code == 422

    expanded = client.post("/api/expand-diagrams", json={"markdown": "```plantuml\nA -> B\n```"}).json()
    assert expanded["converted"] == 1 and "```mermaid" in expanded["markdown"]


def test_normalize_preserves_indentation_code_and_ascii() -> None:
    text = (
        "Certainly!\n\n- parent\n    - child\n\n```python\ndef f():\n\n\n    return 1\n```\n\n"
        "```plantuml\nA -> B: hi\n```\n\n" + ASCII
    )
    result = normalize_pasted_content(text)
    assert "Certainly!" not in result
    assert "    - child" in result
    assert "def f():\n\n\n    return 1" in result  # blank lines inside a fence are not collapsed
    assert "```mermaid\nsequenceDiagram" in result
    assert "       |\n       v" in result  # ASCII arrows keep their indentation
