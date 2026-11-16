# Reliability milestone validation

Validated on 16 November 2026 using a dedicated Docker Compose project and Chromium. These results replace the historical UAT report as the baseline for this milestone.

| Check | Result |
| --- | --- |
| Backend suite | 254 passed, 3 skipped; 93% application line coverage |
| Frontend unit/component suite | 352 passed across 26 files |
| ESLint and TypeScript | Passed |
| Production frontend build | Passed locally and in the standard Docker image |
| End-to-end browser suite | 79 passed |
| Smoke, accessibility and recovery browser suites | 73 passed, including keyboard focus and reflow at 320, 375, 768, 1280 and 3440 pixels |
| Targeted performance browser checks | 3 passed: typing in 1,000-line, 10,000-line and diagram-heavy documents stayed within the 1.5-second burst threshold |
| OpenAPI schema types | Generated types match the backend contract |
| Portable Compose build | Standard images build without personal paths or corporate certificates |
| Scheduled export retention | Beat dispatched maintenance; an expired file was removed and its download URL cleared |
| Backup / restore | A saved document and generated export were recovered in a separate empty Compose project; a second restore refused to overwrite existing data |

The backend checks include concurrent saves using one revision, stale version restoration, cancellation, timeout handling, and recovery after an export task process was killed with SIGKILL. Browser fidelity checks compare preview content with HTML, DOCX and PDF output, including tables, diagrams and code.

## Historical findings reconciled

| Original finding | Current disposition |
| --- | --- |
| D1 hostile preview content | Sanitization, shadow-root isolation and recovery paths are covered by unit and browser checks. |
| D2–D7 import and Markdown support | Source adapters, shared import fixtures and rendering extensions have regression coverage. |
| D8 documents capped at 100 | Load-more pagination is implemented; the component test fetches the second page. |
| D9 RTL PDF text | Remains a format limitation; see conversion support. |
| D10 stuck jobs / export performance | Lifecycle recovery, periodic maintenance, retention and timeouts are implemented. SIGKILL recovery is tested. Large-export performance remains bounded by document complexity and configured limits. |
| D11–D14 lost work, concurrency and failures | Confirmation flows, revision checks, document-aware drafts and readable failure handling are covered by tests. |
| D15 cleanup behavior | Rule-based, reviewed cleanup; vocabulary changes apply to headings and preserve prose. |
| D16 HTML fidelity | Semantic HTML policy and shared export corpus have regression coverage. |
| D17 diagrams | Supported ASCII and Unicode structures have tests; unsupported diagram formats remain explicit limitations. |
| D18 file import | Still future work. |
| D19 empty search results | Distinct search-empty and library-empty messages. |
| D20 browser history | Sidebar navigation does not yet represent browser history entries. |
| D21 accessibility / D24 narrow layouts | Keyboard menus and tabs, preview naming, focus indicators and a single-pane narrow layout are implemented. |
| D22 diagram theming | Diagram rendering still uses a light theme. |
| D23 rendering latency | Preview updates are deferred; diagram render work is cached with separate SVG ids for each insertion. |
| D25 environment hygiene | Portable builds, isolated validation projects and generated-file retention are in place. Job metadata and soft-deleted records still need a retention policy. |

## Limits of this validation

The optional Pandoc, LibreOffice and Mermaid CLI integration tests were skipped because those binaries are absent in the standard image. Mocked fallback tests passed. Firefox, WebKit, a two-hour soak and a second physical machine were not tested. Semantic extraction checks cannot establish visual fidelity for every document.

Authentication, ownership and CI remain explicitly deferred. This milestone does not change that deployment scope. Format-specific limitations, including PDF emoji and RTL shaping, are documented in [conversion.md](conversion.md).
