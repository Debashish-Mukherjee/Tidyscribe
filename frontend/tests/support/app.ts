import { expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";

export const editor = (page: Page): Locator => page.getByRole("textbox", { name: /paste ai output/i });
export const preview = (page: Page): Locator => page.locator(".md-preview");
export const statusBar = (page: Page): Locator => page.getByRole("status").filter({ hasNotText: /^$/ }).first();

export async function open(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(preview(page)).toBeVisible();
}

/** Playwright's fill()/insertText take ~30 s for 4 000 lines in headless Chromium (browser cost, not the app's), so big text is set natively. */
async function setNative(page: Page, text: string): Promise<void> {
  await editor(page).evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

export async function setContent(page: Page, text: string): Promise<void> {
  if (text.length > 20_000) await setNative(page, text);
  else await editor(page).fill(text);
}

/** Fires a real paste event carrying both clipboard flavours, like a browser does for rich sources. */
export async function paste(page: Page, data: { text?: string; html?: string }): Promise<void> {
  await editor(page).focus();
  const intercepted = await editor(page).evaluate((element, payload) => {
    const transfer = new DataTransfer();
    if (payload.text !== undefined) transfer.setData("text/plain", payload.text);
    if (payload.html !== undefined) transfer.setData("text/html", payload.html);
    const event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, data);
  // A synthetic event never inserts anything itself; do what the browser would when the app lets the paste through.
  if (!intercepted && data.text) {
    if (data.text.length > 20_000) await setNative(page, data.text);
    else await page.keyboard.insertText(data.text);
  }
}

export async function editorValue(page: Page): Promise<string> {
  return editor(page).inputValue();
}

export async function clearEditor(page: Page): Promise<void> {
  await editor(page).fill("");
}

export const unique = (label: string): string => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function apiFetch(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${pathname}`, init);
}

export async function apiJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(pathname, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${pathname} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

export interface ExportOutcome {
  status: "completed" | "failed";
  error: string | null;
  bytes: Buffer;
  durationMs: number;
}

/** Saves the markdown as a document, exports it through the API and downloads the result. */
export async function exportViaApi(markdown: string, format: "docx" | "pdf" | "html" | "markdown", title = unique("UAT export")): Promise<ExportOutcome> {
  const started = Date.now();
  const doc = await apiJson<{ id: string }>("/api/documents", { method: "POST", body: JSON.stringify({ title, content: markdown }) });
  const job = await apiJson<{ job_id: string }>("/api/exports", { method: "POST", body: JSON.stringify({ document_id: doc.id, format }) });
  let state = await apiJson<{ status: string; file_url: string | null; error: string | null }>(`/api/exports/${job.job_id}`);
  for (let i = 0; i < 240 && state.status !== "completed" && state.status !== "failed"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await apiJson(`/api/exports/${job.job_id}`);
  }
  if (state.status !== "completed" || !state.file_url) {
    return { status: "failed", error: state.error ?? `stuck in ${state.status}`, bytes: Buffer.alloc(0), durationMs: Date.now() - started };
  }
  const file = await fetch(state.file_url.startsWith("http") ? state.file_url : `${API_URL}${state.file_url}`);
  return { status: "completed", error: null, bytes: Buffer.from(await file.arrayBuffer()), durationMs: Date.now() - started };
}

function scratch(name: string, bytes: Buffer): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "uat-")), name);
  writeFileSync(file, bytes);
  return file;
}

/** Plain text of every paragraph and table cell in a .docx (document order not guaranteed to be preserved for tables). */
export function docxText(bytes: Buffer): string {
  const xml = execFileSync("unzip", ["-p", scratch("a.docx", bytes), "word/document.xml"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function docxXml(bytes: Buffer): string {
  return execFileSync("unzip", ["-p", scratch("a.docx", bytes), "word/document.xml"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
}

export function docxHasImages(bytes: Buffer): number {
  const listing = execFileSync("unzip", ["-Z1", scratch("a.docx", bytes)]).toString("utf8");
  return listing.split("\n").filter((entry) => entry.startsWith("word/media/")).length;
}

export function pdfText(bytes: Buffer): string {
  return execFileSync("pdftotext", ["-layout", scratch("a.pdf", bytes), "-"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
}

export function pdfPageCount(bytes: Buffer): number {
  const info = execFileSync("pdfinfo", [scratch("a.pdf", bytes)]).toString("utf8");
  return Number(info.match(/Pages:\s+(\d+)/)?.[1] ?? 0);
}

/** Collapses whitespace so formatting differences do not count as content loss. */
export const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Words from the source that never show up in the output; a crude but honest fidelity metric. */
export function missingWords(source: string, output: string, minLength = 3): string[] {
  const haystack = squash(output).toLowerCase();
  const words = source.match(/[\p{L}\p{N}_]{3,}/gu) ?? [];
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < minLength || seen.has(lower)) continue;
    seen.add(lower);
    if (!haystack.includes(lower)) missing.push(word);
  }
  return missing;
}

/** Deletes every document, clipboard item and snippet created after `sinceIso` (used by teardown). */
export async function purgeCreatedSince(sinceIso: string): Promise<{ documents: number; clipboard: number }> {
  const since = Date.parse(sinceIso);
  let documents = 0;
  let clipboard = 0;
  for (let offset = 0; offset < 5000; offset += 200) {
    const batch = await apiJson<Array<{ id: string; created_at: string | null }>>(`/api/documents?limit=200&offset=${offset}`);
    if (batch.length === 0) break;
    for (const doc of batch) {
      if (doc.created_at && Date.parse(doc.created_at) >= since) {
        await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
        documents += 1;
      }
    }
  }
  const items = await apiJson<Array<{ id: string; created_at: string | null }>>(`/api/clipboard?limit=500`);
  for (const item of items) {
    if (item.created_at && Date.parse(item.created_at) >= since) {
      await apiFetch(`/api/clipboard/${item.id}`, { method: "DELETE" });
      clipboard += 1;
    }
  }
  return { documents, clipboard };
}
