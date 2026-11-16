"""Export profiler: python -m bench.profile_export [--rows 100 300] [--format docx pdf html] [--profile].

Prints wall time, peak RSS and (with --profile) the cumulative hot spots of each export stage.
"""
from __future__ import annotations

import argparse
import cProfile
import io
import pstats
import resource
import time

from app.services.export_service import build_export, parse_document


def table_markdown(rows: int, cols: int = 6) -> str:
    head = "| " + " | ".join(f"Col {i + 1}" for i in range(cols)) + " |\n| " + " | ".join("---" for _ in range(cols)) + " |\n"
    body = "".join("| " + " | ".join(f"r{r}c{c} **v**" if c == 0 else f"r{r}c{c}" for c in range(cols)) + " |\n" for r in range(rows))
    return f"# Table\n\n{head}{body}"


def prose(lines: int) -> str:
    out = ["# Large document", ""]
    for i in range(lines):
        if i % 50 == 0:
            out += ["", f"## Section {i // 50 + 1}", ""]
        elif i % 10 == 0:
            out.append(f"- bullet {i} with **bold** and `code` and [a link](https://example.com/{i})")
        else:
            out.append(f"Line {i}: The quick brown fox jumps over the lazy dog.")
    return "\n".join(out)


SHAPES = {
    "prose": prose,
    "code": lambda n: "# Code\n\n```python\n" + "\n".join(f"def f{i}(x): return x * {i}  # comment" for i in range(n)) + "\n```\n",
    "quotes": lambda n: "\n\n".join(f"> **Note {i}**\n> quoted line with `code`" for i in range(n)),
    "links": lambda n: "\n\n".join(f"Paragraph {i} [one](https://a.example/{i}) and [two](https://b.example/{i})." for i in range(n)),
    "nested": lambda n: "\n".join(f"- item {i}\n  - child {i}\n    1. grandchild {i}" for i in range(n)),
}


def rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def run(label: str, fn, profile: bool) -> None:
    profiler = cProfile.Profile() if profile else None
    started = time.perf_counter()
    if profiler:
        profiler.enable()
    result = fn()
    if profiler:
        profiler.disable()
    elapsed = time.perf_counter() - started
    size = len(result) if isinstance(result, (bytes, str)) else 0
    print(f"{label:<28} {elapsed:8.2f}s  peak-rss {rss_mb():7.0f} MB  out {size / 1024:8.0f} KB")
    if profiler:
        out = io.StringIO()
        pstats.Stats(profiler, stream=out).sort_stats("cumulative").print_stats(14)
        print("\n".join(line for line in out.getvalue().splitlines() if line.strip())[:3500])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, nargs="+", default=[100, 300, 1000])
    parser.add_argument("--format", nargs="+", default=["docx"])
    parser.add_argument("--profile", action="store_true")
    parser.add_argument("--shape", default="table", choices=["table", *SHAPES])
    args = parser.parse_args()
    for rows in args.rows:
        text = table_markdown(rows) if args.shape == "table" else SHAPES[args.shape](rows)
        run(f"parse {rows} rows", lambda: str(len(parse_document(text).children)), False)
        for fmt in args.format:
            run(f"{fmt} {rows} rows", lambda: build_export("Table", text, fmt, {})[2], args.profile)


if __name__ == "__main__":
    main()
