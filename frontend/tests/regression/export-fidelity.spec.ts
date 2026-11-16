import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FENCE,
  GITHUB_FLAVOURED_DOC,
  HOSTILE_HTML_DOC,
  MALFORMED_DOC,
  MATH_DOC,
  MIXED_HTML_DOC,
  NESTED_FENCE_DOC,
  UNICODE_DOC,
  bigDocument,
  bigTable,
  deeplyNestedList,
  flowchart,
} from "../support/corpus";
import { docxText, docxXml, exportViaApi, missingWords, pdfPageCount, pdfText } from "../support/app";

const ORDER_DOC = readFileSync(path.resolve(__dirname, "../../../backend/tests/fixtures/order_platform.md"), "utf8");

/** Code-fence info strings (```python) are metadata, not content, so they are not expected in the output. */
const withoutFenceLanguages = (markdown: string) => markdown.replace(/^(\s*(?:`{3,}|~{3,}))[\w+#.-]*\s*$/gm, "$1");
const compact = (text: string) => text.replace(/\s+/g, "");
/**
 * Words that exist only as syntax are rendered, not printed: tag names, TeX commands, emoji shortcode names and footnote
 * labels. The text inside tags and the rendered result are checked by the structure tests and by tests/e2e/fidelity.spec.ts.
 */
const withoutSyntaxWords = (markdown: string) =>
  markdown
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, " ")
    .replace(/:[a-z0-9_+-]+:/g, " ")
    .replace(/\[\^[^\]]+\]/g, " ");

const CORPUS: Array<{ name: string; markdown: string }> = [
  { name: "order platform fixture", markdown: ORDER_DOC },
  { name: "unicode / CJK / RTL / emoji", markdown: UNICODE_DOC },
  { name: "nested code fence", markdown: NESTED_FENCE_DOC },
  { name: "mixed markdown + html", markdown: MIXED_HTML_DOC },
  { name: "GFM extras", markdown: GITHUB_FLAVOURED_DOC },
  { name: "math", markdown: MATH_DOC },
  { name: "malformed markdown", markdown: MALFORMED_DOC },
  { name: "wide table 40 x 14", markdown: `# Wide\n\n${bigTable(40, 14)}` },
  { name: "deep list", markdown: `# Deep\n\n${deeplyNestedList(12)}` },
];

test.describe("export fidelity: source words must survive into every format", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const format of ["docx", "pdf", "html", "markdown"] as const) {
    for (const sample of CORPUS) {
      // pdftotext cannot reassemble a 14 column table whose cells wrap; checked visually and by the column-header test instead.
      if (format === "pdf" && sample.name.startsWith("wide table")) continue;
      test(`${format}: ${sample.name}`, async ({}, info) => {
        const outcome = await exportViaApi(sample.markdown, format);
        expect(outcome.status, outcome.error ?? "").toBe("completed");
        expect(outcome.bytes.length).toBeGreaterThan(format === "markdown" ? 0 : 200);

        const text =
          format === "docx" ? docxText(outcome.bytes) : format === "pdf" ? pdfText(outcome.bytes) : outcome.bytes.toString("utf8");
        // PDF can legitimately drop glyphs for fonts it lacks; everything else must keep every word.
        // PDF wraps long tokens mid-word inside narrow table cells, so compare without whitespace there.
        const haystack = format === "pdf" ? compact(text) : text;
        const lost = missingWords(withoutSyntaxWords(withoutFenceLanguages(sample.markdown)), haystack);
        await info.attach("lost-words.txt", { body: lost.join("\n") || "(none)", contentType: "text/plain" });
        expect.soft(lost, `${lost.length} source words missing from ${format}`).toEqual([]);
      });
    }
  }
});

test.describe("export structure", () => {
  test("html export: headings, tables and code are semantic elements", async () => {
    const { bytes } = await exportViaApi(ORDER_DOC, "html");
    const html = bytes.toString("utf8");
    expect(html).toMatch(/<h1[ >]/);
    expect((html.match(/<h2[ >]/g) ?? []).length).toBe(12);
    expect(html).toMatch(/<table/);
    expect(html).toMatch(/<pre/);
    expect(html).toMatch(/<meta[^>]+charset/i);
  });

  test("html export of hostile content carries no active content", async () => {
    const { bytes } = await exportViaApi(HOSTILE_HTML_DOC, "html");
    const html = bytes.toString("utf8");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[^>]+\son\w+\s*=/i);
    expect(html).not.toMatch(/href\s*=\s*["']\s*javascript:/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/http-equiv\s*=\s*["']refresh/i);
  });

  test("raw HTML in markdown (details, kbd, sub, sup, br) is not exported as literal escaped tags", async () => {
    const { bytes } = await exportViaApi(MIXED_HTML_DOC, "html");
    const html = bytes.toString("utf8");
    expect(html, "preview renders <kbd>/<details> but the HTML export prints them as text").not.toContain("&lt;kbd&gt;");
    expect(html).not.toContain("&lt;details&gt;");
    const docx = docxText((await exportViaApi(MIXED_HTML_DOC, "docx")).bytes);
    expect(docx, "DOCX shows literal <kbd> tags").not.toContain("<kbd>");
    expect(docx).not.toContain("<br>");
  });

  test("docx export: real heading styles, real table, monospace code", async () => {
    const { bytes } = await exportViaApi(ORDER_DOC, "docx");
    const xml = docxXml(bytes);
    expect((xml.match(/w:pStyle w:val="Heading2"/g) ?? []).length).toBe(12);
    expect(xml).toMatch(/<w:tbl>/);
    expect(xml).toMatch(/Courier|Consolas|Mono/i);
  });

  test("docx export keeps nested code fence as a single code block with inner fence text", async () => {
    const { bytes } = await exportViaApi(NESTED_FENCE_DOC, "docx");
    const text = docxText(bytes);
    expect(text).toContain("```python");
    expect(text).toContain("print('hi')");
  });

  test("pdf export of CJK / Arabic / Hebrew does not substitute tofu or drop text", async () => {
    const { bytes } = await exportViaApi(UNICODE_DOC, "pdf");
    const text = pdfText(bytes);
    expect.soft(text).toContain("日本語");
    expect.soft(text, "Arabic text missing in PDF").toMatch(/مرحبا|ﻣﺮﺣﺒﺎ/);
    expect.soft(text, "Hebrew text missing in PDF").toContain("שלום");
  });

  test("markdown export is byte-identical to the source", async () => {
    const { bytes } = await exportViaApi(UNICODE_DOC, "markdown");
    expect(bytes.toString("utf8")).toBe(UNICODE_DOC);
  });

  test("diagrams exported through the API fall back to source text rather than failing", async () => {
    const { status, bytes } = await exportViaApi(flowchart(3), "docx");
    expect(status).toBe("completed");
    expect(docxText(bytes)).toContain("flowchart TD");
  });
});

test.describe("export at scale", () => {
  test.describe.configure({ timeout: 300_000 });

  for (const lines of [1000, 10_000]) {
    test(`${lines} line document exports to docx, pdf and html in reasonable time`, async ({}, info) => {
      const markdown = bigDocument(lines);
      for (const format of ["html", "docx", "pdf"] as const) {
        const outcome = await exportViaApi(markdown, format);
        info.annotations.push({ type: `${format}-${lines}-ms`, description: String(outcome.durationMs) });
        expect.soft(outcome.status, `${format}: ${outcome.error ?? ""}`).toBe("completed");
        expect.soft(outcome.durationMs, `${format} duration`).toBeLessThan(60_000);
        if (format === "pdf" && outcome.status === "completed") expect.soft(pdfPageCount(outcome.bytes)).toBeGreaterThan(lines / 100);
      }
    });
  }

  test("a single 5 000 line code block exports to pdf without truncation", async () => {
    const code = Array.from({ length: 5000 }, (_, i) => `line_${i} = ${i}`).join("\n");
    const outcome = await exportViaApi(`# Code\n\n${FENCE}python\n${code}\n${FENCE}`, "pdf");
    expect(outcome.status, outcome.error ?? "").toBe("completed");
    const text = pdfText(outcome.bytes);
    expect.soft(text).toContain("line_0 = 0");
    expect.soft(text, "last line of the code block").toContain("line_4999 = 4999");
  });

  test("a 1 000 row table exports to docx with every row", async () => {
    const outcome = await exportViaApi(`# T\n\n${bigTable(1000, 6)}`, "docx");
    expect(outcome.status, outcome.error ?? "").toBe("completed");
    const text = docxText(outcome.bytes);
    expect.soft(text).toContain("r1000c6");
  });
});
