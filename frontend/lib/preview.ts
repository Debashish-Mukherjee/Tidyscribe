import { Marked } from "marked";
import { fenceAsciiDiagrams } from "./markdown";
import { expandMarkdownExtensions, replaceEmoji } from "./markdown-ext";
import { sanitizeHtml, type SafeHtml } from "./sanitize";

// A private instance: the global `marked` is shared with the rich editor, which expects marked's default <input> checkboxes.
const previewMarked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Form controls are forbidden in the preview, so task items get an inert, accessible stand-in.
    checkbox({ checked }) {
      return `<span class="md-task" role="checkbox" aria-checked="${checked}" aria-disabled="true" aria-label="${checked ? "Completed" : "Not completed"}"></span> `;
    },
  },
  walkTokens(token) {
    if (token.type === "text") token.text = replaceEmoji(token.text);
  },
});

const parseBlock = (markdown: string): string => previewMarked.parse(expandMarkdownExtensions(markdown, extensionRenderers), { async: false }) as string;
const parseInline = (markdown: string): string => parseBlock(markdown).replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1");
const extensionRenderers = { block: parseBlock, inline: parseInline };

const CALLOUT = /<blockquote>\s*<p>\[!(WARNING|TIP|NOTE|IMPORTANT|CAUTION)\](?:<br>|\s)*/g;
const MERMAID_BLOCK = /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g;
const AUTO_DIRECTION = /<(p|h[1-6]|li|td|th|dt|dd|blockquote)(\s|>)/g;

export type PreviewResult = { ok: true; html: SafeHtml; blocked: string[] } | { ok: false; error: string };

const EMPTY_PREVIEW = "<p>Start pasting content to preview it here.</p>";

/** Markdown to sanitised HTML. Never throws: a failure becomes `{ ok: false }` so the caller can keep the source usable. */
export function renderPreview(markdown: string): PreviewResult {
  try {
    if (!markdown.trim()) return { ok: true, ...sanitizeHtml(EMPTY_PREVIEW) };

    const rendered = parseBlock(fenceAsciiDiagrams(markdown))
      .replace(CALLOUT, (_, kind: string) => {
        const label = kind.charAt(0) + kind.slice(1).toLowerCase();
        const name = kind.toLowerCase();
        return `<blockquote class="callout callout-${name}" data-callout="${name}"><p><strong>${label}</strong><br>`;
      })
      .replace(MERMAID_BLOCK, (_, source: string) => `<div class="mermaid">${source}</div>`)
      // Direction follows each block's own first strong character, so Arabic and Hebrew paragraphs lay out right to left.
      .replace(AUTO_DIRECTION, '<$1 dir="auto"$2');

    return { ok: true, ...sanitizeHtml(rendered) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
