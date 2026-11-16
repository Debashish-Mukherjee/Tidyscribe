import { marked } from "marked";
import { createMarkdownService } from "./richpaste";
import { fenceBareDiagrams } from "./markdown";
import { sanitizeHtml } from "./sanitize";

/**
 * Markdown <-> the HTML the rich editor (TipTap) reads and writes. Markdown stays the source of truth: the editor
 * is loaded from it and every edit is serialised back, which normalises formatting (bullet markers, spacing).
 */

export function markdownToEditorHtml(markdown: string): string {
  const html = marked.parse(fenceBareDiagrams(markdown || ""), { gfm: true, breaks: true }) as string;
  const doc = new DOMParser().parseFromString(html, "text/html");

  // marked renders `- [x] item` as <li><input type=checkbox> item</li>; TipTap's task list uses data attributes instead.
  doc.querySelectorAll("li").forEach((item) => {
    const box = item.querySelector(":scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]");
    if (!box) return;
    item.setAttribute("data-type", "taskItem");
    item.setAttribute("data-checked", box.hasAttribute("checked") ? "true" : "false");
    const holder = box.parentElement;
    box.remove();
    if (holder?.firstChild?.nodeType === Node.TEXT_NODE) holder.firstChild.textContent = holder.firstChild.textContent?.replace(/^\s+/, "") ?? "";
    item.parentElement?.setAttribute("data-type", "taskList");
  });
  return sanitizeHtml(doc.body.innerHTML, { extraAttributes: ["data-type", "data-checked"] }).html;
}

let service: ReturnType<typeof createMarkdownService> | null = null;

export function editorHtmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  doc.querySelectorAll("colgroup").forEach((node) => node.remove());
  // A table cell cannot hold block content in Markdown; join its paragraphs on one line.
  doc.querySelectorAll("th,td").forEach((cell) => {
    const paragraphs = Array.from(cell.querySelectorAll(":scope > p"));
    if (paragraphs.length === 0) return;
    const parts = paragraphs.map((paragraph) => paragraph.innerHTML.trim()).filter(Boolean);
    cell.innerHTML = parts.join(" ");
  });
  // TipTap task items are <li data-checked><label><input><span/></label><div><p>text</p></div></li>.
  doc.querySelectorAll("li[data-type=taskItem], li[data-checked]").forEach((item) => {
    const checked = item.getAttribute("data-checked") === "true";
    item.querySelector(":scope > label")?.remove();
    const content = item.querySelector(":scope > div") ?? item;
    const first = content.querySelector(":scope > p:first-child");
    const lead = first ? first.innerHTML : "";
    first?.remove();
    const rest = content.innerHTML;
    item.innerHTML = `<input type="checkbox"${checked ? " checked" : ""}> ${lead}${rest}`;
  });

  service ??= createMarkdownService();
  return service
    .turndown(doc.body)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
