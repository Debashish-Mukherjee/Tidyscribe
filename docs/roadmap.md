# Roadmap

Status against the original specification. Items are grouped by theme; nothing here is promised for a date.

## Done

- Markdown source editor with live preview: headings, tables, task lists, code, callouts, Mermaid and ASCII diagrams. Undo/redo, draft autosave, resizable and persisted panes, dark/light/system theme.
- HTML, DOCX and PDF export with real structure; diagrams embedded as images; Unicode PDF text.
- Smart paste and AI cleanup (preamble removal, tone transforms).
- Rich paste: clipboard HTML is converted to Markdown in the browser (lists, headings, emphasis, links, tables, task lists, code blocks; Google Docs, Word and chat-UI quirks handled). Editor-style HTML and plain text paste unchanged.
- Local UTF-8 Markdown, text and HTML file import (up to 2 MB). Imports open as new unsaved documents, with save/discard choices before replacing edits.
- Diagram conversion: ASCII to Mermaid / SVG / Draw.io; PlantUML (sequence, class, state, activity, component), Draw.io files, Terraform and Kubernetes to Mermaid.
- Editor find/replace and a Rich (TipTap) mode that reads and writes Markdown.
- Runtime `API_URL` for the frontend image; Prometheus `/metrics`; optional Sentry error tracking.
- Optional Pandoc / LibreOffice / Mermaid CLI export pipeline (`EXPORT_ENGINE=pandoc`) with fallback to the built-in writers.
- REST CRUD with soft delete for documents (with version history), templates, snippets (search, tags, favourite, archive), clipboard history (pin, restore, 100-item cap) and settings.
- Structured JSON logging with request IDs; health and readiness endpoints.
- Alembic migrations (baseline plus incremental), applied at startup; existing databases are adopted without data loss.
- Exports run in the Celery worker with job status polling, 503 when the queue is down.
- Production frontend image (standalone Next.js, non-root, health-checked) with a hot-reload development override.
- Settings screen: theme and default writing style saved server-side through `/api/settings`; pane-size reset.
- Tests: backend (pytest, ~93% line coverage), frontend component tests (Vitest) and end-to-end tests (Playwright).

## Reliability milestone

- Dedicated export and maintenance queues, a Beat scheduler, periodic recovery and generated-file retention.
- All export terminal states handled by the frontend, with an explicit cancel action.
- Serialized document mutations with revision checks on saves and version restoration.
- Draft recovery retains document identity and the saved baseline; separate storage keys avoid cross-tab write races.
- Portable default builds, optional corporate certificate roots, loopback-only published ports and dependency-aware readiness.
- Generated API schema types, document-session/export hooks, deferred preview work and bounded diagram caching.
- Keyboard export menu and preview tabs, named preview content, narrow-screen Editor/Preview switching and document pagination.
- Shaped RTL PDF output, right-aligned RTL blocks and cells, and distinct light-mode code-block backgrounds.
- Shared conversion corpus and backup/restore scripts. See [validation.md](validation.md).

## Next

| Theme | Item |
| --- | --- |
| Security (explicitly deferred) | JWT authentication, role-based access, rate limiting, security headers, secret handling. |
| Data | Per-user ownership; retention policy for job metadata and soft-deleted records. Generated export files now expire after seven days by default. |
| Jobs | Bounded retries and dead-letter handling for failed exports; progress reporting. Cancellation, orphan re-dispatch, heartbeat recovery and file retention are implemented. |
| Diagrams | PlantUML use-case diagrams. |
| Editor | Markdown-aware syntax highlighting; find/replace inside the rich editor. |
| PDF | Colour emoji (today they are dropped); bold/italic CJK faces; user-selectable fonts and page size. |
| Frontend | More settings (default export format, editor font size). |
| Delivery | CI (lint, test, build, container scan, publish) - deferred by request. |
| Observability | Tracing; alert rules and a Grafana dashboard for the `/metrics` endpoint. |
