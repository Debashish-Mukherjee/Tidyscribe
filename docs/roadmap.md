# Roadmap

Status against the original specification. Items are grouped by theme; nothing here is promised for a date.

## Done

- Markdown source editor with live preview: headings, tables, task lists, code, callouts, Mermaid and ASCII diagrams. Undo/redo, draft autosave, resizable and persisted panes, dark/light/system theme.
- HTML, DOCX and PDF export with real structure; diagrams embedded as images; Unicode PDF text.
- Smart paste and AI cleanup (preamble removal, tone transforms).
- Rich paste: clipboard HTML is converted to Markdown in the browser (lists, headings, emphasis, links, tables, task lists, code blocks; Google Docs, Word and chat-UI quirks handled). Editor-style HTML and plain text paste unchanged.
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

## Next

| Theme | Item |
| --- | --- |
| Security (explicitly deferred) | JWT authentication, role-based access, rate limiting, security headers, secret handling. |
| Data | Per-user ownership of documents; retention for old export files and finished jobs (exports and their files accumulate today). |
| Jobs | Retry policy and dead-letter handling; progress reporting for large exports; cancel. |
| Diagrams | PlantUML use-case diagrams. |
| Editor | Markdown-aware syntax highlighting; find/replace inside the rich editor. |
| PDF | Colour emoji (today they are dropped); bold/italic CJK faces; user-selectable fonts and page size. |
| Frontend | More settings (default export format, editor font size). |
| Delivery | CI (lint, test, build, container scan, publish) - deferred by request. |
| Observability | Tracing; alert rules and a Grafana dashboard for the `/metrics` endpoint. |
