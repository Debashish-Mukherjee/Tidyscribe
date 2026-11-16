import { adaptDocument } from "./import/adapters";
import { detectSources } from "./import/detect";
import { fenceLostCodeBlocks, normalizePlainText } from "./import/plaintext";
import { tableReport } from "./import/tables";
import { createMarkdownService, normalizeDocument } from "./import/turndown";
import { SOURCE_LABELS, plural, type ImportResult, type ImportSource } from "./import/types";

export { createMarkdownService } from "./import/turndown";
export { SOURCE_LABELS } from "./import/types";
export type { ImportResult, ImportSource } from "./import/types";

export const MAX_HTML_CHARS = 1_500_000;
// Tags that carry structure plain text would lose. Plain wrappers (div/span/p/br) alone are not "rich".
const STRUCTURE =
  "h1,h2,h3,h4,h5,h6,ul,ol,li,table,blockquote,pre,strong,b,em,i,a[href],del,s,code,img,details,sub,sup,kbd,mark,u,ins," +
  "[data-md-list],[data-md-math],[data-md-footnote-ref],[data-md-callout],[data-md-taskline],[data-md-task]";

let service: ReturnType<typeof createMarkdownService> | null = null;

/** The tool the paste most likely came from, for messages (Outlook before the Word HTML it is built on). */
const primarySource = (sources: ImportSource[]): ImportSource => sources.find((source) => source !== "word") ?? sources[0] ?? "generic";

/**
 * Converts clipboard HTML to Markdown, with a list of what was changed. `markdown` is null when the HTML adds nothing
 * over plain text (or is unusable), so the caller can fall back to the normal paste.
 */
export function importHtml(html: string): ImportResult {
  const empty: ImportResult = { markdown: null, sources: [], notices: [] };
  if (!html) return empty;
  if (html.length > MAX_HTML_CHARS) {
    return { ...empty, notices: [`the pasted HTML is over ${MAX_HTML_CHARS / 1_000_000} MB, so it was pasted as plain text and its headings, tables and links were not converted`] };
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sources = detectSources(html);
    const notices: string[] = [];
    tableReport.pipe = 0;
    tableReport.html = 0;

    normalizeDocument(doc);
    adaptDocument(doc, { sources, notices });
    if (!doc.body.querySelector(STRUCTURE)) return { ...empty, sources, notices };

    service ??= createMarkdownService();
    const markdown = service
      .turndown(doc.body)
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (tableReport.pipe + tableReport.html > 0) {
      const kept = tableReport.html ? `, ${tableReport.html} kept as HTML because Markdown cannot hold merged cells, lists or code in cells` : "";
      notices.unshift(`converted ${plural(tableReport.pipe + tableReport.html, "table")}${kept}`);
    }
    return { markdown: markdown || null, sources, notices };
  } catch {
    return empty;
  }
}

export function htmlToMarkdown(html: string): string | null {
  return importHtml(html).markdown;
}

export const PASTE_MODES = ["auto", "markdown", "rich", "plain"] as const;
export type PasteMode = (typeof PASTE_MODES)[number];
export const PASTE_MODE_LABELS: Record<PasteMode, string> = {
  auto: "Paste: Auto",
  markdown: "Paste: Markdown",
  rich: "Paste: Rich text",
  plain: "Paste: Plain",
};
export const isPasteMode = (value: unknown): value is PasteMode => PASTE_MODES.includes(value as PasteMode);

const FENCE = /^ {0,3}(```|~~~)/m;
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+\S/m;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/m;

/** True when plain text already carries Markdown syntax that rich conversion would only damage. */
export function looksLikeMarkdown(text: string): boolean {
  return ATX_HEADING.test(text) || FENCE.test(text) || TABLE_RULE.test(text);
}

export type PasteOutcome = { markdown: string | null; message: string | null };

const describe = (sources: ImportSource[], notices: string[]) => {
  const source = primarySource(sources);
  const lead = source === "generic" ? "Pasted formatted text as Markdown" : `Pasted from ${SOURCE_LABELS[source]} as Markdown`;
  return `${lead}${notices.length ? `: ${notices.join("; ")}` : ""} (Ctrl+Shift+V pastes plain text)`;
};

/**
 * Decides what a paste inserts and what to tell the user. `markdown` replaces the default paste; null lets the
 * browser paste the clipboard's plain text unchanged. `message` is set whenever the paste was transformed or could not be.
 */
export function resolvePasteDetailed(mode: PasteMode, html: string, text: string): PasteOutcome {
  if (mode === "plain") return { markdown: null, message: null };
  const markdownText = looksLikeMarkdown(text);
  const plainOptions = { hasStyleTag: /<style[\s>]/i.test(html), looksLikeDocument: looksLikeMarkdown };

  // Markdown text without any fence next to HTML that has real code blocks: the HTML still knows where the code was.
  if (mode === "auto" && markdownText && !FENCE.test(text) && /<pre[\s>]/i.test(html) && /<(h[1-6]|p|li|blockquote)[\s>]/i.test(html)) {
    const fromHtml = importHtml(html);
    if (fromHtml.markdown && FENCE.test(fromHtml.markdown)) return { markdown: fromHtml.markdown, message: describe(fromHtml.sources, fromHtml.notices) };
  }

  // Text copied from a code block, chat or docs page arrives as <pre> HTML plus the raw Markdown as plain text.
  if (mode === "markdown" || (mode === "auto" && markdownText)) {
    const cleaned = normalizePlainText(text, plainOptions);
    return cleaned.changed ? { markdown: cleaned.text, message: `Pasted as Markdown: ${cleaned.notices.join("; ")} (Ctrl+Shift+V pastes plain text)` } : { markdown: null, message: null };
  }

  const imported = importHtml(html);
  if (imported.markdown) {
    // HTML whose code lines were plain blocks converts to fence-less Markdown; restore the fences the same way.
    const restored = !FENCE.test(imported.markdown) && looksLikeMarkdown(imported.markdown) ? fenceLostCodeBlocks(imported.markdown) : null;
    if (restored?.changed) return { markdown: restored.text, message: describe(imported.sources, [...imported.notices, ...restored.notices]) };
    return { markdown: imported.markdown, message: describe(imported.sources, imported.notices) };
  }

  // No usable HTML: the plain-text flavour may still be a spreadsheet, a ruled table or a chat transcript.
  const plain = normalizePlainText(text, plainOptions);
  const notices = [...imported.notices, ...plain.notices];
  if (plain.changed) return { markdown: plain.text, message: `Pasted as Markdown: ${notices.join("; ")} (Ctrl+Shift+V pastes plain text)` };
  return { markdown: null, message: notices.length ? `Pasted as plain text: ${notices.join("; ")}` : null };
}

export function resolvePaste(mode: PasteMode, html: string, text: string): string | null {
  return resolvePasteDetailed(mode, html, text).markdown;
}
