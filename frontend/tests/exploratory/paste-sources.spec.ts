import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { PASTE_SAMPLES, PLAIN_TEXT_AI_COPIES } from "../support/corpus";
import { clearEditor, editorValue, open, paste, preview } from "../support/app";

test.describe("clipboard fidelity: content pasted from real tools", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await clearEditor(page);
  });

  for (const sample of PASTE_SAMPLES) {
    test(`paste from ${sample.name}`, async ({ page }, info) => {
      await paste(page, { html: sample.html, text: sample.text });
      const result = await editorValue(page);
      await info.attach("pasted-markdown.md", { body: result, contentType: "text/markdown" });
      mkdirSync("/tmp/uat/paste", { recursive: true });
      writeFileSync(`/tmp/uat/paste/${sample.name.replace(/\W+/g, "_")}.md`, result);

      for (const wanted of sample.mustContain) {
        if (typeof wanted === "string") expect.soft(result, `should contain ${JSON.stringify(wanted)}`).toContain(wanted);
        else expect.soft(result).toMatch(wanted);
      }
      for (const junk of sample.mustNotContain) {
        if (typeof junk === "string") expect.soft(result, `should not contain ${JSON.stringify(junk)}`).not.toContain(junk);
        else expect.soft(result).not.toMatch(junk);
      }
    });
  }

  test("plain-text copy of a ChatGPT answer keeps UI chrome out of the document", async ({ page }) => {
    await paste(page, { text: PLAIN_TEXT_AI_COPIES.chatGptWithHeaders });
    const result = await editorValue(page);
    expect.soft(result).not.toContain("Copy code");
    expect.soft(result).not.toContain("ChatGPT said:");
  });

  test("Excel / tab separated paste becomes a table", async ({ page }) => {
    await paste(page, { text: PLAIN_TEXT_AI_COPIES.tabSeparatedExcel });
    expect(await editorValue(page)).toContain("| Name | Role |");
  });

  test("JSON paste is kept verbatim and rendered as code, not mangled prose", async ({ page }) => {
    await paste(page, { text: PLAIN_TEXT_AI_COPIES.jsonPaste });
    const value = await editorValue(page);
    expect(value).toContain('"nested":{"a":null}');
    await expect(preview(page)).toContainText('"items":[1,2,3]');
  });

  test("pasting an HTML-only clipboard (no text/plain flavour) still produces content", async ({ page }) => {
    await paste(page, { html: "<h2>Only HTML</h2><p>Body</p>" });
    expect(await editorValue(page)).toContain("## Only HTML");
  });

  test("pasting a 400 row HTML table (Confluence/Excel scale) converts within 5 s and keeps every row", async ({ page }) => {
    const rows = Array.from({ length: 400 }, (_, i) => `<tr><td>r${i}</td><td>v${i}</td></tr>`).join("");
    const started = Date.now();
    await paste(page, { html: `<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table>`, text: "x" });
    const value = await editorValue(page);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(value).toContain("| r399 | v399 |");
  });

  test("a very large rich paste (over 1.5 MB of HTML) is still converted, or the user is told it was not", async ({ page }) => {
    const paragraph = "<p><b>Bold</b> text with a <a href='https://example.com'>link</a></p>";
    const html = `<h1>Huge</h1>${paragraph.repeat(30_000)}`;
    await paste(page, { html, text: "Huge\n" + "Bold text with a link\n".repeat(30_000) });
    const value = await editorValue(page);
    const message = (await page.getByRole("status").first().textContent()) ?? "";
    expect(value.includes("# Huge") || /too large|plain/i.test(message), "silently fell back to flattened plain text (headings, bold and links lost) with no notice").toBe(true);
  });

  test("a paste of a Word table keeps each cell on one line so the Markdown table is valid", async ({ page }) => {
    const sample = PASTE_SAMPLES.find((item) => item.name.startsWith("Word"))!;
    await paste(page, { html: sample.html, text: sample.text });
    const value = await editorValue(page);
    expect(value, "header row split across lines").toMatch(/^\| Name \| Role \|$/m);
    expect(value, "body row split across lines").toMatch(/^\| Ada \| Engineer \|$/m);
  });
});
