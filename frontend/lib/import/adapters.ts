import { plural, type ImportContext, type ImportSource } from "./types";

type Adapter = (doc: Document, ctx: ImportContext) => void;

const text = (node: Node | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const all = (doc: Document, selector: string) => Array.from(doc.querySelectorAll<HTMLElement>(selector));

function unwrap(element: Element) {
  element.replaceWith(...Array.from(element.childNodes));
}

function replaceWith(doc: Document, element: Element, tag: string, html: string, attributes: Record<string, string> = {}) {
  const next = doc.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => next.setAttribute(name, value));
  next.innerHTML = html;
  element.replaceWith(next);
  return next;
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- shared

const COPY_BUTTON = /^(copy( code)?|copied!?|copy to clipboard)$/i;
const LANGUAGE_LABEL = /^[A-Za-z][A-Za-z0-9+#.-]{0,19}(?: [A-Za-z]{1,10})?$/;

/**
 * Chat tools wrap code in a header bar holding the language and a Copy button. Only a bar that contains a real Copy
 * button is removed, and its language label is kept as the code block's language.
 */
function stripCodeChrome(doc: Document, ctx: ImportContext) {
  let bars = 0;
  all(doc, "button, [role=button]").forEach((button) => {
    if (!button.isConnected || !COPY_BUTTON.test(text(button))) return;
    let header: Element = button;
    while (header.parentElement && header.parentElement !== doc.body && text(header.parentElement).length <= 40 && !header.parentElement.querySelector("pre, code")) {
      header = header.parentElement;
    }
    const label = text(header).replace(text(button), "").trim();
    const scope = header.parentElement;
    const code = scope?.querySelector("pre, code") ?? header.nextElementSibling?.querySelector("pre, code") ?? null;
    if (label && LANGUAGE_LABEL.test(label) && code) {
      const target = code.closest("pre") ?? code;
      const existing = `${target.className} ${target.querySelector("code")?.className ?? ""}`;
      if (!/language-/.test(existing)) target.setAttribute("data-md-lang", label.toLowerCase().replace(/\s+/g, ""));
    }
    if (code || !label || LANGUAGE_LABEL.test(label)) {
      header.remove();
      bars += 1;
    } else {
      button.remove();
    }
  });
  if (bars) ctx.notices.push(`removed ${plural(bars, "Copy-code header")}`);
}

/** Buttons are never document content; chat tools use them for UI (citations, actions). */
function removeButtons(doc: Document, ctx: ImportContext) {
  const buttons = all(doc, "button");
  buttons.forEach((button) => button.remove());
  if (buttons.length) ctx.notices.push(`removed ${plural(buttons.length, "UI control")}`);
}

const CITATION = /\ue200[^\ue201]*\ue201|【\d+(?:[:†][^】]*)?】/g;

function stripCitationMarkers(doc: Document, ctx: ImportContext) {
  let removed = 0;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const value = node.textContent ?? "";
    if (!/[\ue200【]/.test(value)) return;
    const cleaned = value.replace(CITATION, () => {
      removed += 1;
      return "";
    });
    if (cleaned !== value) node.textContent = cleaned;
  });
  if (removed) ctx.notices.push(`removed ${plural(removed, "citation marker")}`);
}

/** KaTeX and MathJax carry their TeX source; keep it as `$...$` instead of the rendered glyph soup. */
function mathToTex(doc: Document) {
  all(doc, ".katex-display, .katex, mjx-container, .MathJax, .MathJax_Display").forEach((element) => {
    if (!element.isConnected) return;
    const display = element.matches(".katex-display, mjx-container[display=true], .MathJax_Display") || element.closest(".katex-display") !== null;
    const holder = element.closest(".katex-display") ?? element;
    const tex = element.querySelector("annotation[encoding='application/x-tex']")?.textContent ?? element.getAttribute("data-tex");
    if (!tex) return;
    replaceWith(doc, holder, display ? "div" : "span", escapeHtml(tex.trim()), { "data-md-math": display ? "block" : "inline" });
  });
}

/** `<a><svg/></a>` permalinks and other links that show nothing leave `[](#x)` behind. */
function dropEmptyLinks(doc: Document, ctx: ImportContext) {
  all(doc, "svg").forEach((svg) => svg.remove());
  let removed = 0;
  all(doc, "a").forEach((link) => {
    if (text(link) === "" && !link.querySelector("img")) {
      link.remove();
      removed += 1;
    }
  });
  all(doc, "a.anchor, a[aria-label^='Permalink']").forEach((link) => {
    link.remove();
    removed += 1;
  });
  if (removed) ctx.notices.push(`removed ${plural(removed, "empty link")}`);
}

const EMOJI_ONLY = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f\u{1f3fb}-\u{1f3ff}]*$/u;

/** Emoji pasted as small images keep their Unicode character in `alt`. */
function emojiImagesToText(doc: Document, ctx: ImportContext) {
  let converted = 0;
  all(doc, "img[alt]").forEach((image) => {
    const alt = (image.getAttribute("alt") ?? "").trim();
    if (alt && EMOJI_ONLY.test(alt)) {
      image.replaceWith(doc.createTextNode(alt));
      converted += 1;
    }
  });
  if (converted) ctx.notices.push(`converted ${plural(converted, "emoji image")} to text`);
}

const BOX_GLYPHS = /^\s*([\u2610\u2611\u2612\u2705])\s+/;

/** ☐ / ☑ / ☒ at the start of a list item or paragraph are task checkboxes. */
function glyphCheckboxes(doc: Document) {
  all(doc, "li, p").forEach((element) => {
    const first = element.firstChild;
    const match = first?.nodeType === Node.TEXT_NODE ? BOX_GLYPHS.exec(first.textContent ?? "") : null;
    if (!match || (match[1] === "\u2705" && element.tagName === "P")) return;
    const checked = match[1] !== "\u2610";
    first!.textContent = (first!.textContent ?? "").slice(match[0].length);
    element.setAttribute(element.tagName === "LI" ? "data-md-task" : "data-md-taskline", checked ? "checked" : "unchecked");
  });
}

// ---------------------------------------------------------------- tracking links

/** The real destination of a mail-security wrapper link, or null when the URL is not a known wrapper. */
export function unwrapTrackingUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (/(^|\.)safelinks\.protection\.outlook\.com$/i.test(url.hostname)) {
    const target = url.searchParams.get("url");
    return target && /^https?:/i.test(target) ? target : null;
  }
  if (/^urldefense\.(proofpoint\.)?com$/i.test(url.hostname)) {
    const v3 = /^\/v3\/__(.+?)__;/.exec(url.pathname + url.search);
    if (v3) return decodeURIComponent(v3[1]);
    const encoded = url.searchParams.get("u");
    if (encoded) {
      // v2 encoding: "_" is "/", "-XX" is the hex byte XX.
      const decoded = encoded.replace(/-([0-9A-F]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16))).replace(/_/g, "/");
      return /^https?:/i.test(decoded) ? decoded : null;
    }
  }
  return null;
}

function unwrapSafeLinks(doc: Document, ctx: ImportContext) {
  let unwrapped = 0;
  all(doc, "a[href]").forEach((link) => {
    const target = unwrapTrackingUrl(link.getAttribute("href") ?? "");
    if (target) {
      link.setAttribute("href", target);
      unwrapped += 1;
    }
  });
  if (unwrapped) ctx.notices.push(`unwrapped ${plural(unwrapped, "tracking link")} to the original address`);
}

// ---------------------------------------------------------------- Word and Outlook

function groupWordLists(doc: Document, cell: Element) {
  const items = Array.from(cell.querySelectorAll<HTMLElement>("p[data-md-list]"));
  let list: HTMLElement | null = null;
  let kind = "";
  items.forEach((item) => {
    const type = item.getAttribute("data-md-list") === "ordered" ? "ol" : "ul";
    if (!list || kind !== type || list.nextElementSibling !== item) {
      list = doc.createElement(type);
      kind = type;
      item.before(list);
    }
    const entry = doc.createElement("li");
    entry.append(...Array.from(item.childNodes));
    list.append(entry);
    item.remove();
  });
}

const wordAdapter: Adapter = (doc, ctx) => {
  all(doc, "td, th").forEach((cell) => groupWordLists(doc, cell));
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent?.includes("\u00a0")) node.textContent = node.textContent.replace(/\u00a0/g, " ");
  }
  void ctx;
};

const outlookAdapter: Adapter = (doc, ctx) => {
  unwrapSafeLinks(doc, ctx);
};

// ---------------------------------------------------------------- Confluence

const PANEL_CALLOUTS: Record<string, string> = {
  information: "NOTE",
  info: "NOTE",
  note: "IMPORTANT",
  warning: "WARNING",
  tip: "TIP",
  success: "TIP",
  error: "CAUTION",
  problem: "CAUTION",
};

const confluenceAdapter: Adapter = (doc, ctx) => {
  // Code macros: "brush: java" or a data-code-lang attribute carry the language.
  all(doc, "pre[data-syntaxhighlighter-params], pre[data-code-lang], pre[data-language]").forEach((pre) => {
    const params = pre.getAttribute("data-syntaxhighlighter-params") ?? "";
    const language = /brush:\s*([\w+#.-]+)/i.exec(params)?.[1] ?? pre.getAttribute("data-code-lang") ?? pre.getAttribute("data-language");
    if (language) pre.setAttribute("data-md-lang", language.toLowerCase());
  });

  // Info / Note / Warning / Tip / Success panels become GitHub-style callouts.
  let panels = 0;
  all(doc, "[class*='confluence-information-macro-'], [data-panel-type]").forEach((panel) => {
    const kind = panel.getAttribute("data-panel-type") ?? /confluence-information-macro-(\w+)/.exec(panel.className)?.[1] ?? "";
    const callout = PANEL_CALLOUTS[kind.toLowerCase()];
    if (!callout || !panel.isConnected) return;
    const body = panel.querySelector(".confluence-information-macro-body, .ak-editor-panel__content, [data-panel-content]") ?? panel;
    const quote = doc.createElement("blockquote");
    quote.setAttribute("data-md-callout", callout);
    quote.innerHTML = body.innerHTML;
    panel.replaceWith(quote);
    panels += 1;
  });
  if (panels) ctx.notices.push(`converted ${plural(panels, "Confluence panel")} to callouts`);

  // Task lists keep their checked state.
  let tasks = 0;
  all(doc, "li[data-inline-task-id], li.checked, li[data-task-local-id], [data-prosemirror-node-name='taskItem'], .task-list-item").forEach((item) => {
    const checkbox = item.querySelector<HTMLInputElement>("input[type=checkbox]");
    const done = item.classList.contains("checked") || item.getAttribute("data-task-state") === "DONE" || checkbox?.checked === true || checkbox?.hasAttribute("checked") === true;
    if (item.tagName === "LI") {
      item.setAttribute("data-md-task", done ? "checked" : "unchecked");
      checkbox?.remove();
      tasks += 1;
    }
  });
  if (tasks) ctx.notices.push(`kept ${plural(tasks, "task")} with checked state`);

  // Expand macros are collapsible sections.
  all(doc, ".expand-container").forEach((expand) => {
    const title = text(expand.querySelector(".expand-control-text, .expand-title")) || "Details";
    const content = expand.querySelector(".expand-content")?.innerHTML ?? "";
    replaceWith(doc, expand, "details", `<summary>${escapeHtml(title)}</summary>${content}`);
  });

  all(doc, ".table-wrap, .tablesorter-header-inner").forEach(unwrap);
};

// ---------------------------------------------------------------- GitHub

const githubAdapter: Adapter = (doc, ctx) => {
  all(doc, "clipboard-copy, .zeroclipboard-container, .octicon").forEach((element) => element.remove());
  all(doc, "g-emoji").forEach((emoji) => emoji.replaceWith(doc.createTextNode(emoji.textContent ?? "")));

  // Alerts (> [!WARNING]) are rendered as a div with a title paragraph.
  let alerts = 0;
  all(doc, ".markdown-alert").forEach((alert) => {
    const kind = /markdown-alert-(note|tip|important|warning|caution)/.exec(alert.className)?.[1]?.toUpperCase();
    if (!kind) return;
    alert.querySelector(".markdown-alert-title")?.remove();
    replaceWith(doc, alert, "blockquote", alert.innerHTML, { "data-md-callout": kind });
    alerts += 1;
  });
  if (alerts) ctx.notices.push(`kept ${plural(alerts, "alert")} as callouts`);

  // Footnotes: <sup><a data-footnote-ref>1</a></sup> and <section data-footnotes>.
  let notes = 0;
  all(doc, "sup > a[data-footnote-ref], a[data-footnote-ref]").forEach((ref) => {
    const holder = ref.closest("sup") ?? ref;
    replaceWith(doc, holder, "span", escapeHtml(text(ref)), { "data-md-footnote-ref": text(ref) });
    notes += 1;
  });
  all(doc, "section[data-footnotes] li, section.footnotes li").forEach((item, index) => {
    item.querySelectorAll("a[data-footnote-backref], a.footnote-backref").forEach((back) => back.remove());
    replaceWith(doc, item, "div", item.innerHTML, { "data-md-footnote": String(index + 1) });
  });
  all(doc, "section[data-footnotes], section.footnotes").forEach((section) => {
    section.querySelectorAll("h2.sr-only, h2#footnote-label").forEach((heading) => heading.remove());
    unwrap(section.querySelector("ol") ?? section);
    unwrap(section);
  });
  if (notes) ctx.notices.push(`kept ${plural(notes, "footnote")}`);
};

// ---------------------------------------------------------------- Teams

const teamsAdapter: Adapter = (doc, ctx) => {
  // Reply quotes: author, time and preview ran together ("Ada10:01Can you...").
  let quotes = 0;
  all(doc, "blockquote[itemtype*='Reply'], blockquote[itemtype*='schema.skype.com']").forEach((quote) => {
    const author = text(quote.querySelector("[itemprop='mri'], strong"));
    const time = text(quote.querySelector("[itemprop='time']"));
    const preview = text(quote.querySelector("[itemprop='preview']")) || text(quote).replace(author, "").replace(time, "").trim();
    const header = [author && `<strong>${escapeHtml(author)}</strong>`, time && `<em>${escapeHtml(time)}</em>`].filter(Boolean).join(" ");
    quote.innerHTML = `${header ? `<p>${header}</p>` : ""}<p>${escapeHtml(preview)}</p>`;
    quote.removeAttribute("itemtype");
    quotes += 1;
  });
  if (quotes) ctx.notices.push(`kept ${plural(quotes, "quoted message")} with author and time`);
  // Message header lines such as "Ada Lovelace 10:01 AM" stay as they are; only the Skype microdata is noise.
  all(doc, "[itemscope]").forEach((element) => {
    element.removeAttribute("itemscope");
    element.removeAttribute("itemtype");
    element.removeAttribute("itemid");
  });
};

// ---------------------------------------------------------------- chat tools

const geminiAdapter: Adapter = (doc, ctx) => {
  let citations = 0;
  all(doc, "sup[data-turn-source-index], sup.superscript, source-footnote, sources-list, .source-footnote").forEach((element) => {
    element.remove();
    citations += 1;
  });
  all(doc, "message-actions, response-footer, .response-footer, .actions-container, thumb-up-button, thumb-down-button").forEach((element) => element.remove());
  if (citations) ctx.notices.push(`removed ${plural(citations, "source citation marker")}`);
};

const chatgptAdapter: Adapter = (doc) => {
  all(doc, ".sr-only, [data-testid*='copy-turn'], [data-testid*='webpage-citation'], [data-testid*='citation-pill']").forEach((element) => element.remove());
};

// ---------------------------------------------------------------- pipeline

const CHAT_SOURCES: ImportSource[] = ["gemini", "copilot", "chatgpt", "claude"];

const SOURCE_ADAPTERS: Partial<Record<ImportSource, Adapter>> = {
  word: wordAdapter,
  outlook: outlookAdapter,
  confluence: confluenceAdapter,
  github: githubAdapter,
  teams: teamsAdapter,
  gemini: geminiAdapter,
  chatgpt: chatgptAdapter,
};

/** Source-specific clean-up first, then the shared passes. Everything here changes the DOM only; Turndown comes after. */
export function adaptDocument(doc: Document, ctx: ImportContext) {
  const chat = ctx.sources.some((source) => CHAT_SOURCES.includes(source));
  ctx.sources.forEach((source) => SOURCE_ADAPTERS[source]?.(doc, ctx));
  stripCodeChrome(doc, ctx);
  if (chat) {
    removeButtons(doc, ctx);
    stripCitationMarkers(doc, ctx);
  }
  mathToTex(doc);
  emojiImagesToText(doc, ctx);
  dropEmptyLinks(doc, ctx);
  glyphCheckboxes(doc);
}
