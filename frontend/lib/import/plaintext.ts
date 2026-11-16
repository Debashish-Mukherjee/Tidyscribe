import { plural } from "./types";

const LANGUAGES = new Set(
  "python javascript typescript json yaml yml bash shell sh sql html css java c c++ c# csharp cpp go golang rust ruby php xml markdown text plaintext plain powershell terraform hcl dockerfile kotlin swift scala r perl lua ini toml diff graphql mermaid jsx tsx http console".split(" "),
);

const CHROME = /^(copy( code)?|expand|collapse|show more|show less)$/i;
const ASSISTANT_LABEL = /^(ChatGPT said|Claude responded|Gemini said|Copilot said|Assistant)\s*:?\s*$/i;
const USER_LABEL = /^(You said|You|User|Human)\s*:\s*$/i;
const INLINE_ASSISTANT = /^(ChatGPT said|Claude responded|Gemini said|Copilot said)\s*:\s+(?=\S)/i;

export type PlainResult = { text: string; notices: string[]; changed: boolean };

function isLanguageLine(line: string) {
  return LANGUAGES.has(line.trim().toLowerCase());
}

/** Chat tools' plain-text "copy" keeps their UI: speaker labels, "Copy code" bars and language captions. */
export function cleanChatChrome(input: string): PlainResult {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const notices: string[] = [];
  const out: string[] = [];
  let inFence = false;
  let barLines = 0;
  let fenced = 0;

  const hasUser = lines.some((line) => USER_LABEL.test(line.trim()));
  const hasAssistant = lines.some((line) => ASSISTANT_LABEL.test(line.trim()) && !/^assistant$/i.test(line.trim()));
  const transcript = hasUser && hasAssistant;
  let removedLabels = 0;
  let relabelled = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    // "python" followed by "Copy code": the language caption and the button of a code bar. The code under it lost its
    // fences in the plain-text copy, so it is fenced again up to the first blank line that is not followed by indented code.
    if (isLanguageLine(trimmed) && CHROME.test((lines[i + 1] ?? "").trim())) {
      const language = trimmed.toLowerCase();
      i += 1;
      while (CHROME.test((lines[i + 1] ?? "").trim())) i += 1;
      const code: string[] = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (next.trim() === "" && !/^[ \t]+\S/.test(lines[i + 2] ?? "")) break;
        code.push(next);
        i += 1;
      }
      if (code.some((line) => line.trim() !== "")) {
        out.push(`\`\`\`${language === "plain" || language === "plaintext" ? "text" : language}`, ...code, "```");
        fenced += 1;
      }
      barLines += 1;
      continue;
    }
    if (/^copy( code)?$/i.test(trimmed)) {
      barLines += 1;
      continue;
    }

    if (transcript && (USER_LABEL.test(trimmed) || ASSISTANT_LABEL.test(trimmed))) {
      const who = USER_LABEL.test(trimmed) ? "You" : trimmed.replace(/\s*(said|responded)\s*:?\s*$/i, "").trim() || "Assistant";
      out.push(`**${who}:**`);
      relabelled += 1;
      continue;
    }
    if (!transcript && ASSISTANT_LABEL.test(trimmed)) {
      removedLabels += 1;
      continue;
    }
    if (!transcript && INLINE_ASSISTANT.test(trimmed)) {
      out.push(line.replace(INLINE_ASSISTANT, ""));
      removedLabels += 1;
      continue;
    }
    out.push(line);
  }

  if (barLines) notices.push(`removed ${plural(barLines, "Copy-code bar")}`);
  if (fenced) notices.push(`fenced ${plural(fenced, "code block")} again`);
  if (removedLabels) notices.push(`removed ${plural(removedLabels, "speaker label")}`);
  if (relabelled) notices.push(`kept ${plural(relabelled, "chat turn")} as bold speaker labels`);
  const text = out.join("\n").replace(/^\n+/, "");
  return { text, notices, changed: notices.length > 0 };
}

// ---------------------------------------------------------------- tables

const escapeCell = (value: string) => value.trim().replace(/\|/g, "\\|");

function pipeTable(rows: string[][]): string {
  const columns = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => [...row, ...Array(columns - row.length).fill("")]);
  const line = (cells: string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(padded[0]), `| ${Array(columns).fill("---").join(" | ")} |`, ...padded.slice(1).map(line)].join("\n");
}

const DASH_RULE = /^\s*-{2,}(?:[ \t]+-{2,})+\s*$/;
const PSQL_RULE = /^[-+ ]*\+[-+ ]*$/;

/** Tab-indented code has the same tab count on every line; a table has text before the first tab and a full header. */
function looksTabular(block: string[]): boolean {
  const header = block[0].split("\t");
  return header.every((cell) => cell.trim() !== "") && block.every((line) => !line.startsWith("\t") && !line.startsWith(" ") && line.split("\t")[0].trim() !== "");
}

/** Turns tab-separated blocks (Excel, Sheets) and ruled plain-text tables into pipe tables. */
export function plainTablesToMarkdown(input: string): PlainResult {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let tables = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; ) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) {
      out.push(lines[i]);
      i += 1;
      continue;
    }

    // Tab separated: two or more consecutive lines with the same number of tabs.
    const tabs = (lines[i].match(/\t/g) ?? []).length;
    if (tabs > 0 && lines[i].trim() !== "") {
      let end = i;
      while (end < lines.length && lines[end].trim() !== "" && (lines[end].match(/\t/g) ?? []).length === tabs) end += 1;
      if (end - i >= 2 && looksTabular(lines.slice(i, end))) {
        out.push(pipeTable(lines.slice(i, end).map((line) => line.split("\t"))), "");
        tables += 1;
        i = end;
        continue;
      }
    }

    // Header, then a rule of dashes that marks the columns.
    const rule = lines[i + 1];
    if (rule !== undefined && lines[i].trim() !== "" && !DASH_RULE.test(lines[i]) && (DASH_RULE.test(rule) || (PSQL_RULE.test(rule) && lines[i].includes("|")))) {
      let end = i + 2;
      while (end < lines.length && lines[end].trim() !== "") end += 1;
      if (end - i >= 3) {
        const block = lines.slice(i, end);
        let rows: string[][];
        if (DASH_RULE.test(rule)) {
          const spans = Array.from(rule.matchAll(/-{2,}/g)).map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length] as const);
          rows = [block[0], ...block.slice(2)].map((line) => spans.map(([start], column) => line.slice(start, column === spans.length - 1 ? undefined : spans[column + 1][0]).trim()));
        } else {
          rows = [block[0], ...block.slice(2)].map((line) => line.split("|").map((cell) => cell.trim()));
        }
        out.push(pipeTable(rows), "");
        tables += 1;
        i = end;
        continue;
      }
    }

    out.push(lines[i]);
    i += 1;
  }

  const notices = tables ? [`converted ${plural(tables, "plain-text table")} to Markdown`] : [];
  return { text: tables ? out.join("\n").replace(/\n+$/, input.endsWith("\n") ? "\n" : "") : input, notices, changed: tables > 0 };
}

// ---------------------------------------------------------------- leaked CSS, bare diagrams and JSON

const CSS_RULE = /^\s*[^{}\n]{1,200}\{\s*(?:[a-z-]+\s*:[^;{}]+;?\s*)+\}[ \t]*(?:\n|$)/i;

/** A page's `<style>` text lands before the content in the plain-text copy; it is removed only when real content follows. */
export function stripLeakedCss(text: string, hasStyleTag: boolean, looksLikeDocument: (rest: string) => boolean): PlainResult {
  let rest = text.replace(/\r\n/g, "\n");
  let rules = 0;
  for (let match = CSS_RULE.exec(rest); match; match = CSS_RULE.exec(rest)) {
    rest = rest.slice(match[0].length);
    rules += 1;
  }
  rest = rest.replace(/^\n+/, "");
  if (!rules || !rest.trim() || !(hasStyleTag || looksLikeDocument(rest))) return { text, notices: [], changed: false };
  return { text: rest, notices: [`removed ${plural(rules, "leaked CSS rule")}`], changed: true };
}

const CONNECTOR_ONLY = /^\s*[|│┃↓↑▼▲⬇⬆]\s*$/;
const BRANCH = /^\s*(?:\+-{2,}|[└├╰]─+)/;

/** Fences runs of lines that are flow drawings (arrows down, `+-->` branches) whose layout a Markdown paragraph would destroy. */
export function fenceTextDiagrams(input: string): PlainResult {
  const lines = input.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenced = 0;

  for (let i = 0; i < lines.length; ) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence || lines[i].trim() === "" || /^\s*(```|~~~)/.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].trim() !== "" && !/^\s*(```|~~~)/.test(lines[end])) end += 1;
    const block = lines.slice(i, end);
    const connectors = block.filter((line) => CONNECTOR_ONLY.test(line)).length;
    const branches = block.filter((line) => BRANCH.test(line)).length;
    const markdownRows = block.some((line) => /^\s*(?:[-*+]\s|\d+[.)]\s|>|#|\|.*\|\s*$)/.test(line) && !BRANCH.test(line));
    if (!markdownRows && ((connectors > 0 && block.length >= 3) || (branches > 0 && block.length >= 2))) {
      out.push("```text", ...block, "```");
      fenced += 1;
    } else {
      out.push(...block);
    }
    i = end;
  }
  return { text: fenced ? out.join("\n") : input, notices: fenced ? [`fenced ${plural(fenced, "flow diagram")}`] : [], changed: fenced > 0 };
}

/** A `{ ... }` object left bare (its fence was lost in the copy) is fenced as JSON. */
export function fenceBareJson(input: string): PlainResult {
  const lines = input.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenced = 0;

  for (let i = 0; i < lines.length; ) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (!inFence && /^\s*[{[]\s*$/.test(lines[i])) {
      const indent = /^\s*/.exec(lines[i])![0];
      const close = lines[i].includes("{") ? "}" : "]";
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== "" && lines[end].replace(/,\s*$/, "") !== indent + close) end += 1;
      const block = lines.slice(i, end + 1);
      if (end < lines.length && lines[end].replace(/,\s*$/, "") === indent + close && block.length >= 3 && block.some((line) => /^\s*"[^"]+"\s*:/.test(line))) {
        out.push("```json", ...block, "```");
        fenced += 1;
        i = end + 1;
        continue;
      }
    }
    out.push(lines[i]);
    i += 1;
  }
  return { text: fenced ? out.join("\n") : input, notices: fenced ? [`fenced ${plural(fenced, "JSON block")}`] : [], changed: fenced > 0 };
}

// A copy that kept headings and **bold** but dropped every code fence leaves each code block as bare short lines.
const MD_SYNTAX = /^\s*(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s|\||<\w|[-*_]{3,}\s*$|\[[^\]]*\]:|!\[)/;
const INLINE_MD = /\*\*|__|`|\[[^\]]*\]\([^)]*\)/;
const isCodeLine = (line: string) => {
  const t = line.trim();
  return t.length > 0 && t.length <= 60 && !/[.:;,?!]$/.test(t) && !MD_SYNTAX.test(line) && !INLINE_MD.test(t);
};
const CONNECTIVE = /^(and|or|but|not|plus|then|so|else)$/i;
const FLOW_ARROW = /->|=>|→/;
// Lines of a drawing or JSON object that isCodeLine would reject: `|`, `+--`, long arrow chains, `"key": 1,`.
const isLooseCodeLine = (line: string) => {
  const t = line.trim();
  if (t === "" || INLINE_MD.test(t) || CONNECTIVE.test(t)) return false;
  if (CONNECTOR_ONLY.test(line) || BRANCH.test(line)) return true;
  if (FLOW_ARROW.test(t) && t.length <= 120 && !/[.:;?!]$/.test(t) && !/^[-*+>#]\s/.test(t)) return true;
  if (/^"[^"]*"\s*:/.test(t) && t.length <= 120) return true;
  return isCodeLine(line);
};
const TITLE_CASE = (t: string) => {
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 6 && words.every((word) => /^\(?[A-Z]/.test(word));
};
const codeish = (t: string) => /[_/%]|\w\(|[a-z][A-Z]/.test(t) || TITLE_CASE(t.trim());

/** Some copies put every line, code lines included, in its own paragraph: nearly all blank-separated blocks are one line. */
function isDoubleSpaced(lines: string[]): boolean {
  let blocks = 0;
  let single = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; ) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence || lines[i].trim() === "") {
      i += 1;
      continue;
    }
    let end = i;
    while (end < lines.length && lines[end].trim() !== "") end += 1;
    blocks += 1;
    if (end - i === 1) single += 1;
    i = end;
  }
  return blocks >= 8 && single / blocks >= 0.9;
}

const looksLikeJson = (block: string[]) => /^\s*[{[]\s*$/.test(block[0]) && /^\s*[}\]],?\s*$/.test(block[block.length - 1]) && block.some((line) => /^\s*"[^"]+"\s*:/.test(line));

export function fenceLostCodeBlocks(input: string): PlainResult {
  const lines = input.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenced = 0;
  const doubled = isDoubleSpaced(lines);

  const isCodeBlock = (block: string[], inRun: boolean) =>
    doubled ? block.every(isLooseCodeLine) || (inRun && block.length === 1 && CONNECTIVE.test(block[0].trim())) : block.every(isCodeLine) && (block.length >= 2 || codeish(block[0]));

  for (let i = 0; i < lines.length; ) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence || lines[i].trim() === "" || /^\s*(```|~~~)/.test(lines[i])) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    // Paragraph-sized blocks, joined into one fence when only a single blank line separates code-like blocks.
    const group: string[] = [];
    let blocks = 0;
    let previousGap = 1;
    let cursor = i;
    let groupEnd = i;
    let lastBlockStart = 0;
    let beforeLast = i;
    for (;;) {
      let end = cursor;
      while (end < lines.length && lines[end].trim() !== "" && !/^\s*(```|~~~)/.test(lines[end])) end += 1;
      const block = lines.slice(cursor, end);
      if (!block.length || !isCodeBlock(block, group.length > 0)) break;
      // Double-spaced copies separate code lines by one blank line, and a real blank line by three.
      let gap = 0;
      while (lines[end + gap] !== undefined && lines[end + gap].trim() === "") gap += 1;
      if (group.length) group.push(...Array(doubled ? (previousGap - 1) / 2 : 1).fill(""));
      lastBlockStart = group.length;
      beforeLast = groupEnd;
      group.push(...block);
      blocks += 1;
      groupEnd = end;
      previousGap = gap;
      if (!(gap === 1 || (doubled && gap === 3))) break;
      cursor = end + gap;
    }
    // A run never ends on a connective word ("but", "and"): that belongs to the prose after it.
    if (doubled && blocks > 1 && group.length > lastBlockStart && CONNECTIVE.test(group[group.length - 1].trim()) && lastBlockStart === group.length - 1) {
      group.length = lastBlockStart;
      while (group.length && group[group.length - 1] === "") group.pop();
      blocks -= 1;
      groupEnd = beforeLast;
    }
    // A lone one-line block still has to look like code; several in a row (double-spaced copies) are enough.
    const accepted = group.length > 0 && (blocks > 1 || group.length > 1 || codeish(group[0]));
    if (accepted) {
      out.push(looksLikeJson(group) ? "```json" : "```text", ...group, "```");
      fenced += 1;
      i = groupEnd;
    } else {
      let end = i;
      while (end < lines.length && lines[end].trim() !== "" && !/^\s*(```|~~~)/.test(lines[end])) end += 1;
      out.push(...lines.slice(i, end));
      i = end;
    }
  }
  return { text: fenced ? out.join("\n") : input, notices: fenced ? [`restored ${plural(fenced, "code block")} that lost their fences`] : [], changed: fenced > 0 };
}

/** Everything the plain-text flavour of a paste gets: leaked CSS and chat chrome out, diagrams fenced, text tables in. */
export function normalizePlainText(text: string, options: { hasStyleTag?: boolean; looksLikeDocument?: (rest: string) => boolean } = {}): PlainResult {
  const css = stripLeakedCss(text, options.hasStyleTag ?? false, options.looksLikeDocument ?? (() => false));
  const chat = cleanChatChrome(css.text);
  const unfenced = !/^\s*(```|~~~)/m.test(chat.text) && (options.looksLikeDocument?.(chat.text) ?? false);
  const diagrams = fenceTextDiagrams(chat.text);
  const json = fenceBareJson(diagrams.text);
  const lost = unfenced ? fenceLostCodeBlocks(json.text) : { text: json.text, notices: [], changed: false };
  const tables = plainTablesToMarkdown(lost.text);
  const steps = [css, chat, diagrams, json, lost, tables];
  return { text: tables.text, notices: steps.flatMap((step) => step.notices), changed: steps.some((step) => step.changed) };
}
