import type TurndownService from "turndown";

/** Where a conversion reports what it did; reset by the caller for each paste. */
export const tableReport = { pipe: 0, html: 0 };

const SAFE_LINK = /^(https?:|mailto:|tel:)/i;
const BLOCK_IN_CELL = "ul, ol, pre, table, blockquote, h1, h2, h3, h4, h5, h6, hr, details, dl";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (value: string) => escapeHtml(value).replace(/"/g, "&quot;");

function ownRows(table: Element): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = [];
  Array.from(table.children).forEach((child) => {
    if (child.tagName === "TR") rows.push(child as HTMLTableRowElement);
    else if (["THEAD", "TBODY", "TFOOT"].includes(child.tagName)) rows.push(...(Array.from(child.children).filter((row) => row.tagName === "TR") as HTMLTableRowElement[]));
  });
  return rows;
}

const cellsOf = (row: Element) => Array.from(row.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH") as HTMLTableCellElement[];
const span = (cell: Element, name: "colspan" | "rowspan") => Math.max(1, Math.min(parseInt(cell.getAttribute(name) ?? "1", 10) || 1, 200));

/** A pipe table cannot hold merged cells, lists, code blocks, quotes or nested tables. */
function needsHtml(rows: HTMLTableRowElement[]): boolean {
  return rows.some((row) => cellsOf(row).some((cell) => span(cell, "colspan") > 1 || span(cell, "rowspan") > 1 || cell.querySelector(BLOCK_IN_CELL) !== null));
}

function alignment(cell: Element | undefined): string {
  const value = (cell?.getAttribute("align") ?? /text-align\s*:\s*(left|right|center)/i.exec(cell?.getAttribute("style") ?? "")?.[1] ?? "").toLowerCase();
  return value === "center" ? ":---:" : value === "right" ? "---:" : value === "left" ? ":---" : "---";
}

// ---------------------------------------------------------------- HTML fallback

const INLINE_RENAMES: Record<string, string> = { b: "strong", strong: "strong", i: "em", em: "em", del: "del", s: "del", strike: "del", code: "code", kbd: "kbd", sub: "sub", sup: "sup", mark: "mark", u: "u", ins: "u" };

/** Serialises cell content to the HTML subset the whole product accepts (see html_policy.py), on one line. */
function serialize(node: Node, inPre = false): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? "";
    return inPre ? escapeHtml(value).replace(/\r?\n/g, "&#10;") : escapeHtml(value.replace(/\s+/g, " "));
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const children = () => Array.from(element.childNodes).map((child) => serialize(child, inPre)).join("");
  if (tag === "br") return "<br>";
  if (INLINE_RENAMES[tag]) return `<${INLINE_RENAMES[tag]}>${children()}</${INLINE_RENAMES[tag]}>`;
  if (tag === "a") {
    const href = element.getAttribute("href") ?? "";
    return SAFE_LINK.test(href) ? `<a href="${escapeAttribute(href)}">${children()}</a>` : children();
  }
  if (tag === "ul" || tag === "ol" || tag === "li" || tag === "p") return `<${tag}>${children()}</${tag}>`;
  if (tag === "pre") return `<pre>${serialize(element.firstElementChild?.tagName === "CODE" ? element.firstElementChild : element, true)}</pre>`;
  if (tag === "table") return serializeTable(element);
  if (tag === "img") {
    const alt = element.getAttribute("alt");
    return alt ? escapeHtml(alt) : "";
  }
  return children();
}

function serializeTable(table: Element): string {
  const parts: string[] = ["<table>"];
  const caption = table.querySelector(":scope > caption");
  if (caption?.textContent?.trim()) parts.push(`<caption>${escapeHtml(caption.textContent.trim())}</caption>`);
  const head: HTMLTableRowElement[] = [];
  const body: HTMLTableRowElement[] = [];
  ownRows(table).forEach((row) => (row.parentElement?.tagName === "THEAD" ? head : body).push(row));
  const emit = (rows: HTMLTableRowElement[], section: string) => {
    if (rows.length === 0) return;
    parts.push(`<${section}>`);
    rows.forEach((row) => {
      parts.push("<tr>");
      cellsOf(row).forEach((cell) => {
        const tag = cell.tagName.toLowerCase();
        const attrs = (["colspan", "rowspan"] as const).filter((name) => span(cell, name) > 1).map((name) => ` ${name}="${span(cell, name)}"`).join("");
        parts.push(`<${tag}${attrs}>${Array.from(cell.childNodes).map((child) => serialize(child)).join("").trim()}</${tag}>`);
      });
      parts.push("</tr>");
    });
    parts.push(`</${section}>`);
  };
  emit(head, "thead");
  emit(body, "tbody");
  parts.push("</table>");
  return parts.join("");
}

// ---------------------------------------------------------------- Markdown

/** Converts an HTML table to a Markdown pipe table, or keeps it as HTML when Markdown cannot express it. */
export function convertTable(table: HTMLElement, service: TurndownService): string {
  const rows = ownRows(table);
  if (rows.length === 0) return "";
  if (needsHtml(rows)) {
    tableReport.html += 1;
    return `\n\n${serializeTable(table)}\n\n`;
  }

  const inHead = rows.filter((row) => row.parentElement?.tagName === "THEAD");
  // The first row is the header either way: Markdown requires one, so a headerless table promotes its first row.
  const header = inHead[0] ?? rows[0];
  const body = rows.filter((row) => row !== header);
  const columns = Math.max(...rows.map((row) => cellsOf(row).length));

  const render = (row: HTMLTableRowElement) => {
    const cells = cellsOf(row).map((cell) =>
      service
        .turndown(cell)
        .replace(/\|/g, "\\|")
        .replace(/\n{1,}/g, "<br>")
        .trim(),
    );
    while (cells.length < columns) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };

  const aligns = Array.from({ length: columns }, (_unused, index) => alignment(cellsOf(header)[index]));
  tableReport.pipe += 1;
  return `\n\n${[render(header), `| ${aligns.join(" | ")} |`, ...body.map(render)].join("\n")}\n\n`;
}
