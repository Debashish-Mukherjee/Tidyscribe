import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { convertTable } from "./tables";

const REMOVED = "style,script,meta,link,title,noscript,template";
const SAFE_LINK = /^(https?:|mailto:|tel:|#)/i;

const isBoldStyle = (style: string) => /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i.test(style);
const isNormalWeight = (style: string) => /font-weight\s*:\s*(normal|lighter|[1-5]00)\b/i.test(style);
const isItalicStyle = (style: string) => /font-style\s*:\s*italic/i.test(style);

function wrap(doc: Document, element: Element, tag: "strong" | "em") {
  const wrapper = doc.createElement(tag);
  while (element.firstChild) wrapper.appendChild(element.firstChild);
  element.appendChild(wrapper);
}

function unwrap(element: Element) {
  element.replaceWith(...Array.from(element.childNodes));
}

/** Structure-preserving clean-up that applies to every source (adapters add the source-specific parts). */
export function normalizeDocument(doc: Document) {
  doc.querySelectorAll(REMOVED).forEach((node) => node.remove());

  // Google Docs wraps the whole selection in <b style="font-weight:normal">.
  doc.querySelectorAll("b,strong").forEach((node) => {
    if (isNormalWeight(node.getAttribute("style") ?? "")) unwrap(node);
  });

  // Styled spans (Google Docs, Word, web editors) mean bold/italic without using <b>/<i>.
  doc.querySelectorAll("span[style]").forEach((span) => {
    const style = span.getAttribute("style") ?? "";
    if (!span.textContent?.trim()) return;
    if (isItalicStyle(style)) wrap(doc, span, "em");
    if (isBoldStyle(style)) wrap(doc, span, "strong");
  });

  doc.querySelectorAll("a[href]").forEach((link) => {
    if (!SAFE_LINK.test(link.getAttribute("href") ?? "")) unwrap(link);
  });

  // Inline image data would bloat the document; keep only remote images.
  doc.querySelectorAll("img").forEach((image) => {
    const src = image.getAttribute("src") ?? "";
    if (!/^https?:/i.test(src)) image.replaceWith(doc.createTextNode(image.getAttribute("alt") ?? ""));
  });

  // Word exports lists as paragraphs: `mso-list:l0 level2 lfo1`, with the bullet or number in an "Ignore" span.
  doc.querySelectorAll("p[style*='mso-list']").forEach((paragraph) => {
    const style = paragraph.getAttribute("style") ?? "";
    if (/mso-list\s*:\s*none/i.test(style)) return;
    const marker = paragraph.querySelector("span[style*='mso-list:Ignore'],span[style*='mso-list: Ignore']");
    const markerText = marker?.textContent?.trim() ?? "";
    marker?.remove();
    paragraph.setAttribute("data-md-list", /^(\d+|[a-z]|[ivx]+)[.)]/i.test(markerText) ? "ordered" : "bullet");
    paragraph.setAttribute("data-md-level", style.match(/level(\d+)/i)?.[1] ?? "1");
  });
}

const RAW_INLINE = ["kbd", "sub", "sup", "mark", "u", "ins", "small"];

export function createMarkdownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
    br: "",
    linkStyle: "inlined",
  });
  service.use(gfm);

  // Only escape what would start unintended structure; technical text is full of `_` and `*`.
  service.escape = (text: string) =>
    text.replace(/^(\s*)(?:([#>+-])|(\d+)([.)]))(?=\s)/gm, (_all, indent, bullet, digits, dot) => (bullet ? `${indent}\\${bullet}` : `${indent}${digits}\\${dot}`));

  // A heading line never starts a list or quote, so "## 1. Scope" needs no escaping.
  service.addRule("plainHeading", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content, node) => {
      const text = content.replace(/^(\d+)\\([.)])/, "$1$2").replace(/^\\([#>+-])/, "$1");
      return `\n\n${"#".repeat(Number(node.nodeName.charAt(1)))} ${text}\n\n`;
    },
  });

  // Turndown pads markers to four columns (`-   item`); use the compact form people actually write.
  service.addRule("compactListItem", {
    filter: "li",
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const parent = node.parentNode as HTMLElement | null;
      let prefix = "- ";
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") ?? 1) || 1;
        prefix = `${start + Array.from(parent.children).indexOf(node as Element)}. `;
      }
      let body = content.replace(/^\n+/, "").replace(/\n+$/, "\n");
      const task = element.getAttribute("data-md-task");
      if (task) body = `[${task === "checked" ? "x" : " "}] ${body.replace(/^\[[ xX]\]\s+/, "")}`;
      body = body.replace(/^(\[[ x]\])\s+/, "$1 ").replace(/\n/g, `\n${" ".repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });

  // A paragraph that starts with a checkbox glyph is a task line.
  service.addRule("taskLine", {
    filter: (node) => node.nodeName === "P" && (node as HTMLElement).hasAttribute("data-md-taskline"),
    replacement: (content, node) => `\n- [${(node as HTMLElement).getAttribute("data-md-taskline") === "checked" ? "x" : " "}] ${content.trim()}\n`,
  });

  // markdown-it (used for exports) only recognises the double-tilde form.
  service.addRule("strikethrough", {
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });

  // Chat UIs put a language label and a "Copy" button inside <pre>, outside <code>; use the code text only.
  service.addRule("fencedPre", {
    filter: "pre",
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const code = element.querySelector("code");
      const text = (code ?? element).textContent ?? "";
      const language = (code?.className ?? "").match(/language-([\w+#.-]+)/)?.[1] ?? element.getAttribute("data-md-lang") ?? "";
      const fence = text.includes("```") ? "````" : "```";
      return `\n\n${fence}${language}\n${text.replace(/\n+$/, "")}\n${fence}\n\n`;
    },
  });

  service.addRule("wordListItem", {
    filter: (node) => node.nodeName === "P" && (node as HTMLElement).hasAttribute("data-md-list"),
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const level = Math.min(Math.max(parseInt(element.getAttribute("data-md-level") ?? "1", 10) || 1, 1), 8);
      const marker = element.getAttribute("data-md-list") === "ordered" ? "1." : "-";
      return `\n${"  ".repeat(level - 1)}${marker} ${content.trim()}\n`;
    },
  });

  // Confluence panels and GitHub alerts arrive as `<blockquote data-md-callout>`.
  service.addRule("callout", {
    filter: (node) => node.nodeName === "BLOCKQUOTE" && (node as HTMLElement).hasAttribute("data-md-callout"),
    replacement: (content, node) => {
      const kind = (node as HTMLElement).getAttribute("data-md-callout");
      const lines = [`[!${kind}]`, ...content.trim().replace(/\n{3,}/g, "\n\n").split("\n")];
      return `\n\n${lines.map((line) => (line ? `> ${line}` : ">")).join("\n")}\n\n`;
    },
  });

  // TeX source recovered from KaTeX/MathJax markup.
  service.addRule("math", {
    filter: (node) => (node as HTMLElement).hasAttribute?.("data-md-math") ?? false,
    replacement: (content, node) => ((node as HTMLElement).getAttribute("data-md-math") === "block" ? `\n\n$$\n${content.trim()}\n$$\n\n` : `$${content.trim()}$`),
  });

  service.addRule("footnoteRef", {
    filter: (node) => (node as HTMLElement).hasAttribute?.("data-md-footnote-ref") ?? false,
    replacement: (_content, node) => `[^${(node as HTMLElement).getAttribute("data-md-footnote-ref")}]`,
  });

  service.addRule("footnoteDefinition", {
    filter: (node) => (node as HTMLElement).hasAttribute?.("data-md-footnote") ?? false,
    replacement: (content, node) => `\n\n[^${(node as HTMLElement).getAttribute("data-md-footnote")}]: ${content.trim().replace(/\n/g, "\n    ")}\n\n`,
  });

  // Markdown has no syntax for these; the shared HTML policy keeps them as raw HTML in Preview and in every export.
  service.addRule("rawInline", {
    filter: (node) => RAW_INLINE.includes(node.nodeName.toLowerCase()),
    replacement: (content, node) => {
      const tag = node.nodeName.toLowerCase();
      return content.trim() ? `<${tag}>${content}</${tag}>` : content;
    },
  });

  service.addRule("details", {
    filter: "details",
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const title = (element.querySelector("summary")?.textContent ?? "Details").replace(/\s+/g, " ").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const body = content.trim();
      return `\n\n<details${element.hasAttribute("open") ? " open" : ""}>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n\n`;
    },
  });
  service.addRule("summary", { filter: "summary", replacement: () => "" });

  service.addRule("table", { filter: "table", replacement: (_content, node) => convertTable(node as HTMLElement, service) });

  return service;
}
