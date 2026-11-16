# API reference

Base URL: `http://localhost:8000`. Interactive docs: [`/docs`](http://localhost:8000/docs) (Swagger UI), [`/redoc`](http://localhost:8000/redoc), schema at `/openapi.json`.

All bodies are JSON. Errors use FastAPI's shape, `{"detail": "..."}`; validation errors return `422` with a detail list. Every response carries an `X-Request-ID` header (send your own `X-Request-ID` of 8-64 characters `[A-Za-z0-9._-]` to correlate logs).

Deleting is **soft**: rows get `deleted_at` and disappear from the API. List endpoints accept `limit` (1-500, default 100) and `offset`; `q` is a case-insensitive substring search in which `%` and `_` match literally.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Liveness. |
| GET | `/api/ready` | Readiness. |

## Documents

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/documents?q=` | Newest first. |
| POST | `/api/documents` | `{title, content}`; title 1-255 chars, content up to 2 MB. |
| GET | `/api/documents/{id}` | 404 if missing or deleted. |
| PUT | `/api/documents/{id}` | `{title?, content?, expected_updated_at?}`. A content change stores the previous content as a version (last 50 kept). When `expected_updated_at` (the `updated_at` the client last saw) differs from the current value the update is rejected with `409`, so a stale tab cannot overwrite newer work; omit it to overwrite on purpose. |
| DELETE | `/api/documents/{id}` | 204, soft delete. |
| GET | `/api/documents/{id}/versions` | Newest first. |
| POST | `/api/documents/{id}/versions/{version_id}/restore` | Restores that content; the replaced content becomes a new version. |

## Templates

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/templates?q=&category=` | |
| POST | `/api/templates` | `{name, category?, body}`; 201. Names are unique: `409` if taken (re-creating a deleted name revives it). |
| GET / PUT / DELETE | `/api/templates/{id}` | PUT is partial; renaming onto an existing name is `409`. |

Six built-in templates (Solution Design, HLD, LLD, ADR, RFC, Runbook) are seeded at startup.

## Snippets

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/snippets?q=&category=&tag=&favorite=&archived=` | `archived` defaults to `false`; pass `true` to list only archived. `tag` matches a whole tag. Favourites sort first. |
| POST | `/api/snippets` | `{title, body, category?, tags?: string[], favorite?}`; tags are lower-cased and de-duplicated. |
| GET / PUT / DELETE | `/api/snippets/{id}` | PUT is partial: `title, body, category, tags, favorite, archived`. |

Eight starter snippets (Architecture, Azure, AWS, Terraform, SQL, Python, PowerShell, Kubernetes) are seeded when the table is empty.

## Clipboard history

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/clipboard?q=&tag=&pinned=` | Pinned first, then newest. |
| POST | `/api/clipboard` | `{content, source?, tags?}`; 201. Only the newest 100 unpinned items are kept; pinned items never expire. |
| GET / PUT / DELETE | `/api/clipboard/{id}` | PUT accepts `{pinned?, tags?}`. |
| POST | `/api/clipboard/{id}/restore` | Undo a delete. |

## Settings

Key/value pairs; keys match `[a-z0-9_.-]{1,100}`, values up to 10 000 characters. The web UI uses `ui.theme` (`dark`, `light` or `system`) and `editor.default_tone` (one of the writing styles); unknown values are ignored by the UI.

| Method | Path |
| --- | --- |
| GET | `/api/settings` (object of all pairs) |
| GET / PUT / DELETE | `/api/settings/{key}` (PUT body `{value}`) |

## Smart paste and cleanup

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/parse-paste` | `{text}` | `{normalized_markdown, detected_types, converted_mermaid, summary}`. Drops AI preambles, keeps indentation and code fences intact, converts PlantUML blocks to Mermaid. |
| POST | `/api/transform` | `{text, tone}` (text up to 2 MB) | `{cleaned_text, summary, changes: [{rule, label, count, examples}], removed, changed}`: nothing is applied server side, the report lets the client show a preview; `tone` is one of Solution Design, HLD, LLD, ADR, RFC, Runbook, Operational Guide. |

## Diagrams

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/api/convert-diagram` | `{source, target: mermaid\|svg\|drawio, source_format?: auto\|ascii\|plantuml\|drawio\|terraform\|kubernetes}` | `{content, target, media_type, extension, warnings}`; `422` with an actionable reason (no boxes found, unclosed box, only one box, no connection between boxes) when the structure is unsupported, or when the target is not `mermaid` for a non-ASCII source. ASCII and Unicode (┌─┐ ╔═╗ ╭─╮) boxes are read as a graph: containment becomes subgraphs, lines and arrows become edges, text on a line becomes the edge label. |
| POST | `/api/expand-diagrams` | `{markdown}` | `{markdown, converted, unsupported}`: PlantUML fences and `@startuml` blocks replaced by Mermaid fences where convertible; the rest is left untouched. |

Supported conversions:

- **ASCII boxes** (`+---+` / `| label |`) to Mermaid flowchart, standalone SVG, or Draw.io (`mxfile`) XML. Boxes are connected top to bottom in reading order.
- **PlantUML to Mermaid**: sequence diagrams (participants, actors, messages, `alt/else/opt/loop/par`, notes, activation), class diagrams (classes, interfaces, enums, members, inheritance, composition, aggregation, packages), state diagrams, activity diagrams (new syntax: `start`/`stop`, `:action;`, `if/elseif/else`, `while`, `repeat`, `fork`) and component diagrams (components, interfaces, databases, `package`/`node`/`cloud` containers, links). Use-case, Gantt and other types are reported as unsupported and left as source.
- **Draw.io to Mermaid**: `.drawio` / `mxfile` XML (plain or compressed pages). Containers become subgraphs, shapes map to rectangles, rounded, diamond, circle, cylinder and hexagon, dashed or arrow-less edges and edge labels are kept. DOCTYPE/entity declarations are rejected.
- **Terraform to Mermaid**: `resource`, `data`, `module` and `output` blocks as nodes; an arrow runs from a referenced block to the block that uses it (creation order). Variables, locals and providers are not drawn.
- **Kubernetes to Mermaid**: multi-document YAML or `kind: List`. Links: Ingress to Service (labelled host/path), Service to the workloads its selector matches, ConfigMap/Secret/PVC/ServiceAccount to the workloads that use them, HPA to its target. Objects are grouped by namespace when there is more than one.

The editor's *Convert diagram* menu also converts `hcl`/`terraform`, `yaml` and `drawio` fences when the caret is inside them.

## Exports

Exports are built in the background by the Celery worker. Create a job for a saved document, or for text that was never saved, poll it, then download the file.

```http
POST /api/exports
{"document_id": "...", "format": "html|docx|pdf|markdown", "diagrams": [{"source": "<mermaid source>", "png_base64": "<PNG>"}]}
{"title": "...", "content": "# markdown", "html": "<preview html, optional>", "format": "html", "diagrams": []}
```

Send exactly one of `document_id` or `content` (`422` otherwise). `html` (optional, with `content`) is the HTML the Preview showed; the exports follow it. Exporting `content` does not create a document; the web UI always uses it, so viewing or exporting never saves anything. Downloads of such jobs are named `document.<ext>`.

`202 Accepted` with `{job_id, status, type, file_url, error}`. `status` moves `queued` → `starting` → `processing` → `completed`, `failed`, `cancelled` or `timed_out`; `file_url` is set once completed and `error` is a short message when failed (details are in the server logs, not in the response).

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/exports/{job_id}` | Job status for polling (the web UI polls every 400 ms). `404` if unknown. |
| POST | `/api/exports/{job_id}/cancel` | Cancel queued or active work; returns the job. Finished jobs remain unchanged. |
| GET | `/api/exports/{job_id}/download` | The file, with the right `Content-Type` and a `Content-Disposition` filename derived from the document title. `409` while the job is not completed, `404` if unknown. |
| GET | `/api/jobs` | All jobs. |

Errors: `400` for an unknown or deleted document or an invalid diagram upload (rejected before queueing); `503` when the queue (Redis) cannot be reached, in which case the job is recorded as failed.

`diagrams` is optional. Mermaid cannot be rendered server-side without a headless browser, so the web UI renders each diagram and uploads it as a PNG keyed by its Mermaid source. Diagrams without an image are exported as source code with a note. Uploads are validated (valid base64, PNG signature, 5 MB each, at most 50) and handed to the worker through the shared `exports` volume, then deleted.

Export content: headings, paragraphs, lists, task lists, tables, blockquotes and GitHub-style callouts (`> [!WARNING]`), code blocks, ASCII diagrams (rendered monospaced), links and images-as-diagrams. PDFs are A4 and embed DejaVu fonts (Latin, Greek, Cyrillic, symbols, arrows, box drawing) plus WenQuanYi Micro Hei for Chinese, Japanese and Korean, in paragraphs, tables and code blocks (regular weight only, so bold/italic CJK is not synthesised). Task items render as checkboxes, `✅`/`❌` become `✔`/`✘`, and emoji and zero-width characters are dropped because the PDF fonts have no colour glyphs. Callouts, quotes and table cells taller than a page continue on the next page, and long tables repeat their header row.

Document updates and version restores accept an optional `expected_updated_at` revision. A stale revision returns `409` before changing content. Omitting it preserves the explicit overwrite behavior for existing API clients. Mutations serialize on the document row.

Completed export files expire after the configured retention period; their job metadata remains, `file_url` becomes null and downloads return `404`. Cleanup runs independently every 15 seconds.
