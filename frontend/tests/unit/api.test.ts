import { describe, expect, it, vi } from "vitest";
import { api, ApiError, errorMessage, queryString, waitForExport, type ExportJob, type ExportStatus } from "../../lib/api";

const respond = (status: number, body?: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "Status text",
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  });

describe("queryString", () => {
  it("omits empty values and encodes the rest", () => {
    expect(queryString({ q: "a b&c", archived: false, tag: undefined, empty: "", none: null })).toBe("?q=a+b%26c&archived=false");
    expect(queryString()).toBe("");
    expect(queryString({ q: "" })).toBe("");
  });
});

describe("api client", () => {
  it("sends JSON bodies with the right method and parses the response", async () => {
    const fetchMock = respond(201, { id: "1", title: "T", content: "C" });
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.documents.create({ title: "T", content: "C" });
    expect(result.id).toBe("1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/documents$/);
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ title: "T", content: "C" }), headers: { "Content-Type": "application/json" } });
  });

  it("builds query strings for searches", async () => {
    const fetchMock = respond(200, []);
    vi.stubGlobal("fetch", fetchMock);
    await api.snippets.list({ q: "sql", archived: true });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/snippets\?q=sql&archived=true$/);
  });

  it("returns undefined for 204 responses", async () => {
    vi.stubGlobal("fetch", respond(204));
    await expect(api.snippets.remove("x")).resolves.toBeUndefined();
  });

  it("raises ApiError with the server's detail message", async () => {
    vi.stubGlobal("fetch", respond(409, { detail: "Template 'ADR' already exists" }));
    const error = await api.templates.create({ name: "ADR", body: "" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("Template 'ADR' already exists");
  });

  it("serialises validation detail arrays and survives non-JSON error bodies", async () => {
    vi.stubGlobal("fetch", respond(422, { detail: [{ msg: "bad" }] }));
    expect((await api.documents.create({ title: "", content: "" }).catch((e) => e)).message).toContain("bad");
    vi.stubGlobal("fetch", respond(500));
    expect((await api.documents.list().catch((e) => e)).message).toBe("Status text");
  });

  it("maps every resource to the documented route", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await api.documents.restore("d", "v");
    await api.clipboard.restore("c");
    await api.clipboard.update("c", { pinned: true });
    await api.convertDiagram("src", "svg");
    await api.expandDiagrams("md");
    const calls = fetchMock.mock.calls.map(([url, init]) => `${init.method} ${String(url).replace(/^https?:\/\/[^/]+/, "")}`);
    expect(calls).toEqual([
      "POST /api/documents/d/versions/v/restore",
      "POST /api/clipboard/c/restore",
      "PUT /api/clipboard/c",
      "POST /api/convert-diagram",
      "POST /api/expand-diagrams",
    ]);
  });
});

describe("errorMessage", () => {
  it("handles Error and unknown values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("x")).toBe("Something went wrong");
  });
});

describe("waitForExport", () => {
  const job = (status: ExportStatus, extra: Partial<ExportJob> = {}): ExportJob => ({
    job_id: "j1",
    status,
    type: "pdf",
    file_url: status === "completed" ? "http://x/download" : null,
    error: null,
    ...extra,
  });

  it("returns immediately for a completed job without polling", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const done = await waitForExport(job("completed"), { onStatus: (status) => seen.push(status) });
    expect(done.file_url).toBe("http://x/download");
    expect(seen).toEqual(["completed"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("polls through queued and processing, reporting each state once", async () => {
    const states = [job("queued"), job("processing"), job("processing"), job("completed")];
    const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => states.shift() }));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const done = await waitForExport(job("queued"), { intervalMs: 1, onStatus: (status) => seen.push(status) });
    expect(done.status).toBe("completed");
    expect(seen).toEqual(["queued", "processing", "completed"]);
    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^https?:\/\/[^/]+/, ""))).toEqual(["/api/exports/j1", "/api/exports/j1", "/api/exports/j1", "/api/exports/j1"].slice(0, 4));
  });

  it("throws the job's error message when it fails, with a fallback", async () => {
    await expect(waitForExport(job("failed", { error: "The document no longer exists" }))).rejects.toThrow("The document no longer exists");
    await expect(waitForExport(job("failed"))).rejects.toThrow("The export failed");
  });

  it.each(["cancelled", "timed_out"] as const)("stops polling immediately for %s", async (status) => {
    const fetchMock = respond(200, job(status, { error: "Stopped by worker" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(waitForExport(job("starting"), { intervalMs: 1 })).rejects.toThrow("Stopped by worker");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => job("processing") }));
    await expect(waitForExport(job("queued"), { intervalMs: 5, timeoutMs: 30 })).rejects.toThrow(/taking too long/);
  });

  it("propagates polling errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: "Export job not found" }) }));
    await expect(waitForExport(job("queued"), { intervalMs: 1 })).rejects.toThrow("Export job not found");
  });
});
