import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearEditor, editorValue, open, paste, preview } from "../support/app";

const sample = readFileSync(path.resolve(__dirname, "../../../test-fixtures/imports/vscode-chat-unfenced.txt"), "utf8");
const STYLE = "<style>a{text-decoration:none;color:#464feb}tr th,tr td{border:1px solid #e6e6e6}tr th{background-color:#f5f5f5}</style>";

// VS Code chat copies: markdown text without code fences, with an HTML flavour that is a styled wrapper.
// Seen in a real paste: every line, code lines included, in its own paragraph.
const doubled = sample.split("\n").filter((line) => line.trim() !== "").join("\n\n");

const flavours = {
  "text only": { text: sample },
  "double-spaced text": { text: doubled },
  "text with style-only html": { text: sample, html: `${STYLE}<div style="white-space:pre-wrap">${sample.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>` },
};

const rendered = `${STYLE}<p>That changes the model. I would think of it as <strong>two parallel outputs</strong>:</p>
<div><div><span>Plain Text</span><button>Copy</button></div><pre><code>               +--&gt; MySQL
               |
Zabbix Proxy -&gt; Zabbix Server</code></pre></div>
<blockquote><p>"Is the stream faithful?"</p></blockquote>
<h2>Observability Domains</h2><h3>1. Source Domain</h3><p>Add a view for:</p>
<pre><code>items processed/sec
history writes/sec</code></pre><hr><p>Questions answered:</p><ul><li>Did Zabbix produce an event?</li></ul>
<table><thead><tr><th>Metric</th><th>Type</th></tr></thead><tbody><tr><td>lag</td><td>gauge</td></tr></tbody></table>`;

test("VS Code chat copy with rendered HTML restores code blocks, quotes, lists and tables", async ({ page }) => {
  await open(page);
  await clearEditor(page);
  await paste(page, { text: `${sample}`, html: rendered });
  const value = await editorValue(page);
  writeFileSync("/tmp/uat/paste/chat_rendered_html.md", value);
  expect(value).toContain("**two parallel outputs**");
  expect(value).toMatch(/```[a-z]*\n {15}\+--> MySQL/);
  expect(value).toContain("> \"Is the stream faithful?\"");
  expect(value).toContain("## Observability Domains");
  expect(value).toContain("| Metric | Type |");
  expect(value).not.toContain("Copy\n");
  await expect(preview(page).locator("table")).toHaveCount(1);
});

for (const [name, data] of Object.entries(flavours)) {
  test(`VS Code chat copy (${name}) keeps diagrams, code lists and headings`, async ({ page }) => {
    await open(page);
    await clearEditor(page);
    await paste(page, data);
    const value = await editorValue(page);
    mkdirSync("/tmp/uat/paste", { recursive: true });
    const slug = name.replace(/\W+/g, "_");
    writeFileSync(`/tmp/uat/paste/chat_${slug}.md`, value);
    await page.screenshot({ path: `/tmp/uat/paste/chat_${slug}.png`, fullPage: true });

    expect(value).not.toContain("text-decoration");
    expect(value.startsWith("That changes the observability model")).toBe(true);
    await expect(preview(page).locator("pre")).not.toHaveCount(0);
    await expect(preview(page).locator("h2", { hasText: "Observability Domains" })).toBeVisible();
    // Every metric list, diagram and JSON object ends up as a code block, none as run-together paragraph text.
    expect(value).toContain("```text\nitems processed/sec\nhistory writes/sec\nevents generated/sec\ntriggers generated/sec\n```");
    expect(value).toContain("```text\nGolang Producer\nGolang Consumer\n```");
    expect(value).toContain('```json\n{\n  "event_time": "..."\n}\n```');
    expect(value).toContain("```text\nexported_total / received_total\n```");
    expect(await preview(page).locator("pre").count()).toBeGreaterThan(25);
    await expect(preview(page).locator("p", { hasText: "items processed/sec" })).toHaveCount(0);
  });
}
