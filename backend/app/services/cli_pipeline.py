"""Wrappers around the optional Pandoc, LibreOffice and Mermaid CLI binaries.

Every call runs without a shell, with a timeout and in a throw-away directory. Document content is never passed on the
command line, only through files or stdin.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from app.config import settings

logger = logging.getLogger("app.cli")

_STDERR_LIMIT = 500
# A leftover fence line (e.g. a closing "```mermaid") would be drawn as a node.
_FENCE_LINE = re.compile(r"^[ \t]*(`{3,}|~{3,})[\w-]*[ \t]*$", re.MULTILINE)


class ToolError(RuntimeError):
    """The binary ran and failed."""


class ToolUnavailable(ToolError):
    """The binary is not installed."""


def _find(*names: str) -> str:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    raise ToolUnavailable(f"{names[0]} is not installed")


def has_pandoc() -> bool:
    return shutil.which("pandoc") is not None


def has_libreoffice() -> bool:
    return shutil.which("soffice") is not None or shutil.which("libreoffice") is not None


def has_mermaid_cli() -> bool:
    return shutil.which("mmdc") is not None


def _run(args: list[str], *, input_bytes: bytes | None = None, cwd: str | None = None, env: dict[str, str] | None = None) -> bytes:
    try:
        result = subprocess.run(  # noqa: S603 - fixed argv, no shell
            args, input=input_bytes, capture_output=True, cwd=cwd, env=env, timeout=settings.cli_timeout_seconds, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ToolError(f"{Path(args[0]).name} timed out after {settings.cli_timeout_seconds}s") from exc
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()[:_STDERR_LIMIT]
        raise ToolError(f"{Path(args[0]).name} exited with {result.returncode}: {detail}")
    return result.stdout


def _keep_only_png_data_images(node: object) -> object:
    """Replace every image that is not an inline PNG data URI with its alt text."""
    if isinstance(node, list):
        kept: list[object] = []
        for item in node:
            if isinstance(item, dict) and item.get("t") == "Image":
                url = str(item["c"][2][0])
                if url.startswith("data:image/png;base64,"):
                    kept.append(item)
                else:
                    kept.extend(_keep_only_png_data_images(item["c"][1]))  # type: ignore[arg-type]
            else:
                kept.append(_keep_only_png_data_images(item))
        return kept
    if isinstance(node, dict):
        return {key: _keep_only_png_data_images(value) for key, value in node.items()}
    return node


def pandoc_docx(markdown: str) -> bytes:
    """Markdown (diagram images as data: URIs) to DOCX.

    Pandoc embeds any local file a document links as an image, so `![](/etc/passwd)` would leak it. `--sandbox` blocks
    that but also blocks Pandoc's own template files, so it only guards the parse step: the document is parsed to JSON
    in the sandbox, foreign images are removed from the tree, and the clean tree is written to DOCX. Raw HTML is off.
    """
    pandoc = _find("pandoc")
    with tempfile.TemporaryDirectory(prefix="pandoc-") as work:
        parsed = _run(
            [pandoc, "--sandbox", "--from=gfm-raw_html+hard_line_breaks", "--to=json"], input_bytes=markdown.encode("utf-8"), cwd=work,
        )
        tree = _keep_only_png_data_images(json.loads(parsed))
        output = os.path.join(work, "out.docx")
        # Diagram PNGs are rendered at 3x of 96 DPI.
        _run(
            [pandoc, "--from=json", "--to=docx", "--dpi=288", f"--output={output}"],
            input_bytes=json.dumps(tree).encode("utf-8"), cwd=work,
        )
        return Path(output).read_bytes()


def libreoffice_pdf(docx: bytes) -> bytes:
    office = _find("soffice", "libreoffice")
    with tempfile.TemporaryDirectory(prefix="lo-") as work:
        source = os.path.join(work, "document.docx")
        Path(source).write_bytes(docx)
        # A private profile avoids lock clashes between concurrent conversions and a read-only HOME.
        env = {**os.environ, "HOME": work}
        _run(
            [office, f"-env:UserInstallation=file://{work}/profile", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", work, source],
            cwd=work, env=env,
        )
        output = os.path.join(work, "document.pdf")
        if not os.path.exists(output):
            raise ToolError("LibreOffice produced no PDF")
        return Path(output).read_bytes()


def mermaid_png(source: str) -> bytes:
    mmdc = _find("mmdc")
    with tempfile.TemporaryDirectory(prefix="mmdc-") as work:
        diagram, output = os.path.join(work, "in.mmd"), os.path.join(work, "out.png")
        Path(diagram).write_text(_FENCE_LINE.sub("", source), encoding="utf-8")
        # strict stops diagram text running scripts or links in the headless browser; no-sandbox is needed as container root.
        Path(work, "mermaid.json").write_text(json.dumps({"securityLevel": "strict", "theme": "default"}))
        Path(work, "puppeteer.json").write_text(json.dumps({"args": ["--no-sandbox", "--disable-gpu"]}))
        _run(
            [mmdc, "-i", diagram, "-o", output, "-s", "3", "-b", "white", "-c", os.path.join(work, "mermaid.json"), "-p", os.path.join(work, "puppeteer.json")],
            cwd=work,
        )
        return Path(output).read_bytes()


def png_data_uri(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")
