# Reliability milestone validation

Validated on 16 November 2026 using a dedicated Docker Compose project and Chromium. These results replace the historical UAT report as the baseline for this milestone.

| Check | Result |
| --- | --- |
| Backend suite | 271 passed, 3 skipped; 93% application line coverage |
| Frontend unit/component suite | 352 passed across 26 files |
| ESLint and TypeScript | Passed |
| Production frontend build | Passed locally and in the standard Docker image |
| End-to-end browser suite | 80 passed |
| Expanded browser regression suite | 93 passed, including RTL PDF extraction and light-mode code styling |
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
| D9 RTL PDF text | Fixed: shaping-capable RTL layout; see the RTL milestone below. |
| D10 stuck jobs / export performance | Lifecycle recovery, periodic maintenance, retention and timeouts are implemented. SIGKILL recovery is tested. Large-export performance remains bounded by document complexity and configured limits. |
| D11–D14 lost work, concurrency and failures | Confirmation flows, revision checks, document-aware drafts and readable failure handling are covered by tests. |
| D15 cleanup behavior | Rule-based, reviewed cleanup; vocabulary changes apply to headings and preserve prose. |
| D16 HTML fidelity | Semantic HTML policy and shared export corpus have regression coverage. |
| D17 diagrams | Supported ASCII and Unicode structures have tests; unsupported diagram formats remain explicit limitations. |
| D18 file import | Still future work. |
| D19 empty search results | Distinct search-empty and library-empty messages. |
| D20 browser history | Sidebar navigation does not yet represent browser history entries. |
| D21 accessibility / D24 narrow layouts | Keyboard menus and tabs, preview naming, focus indicators and a single-pane narrow layout are implemented. |
| D22 diagram theming | Light-mode code backgrounds are fixed. Diagram rendering still uses a light theme. |
| D23 rendering latency | Preview updates are deferred; diagram render work is cached with separate SVG ids for each insertion. |
| D25 environment hygiene | Portable builds, isolated validation projects and generated-file retention are in place. Job metadata and soft-deleted records still need a retention policy. |

## Limits of this validation

The optional Pandoc, LibreOffice and Mermaid CLI integration tests were skipped because those binaries are absent in the standard image. Mocked fallback tests passed. Firefox, WebKit, a two-hour soak and a second physical machine were not tested. Semantic extraction checks cannot establish visual fidelity for every document.

Authentication, ownership and CI remain explicitly deferred. This milestone does not change that deployment scope. Remaining format-specific limitations, including PDF emoji, are documented in [conversion.md](conversion.md).

## Dependency hardening validation

The subsequent dependency cleanup was validated on 16 November 2026. Clean `npm ci` now runs with normal peer checks. ESLint, TypeScript, 352 unit/component tests, V8 coverage and the production build passed with Vitest 4.1.12 and Vite 8.3.8. The upgraded FastAPI/Starlette stack passed 254 backend tests (3 optional CLI tests skipped), retaining 93% application line coverage. The generated OpenAPI types were refreshed for the updated validation-error schema. All 79 end-to-end tests and 73 smoke/accessibility/recovery checks passed again on the upgraded stack.

The complete npm audit and its production-only subset reported zero known vulnerabilities. Separate audits of the actual frozen packages from the constrained Python runtime and test images also reported zero known vulnerabilities. `pip check` passed for both images. Image inspection confirmed that production excludes test tools and test sources. These are package audits of the standard images, not an audit of the operating system or the optional Pandoc/LibreOffice/Mermaid CLI toolchain.

See [dependency-maintenance.md](dependency-maintenance.md) for versions, the scoped minimatch override and reproducible audit commands. CI and authentication remain deferred.

The expanded browser regression run reproduced the known RTL PDF limitation. A direct before/after probe using the previous and upgraded backend images returned identical reversed Arabic and Hebrew text with `pdftotext`, while Japanese text was preserved. This is a pre-existing export limitation, not a dependency-upgrade regression. The failing fidelity assertions are retained. A stale editor-name selector in the Mermaid repeat-edit regression test was also corrected to use the shared editor locator.

The expanded regression suite also reproduced the known light-mode styling issue: code-block backgrounds match the page background. Browser probes against the previous and upgraded frontend images both returned `rgb(255, 255, 255)` for those backgrounds. At that baseline, three assertions (two RTL PDF checks and one light-mode styling check) failed and were not suppressed. The main run passed 88 cases and stopped at its configured three-failure limit before its final two cases; those remaining cases were run separately and both passed. Across all 93 cases, 90 passed and three pre-existing assertions failed. These were subsequently fixed in the RTL milestone below.

## RTL PDF and light-mode styling milestone

The default PDF path now uses WeasyPrint/Pango/HarfBuzz for documents containing RTL text, with ReportLab retained for other documents. New backend tests cover Arabic and Hebrew, mixed-direction text, inline formatting, code, tables spanning pages, embedded diagram images, metadata and actual refusal of remote image loads. Visual inspection of a representative PDF confirmed joined Arabic glyphs, correct reading order and right-aligned RTL blocks/cells. Unsupported emoji filtering remains in place, and text joiners remain available to the shaping engine.

The complete backend suite passed 271 tests (3 optional CLI tests skipped), retaining 93% application line coverage. All 352 frontend unit/component tests, lint, TypeScript, production builds, 80 end-to-end tests and 73 smoke/accessibility/recovery checks passed. The generated OpenAPI types still match the backend contract.

The expanded browser regression suite now passes all 93 cases, including the three previously failing assertions. Light-mode code blocks use the existing panel background color. The package audit script continues to report zero known npm or Python package vulnerabilities with the new rendering dependencies.

GitHub alert reconciliation was completed on 16 November 2026 at approximately 07:33 UTC. An authenticated request to the repository’s Dependabot endpoint returned HTTP 200 and zero open alerts, agreeing with the local package audit results. No alerts were dismissed or suppressed by this work. See [dependency-maintenance.md](dependency-maintenance.md) for the scope of this check.
