import type { ApiSchemas } from "./api-schema";
import { resolveApiBase } from "./config";

export const apiBase = resolveApiBase();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type DocumentOut = ApiSchemas["DocumentOut"];
export type DocumentVersion = ApiSchemas["DocumentVersionOut"];
export type TemplateOut = ApiSchemas["TemplateOut"];
export type SnippetOut = Required<ApiSchemas["SnippetOut"]>;
export type ClipboardOut = Required<ApiSchemas["ClipboardItemOut"]>;
export type DiagramTarget = NonNullable<ApiSchemas["ConvertDiagramRequest"]["target"]>;
export type ConvertedDiagram = ApiSchemas["ConvertDiagramResponse"];
export type ExportJob = ApiSchemas["ExportJobOut"];
export type ExportStatus = ExportJob["status"];
export type ExportDiagram = ApiSchemas["DiagramImage"];
export type TransformChange = Required<ApiSchemas["ChangeOut"]>;
export type TransformResult = Omit<Required<ApiSchemas["TransformResponse"]>, "changes"> & { changes: TransformChange[] };

type Params = Record<string, string | number | boolean | undefined | null>;

type ValidationIssue = { loc?: (string | number)[]; msg?: string; type?: string; ctx?: { max_length?: number; min_length?: number } };

/** FastAPI validation errors arrive as an array of issues; turn them into one sentence a person can act on. */
export function describeValidation(detail: unknown): string | null {
  if (!Array.isArray(detail) || detail.length === 0) return null;
  return detail
    .map((issue: ValidationIssue) => {
      const field = String(issue.loc?.filter((part) => part !== "body").slice(-1)[0] ?? "value");
      const label = field.charAt(0).toUpperCase() + field.slice(1);
      if (issue.type === "string_too_long" && issue.ctx?.max_length) return `${label} is too long (limit ${issue.ctx.max_length.toLocaleString("en-US")} characters)`;
      if (issue.type === "string_too_short") return `${label} is too short`;
      return `${label}: ${issue.msg ?? "invalid"}`;
    })
    .join("; ");
}

export const queryString = (params?: Params) => {
  const entries = Object.entries(params ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}` : "";
};

async function request<T>(path: string, options: { method?: string; json?: unknown } = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: options.json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : (describeValidation(body.detail) ?? JSON.stringify(body.detail ?? body));
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  documents: {
    list: (params?: Params) => request<DocumentOut[]>(`/api/documents${queryString(params)}`),
    create: (json: { title: string; content: string }) => request<DocumentOut>("/api/documents", { method: "POST", json }),
    update: (id: string, json: { title?: string; content?: string; expected_updated_at?: string | null }) => request<DocumentOut>(`/api/documents/${id}`, { method: "PUT", json }),
    remove: (id: string) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
    versions: (id: string) => request<DocumentVersion[]>(`/api/documents/${id}/versions`),
    restore: (id: string, versionId: string, expected_updated_at?: string | null) => request<DocumentOut>(`/api/documents/${id}/versions/${versionId}/restore`, { method: "POST", json: { expected_updated_at } }),
  },
  templates: {
    list: () => request<TemplateOut[]>("/api/templates"),
    create: (json: { name: string; category?: string; body: string }) => request<TemplateOut>("/api/templates", { method: "POST", json }),
    remove: (id: string) => request<void>(`/api/templates/${id}`, { method: "DELETE" }),
  },
  snippets: {
    list: (params?: Params) => request<SnippetOut[]>(`/api/snippets${queryString(params)}`),
    create: (json: { title: string; body: string; category: string; tags: string[] }) => request<SnippetOut>("/api/snippets", { method: "POST", json }),
    update: (id: string, json: Partial<Pick<SnippetOut, "favorite" | "archived" | "title" | "tags" | "category" | "body">>) =>
      request<SnippetOut>(`/api/snippets/${id}`, { method: "PUT", json }),
    remove: (id: string) => request<void>(`/api/snippets/${id}`, { method: "DELETE" }),
  },
  clipboard: {
    list: (params?: Params) => request<ClipboardOut[]>(`/api/clipboard${queryString(params)}`),
    create: (json: { content: string; source?: string }) => request<ClipboardOut>("/api/clipboard", { method: "POST", json }),
    update: (id: string, json: { pinned?: boolean; tags?: string[] }) => request<ClipboardOut>(`/api/clipboard/${id}`, { method: "PUT", json }),
    remove: (id: string) => request<void>(`/api/clipboard/${id}`, { method: "DELETE" }),
    restore: (id: string) => request<ClipboardOut>(`/api/clipboard/${id}/restore`, { method: "POST" }),
  },
  exports: {
    create: (json: ApiSchemas["ExportRequest"]) => request<ExportJob>("/api/exports", { method: "POST", json }),
    get: (jobId: string) => request<ExportJob>(`/api/exports/${jobId}`),
    cancel: (jobId: string) => request<ExportJob>(`/api/exports/${jobId}/cancel`, { method: "POST" }),
  },
  settings: {
    list: () => request<Record<string, string>>("/api/settings"),
    put: (key: string, value: string) => request<{ value: string }>(`/api/settings/${encodeURIComponent(key)}`, { method: "PUT", json: { value } }),
  },
  convertDiagram: (source: string, target: DiagramTarget, source_format: NonNullable<ApiSchemas["ConvertDiagramRequest"]["source_format"]> = "auto") =>
    request<ConvertedDiagram>("/api/convert-diagram", { method: "POST", json: { source, target, source_format } }),
  expandDiagrams: (markdown: string) =>
    request<{ markdown: string; converted: number; unsupported: number }>("/api/expand-diagrams", { method: "POST", json: { markdown } }),
  transform: (text: string, tone: string) => request<TransformResult>("/api/transform", { method: "POST", json: { text, tone } }),
  parsePaste: (text: string) => request<{ detected_types: string[]; normalized_markdown?: string | null }>("/api/parse-paste", { method: "POST", json: { text } }),
};

// A failed fetch surfaces as a TypeError whose text differs per browser ("Failed to fetch", "Load failed", ...).
const NETWORK_FAILURE = /failed to fetch|network|load failed|fetch failed|connection/i;

export const errorMessage = (error: unknown) => {
  if (error instanceof TypeError && NETWORK_FAILURE.test(error.message)) return "Cannot reach the server. Check your connection and try again.";
  return error instanceof Error ? error.message : "Something went wrong";
};

export type WaitOptions = { intervalMs?: number; timeoutMs?: number; onStatus?: (status: ExportStatus) => void };

/** Polls an export job until it finishes; throws if it fails or does not finish in time. */
export async function waitForExport(job: ExportJob, { intervalMs = 400, timeoutMs = 180_000, onStatus }: WaitOptions = {}): Promise<ExportJob> {
  const deadline = Date.now() + timeoutMs;
  let current = job;
  let announced: ExportStatus | null = null;
  for (;;) {
    if (current.status !== announced) {
      announced = current.status;
      onStatus?.(current.status);
    }
    if (current.status === "completed") return current;
    if (current.status === "failed" || current.status === "cancelled" || current.status === "timed_out") {
      const fallback = { failed: "The export failed", cancelled: "The export was cancelled", timed_out: "The export timed out" };
      throw new Error(current.error || fallback[current.status]);
    }
    if (Date.now() >= deadline) throw new Error("The export is taking too long; try again in a moment");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await api.exports.get(job.job_id);
  }
}
