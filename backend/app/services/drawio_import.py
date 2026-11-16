"""Draw.io (diagrams.net) files -> Mermaid flowcharts."""
from __future__ import annotations

import base64
import re
import urllib.parse
import xml.etree.ElementTree as ET
import zlib

from app.services.mermaid_util import edge, label, node

_MAX_XML = 5_000_000


def _safe_parse(text: str) -> ET.Element | None:
    # DTDs and entities are how XML bombs and external-entity tricks work; draw.io files never need them.
    if re.search(r"<!(DOCTYPE|ENTITY)", text, re.IGNORECASE):
        return None
    try:
        return ET.fromstring(text)
    except ET.ParseError:
        return None


def _inflate(payload: str) -> str | None:
    """Draw.io stores pages as base64(raw deflate(url-encoded XML)) unless compression is turned off."""
    try:
        raw = zlib.decompressobj(-15).decompress(base64.b64decode(payload.strip()), _MAX_XML)
    except (ValueError, zlib.error):
        return None
    return urllib.parse.unquote(raw.decode("utf-8", errors="replace"))


def _model(root: ET.Element) -> ET.Element | None:
    if root.tag == "mxGraphModel":
        return root
    model = root.find(".//mxGraphModel")
    if model is not None:
        return model
    diagram = root if root.tag == "diagram" else root.find(".//diagram")
    if diagram is not None and (diagram.text or "").strip():
        inflated = _inflate(diagram.text)
        parsed = _safe_parse(inflated) if inflated else None
        if parsed is not None:
            return parsed if parsed.tag == "mxGraphModel" else parsed.find(".//mxGraphModel")
    return None


def _style(cell: ET.Element) -> dict[str, str]:
    pairs = (part.partition("=") for part in (cell.get("style") or "").split(";") if part)
    return {key: value for key, _, value in pairs}


def _shape(style: dict[str, str], raw: str) -> str:
    keys = set(style) | {raw}
    if "rhombus" in keys or style.get("shape") == "rhombus":
        return "diamond"
    if "ellipse" in keys or style.get("shape") == "ellipse":
        return "circle"
    if style.get("shape", "").startswith(("cylinder", "datastore")):
        return "cylinder"
    if style.get("shape") == "hexagon" or "hexagon" in keys:
        return "hexagon"
    if style.get("rounded") == "1" or style.get("arcSize"):
        return "round"
    return "rect"


def drawio_to_mermaid(source: str) -> str | None:
    root = _safe_parse(source.strip())
    if root is None:
        return None
    model = _model(root)
    if model is None:
        return None

    vertices: dict[str, ET.Element] = {}
    edges: list[ET.Element] = []
    for cell in model.iter("mxCell"):
        identifier = cell.get("id")
        if not identifier:
            continue
        if cell.get("edge") == "1":
            edges.append(cell)
        elif cell.get("vertex") == "1":
            vertices[identifier] = cell

    edge_ids = {cell.get("id") for cell in edges}
    edge_labels: dict[str, str] = {}
    for identifier, cell in list(vertices.items()):
        # Labels dragged onto an edge are separate vertices whose parent is the edge.
        if cell.get("parent") in edge_ids:
            edge_labels[cell.get("parent", "")] = cell.get("value") or ""
            del vertices[identifier]

    # Containers are vertices that other vertices name as their parent.
    parents = {cell.get("parent") for cell in vertices.values()}
    containers = {identifier for identifier in vertices if identifier in parents}
    if not vertices:
        return None

    def mermaid_id(identifier: str) -> str:
        return "D" + re.sub(r"[^A-Za-z0-9_]", "_", identifier)

    xs, ys = [], []
    for cell in vertices.values():
        geometry = cell.find("mxGeometry")
        if geometry is not None and geometry.get("x") is not None:
            xs.append(float(geometry.get("x") or 0))
            ys.append(float(geometry.get("y") or 0))
    direction = "LR" if xs and (max(xs) - min(xs)) > (max(ys) - min(ys)) * 1.2 else "TD"

    out = [f"flowchart {direction}"]

    def emit(parent: str | None, depth: int) -> None:
        pad = "    " * (depth + 1)
        for identifier, cell in vertices.items():
            actual_parent = cell.get("parent")
            if (actual_parent if actual_parent in vertices else None) != parent:
                continue
            text = cell.get("value") or ""
            if identifier in containers:
                out.append(f'{pad}subgraph {mermaid_id(identifier)}["{label(text) or identifier}"]')
                emit(identifier, depth + 1)
                out.append(f"{pad}end")
            else:
                shape = _shape(_style(cell), cell.get("style", "").split(";")[0])
                out.append(pad + node(mermaid_id(identifier), text or identifier, shape))

    emit(None, 0)

    connected = 0
    for cell in edges:
        source_id, target_id = cell.get("source"), cell.get("target")
        if source_id not in vertices or target_id not in vertices:
            continue
        style = _style(cell)
        text = cell.get("value") or edge_labels.get(cell.get("id", ""), "")
        arrow = style.get("endArrow", "classic") != "none"
        out.append("    " + edge(mermaid_id(source_id), mermaid_id(target_id), text, dotted=style.get("dashed") == "1", arrow=arrow))
        connected += 1

    # A single unconnected shape is not a diagram worth converting.
    return "\n".join(out) if connected or len(vertices) > 1 else None
