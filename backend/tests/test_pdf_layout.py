"""PDF layout and robustness: content taller than a page, table sizing, lists, and character handling."""
import io

import pytest
from pypdf import PdfReader

from app.services.export_service import CJK_FONT, _has_embedded_cjk, _pdf_fonts, build_export

needs_fonts = pytest.mark.skipif(not _pdf_fonts()[2], reason="DejaVu fonts are not installed")
needs_cjk = pytest.mark.skipif(not (_pdf_fonts()[2] and _has_embedded_cjk()), reason="CJK font is not installed")

PARAGRAPH = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. " * 3


def _pdf(markdown: str) -> PdfReader:
    return PdfReader(io.BytesIO(build_export("t", markdown, "pdf", {})[2]))


def _text(reader: PdfReader) -> str:
    return "\n".join(page.extract_text() for page in reader.pages)


class TestContentTallerThanAPage:
    """These used to raise LayoutError, so the whole export failed."""

    def test_callout_continues_over_pages_without_losing_text(self) -> None:
        quote = "> [!NOTE]\n" + "\n".join(f"> Paragraph {i}. {PARAGRAPH}\n>" for i in range(30))
        reader = _pdf(quote)
        text = _text(reader)
        assert len(reader.pages) >= 3
        assert all(f"Paragraph {i}." in text for i in range(30))
        assert "Note" in text

    def test_plain_blockquote_continues_over_pages(self) -> None:
        reader = _pdf("\n".join(f"> Paragraph {i}. {PARAGRAPH}\n>" for i in range(30)))
        assert len(reader.pages) >= 3
        assert all(f"Paragraph {i}." in _text(reader) for i in range(30))

    def test_table_cell_taller_than_a_page_keeps_every_word_and_what_follows(self) -> None:
        words = " ".join(f"word{i}" for i in range(1500))
        text = _text(_pdf(f"| A | B |\n|---|---|\n| {words} | x |\n\nAFTER-MARKER"))
        assert text.count("word") == 1500
        assert "AFTER-MARKER" in text

    def test_callout_containing_list_and_code_still_renders(self) -> None:
        text = _text(_pdf("> [!WARNING]\n> intro\n>\n> - one\n> - two\n>\n> ```python\n> x = 1\n> ```\n"))
        assert all(piece in text for piece in ("intro", "one", "two", "x = 1"))


class TestTables:
    WIDE = "| " + " | ".join(f"Column {c}" for c in "ABCDEFGH") + " |\n|" + "---|" * 8 + "\n| " + " | ".join("x" for _ in range(8)) + " |\n"

    def test_header_words_are_not_broken_across_lines(self) -> None:
        text = _text(_pdf(self.WIDE))
        for letter in "ABCDEFGH":
            assert f"Column {letter}" in text.replace("\n", " ")
        assert "Colu\n" not in text and "Colu mn" not in text

    def test_a_very_long_word_does_not_starve_the_other_columns(self) -> None:
        text = _text(_pdf("| Name | Link |\n|---|---|\n| Alpha | " + "x" * 400 + " |\n"))
        assert "Name" in text and "Alpha" in text and text.count("x") == 400

    def test_a_long_url_column_gives_way_so_short_words_in_narrow_columns_stay_whole(self) -> None:
        url = "https://example.com/a/very/long/url/that/cannot/wrap/easily/anywhere/at/all/1234567890"
        words = ["bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"]
        header = "| Column A | " + " | ".join(f"Column {c}" for c in "BCDEFGH") + " |\n|" + "---|" * 8 + "\n"
        text = _text(_pdf(header + f"| {url} | " + " | ".join(words) + " |\n"))
        for word in words:
            assert word in text.split(), f"{word!r} was broken across lines"
        assert text.count("Column") == 8 and "Colu\n" not in text

    def test_header_repeats_on_each_page_of_a_long_table(self) -> None:
        rows = "\n".join(f"| {i} | row |" for i in range(150))
        reader = _pdf("| Number | Label |\n|---|---|\n" + rows)
        assert len(reader.pages) >= 3
        assert all("Number" in page.extract_text() for page in reader.pages)

    def test_ragged_empty_and_header_only_tables_render(self) -> None:
        text = _text(_pdf("| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |\n\n| H1 | H2 |\n|----|----|\n\n| X |\n|---|\n|  |\n"))
        assert "H1" in text and "H2" in text


class TestPageFlow:
    def test_heading_does_not_drag_a_long_table_onto_a_new_page(self) -> None:
        rows = "\n".join(f"| {i} | row |" for i in range(80))
        reader = _pdf(f"Short intro paragraph.\n\n## Big table\n\n| N | Label |\n|---|---|\n{rows}")
        first_page = reader.pages[0].extract_text()
        assert "Big table" in first_page and "row" in first_page

    def test_heading_near_the_bottom_moves_with_its_content(self) -> None:
        filler = "\n\n".join(f"Filler paragraph {i}. {PARAGRAPH}" for i in range(7))
        reader = _pdf(f"{filler}\n\n## Orphan check\n\nFollowing text.")
        for page in reader.pages:
            text = page.extract_text()
            assert ("Orphan check" in text) == ("Following text." in text)  # never separated


@needs_fonts
class TestLists:
    def test_task_items_use_checkbox_glyphs(self) -> None:
        text = _text(_pdf("- [x] done\n- [ ] open\n"))
        assert "\u2611" in text and "\u2610" in text
        assert "[x]" not in text and "[ ]" not in text

    def test_item_text_stays_aligned_when_numbers_gain_digits(self) -> None:
        positions: dict[str, float] = {}

        def visit(text: str, _cm, tm, _font, _size) -> None:
            if text.strip().startswith("entry"):
                positions[text.strip()] = tm[4]

        reader = _pdf("\n".join(f"{i}. entry {i}" for i in range(95, 110)))
        for page in reader.pages:
            page.extract_text(visitor_text=visit)
        assert len(positions) == 15
        assert len({round(x, 1) for x in positions.values()}) == 1  # one text column for 2- and 3-digit numbers

    def test_ordered_list_keeps_its_start_number(self) -> None:
        text = _text(_pdf("7. seven\n8. eight\n"))
        assert "7." in text and "8." in text


@needs_fonts
class TestCharacters:
    def test_emoji_are_dropped_instead_of_corrupting_the_text_layer(self) -> None:
        reader = _pdf("# Release \U0001f680 notes\n\nStatus \U0001f600 ok\n\nDone \u2705 and failed \u274c")
        text = _text(reader)  # extraction used to raise binascii.Error for these documents
        assert "Release" in text and "notes" in text and "ok" in text
        assert "\U0001f680" not in text and "\U0001f600" not in text
        assert "\u2714" in text and "\u2718" in text  # check/cross emoji keep their meaning as symbols

    def test_invisible_characters_are_removed(self) -> None:
        assert "ok done" in _text(_pdf("ok\u200b\u200d\ufe0f done")).replace("\n", " ")

    def test_mixed_scripts_survive_text_extraction(self) -> None:
        text = _text(_pdf("# Caf\u00e9 \u2192 \u03a9 \u041f\u0440\u0438\u0432\u0435\u0442 \u2714"))
        assert "Caf\u00e9 \u2192 \u03a9" in text and "\u041f\u0440\u0438\u0432\u0435\u0442" in text and "\u2714" in text

    def test_repeated_builds_in_one_process_stay_valid(self) -> None:
        for _ in range(3):
            assert "Caf\u00e9" in _text(_pdf("# Caf\u00e9 \u4e2d\u6587\n\n```\n\u4e2d\u6587 = 1\n```"))


@needs_cjk
class TestCjk:
    def test_chinese_japanese_korean_are_embedded_and_searchable(self) -> None:
        data = build_export("t", "# \u4e2d\u6587\u6807\u9898\n\n\u65e5\u672c\u8a9e \ud55c\uad6d\uc5b4 **\u7c97\u4f53**", "pdf", {})[2]
        assert CJK_FONT.encode() in data or b"WenQuanYi" in data  # embedded, not left to the viewer
        text = _text(PdfReader(io.BytesIO(data)))
        for expected in ("\u4e2d\u6587\u6807\u9898", "\u65e5\u672c\u8a9e", "\ud55c\uad6d\uc5b4", "\u7c97\u4f53"):
            assert expected in text

    def test_cjk_in_tables_and_code_blocks(self) -> None:
        text = _text(_pdf("| \u540d\u79f0 | \u63cf\u8ff0 |\n|---|---|\n| \u4e2d\u6587 | \u8bf4\u660e |\n\n```\n\u4e2d\u6587\u4ee3\u7801 = 1\n```"))
        assert all(piece in text for piece in ("\u540d\u79f0", "\u8bf4\u660e", "\u4e2d\u6587\u4ee3\u7801"))

    def test_long_cjk_code_lines_wrap_by_display_width(self) -> None:
        reader = _pdf("```\n" + "\u4e2d" * 200 + "\n```")
        assert _text(reader).replace("\n", "").count("\u4e2d") == 200
