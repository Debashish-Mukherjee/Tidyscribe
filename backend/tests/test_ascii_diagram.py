"""Box diagrams drawn in text, ASCII and Unicode (UAT D17)."""
import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.ascii_diagram import parse_ascii_diagram
from app.services.diagram_service import ascii_nodes, ascii_to_drawio, ascii_to_mermaid, ascii_to_svg, convert_diagram
from app.services.doc_tree import _fence_ascii_diagrams
from app.services.parser_service import detect_content_type

client = TestClient(app)

SIDE_BY_SIDE = """+-----+     +----+
| API | --> | DB |
+-----+     +----+"""

UNICODE = """┌─────┐     ┌────┐
│ API │ ──▶ │ DB │
└─────┘     └────┘"""

DOUBLE_AND_ROUNDED = """╔═════╗     ╭────╮
║ Web ║ ───►│ DB │
╚═════╝     ╰────╯"""


@pytest.mark.parametrize("diagram", [SIDE_BY_SIDE, UNICODE, DOUBLE_AND_ROUNDED])
def test_boxes_joined_by_an_arrow_become_a_left_to_right_flow(diagram: str) -> None:
    mermaid = ascii_to_mermaid(diagram)
    assert mermaid is not None
    lines = mermaid.split("\n")
    assert lines[0] == "flowchart LR"
    assert lines[1].startswith('    N1["') and "-->" in lines[1] and lines[1].count("N2[") == 1


def test_labels_on_a_line_are_kept() -> None:
    mermaid = ascii_to_mermaid("+-----+          +----+\n| API | --HTTP-->| DB |\n+-----+          +----+")
    assert mermaid and '-->|HTTP|' in mermaid


def test_arrow_direction_follows_the_arrowhead() -> None:
    reverse = ascii_to_mermaid("+-----+     +----+\n| API | <-- | DB |\n+-----+     +----+") or ""
    diagram = parse_ascii_diagram("+-----+     +----+\n| API | <-- | DB |\n+-----+     +----+")
    assert (diagram.edges[0].source, diagram.edges[0].target) == (1, 0)
    assert "N2" in reverse.split("\n")[1] and reverse.split("\n")[1].index("N2") < reverse.split("\n")[1].index("N1")
    both = parse_ascii_diagram("+---+     +---+\n| A | <-> | B |\n+---+     +---+")
    assert both.edges[0].arrow == "both" or both.edges == []  # "<->" is two arrowheads on one line


def test_plain_lines_without_arrowheads_flow_in_reading_order_but_mixed_diagrams_keep_plain_lines() -> None:
    mermaid = ascii_to_mermaid("+---+\n| A |\n+---+\n  |\n+---+\n| B |\n+---+")
    assert mermaid == 'flowchart TD\n    N1["A"] --> N2["B"]'
    mixed = parse_ascii_diagram("+---+     +---+\n| A | --> | B |\n+---+     +---+\n  |\n+---+\n| C |\n+---+")
    assert sorted(e.arrow for e in mixed.edges) == ["forward", "none"]


def test_an_l_shaped_connector_is_followed_round_the_corner() -> None:
    diagram = """+-----+
| App |
+-----+
   |
   +----------+
              |
         +----------+
         | Database |
         +----------+"""
    graph = parse_ascii_diagram(diagram)
    assert [(e.source, e.target) for e in graph.edges] == [(0, 1)]


def test_a_box_drawn_inside_another_becomes_a_subgraph() -> None:
    diagram = """+--------------------+
| Cloud              |
|  +-----+   +-----+ |
|  | Web |-->| API | |
|  +-----+   +-----+ |
+--------------------+"""
    graph = parse_ascii_diagram(diagram)
    assert [b.label for b in graph.boxes] == ["Cloud", "Web", "API"]
    assert graph.boxes[1].parent == 0 and graph.boxes[2].parent == 0
    mermaid = ascii_to_mermaid(diagram) or ""
    assert 'subgraph N1["Cloud"]' in mermaid and mermaid.count("end") == 1
    assert 'N2["Web"] --> N3["API"]' in mermaid


def test_several_boxes_and_fan_out() -> None:
    diagram = """+---+      +---+
| A |----->| B |
+---+      +---+
  |
  v
+---+
| C |
+---+"""
    edges = {(e.source, e.target) for e in parse_ascii_diagram(diagram).edges}
    assert edges == {(0, 1), (0, 2)}


def test_unicode_vertical_flow_matches_the_ascii_one() -> None:
    ascii_version = "+---+\n| A |\n+---+\n  |\n  v\n+---+\n| B |\n+---+"
    unicode_version = "┌───┐\n│ A │\n└───┘\n  │\n  ▼\n┌───┐\n│ B │\n└───┘"
    assert ascii_to_mermaid(unicode_version) == ascii_to_mermaid(ascii_version) == 'flowchart TD\n    N1["A"] --> N2["B"]'


def test_unconnected_boxes_fall_back_to_reading_order_with_a_warning() -> None:
    graph = parse_ascii_diagram("+---+\n| A |\n+---+\n\n+---+\n| B |\n+---+")
    assert [(e.source, e.target) for e in graph.edges] == [(0, 1)]
    assert "linked in reading order" in graph.warnings[0]


def test_svg_and_drawio_follow_the_layout_of_the_drawing() -> None:
    svg = ascii_to_svg(SIDE_BY_SIDE) or ""
    root = ET.fromstring(svg)
    rects = [r for r in root.iter("{http://www.w3.org/2000/svg}rect") if r.get("x")]
    assert len(rects) == 2 and float(rects[0].get("x")) < float(rects[1].get("x")) and rects[0].get("y") == rects[1].get("y")
    xml = ascii_to_drawio(UNICODE) or ""
    cells = {c.get("id"): c for c in ET.fromstring(xml.split("?>", 1)[1]).iter("mxCell")}
    assert cells["n1"].get("value") == "API" and cells["e1"].get("source") == "n1" and cells["e1"].get("target") == "n2"


@pytest.mark.parametrize(
    ("diagram", "needle"),
    [
        ("just some words", "No boxes found"),
        ("+-----+\n| API |\n+-----", "Found box corners but no closed rectangle"),
        ("+-----+\n| API |\n+-----+", "Only one box found"),
        ("+---+       +---+\n| A |   x   | B |\n+---+       +---+\n    --- ---", "could not follow a line"),
    ],
)
def test_failures_say_what_to_fix(diagram: str, needle: str) -> None:
    with pytest.raises(ValueError, match=needle):
        convert_diagram(diagram, "mermaid")


def test_api_reports_the_reason_and_the_warnings() -> None:
    bad = client.post("/api/convert-diagram", json={"source": "+-----+\n| API |\n+-----+", "target": "mermaid"})
    assert bad.status_code == 422 and "Only one box found" in bad.json()["detail"]
    ok = client.post("/api/convert-diagram", json={"source": "+---+\n| A |\n+---+\n\n+---+\n| B |\n+---+", "target": "mermaid"}).json()
    assert ok["content"].startswith("flowchart") and "reading order" in ok["warnings"][0]


def test_unicode_and_side_by_side_boxes_are_fenced_as_preformatted_text() -> None:
    for diagram in (SIDE_BY_SIDE, UNICODE):
        fenced = _fence_ascii_diagrams(f"Intro\n\n{diagram}\n\nOutro")
        assert fenced.startswith("Intro\n\n```text\n") and "\n```\n\nOutro" in fenced
    assert "ascii_diagram" in detect_content_type(UNICODE)


def test_nodes_helper_lists_labels_in_reading_order() -> None:
    assert ascii_nodes(SIDE_BY_SIDE) == ["API", "DB"]
    assert ascii_nodes("just text") == []
