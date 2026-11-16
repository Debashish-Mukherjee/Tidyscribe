# Conversion support

Tidyscribe uses deterministic cleanup rules. Style selection changes heading vocabulary; it does not rewrite prose or generate a design document. Cleanup is reviewed before it is applied.

## File import

Choose **Import** in the editor toolbar to open a UTF-8 `.md`, `.markdown`, `.txt`, `.html` or `.htm` file, up to 2,000,000 bytes (2 MB). Markdown and text retain their contents; a UTF-8 BOM is removed. HTML uses the same sanitized conversion pipeline as rich paste, preserving supported document structure and reporting conversion notices. An imported HTML file's relative links and images are not resolved against its original folder. DOCX and PDF import are not supported.

The original file is read in the browser. Importing does not upload it or create a saved document. Existing unsaved work offers Cancel, Save then open, or Discard and open. Imports start a new unsaved document so saving cannot overwrite the previously opened document. Draft autosave and recovery apply to the imported text as usual. Empty, binary, unsupported, oversized and invalid UTF-8 files leave the editor unchanged.

## Export

The default engine uses the shared document tree. Browser exports submit sanitized preview HTML; API-only exports render Markdown on the server. The optional Pandoc engine consumes Markdown through a separate conversion path, so it has different formatting behavior. A failed optional tool falls back to the built-in writer and logs the reason.

| Feature | Preview / HTML | Built-in DOCX | Built-in PDF |
| --- | --- | --- | --- |
| Headings, lists, links, code | Semantic structure | Word structures and styles | Structured page layout |
| Tables, including merged cells | HTML tables | Word tables | Paginated tables |
| Callouts and tasks | Styled elements | Document equivalents | Document equivalents |
| Mermaid | Browser SVG; exported PNG when provided | PNG or source fallback | PNG or source fallback |
| Math | MathML | Readable Unicode | Readable Unicode |
| Raw document HTML | Safe semantic subset | Supported tree elements | Supported tree elements |
| Remote images | Shown in Preview; alt text in export | Alt text | Alt text |
| CJK | Browser font support | Depends on viewer fonts | Embedded regular CJK font in standard image |
| Arabic / Hebrew | Browser text layout | Viewer text layout | Shaped glyphs and bidirectional layout |
| Emoji | Browser font support | Viewer font support | Unsupported glyphs are dropped |

Documents containing RTL text use WeasyPrint with Pango/HarfBuzz to shape text and lay out mixed-direction lines. The input is generated from the shared sanitized document tree, with math represented as readable Unicode. Embedded diagram PNGs are allowed; external and local-file resources are rejected. Other documents use the existing ReportLab writer. Both PDF paths preserve the existing unsupported-emoji policy.

PDF defaults to A4. DOCX, PDF and browser layout differ in fonts, line breaking, pagination and available constructs. Semantic content checks complement visual review; text extraction alone cannot establish layout fidelity.

The shared corpus and expected format losses live in `test-fixtures/exports/`. Existing layout and performance suites add large tables, long code blocks and multi-page content. The original UAT report is historical; current validation is tracked in [validation.md](validation.md).
