import { vi } from "vitest";

type Row = Record<string, unknown> & { id: string };

export type FakeApi = {
  calls: string[];
  db: { documents: Row[]; templates: Row[]; snippets: Row[]; clipboard: Row[] };
  fetch: ReturnType<typeof vi.fn>;
  /** Server-side key/value settings. */
  settings: Record<string, string>;
  /** Poll responses a new export job reports before it completes, e.g. ["queued", "processing"]. */
  exportStates: string[];
  /** When set, the export job ends as failed with this message. */
  exportFailure: string | null;
};

const json = (status: number, body?: unknown) => ({
  ok: status < 400,
  status,
  statusText: String(status),
  json: async () => body,
  blob: async () => ({ type: "application/octet-stream", text: async () => String(body ?? "") }),
});

/** In-memory stand-in for the backend REST API (only the behaviour the UI relies on). */
export function createFakeApi(seed: Partial<FakeApi["db"]> = {}): FakeApi {
  let counter = 0;
  const id = () => `id-${(counter += 1)}`;
  const db: FakeApi["db"] = {
    documents: seed.documents ?? [],
    templates: seed.templates ?? [{ id: "t1", name: "ADR", category: "document", body: "# ADR\n\n## Decision\n" }],
    snippets: seed.snippets ?? [
      { id: "s1", title: "SQL index", body: "CREATE INDEX i ON t (c);", category: "SQL", tags: ["db"], favorite: false, archived: false },
      { id: "s2", title: "K8s deploy", body: "kind: Deployment", category: "Kubernetes", tags: [], favorite: true, archived: false },
    ],
    clipboard: seed.clipboard ?? [{ id: "c1", content: "first clip", tags: [], pinned: false }],
  };
  const calls: string[] = [];
  const settings: Record<string, string> = {};
  const jobs = new Map<string, { format: string; polls: number }>();
  const fake = { exportStates: [] as string[], exportFailure: null as string | null };

  const matches = (row: Row, q: string | null, fields: string[]) =>
    !q || fields.some((field) => String(row[field] ?? "").toLowerCase().includes(q.toLowerCase()));

  const handler = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const path = url.pathname;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(`${method} ${path}${url.search}`);
    const q = url.searchParams.get("q");

    const collection = (name: keyof FakeApi["db"], searchFields: string[], make: (b: Record<string, unknown>) => Row) => {
      const base = `/api/${name}`;
      if (path === base && method === "GET") {
        const archived = url.searchParams.get("archived") === "true";
        return json(
          200,
          db[name].filter((row) => matches(row, q, searchFields) && (name !== "snippets" || Boolean(row.archived) === archived)),
        );
      }
      if (path === base && method === "POST") {
        const row = make(body);
        db[name].push(row);
        return json(201, row);
      }
      const [, , , rowId, action] = path.split("/");
      const index = db[name].findIndex((row) => row.id === rowId);
      if (index < 0) return json(404, { detail: "not found" });
      if (method === "PUT") {
        db[name][index] = { ...db[name][index], ...body };
        return json(200, db[name][index]);
      }
      if (method === "DELETE") {
        db[name].splice(index, 1);
        return json(204);
      }
      if (method === "POST" && action === "restore") return json(200, db[name][index]);
      return json(200, db[name][index]);
    };

    if (path === "/api/settings" && method === "GET") return json(200, { ...settings });
    const settingMatch = path.match(/^\/api\/settings\/(.+)$/);
    if (settingMatch && method === "PUT") {
      settings[decodeURIComponent(settingMatch[1])] = String(body.value);
      return json(200, { value: body.value });
    }
    if (path.startsWith("/api/templates")) return collection("templates", ["name", "body"], (b) => ({ id: id(), category: "general", ...b }));
    if (path.startsWith("/api/snippets")) return collection("snippets", ["title", "body", "category"], (b) => ({ id: id(), favorite: false, archived: false, tags: [], ...b }));
    if (path.startsWith("/api/clipboard")) return collection("clipboard", ["content"], (b) => ({ id: id(), tags: [], pinned: false, ...b }));
    if (path === "/api/documents" && method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 100);
      return json(200, db.documents.filter((row) => matches(row, q, ["title", "content"])).slice(offset, offset + limit));
    }
    if (path === "/api/documents" && method === "POST") {
      const row = { id: id(), updated_at: null, ...body } as Row;
      db.documents.push(row);
      return json(200, row);
    }
    const docMatch = path.match(/^\/api\/documents\/([^/]+)(?:\/(versions))?$/);
    if (docMatch) {
      const index = db.documents.findIndex((row) => row.id === docMatch[1]);
      if (index < 0) return json(404, { detail: "Document not found" });
      if (docMatch[2] === "versions") return json(200, []);
      if (method === "PUT") {
        const current = db.documents[index];
        if (body.expected_updated_at && current.updated_at && body.expected_updated_at !== current.updated_at) {
          return json(409, { detail: "This document was changed somewhere else after you opened it" });
        }
        const { expected_updated_at: _expected, ...changes } = body;
        void _expected;
        db.documents[index] = { ...current, ...changes, ...(current.updated_at ? { updated_at: `rev-${(counter += 1)}` } : {}) };
        return json(200, db.documents[index]);
      }
      if (method === "DELETE") {
        db.documents.splice(index, 1);
        return json(204);
      }
      return json(200, db.documents[index]);
    }
    if (path === "/api/expand-diagrams") {
      const markdown = String(body.markdown).replace(/```plantuml\n[\s\S]*?```/g, "```mermaid\nsequenceDiagram\n    A->>B: hi\n```");
      return json(200, { markdown, converted: markdown === body.markdown ? 0 : 1, unsupported: 0 });
    }
    if (path === "/api/convert-diagram") {
      if (!/\+-+\+|@startuml|A ->/.test(String(body.source))) return json(422, { detail: "This diagram could not be converted (unsupported structure)" });
      const extension = { mermaid: "mmd", svg: "svg", drawio: "drawio" }[String(body.target)];
      return json(200, { content: `converted-${body.target}`, target: body.target, media_type: "text/plain", extension });
    }
    if (path === "/api/transform") {
      const cleaned = `# Cleaned\n\n${String(body.text).replace(/^Certainly!\s*/, "")}`;
      const removedOpener = /^Certainly!/.test(String(body.text));
      return json(200, {
        cleaned_text: cleaned,
        summary: "ok",
        changed: true,
        removed: removedOpener ? 1 : 0,
        changes: removedOpener ? [{ rule: "preamble", label: "Removed AI openers and lead-ins", count: 1, examples: ["Certainly!"] }] : [{ rule: "style", label: "Applied the style", count: 1, examples: ["a -> b"] }],
      });
    }
    if (path === "/api/parse-paste") return json(200, { normalized_markdown: String(body.text).trim(), detected_types: ["markdown"], converted_mermaid: null, summary: "" });
    if (path === "/api/exports" && method === "POST") {
      const jobId = `job-${jobs.size + 1}`;
      jobs.set(jobId, { format: String(body.format), polls: 0 });
      return json(202, exportJob(jobId, fake.exportStates.length ? fake.exportStates[0] : fake.exportFailure ? "failed" : "completed"));
    }
    const jobMatch = path.match(/^\/api\/exports\/(job-\d+)(\/download)?$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return json(404, { detail: "Export job not found" });
      if (jobMatch[2]) return json(200, "<html><body><h1>Exported</h1></body></html>");
      job.polls += 1;
      const state = fake.exportStates[job.polls] ?? (fake.exportFailure ? "failed" : "completed");
      return json(200, exportJob(jobMatch[1], state));
    }
    return json(404, { detail: `unhandled ${method} ${path}` });
  });

  const exportJob = (jobId: string, status: string) => ({
    job_id: jobId,
    status,
    type: jobs.get(jobId)?.format ?? "html",
    file_url: status === "completed" ? `http://localhost:8000/api/exports/${jobId}/download` : null,
    error: status === "failed" ? fake.exportFailure : null,
  });

  return {
    calls,
    db,
    settings,
    fetch: handler,
    get exportStates() {
      return fake.exportStates;
    },
    set exportStates(value: string[]) {
      fake.exportStates = value;
    },
    get exportFailure() {
      return fake.exportFailure;
    },
    set exportFailure(value: string | null) {
      fake.exportFailure = value;
    },
  };
}
