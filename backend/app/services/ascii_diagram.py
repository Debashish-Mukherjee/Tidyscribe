"""ASCII and Unicode box diagrams to a graph: boxes, containment, and the lines and arrows between them.

Boxes are closed rectangles (`+---+` / `| x |`, or ┌─┐ │ └┘ and the double and rounded variants). A connection is a run of
line characters that leaves one box and arrives at another, possibly turning at `+` corners and carrying a label
(`--HTTP-->`). Anything the reader cannot follow is reported as a diagnosis instead of a silent "unsupported".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

_NORMALISE = str.maketrans(
    {
        **dict.fromkeys("┌┐└┘╔╗╚╝╭╮╰╯├┤┬┴┼╠╣╦╩╬╒╓╕╖╘╙╛╜╞╟╡╢╤╥╧╨╪╫", "+"),
        **dict.fromkeys("─━═╌╍┄┅┈┉╴╶", "-"),
        **dict.fromkeys("│┃║╎╏┆┇┊┋╵╷", "|"),
        **dict.fromkeys("→▶►➔➜⇒⟶▸➤➞", ">"),
        **dict.fromkeys("←◀◄⇐⟵◂", "<"),
        **dict.fromkeys("↑▲△⇑", "^"),
        **dict.fromkeys("↓▼▽⇓", "v"),
    }
)

_RIGHT, _LEFT, _DOWN, _UP = (0, 1), (0, -1), (1, 0), (-1, 0)
_LABEL_CHARS = re.compile(r"[A-Za-z0-9 .,:;/_()'\"#@%&*!?]")


@dataclass
class Box:
    index: int
    top: int
    left: int
    bottom: int
    right: int
    label: str = ""
    parent: int | None = None

    @property
    def width(self) -> int:
        return self.right - self.left + 1

    @property
    def height(self) -> int:
        return self.bottom - self.top + 1

    def contains(self, other: "Box") -> bool:
        return self is not other and self.top < other.top and self.left < other.left and self.bottom > other.bottom and self.right > other.right


@dataclass
class Edge:
    source: int
    target: int
    label: str = ""
    arrow: str = "forward"  # forward | both | none


@dataclass
class Diagram:
    boxes: list[Box] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    problem: str | None = None  # why nothing usable was found, in words the author can act on
    grid_width: int = 0
    grid_height: int = 0


def normalise(text: str) -> list[str]:
    lines = [line.expandtabs(4).translate(_NORMALISE).rstrip() for line in (text or "").replace("\r\n", "\n").split("\n")]
    width = max((len(line) for line in lines), default=0)
    return [line.ljust(width) for line in lines]


def _at(grid: list[str], row: int, col: int) -> str:
    return grid[row][col] if 0 <= row < len(grid) and 0 <= col < len(grid[row]) else " "


# ---------------------------------------------------------------- boxes

def _find_boxes(grid: list[str]) -> list[Box]:
    boxes: list[Box] = []
    for row, line in enumerate(grid):
        for col, char in enumerate(line):
            if char != "+":
                continue
            # candidate right corners: every "+" reached through dashes
            candidates: list[int] = []
            probe = col + 1
            while probe < len(line) and line[probe] in "-=+":
                if line[probe] == "+" and probe - col >= 2:
                    candidates.append(probe)
                probe += 1
            for right_col in candidates:
                bottom = _box_bottom(grid, row, col, right_col)
                if bottom is not None:
                    boxes.append(Box(len(boxes), row, col, bottom, right_col))
                    break
    return boxes


def _box_bottom(grid: list[str], top: int, left: int, right: int) -> int | None:
    for bottom in range(top + 2, len(grid)):
        if _at(grid, bottom, left) not in "|+":
            return None
        if _at(grid, bottom, left) == "+":
            if _at(grid, bottom, right) == "+" and all(_at(grid, bottom, c) in "-=+" for c in range(left, right + 1)):
                if all(_at(grid, r, right) in "|+" for r in range(top + 1, bottom)):
                    return bottom
        # keep going down the left wall; the corner may be lower
    return None


def _label(grid: list[str], box: Box, children: list[Box]) -> str:
    parts: list[str] = []
    for row in range(box.top + 1, box.bottom):
        if any(c.top <= row <= c.bottom for c in children):
            continue  # a container's own caption sits above its children; connectors between them are not text
        chars = []
        for col in range(box.left + 1, box.right):
            inside_child = any(c.top <= row <= c.bottom and c.left <= col <= c.right for c in children)
            chars.append(" " if inside_child else grid[row][col])
        text = re.sub(r"\s+", " ", "".join(chars)).strip()
        if text and not set(text) <= {"-", "=", "|", "+"}:
            parts.append(text)
    return " ".join(parts)


def _border_cells(box: Box) -> set[tuple[int, int]]:
    cells = {(box.top, c) for c in range(box.left, box.right + 1)} | {(box.bottom, c) for c in range(box.left, box.right + 1)}
    cells |= {(r, box.left) for r in range(box.top, box.bottom + 1)} | {(r, box.right) for r in range(box.top, box.bottom + 1)}
    return cells


# ---------------------------------------------------------------- connections

def _trace(grid: list[str], start: tuple[int, int], direction: tuple[int, int], origin: Box, owners: dict[tuple[int, int], int], used: set[tuple[int, int]]):
    row, col = start
    path: list[tuple[int, int]] = []
    label: list[str] = []
    arrow_forward = False
    arrow_back = False
    first = True
    for _ in range(400):
        owner = owners.get((row, col))
        if owner is not None and owner != origin.index:
            return owner, "".join(label).strip(), arrow_forward, arrow_back, path
        if owner == origin.index and not first:
            return None
        char = _at(grid, row, col)
        horizontal = direction[0] == 0
        if (row, col) in used and not first:
            return None
        if first and char in "<>^v" and _points_into_origin(char, direction):
            arrow_back = True
        elif horizontal:
            if char in "-=":
                pass
            elif char == ">" and direction == _RIGHT or char == "<" and direction == _LEFT:
                arrow_forward = True
            elif char == "+":
                turned = _turn(grid, row, col, (_UP, _DOWN), owners, origin)
                if turned is None:
                    return None
                direction = turned
            elif _LABEL_CHARS.match(char) and path:
                label.append(char)
            else:
                return None
        else:
            if char == "|":
                pass
            elif char in "vV" and direction == _DOWN or char == "^" and direction == _UP:
                arrow_forward = True
            elif char == "+":
                turned = _turn(grid, row, col, (_LEFT, _RIGHT), owners, origin)
                if turned is None:
                    return None
                direction = turned
            else:
                return None
        path.append((row, col))
        first = False
        row, col = row + direction[0], col + direction[1]
    return None


def _points_into_origin(char: str, direction: tuple[int, int]) -> bool:
    return (char == "<" and direction == _RIGHT) or (char == ">" and direction == _LEFT) or (char in "vV" and direction == _UP) or (char == "^" and direction == _DOWN)


def _turn(grid: list[str], row: int, col: int, options: tuple[tuple[int, int], tuple[int, int]], owners: dict, origin: Box) -> tuple[int, int] | None:
    usable = []
    for option in options:
        nxt = (row + option[0], col + option[1])
        char = _at(grid, *nxt)
        vertical = option[1] == 0
        ok = char in ("|+vV^" if vertical else "-=+<>") or (owners.get(nxt) not in (None, origin.index))
        if ok:
            usable.append(option)
    return usable[0] if len(usable) == 1 else None


def _side_label(grid: list[str], path: list[tuple[int, int]], boxes: list[Box]) -> str:
    """Text written beside a vertical line, e.g. `| calls`."""
    for row, col in path:
        if _at(grid, row, col) != "|":
            continue
        text = ""
        probe = col + 2
        while probe < len(grid[row]) and _LABEL_CHARS.match(grid[row][probe]):
            text += grid[row][probe]
            probe += 1
        text = text.strip()
        if text and not any(b.top <= row <= b.bottom and b.left <= col + 2 <= b.right for b in boxes):
            return text
    return ""


# ---------------------------------------------------------------- driver

def parse_ascii_diagram(text: str) -> Diagram:
    grid = normalise(text)
    diagram = Diagram(grid_width=len(grid[0]) if grid else 0, grid_height=len(grid))
    boxes = sorted(_find_boxes(grid), key=lambda b: (b.top, b.left))
    for index, box in enumerate(boxes):
        box.index = index

    # Containment: the smallest enclosing box is the parent.
    for box in boxes:
        enclosing = [other for other in boxes if other.contains(box)]
        if enclosing:
            box.parent = min(enclosing, key=lambda o: o.width * o.height).index
    for box in boxes:
        box.label = _label(grid, box, [c for c in boxes if box.contains(c)])
    diagram.boxes = boxes

    if len(boxes) == 0:
        corners = sum(line.count("+") for line in grid)
        if corners:
            diagram.problem = (
                "Found box corners but no closed rectangle. Every box needs all four corners and top and bottom edges of the same "
                "width, for example +-----+ / | API | / +-----+ (or ┌─────┐ │ API │ └─────┘)."
            )
        else:
            diagram.problem = "No boxes found. Draw each box as +-----+ / | label | / +-----+, or with ┌─┐ │ │ └─┘, and connect them with lines such as --> or │ ▼."
        return diagram
    if len(boxes) == 1:
        diagram.problem = "Only one box found. A diagram needs at least two boxes joined by a line or an arrow."
        return diagram

    owners: dict[tuple[int, int], int] = {}
    for box in sorted(boxes, key=lambda b: b.width * b.height, reverse=True):  # inner boxes win shared cells
        for cell in _border_cells(box):
            owners[cell] = box.index
    used: set[tuple[int, int]] = set()

    for box in boxes:
        sides = (
            [((r, box.right + 1), _RIGHT) for r in range(box.top + 1, box.bottom)]
            + [((r, box.left - 1), _LEFT) for r in range(box.top + 1, box.bottom)]
            + [((box.top - 1, c), _UP) for c in range(box.left, box.right + 1)]
            + [((box.bottom + 1, c), _DOWN) for c in range(box.left, box.right + 1)]
        )
        for start, direction in sides:
            # Lines rarely touch the box: "| API | --> | DB |" has spaces on both sides of the arrow.
            for _ in range(4):
                if _at(grid, *start) != " ":
                    break
                start = (start[0] + direction[0], start[1] + direction[1])
            if start in used or _at(grid, *start) == " ":
                continue
            traced = _trace(grid, start, direction, box, owners, used)
            if traced is None:
                continue
            target, label, forward, back, path = traced
            if not path or target == box.index:
                continue
            used.update(path)
            if forward and back:
                edge = Edge(box.index, target, label, "both")
            elif forward:
                edge = Edge(box.index, target, label, "forward")
            elif back:
                edge = Edge(target, box.index, label, "forward")
            else:
                edge = Edge(box.index, target, label, "none")
            if not edge.label:
                edge.label = _side_label(grid, path, boxes)
            diagram.edges.append(edge)

    # No arrowheads anywhere: plain lines read as flow from the earlier box to the later one.
    if diagram.edges and all(edge.arrow == "none" for edge in diagram.edges):
        for edge in diagram.edges:
            edge.arrow = "forward"
            if edge.source > edge.target:
                edge.source, edge.target = edge.target, edge.source

    connected = {e.source for e in diagram.edges} | {e.target for e in diagram.edges}
    if not diagram.edges:
        loose = [(r, c) for r, line in enumerate(grid) for c, ch in enumerate(line) if ch in "-|=><^+" and not _inside_any_box(boxes, r, c)]
        if loose:
            diagram.problem = (
                f"Found {len(boxes)} boxes but could not follow a line between any two of them. A connection must touch the "
                "border of both boxes and use only - | + and the arrowheads > < ^ v (or ─ │ ▶ ▼)."
            )
        else:
            diagram.warnings.append(f"No lines or arrows connect the {len(boxes)} boxes, so they were linked in reading order.")
            leaves = [b for b in boxes if not any(b.contains(o) for o in boxes)]
            diagram.edges = [Edge(a.index, b.index) for a, b in zip(leaves, leaves[1:])]
    else:
        for box in boxes:
            if box.index not in connected and not any(box.contains(o) for o in boxes) and box.parent is None:
                diagram.warnings.append(f"The box \u201c{box.label or box.index + 1}\u201d has no line to any other box.")
    return diagram


def _inside_any_box(boxes: list[Box], row: int, col: int) -> bool:
    return any(b.top <= row <= b.bottom and b.left <= col <= b.right for b in boxes)
