import katex from "katex";
import emojiMap from "./emoji-map.json";

/**
 * Markdown features marked does not have: footnotes, definition lists, math and emoji shortcodes. They are expanded
 * to the same raw-HTML shapes the server-side renderer (backend/app/services/doc_tree.py) produces, so Preview and
 * the exports read one vocabulary. The grammar mirrors markdown-it's footnote/deflist/dollarmath plugins.
 */

const FENCE = /^ {0,3}(```|~~~)/;
const CODE_SPAN = /(`+)[\s\S]*?\1/g;
const WORD_ID = /[^A-Za-z0-9_-]/g;

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Applies `transform` to every stretch outside fenced code; fenced lines pass through untouched. */
function outsideFences(markdown: string, transform: (segment: string) => string): string {
  const out: string[] = [];
  let segment: string[] = [];
  let inFence = false;
  const flush = () => {
    if (segment.length === 0) return;
    const text = segment.join("\n");
    out.push(inFence ? text : transform(text));
    segment = [];
  };
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      flush();
      out.push(line);
      inFence = !inFence;
    } else {
      segment.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/** Applies `transform` to text outside inline code spans. */
function outsideCodeSpans(text: string, transform: (plain: string) => string): string {
  let result = "";
  let last = 0;
  for (const span of text.matchAll(CODE_SPAN)) {
    result += transform(text.slice(last, span.index)) + span[0];
    last = (span.index ?? 0) + span[0].length;
  }
  return result + transform(text.slice(last));
}

// ---------------------------------------------------------------- math

export function renderMath(tex: string, display: boolean): string {
  const source = tex.trim();
  let body: string;
  try {
    body = katex.renderToString(source, { output: "mathml", displayMode: display, throwOnError: false, strict: "ignore" });
  } catch {
    body = `<code>${escapeHtml(source)}</code>`;
  }
  const tag = display ? "div" : "span";
  return `<${tag} class="math ${display ? "math-block" : "math-inline"}" data-tex="${escapeHtml(source)}">${body}</${tag}>`;
}

const isDigit = (char: string | undefined) => char !== undefined && /\d/.test(char);
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isEscaped = (text: string, index: number) => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) backslashes += 1;
  return backslashes % 2 === 1;
};

/** `$x$` with markdown-it-dollarmath's settings (no space inside the delimiters, no digit outside them). */
function inlineDollarMath(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char !== "$" || isSpace(text[index + 1]) || isDigit(text[index - 1]) || isEscaped(text, index) || text[index + 1] === "$") {
      out += char;
      index += 1;
      continue;
    }
    let end = index + 1;
    for (;;) {
      end = text.indexOf("$", end);
      if (end < 0 || !isEscaped(text, end)) break;
      end += 1;
    }
    if (end < 0 || isSpace(text[end - 1]) || isDigit(text[end + 1]) || end === index + 1) {
      out += char;
      index += 1;
      continue;
    }
    out += renderMath(text.slice(index + 1, end), false);
    index = end + 1;
  }
  return out;
}

function mathSegment(segment: string): string {
  // `\[x\]` and `\(x\)` are rewritten first, exactly as the server does, so one grammar covers all notations.
  const lines = outsideCodeSpans(segment, (plain) =>
    plain.replace(/\\\[([\s\S]+?)\\\]/g, (_all, tex: string) => `\n$$\n${tex.trim()}\n$$\n`).replace(/\\\((.+?)\\\)/g, (_all, tex: string) => `$${tex.trim()}$`),
  ).split("\n");

  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const open = /^ {0,3}\$\$(.*)$/.exec(line);
    if (open) {
      const first = open[1];
      const closeSameLine = first.lastIndexOf("$$");
      if (closeSameLine >= 0) {
        out.push("", renderMath(first.slice(0, closeSameLine), true), "");
        continue;
      }
      const body = [first];
      let closed = false;
      for (let j = i + 1; j < lines.length; j += 1) {
        const close = lines[j].indexOf("$$");
        if (close >= 0) {
          body.push(lines[j].slice(0, close));
          i = j;
          closed = true;
          break;
        }
        body.push(lines[j]);
      }
      if (closed) {
        out.push("", renderMath(body.join("\n"), true), "");
        continue;
      }
    }
    out.push(outsideCodeSpans(line, inlineDollarMath));
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- definition lists

const DEFINITION = /^ {0,3}[:~][ \t]+(.*)$/;

function definitionLists(segment: string, inline: (text: string) => string, block: (text: string) => string): string {
  const lines = segment.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const startsBlock = i === 0 || lines[i - 1].trim() === "";
    let probe = i;
    while (startsBlock && probe < lines.length && lines[probe].trim() !== "" && !DEFINITION.test(lines[probe])) probe += 1;
    if (!startsBlock || probe === i || probe >= lines.length || !DEFINITION.test(lines[probe])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    const items: string[] = [];
    let cursor = i;
    for (;;) {
      const terms: string[] = [];
      while (cursor < lines.length && lines[cursor].trim() !== "" && !DEFINITION.test(lines[cursor])) terms.push(lines[cursor++]);
      if (terms.length === 0 || cursor >= lines.length || !DEFINITION.test(lines[cursor])) break;
      terms.forEach((term) => items.push(`<dt>${inline(term.trim())}</dt>`));
      while (cursor < lines.length && DEFINITION.test(lines[cursor])) {
        const body = [DEFINITION.exec(lines[cursor])![1]];
        cursor += 1;
        while (cursor < lines.length && (/^(?: {2,}|\t)\S/.test(lines[cursor]) || (lines[cursor].trim() === "" && /^(?: {2,}|\t)\S/.test(lines[cursor + 1] ?? "")))) {
          body.push(lines[cursor].replace(/^(?: {1,4}|\t)/, ""));
          cursor += 1;
        }
        const loose = body.some((line) => line.trim() === "");
        const html = block(body.join("\n"));
        items.push(`<dd>${loose ? html : html.replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1")}</dd>`);
      }
      if (cursor < lines.length && lines[cursor].trim() === "" && cursor + 1 < lines.length) {
        let next = cursor + 1;
        while (next < lines.length && lines[next].trim() !== "" && !DEFINITION.test(lines[next])) next += 1;
        if (next < lines.length && DEFINITION.test(lines[next])) {
          cursor += 1;
          continue;
        }
      }
      break;
    }
    out.push("", `<dl>${items.join("")}</dl>`, "");
    i = cursor;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- footnotes

type Footnote = { label: string; id: string; body: string };

const FOOTNOTE_DEFINITION = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;

function extractFootnotes(segment: string): { text: string; notes: Footnote[] } {
  const lines = segment.split("\n");
  const kept: string[] = [];
  const notes: Footnote[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = FOOTNOTE_DEFINITION.exec(lines[i]);
    if (!match) {
      kept.push(lines[i]);
      continue;
    }
    const body = [match[2]];
    while (i + 1 < lines.length && (/^(?: {4}|\t)\S/.test(lines[i + 1]) || (lines[i + 1].trim() === "" && /^(?: {4}|\t)\S/.test(lines[i + 2] ?? "")))) {
      i += 1;
      body.push(lines[i].replace(/^(?: {4}|\t)/, ""));
    }
    notes.push({ label: match[1], id: `${match[1].replace(WORD_ID, "-")}`, body: body.join("\n") });
  }
  return { text: kept.join("\n"), notes };
}

// ---------------------------------------------------------------- entry points

export type ExtensionRenderers = {
  inline: (markdown: string) => string;
  block: (markdown: string) => string;
};

/** Expands footnotes, definition lists and math in Markdown source (code is left alone). */
export function expandMarkdownExtensions(markdown: string, render: ExtensionRenderers): string {
  const notes: Footnote[] = [];
  let source = outsideFences(markdown, (segment) => {
    const extracted = extractFootnotes(segment);
    notes.push(...extracted.notes);
    return extracted.text;
  });

  source = outsideFences(source, (segment) => mathSegment(definitionLists(segment, render.inline, render.block)));

  if (notes.length === 0) return source;

  const numbers = new Map(notes.map((note, index) => [note.label, index + 1]));
  source = outsideFences(source, (segment) =>
    outsideCodeSpans(segment, (plain) =>
      plain.replace(/\[\^([^\]\s]+)\]/g, (all, label: string) => {
        const number = numbers.get(label);
        const id = label.replace(WORD_ID, "-");
        return number ? `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}">${number}</a></sup>` : all;
      }),
    ),
  );

  const items = notes
    .map((note) => {
      const html = render.block(note.body).trimEnd();
      const backref = `<a href="#fnref-${note.id}" class="footnote-backref">\u21a9</a>`;
      const withBackref = html.endsWith("</p>") ? `${html.slice(0, -4)} ${backref}</p>` : `${html}${backref}`;
      return `<li id="fn-${note.id}">${withBackref}</li>`;
    })
    .join("");
  return `${source}\n\n<section class="footnotes"><hr class="footnotes-sep"><ol>${items}</ol></section>\n`;
}

const EMOJI = /:([a-z0-9_+-]+):/g;
const EMOJI_MAP = emojiMap as Record<string, string>;

/** Replaces `:rocket:` style shortcodes in plain text (never in code). */
export function replaceEmoji(text: string): string {
  return text.includes(":") ? text.replace(EMOJI, (all, name: string) => EMOJI_MAP[name] ?? all) : text;
}
