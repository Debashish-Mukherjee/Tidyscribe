"""Export time must grow roughly linearly with document size (UAT D10: 100 rows took 7.7 s, 300 rows 67 s)."""
import time

import pytest

from app.services.export_service import build_export


def _table(rows: int, cols: int = 6) -> str:
    head = "| " + " | ".join(f"Col {i}" for i in range(cols)) + " |\n| " + " | ".join("---" for _ in range(cols)) + " |\n"
    return head + "".join("| " + " | ".join(f"r{r}c{c}" for c in range(cols)) + " |\n" for r in range(rows))


def _seconds(text: str, fmt: str) -> float:
    started = time.perf_counter()
    build_export("Perf", text, fmt, {})
    return time.perf_counter() - started


# Budgets from the UAT acceptance targets, with headroom for a busy CI machine.
@pytest.mark.parametrize(("rows", "budget"), [(100, 2.0), (300, 5.0), (1000, 15.0)])
def test_docx_table_budget(rows: int, budget: float) -> None:
    assert _seconds(_table(rows), "docx") < budget


def test_docx_table_time_is_not_quadratic() -> None:
    small, large = _seconds(_table(300), "docx"), _seconds(_table(1200), "docx")
    assert large < small * 4 * 2.5  # 4x the rows; quadratic growth would be ~16x


@pytest.mark.parametrize(
    "shape",
    [
        lambda n: "\n\n".join(f"> quote {i}\n> second line" for i in range(n)),
        lambda n: "\n\n".join(f"Paragraph {i} [a](https://a.example/{i}) [b](https://b.example/{i})" for i in range(n)),
        lambda n: "\n".join(f"- item {i}\n  - child {i}\n    1. grandchild {i}" for i in range(n)),
    ],
    ids=["blockquotes", "links", "nested-lists"],
)
def test_docx_other_block_types_scale_linearly(shape) -> None:
    small, large = _seconds(shape(500), "docx"), _seconds(shape(2000), "docx")
    assert large < max(small, 0.05) * 4 * 2.5


@pytest.mark.parametrize("fmt", ["pdf", "html"])
def test_large_tables_export_quickly_in_every_format(fmt: str) -> None:
    assert _seconds(_table(1000), fmt) < 15.0
