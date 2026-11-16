# Tidyscribe – Independent UAT / Bug Hunt Report

> Historical baseline. Findings below describe the original UAT run, not the current release. Several defects have since been fixed. See [validation.md](validation.md) for current checks and remaining limitations.


Engagement date: 2026-11-02. Target: the stack at `localhost:3000` (frontend) and `localhost:8000` (API), rebuilt from `HEAD` (`f1b757e`) before testing.
Method: black-box exploration through a real Chromium browser (Playwright), HTTP-level export probing, and inspection of downloaded DOCX/PDF/HTML files. Source code was read only to aim hostile tests, never to decide expected behaviour.
Evidence: `docs/uat-screenshots/`. Executable suites: `frontend/tests/{smoke,regression,exploratory,destructive,accessibility,performance}`, run with `npm run test:uat` (see [How to run](#how-to-run)).

Suites assert the *expected* behaviour, so they **fail on every open defect** and will go green as defects are fixed.

---

## 1. Executive summary

The application renders ordinary Markdown, Mermaid and Unicode well, exports are fast for normal documents, memory is stable, and theming is solid. It is **not safe for the stated purpose** (pasting arbitrary content from ChatGPT, Claude, Gemini, Copilot, Word, Confluence, Teams and Outlook) for four reasons:

1. **A pasted `<style>` tag permanently blanks the application** (D1). It survives sanitising, is saved as the draft, and re-applies on every reload. Recovery needs manual browser-storage clearing.
2. **Data loss paths are unguarded**: one-click delete with no confirmation, opening a document silently overwrites unsaved edits (and disables Undo), no unload warning, last-writer-wins across tabs, last 500 ms of typing lost on refresh (D11-D13).
3. **Fidelity is lost silently** on import (Word tables corrupted, Gemini/Copilot UI chrome pasted into the text, Confluence tasks, Outlook tracking links) and on export (Arabic/Hebrew reversed and unshaped in PDF, raw-HTML Markdown exported as literal tags) (D2-D6, D9, D20).
4. **A large table can wedge the export worker**: DOCX export time grows roughly quadratically (100 rows 7.7 s, 300 rows 67 s, 1 000 rows killed at 300 s) and the killed job stays `processing` forever (D10).

Defect count: **1 critical, 5 high, 12 medium, 7 low** (D1-D25 below). Full-suite run: 242 tests, 193 passed, 49 failed (the failures are the defects; the 49 include one skipped-by-design NUL case that the summary tool counts as non-passing, and two later-corrected flawed tests were fixed afterwards). Phase 16 (2 hour soak) was implemented but only run for 2 minutes (see section 9).

---

## 2. Application map and navigation hierarchy (as a user sees it)

Single page at `/`; nothing else exists (no routes, no login).

```
Tidyscribe
├─ Header: document title + save state ("Not saved" / "Saved" / "Unsaved changes")
│   ├─ Save / Save changes
│   ├─ Export ▾  → Word (.docx) | PDF | HTML | Markdown (.md)
│   ├─ Copy Markdown
│   └─ Theme toggle (dark → light → system)
├─ Left rail (5 icons) + collapsible panel
│   ├─ Documents  (search, list, per-item Delete)
│   ├─ Templates  (ADR HLD LLD RFC Runbook Solution Design; save editor as template; delete)
│   ├─ Snippets   (search/#tags, show archived, favourite, archive, delete, save selection)
│   ├─ Clipboard History (search, pin/unpin, delete; every editor paste is logged)
│   └─ Settings   (theme radios, default writing style, reset pane sizes)
├─ Editor pane
│   ├─ Source | Rich mode, Find/Replace, Undo, Redo
│   ├─ Paste mode (Auto | Markdown | Rich text | Plain), Smart Paste
│   ├─ Writing style (7) + Clean AI Text
│   ├─ Convert diagram (to Mermaid / SVG / Draw.io)
│   └─ Textarea "Paste AI output and shape it into a document…"
├─ Resizable separators (sidebar, editor/preview)
├─ Preview pane tabs: Preview | HTML | DOCX | PDF  (the last three generate an export)
└─ Status bar: live message + word count
```

Keyboard shortcuts found: `Ctrl+F`/`Ctrl+H` find/replace, `Ctrl+Z`, `Ctrl+Shift+Z`/`Ctrl+Y`, `Esc` (close find / menu), `Ctrl+Shift+V` (plain paste), arrow keys on separators. No other shortcuts (no save shortcut).

## 3. Feature inventory

| Area | What exists | Notes |
|---|---|---|
| Authoring | Markdown textarea, TipTap "Rich" mode, find/replace (regex, case), undo/redo (200 steps) | Draft auto-saved to this browser only |
| Import | Rich paste → Markdown (Word, Outlook, Confluence, GitHub, Teams, ChatGPT, Claude, Gemini, Copilot), paste modes, Smart Paste, Clean AI Text | No file import, no drag-and-drop |
| Preview | GFM, callouts, task lists, Mermaid (all common types), PlantUML (via backend), code, tables | Mermaid `strict` security level |
| Diagrams | ASCII/PlantUML/Terraform/Kubernetes/Draw.io → Mermaid/SVG/Draw.io | |
| Export | DOCX, PDF, HTML (async worker + polling), Markdown (client side) | Mermaid exported as PNG rendered in the browser |
| Storage | Documents (+versions via API), templates, snippets, clipboard history, settings (server side) | Single shared dataset, no accounts |
| Theming | dark, light, system; stored on the server | |

## 4. User journey catalogue

| # | Journey | Result |
|---|---|---|
| J1 | Paste ChatGPT answer → clean → preview → export PDF | Works for simple answers; preambles mostly left in (D15) |
| J2 | Paste Word report with table → export DOCX | Table corrupted on paste (D2) |
| J3 | Paste Gemini/Copilot answer with code | UI labels and "Copy code" text embedded (D5) |
| J4 | Write, save, reopen later | Works; list capped at 100 (D8) |
| J5 | Open a second document while editing | Silent loss (D11) |
| J6 | Two tabs / two devices editing | Silent overwrite (D12) |
| J7 | Export a 500 row table | Minutes, may never finish (D10) |
| J8 | Arabic/Hebrew document → PDF | Reversed/unshaped (D9) |
| J9 | Switch theme during editing/exporting | Fine |
| J10 | Phone/tablet use | Not usable below ~900 px (D24) |
| J11 | Paste hostile HTML | App blanked (D1) |

---

## 5. Risk matrix

| Area | Likelihood | Impact | Rating | Basis |
|---|---|---|---|---|
| Data loss (editor/draft/delete/multi-tab) | High | High | **HIGH** | D11-D13 confirmed |
| Pasted-content sanitising / app bricking | Medium | Critical | **HIGH** | D1 confirmed |
| Import fidelity (office/AI tools) | High | Medium-High | **HIGH** | D2-D6 confirmed |
| Export accuracy (RTL, raw HTML, huge tables) | Medium | High | **HIGH** | D9, D10, D20 |
| Export worker reliability | Medium | High | **HIGH** | D10 |
| Editor stability / performance | Low | Medium | MEDIUM | 10 000 lines usable; ~280 ms per key |
| State synchronisation (tabs, theme, settings) | Medium | Medium | MEDIUM | Settings sync fine, documents not |
| Rendering (Mermaid, GFM extras) | Medium | Medium | MEDIUM | Footnotes, math, definition lists missing |
| Accessibility | High | Medium | MEDIUM | D21-D23 |
| Responsiveness (mobile) | High | Low-Medium | MEDIUM | Not responsive |
| Theming | Low | Low | LOW | All tests pass |
| Session management | n/a | n/a | n/a | No authentication exists |

Ranked most likely to fail: paste conversion → export of large/complex content → multi-tab/draft handling → Clean AI Text → accessibility.

---

## 6. Test strategy and coverage

| Strategy | Where | Executed |
|---|---|---|
| Happy path | `smoke/smoke.spec.ts` | Yes, 14/14 pass |
| Boundary | export scale (1 000 / 10 000 lines, 1 000 row table, 5 000 line code block), title length, 2.5 MB document, 1 MB single line | Yes |
| Negative | invalid Mermaid (6 kinds), API down, 401, failed export job, malformed markdown | Yes |
| Exploratory | `exploratory/*` (paste from 10 real-world sources, input abuse, weird user) | Yes |
| Destructive | `destructive/*` (data loss, multi-tab, network failure, crash recovery) | Yes |
| Performance | `performance/editor-performance.spec.ts` | Yes |
| Accessibility | `accessibility/accessibility.spec.ts` | Yes |
| Browser | Chromium only | **Gap**: Firefox/WebKit not installed in this environment |
| Session management | recovery spec (401 handling surfaces "Not authenticated", passes); app has no sessions or login | Partial |
| Data persistence | draft, reload, tab close, renderer crash, cross-browser | Yes |
| Reliability soak | `performance/soak.spec.ts` (`UAT_SOAK_MINUTES`) | Short run only |

Test housekeeping: global setup records the start time and settings; teardown deletes every document and clipboard item created during the run and restores settings.

---

## 7. UX review

| Class | Observation |
|---|---|
| FRUSTRATING | Delete is instant and permanent; opening a document throws away unsaved text with Undo disabled |
| FRUSTRATING | HTML/DOCX/PDF tabs silently save the document (and create one if new) just by being clicked |
| FRUSTRATING | Mobile/tablet: page scrolls sideways, preview off screen, header truncates to one letter (`shot-mobile.png`) |
| CONFUSING | Status bar says "Text cleaned" even when nothing changed; "Cleaning text…" can stay forever |
| CONFUSING | Search with no hits shows "No saved documents yet. Use Save in the header." |
| CONFUSING | Convert diagram says "Place the cursor in an ASCII… diagram" when the cursor is inside one the converter simply does not support |
| CONFUSING | Document list is capped at 100 with no "load more"; older documents are only reachable by exact search |
| SURPRISING | Browser Back leaves the app (sidebar sections are not history entries) |
| SURPRISING | Emptying the editor and refreshing brings the starter document back |
| SURPRISING | A diagram clipped at the right edge of the preview with no obvious scroll affordance |
| INCONSISTENT | Mermaid diagrams always use a light card, even in dark mode; light mode code blocks have a border but no fill |
| INCONSISTENT | Errors: some are readable, others show `Failed to fetch` or raw validation JSON |
| Good | Clear header/save state, status bar live region, resizable panes, Source/Rich round trip preserved all test content, theme persists on the server and applies before first paint |

## 8. Accessibility findings (WCAG 2.2)

| ID | Finding | WCAG |
|---|---|---|
| A1 | No skip link; preview `<article>` has no accessible name | 2.4.1, 4.1.2 |
| A2 | Preview tabs lack arrow-key navigation and a `tabpanel` | 4.1.2, 2.1.1 |
| A3 | Export menu: no arrow-key navigation, focus not moved into or returned from the menu | 2.1.1, 2.4.3 |
| A4 | Search boxes show no focus indicator | 2.4.7 |
| A5 | Rendered task-list checkboxes have no accessible name | 4.1.2 |
| A6 | Mobile 375 px and 320 px: horizontal page scroll (240/295 px) | 1.4.10 |
| Pass | Colour contrast of key text in both themes (≥ 4.5:1), no keyboard trap, `lang`/title set, live status region, errors announced (`role=alert`), touch targets ≥ 24 px, reduced motion respected, separators keyboard operable |

## 9. Performance and reliability findings

| Measurement | Result |
|---|---|
| Cold load to interactive | 0.44 s; initial JS 345 KB |
| 1 000 line paste → preview | 0.14 s; typing latency ~0.2 s per burst |
| 10 000 line paste → preview | 0.74 s; longest main-thread task 188 ms; typing ~280 ms per key (every keystroke re-renders the whole preview, no debounce) |
| 50 Mermaid diagrams | all rendered in 3.9 s |
| 400-node diagram | renders, no freeze |
| 15 diagrams + typing | ~1 s per 4 characters (all diagrams re-render per keystroke) |
| Memory | 100 paste/clear cycles: +2 MB; 60 Mermaid edits: no DOM growth; 300 undo/redo: consistent |
| Export 1 000 / 10 000 lines (text) | 1.7 s / 8.4 s total for HTML+DOCX+PDF |
| DOCX, table 100 / 300 / 1 000 rows | **7.7 s / 67 s / killed at 300 s** (D10) |
| Large paste tooling note | Playwright `fill()` of 4 000 lines takes ~30 s in headless Chromium even on a bare `<textarea>`; this is a harness artefact and not counted as a defect (helper `setNative` avoids it) |

Phase 16: a configurable soak test exists (`UAT_SOAK_MINUTES=120`). It was executed for **2 minutes only**: 110 edit/search/theme/save/export cycles, no errors, no lost content, but cycle time rose from 894 ms (first third) to 1 244 ms (last third) while the document grew; that is not conclusive evidence of a leak or degradation, and a literal two hour run was **not** performed. Treat reliability beyond minutes as **unverified**.

---

## 10. Defect list

Severity = impact; Priority = suggested fix order (P1 first). "Test" names the suite that reproduces it.

### D1 – Pasted `<style>` blanks the whole application permanently
- Severity: **Critical** | Priority: P1 | Test: `regression/render-fidelity` "hostile HTML/links…"
- Steps: paste `<style>body{display:none !important}</style>` (or a document containing it) into the editor; refresh.
- Expected: markup is neutralised; the app stays usable.
- Actual: sanitiser keeps `<style>` (and `<form action=…>`); the page goes blank, and because the draft is restored from browser storage the blank page returns after every reload. Saved documents containing it do the same when opened.
- Screenshot: `docs/uat-screenshots/hostile-after-reload.png`
- Fix: forbid `style`, `form`, `input`, `button`, `meta`, `link` in DOMPurify (`FORBID_TAGS`) or render the preview inside a sandboxed iframe / shadow root; add a "safe mode" that ignores a stored draft when the app fails to mount.

### D2 – Word tables are corrupted on paste
- Severity: High | Priority: P1 | Test: `exploratory/paste-sources` (Word, "Word table…")
- Steps: paste Word HTML where each cell wraps a paragraph.
- Expected: a valid pipe table. Actual: cells contain line breaks (`|` / `Name` / `|`), so the table is broken in the editor, preview and every export.
- Fix: flatten block children of `td/th` to inline text joined with `<br>` or a space before Turndown.

### D3 – Confluence paste loses structure
- Severity: Medium | Priority: P2 | Test: same spec (Confluence)
- Task lists lose their checkbox state (`- Review` instead of `- [ ] Review` / `- [x] Approve`), code-macro language (`brush: java`) is dropped, info/note panels become plain paragraphs.

### D4 – GitHub, Outlook and Teams artefacts
- Severity: Medium | Priority: P2 | Test: same spec
- GitHub heading anchors leave an empty link `[](#install)`.
- Outlook keeps Safe Links wrapper URLs (`nam06.safelinks.protection.outlook.com/?url=…`), so the visible and real link differ.
- Teams: emoji become remote image links to a Microsoft CDN; reply quotes run together (`**Ada**10:01`).

### D5 – Gemini and Copilot UI chrome is pasted into the document
- Severity: Medium | Priority: P2 | Test: same spec
- Gemini: `Python` and `Copy code` lines remain above the code, citation superscript merges into the word (`following1`). Copilot: stray `jsonCopy` line. (ChatGPT and Claude are handled correctly.)
- Fix: drop buttons and header labels inside custom code-block containers; treat `sup` citations as footnote markers.

### D6 – Markdown features AI tools emit are not rendered
- Severity: Medium | Priority: P2 | Test: `regression/render-fidelity`
- Footnotes (`[^1]` and its definition printed literally), definition lists, `:rocket:` shortcodes, LaTeX math (`$…$`, `$$…$$`, and `\( … \)` loses its backslashes and shows `( a^2 + b^2 )`).
- Fix: add footnote/deflist/emoji plugins; add KaTeX; stop escaping `\(`/`\[` before math handling.

### D7 – Smaller paste issues
- Severity: Low | Priority: P3
- RTL paragraphs are left-to-right (no `dir="auto"`); Excel/TSV plain text is not turned into a table; ChatGPT plain-text copies keep `ChatGPT said:` and `Copy code` lines; HTML over 1.5 MB silently falls back to flattened plain text with no notice (Medium for large Confluence pages).

### D8 – Document list silently capped at 100
- Severity: Medium | Priority: P2 | Test: `exploratory/weird-user` "documents beyond the first 100…"
- 232 documents exist; the UI lists 100, no "load more". Fix: infinite scroll or pagination.

### D9 – PDF export mangles right-to-left text
- Severity: High | Priority: P1 | Test: `regression/export-fidelity` "CJK / Arabic / Hebrew…"
- Arabic is rendered as unjoined isolated glyphs in reversed order; Hebrew is visually reversed (`שלום עולם` appears as `םלוע םולש`). CJK is fine. DOCX and HTML preserve the text.
- Screenshot: `docs/uat-screenshots/rtl-1.png`. Fix: apply bidi + shaping (`python-bidi`, `arabic-reshaper`) or render PDF via the browser/Pandoc pipeline.
- Related (Low): wide tables (14 columns) wrap cell values mid-token (`r1c1` / `0`), see `wide-1.png`.

### D10 – Large tables make DOCX export unusable; killed jobs hang forever
- Severity: High | Priority: P1 | Test: `regression/export-fidelity` "a 1 000 row table…"
- Steps: export a 6-column table of 100 / 300 / 1 000 rows to DOCX.
- Actual: 7.7 s / 67 s / the worker is SIGKILLed at the 300 s hard limit. The job remains `processing` forever (it is never marked `failed`), the single worker is blocked meanwhile, and queued jobs of other users wait behind it. Time growth is roughly quadratic.
- Also observed: the job store holds 3 `processing` and 5 `queued` jobs that never finish (stale from earlier runs), so killed or lost jobs are never reaped.
- Fix: build tables without per-cell style lookups, add a soft time limit that marks the job `failed`, add a stuck-job reaper, cap table size with a clear message, run more than one worker process.

### D11 – Destructive actions have no guard
- Severity: High | Priority: P1 | Test: `destructive/workflow-data-loss`
- (a) Delete document / template / clipboard item: one click, permanent, no confirmation or undo. (b) Opening a document replaces unsaved editor text without warning and Undo is disabled afterwards. (c) No `beforeunload` warning with unsaved changes. (d) Clicking the HTML / DOCX / PDF tab saves (or creates) the document as a side effect.
- Fix: confirm or provide an "Undo delete" toast; prompt on discard; keep the replaced text in undo history; add `beforeunload`; do not persist on tab click.

### D12 – Multi-tab / multi-device overwrite
- Severity: High | Priority: P1 | Test: `destructive/workflow-data-loss` "multiple tabs"
- Tab B saves a stale copy over Tab A's newer save with no warning; all tabs share one draft slot, so the last tab to type wins on refresh.
- Fix: send `updated_at`/version with saves and return 409; scope draft key by document id and tab; listen to `storage` events.

### D13 – Draft persistence gaps
- Severity: Medium | Priority: P2
- Characters typed in the last 500 ms before a refresh are lost (debounced write, no `pagehide` flush). Emptying the editor then refreshing restores the starter document (an empty draft is treated as "no draft").

### D14 – Failure handling in Clean AI Text, Smart Paste and the sidebar
- Severity: Medium | Priority: P2 | Test: `destructive/workflow-data-loss` "network failures"
- With the API unreachable: Clean AI Text and Smart Paste throw an unhandled promise rejection and the status stays at "Cleaning text…"; the sidebar shows nothing, not an error; save failures show `Failed to fetch`; saving a > 2 MB document shows raw validation JSON; a 300 character template name shows raw JSON.
- Fix: wrap in try/catch with a shared error formatter that understands API validation errors.

### D15 – Clean AI Text misses common preambles and can mislead
- Severity: Medium | Priority: P2
- Left untouched: `Sure! Here's a design doc:`, `Absolutely — here you go:`, `Great question!`, `As an AI language model…`, `ChatGPT said:`, `【4†source】` citations, `Let me know if you'd like me to expand…` (while `Hope this helps!` is removed). `Certainly! Below is the document.` becomes `Below is the document.`. Status says "Text cleaned" even when nothing changed. Code blocks were preserved correctly.
- `POST /api/transform` also has no maximum input length (Low).

### D16 – Raw HTML in Markdown differs between Preview and exports
- Severity: Medium | Priority: P2 | Test: `regression/export-fidelity` "raw HTML in markdown…"
- Preview renders `<details>`, `<kbd>`, `<sub>`, `<sup>`, `<br>`, HTML tables; HTML/DOCX/PDF exports show them as escaped literal text. (Security-wise the escaping is safe; the mismatch is the problem.)

### D17 – Diagram conversion gaps
- Severity: Medium | Priority: P3 | Test: `exploratory/weird-user` "ASCII diagram converted…"
- ASCII box diagrams (`+-----+ … | API | --> | DB |`) and Unicode box drawings return `unsupported structure`; the UI then tells the user to place the cursor in a diagram they are already in. Unfenced box-drawing art collapses into a paragraph in Preview (alignment lost).

### D18 – No file import / drag and drop
- Severity: Low | Priority: P4 – dropping a `.md` file does nothing and gives no message (dropping a PNG does not navigate away, which is good).

### D19 – Misleading empty state
- Severity: Low | Priority: P3 – a search with no hits says "No saved documents yet. Use Save in the header."

### D20 – Browser Back leaves the app
- Severity: Low | Priority: P4 – sidebar sections do not create history entries.

### D21 – Accessibility gaps (A1–A5)
- Severity: Medium | Priority: P2 – see section 8. Test: `accessibility/accessibility.spec.ts`.

### D22 – Theming inconsistencies
- Severity: Low | Priority: P4 – Mermaid always uses the light theme (white card in dark mode); light-mode code blocks have no background distinct from the page; diagrams clip at the pane edge. Screenshots: `shot-dark.png`, `shot-light.png`.

### D23 – Typing latency in large or diagram-heavy documents
- Severity: Low | Priority: P3 – 10 000 lines ≈ 280 ms per keystroke; 15 diagrams ≈ 250 ms per keystroke because preview and diagrams re-render on every key. Fix: debounce/transition the preview, re-render only changed diagrams.

### D24 – Not usable on phones and narrow tablets
- Severity: Medium | Priority: P3 – at 375 px and 320 px the page scrolls horizontally by 240 / 295 px, preview is off screen. Screenshots: `shot-mobile.png`, `shot-tablet.png`. (Stacked Editor/Preview tabs are a known gap.)

### D25 – Environment hygiene
- Severity: Low | Priority: P3 – the running containers were 4 days older than `HEAD` (no Source/Rich, no Find bar) until rebuilt for this exercise; the dev data set contained 200+ test documents with duplicate titles; job and clipboard stores accumulate indefinitely.

---

## 11. Verified OK (not defects)

Source ⇄ Rich round trip preserved every sample (nested fences, HTML, GFM, Unicode, malformed, Mermaid, tables); ten Mermaid diagram types render and six invalid diagrams show an error with the source and leave the page usable; Mermaid labels containing HTML do not execute; markdown export is byte-identical; 10 000 line and 5 000 line code-block exports succeed; HTML export escapes hostile input; double-clicking Save creates one document; twelve simultaneous tabs load; identical pastes are de-duplicated in clipboard history; theme persists, applies before first paint, and survives 100 rapid toggles; contrast passes in both themes; no memory growth.

## How to run

```bash
cd frontend
export NODE_EXTRA_CA_CERTS=/home/debashish/Zscalar_root_CA.cer   # corporate proxy
npx -p node@24 -c 'npm run test:uat'                 # everything
npx -p node@24 -c 'npm run test:uat:smoke'           # one suite
UAT_SOAK_MINUTES=120 npx -p node@24 -c 'npm run test:uat:performance -- -g soak'   # 2 hour soak
```
Requires the stack to be running (`docker compose up -d`), `poppler-utils` (`pdftotext`, `pdfinfo`) and `unzip` on the host for export inspection.
