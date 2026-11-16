# Conversion support

Tidyscribe uses deterministic cleanup rules. Style selection changes heading vocabulary; it does not rewrite prose or generate a design document. Cleanup is reviewed before it is applied.

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
| Arabic / Hebrew | Browser text layout | Viewer text layout | Shaping and bidi layout remain unsupported |
| Emoji | Browser font support | Viewer font support | Unsupported glyphs are dropped |

PDF defaults to A4. DOCX, PDF and browser layout differ in fonts, line breaking, pagination and available constructs. Semantic content checks complement visual review; text extraction alone cannot establish layout fidelity.

The shared corpus and expected format losses live in `test-fixtures/exports/`. Existing layout and performance suites add large tables, long code blocks and multi-page content. The original UAT report is historical; current validation is tracked in [validation.md](validation.md).
