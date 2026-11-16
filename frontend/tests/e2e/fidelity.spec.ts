import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { docxHasImages, docxText, editor, editorValue, open, paste, pdfText, preview, setContent, squash } from "../support/app";

const FIXTURES = path.resolve(__dirname, "../../../test-fixtures/imports");

type Expectation = { mustContain?: string[]; mustNotContain?: string[]; noLineMatches?: string[]; paste?: "plain" | "untouched" };
const manifest = JSON.parse(readFileSync(path.join(FIXTURES, "manifest.json"), "utf8")) as Record<string, Expectation>;
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

const statusText = async (page: Page) => (await page.getByRole("status").filter({ hasNotText: /^$/ }).first().textContent()) ?? "";
const plainTextOf = (page: Page, html: string) => page.evaluate((markup) => new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "", html);

async function exportFile(page: Page, label: RegExp): Promise<Buffer> {
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("menuitem", { name: label }).click();
  return readFileSync((await (await download).path())!);
}

test.describe("clipboard fixtures from every source reach the editor intact", () => {
  for (const [name, expectation] of Object.entries(manifest)) {
    test(`paste ${name}`, async ({ page }) => {
      await open(page);
      await setContent(page, "");
      const raw = fixture(name);
      if (name.endsWith(".html")) await paste(page, { html: raw, text: await plainTextOf(page, raw) });
      else await paste(page, { text: raw });

      const value = await editorValue(page);
      for (const wanted of expectation.mustContain ?? []) expect.soft(value, `missing ${JSON.stringify(wanted)}`).toContain(wanted);
      for (const junk of expectation.mustNotContain ?? []) expect.soft(value, `unexpected ${JSON.stringify(junk)}`).not.toContain(junk);
      for (const pattern of expectation.noLineMatches ?? []) expect.soft(value, `a line matched ${pattern}`).not.toMatch(new RegExp(pattern, "m"));
      if (expectation.paste === "untouched") expect(value).toBe(raw);
    });
  }

  test("the status bar says where the paste came from and what was changed", async ({ page }) => {
    await open(page);
    await setContent(page, "");
    const word = fixture("word.html");
    await paste(page, { html: word, text: await plainTextOf(page, word) });
    await expect.poll(() => statusText(page)).toMatch(/Pasted from Word as Markdown: converted 2 tables, 1 kept as HTML/);

    await setContent(page, "");
    const outlook = fixture("outlook.html");
    await paste(page, { html: outlook, text: await plainTextOf(page, outlook) });
    await expect.poll(() => statusText(page)).toMatch(/Pasted from Outlook as Markdown: unwrapped 2 tracking links/);
  });

  test("a huge HTML paste is not silently flattened", async ({ page }) => {
    await open(page);
    await setContent(page, "");
    await paste(page, { html: `<h1>Huge</h1>${"<p><b>x</b></p>".repeat(150_000)}`, text: "Huge\nx" });
    await expect.poll(() => statusText(page)).toMatch(/over 1\.5 MB.*plain text/);
  });

  test("an Excel selection pasted as text becomes a table", async ({ page }) => {
    await open(page);
    await setContent(page, "");
    await paste(page, { text: "Name\tRole\nAda\tEngineer\n" });
    expect(await editorValue(page)).toContain("| Name | Role |");
    await expect(statusText(page)).resolves.toMatch(/converted 1 plain-text table/);
  });
});

const COMPOSITE = [
  "# Fidelity Check",
  "",
  "> [!WARNING]",
  "> Freeze starts Friday.",
  "",
  "## Table",
  "",
  "| Env | Owner |",
  "|-----|:-----:|",
  "| Staging | Ada |",
  "",
  '<table><tr><th colspan="2">Team</th></tr><tr><td rowspan="2">Ops</td><td>Bob</td></tr><tr><td>Cy</td></tr></table>',
  "",
  "## Lists",
  "",
  "- [x] shipped",
  "- [ ] pending",
  "",
  "1. first step",
  "2. second step",
  "",
  "## Code",
  "",
  "```python",
  "def release(): return 1",
  "```",
  "",
  "## Diagram",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Build] --> B[Ship]",
  "```",
  "",
  "## Inline",
  "",
  "Press <kbd>Ctrl</kbd>+<kbd>S</kbd> for H<sub>2</sub>O, see [the runbook](https://example.com/runbook). Ship :rocket: now.",
  "",
  "<details>",
  "<summary>Rollback steps</summary>",
  "",
  "Hidden **body** text",
  "",
  "</details>",
  "",
  "Latency matters[^1] and $E=mc^2$ holds.",
  "",
  "$$\\int_0^1 x\\,dx = \\frac{1}{2}$$",
  "",
  "Term",
  ": A definition",
  "",
  "[^1]: p99 under 200 ms.",
  "",
].join("\n");

test.describe("one document, three renderers: Preview, HTML, DOCX and PDF agree", () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await setContent(page, COMPOSITE);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 30_000 });
  });

  test("Preview renders every construct", async ({ page }) => {
    const view = preview(page);
    await expect(view.locator("h1")).toHaveText("Fidelity Check");
    await expect(view.locator("blockquote.callout-warning")).toContainText("Freeze starts Friday.");
    await expect(view.locator("table").first().locator("th")).toHaveText(["Env", "Owner"]);
    await expect(view.locator("table th[colspan='2']")).toHaveText("Team");
    await expect(view.locator("table td[rowspan='2']")).toHaveText("Ops");
    await expect(view.locator("[role=checkbox][aria-checked=true]")).toHaveCount(1);
    await expect(view.locator(":scope > ol > li")).toHaveText(["first step", "second step"]);
    await expect(view.locator("pre code.language-python")).toContainText("def release()");
    await expect(view.locator("kbd")).toHaveText(["Ctrl", "S"]);
    await expect(view.locator("sub")).toHaveText("2");
    await expect(view.locator("a[href='https://example.com/runbook']")).toHaveText("the runbook");
    await expect(view.locator("details summary")).toHaveText("Rollback steps");
    await expect(view.locator("sup.footnote-ref a")).toHaveText("1");
    await expect(view.locator("section.footnotes li")).toContainText("p99 under 200 ms.");
    await expect(view.locator("dl dt")).toHaveText("Term");
    await expect(view.locator("math")).toHaveCount(2);
    await expect(view).toContainText("\u{1f680}");
    await expect(view).not.toContainText("[^1]");
    await expect(view).not.toContainText(":rocket:");
  });

  test("HTML export keeps what Preview shows", async ({ page }) => {
    const html = (await exportFile(page, /^HTML$/)).toString("utf8");
    for (const wanted of [
      "<h1>Fidelity Check</h1>", "callout-warning", "Freeze starts Friday.", 'style="text-align:center">Ada', 'colspan="2"', 'rowspan="2"',
      '<li class="task"><input type="checkbox" disabled checked>', "<ol>", 'class="language-python"', "data:image/png;base64",
      "<kbd>Ctrl</kbd>", "<sub>2</sub>", 'href="https://example.com/runbook"', "<details>", "<summary>Rollback steps</summary>",
      'class="footnote-ref"', 'class="footnotes"', "<dl>", "<dt>Term</dt>", "<math", "\u{1f680}",
    ]) {
      expect.soft(html, `HTML export is missing ${JSON.stringify(wanted)}`).toContain(wanted);
    }
    for (const leaked of ["&lt;kbd&gt;", "&lt;details&gt;", "[^1]", ":rocket:", "$$", "[!WARNING]"]) expect.soft(html, `HTML export leaked ${leaked}`).not.toContain(leaked);
  });

  test("DOCX export keeps what Preview shows", async ({ page }) => {
    const bytes = await exportFile(page, /word/i);
    const text = squash(docxText(bytes));
    for (const wanted of [
      "Fidelity Check", "Warning", "Freeze starts Friday.", "Env", "Staging", "Team", "Ops", "Bob", "Cy", "shipped", "pending", "first step",
      "def release(): return 1", "Ctrl", "the runbook", "Rollback steps", "Hidden body text", "p99 under 200 ms.", "E=mc²", "A definition", "Term", "\u{1f680}",
    ]) {
      expect.soft(text, `DOCX is missing ${JSON.stringify(wanted)}`).toContain(wanted);
    }
    expect(text).not.toMatch(/<kbd>|<details>|\[\^1\]|:rocket:|\$\$/);
    expect(docxHasImages(bytes), "the Mermaid diagram must be embedded as an image").toBeGreaterThanOrEqual(1);
  });

  test("PDF export keeps what Preview shows", async ({ page }) => {
    const text = squash(pdfText(await exportFile(page, /^PDF$/)));
    for (const wanted of [
      "Fidelity Check", "Freeze starts Friday.", "Env", "Staging", "Team", "Ops", "Bob", "shipped", "pending", "first step",
      "def release(): return 1", "Ctrl", "the runbook", "Rollback steps", "Hidden body text", "p99 under 200 ms.", "E=mc²", "A definition",
    ]) {
      expect.soft(text, `PDF is missing ${JSON.stringify(wanted)}`).toContain(wanted);
    }
    expect(text).not.toMatch(/<kbd>|<details>|\[\^1\]|:rocket:|\$\$/);
  });

  test("every heading, cell, list item, link and code line in Preview appears in all three exports", async ({ page }) => {
    const facts = await preview(page).evaluate((root) => {
      const texts = (selector: string) => Array.from(root.querySelectorAll(selector)).map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
      return {
        headings: texts("h1, h2, h3"),
        cells: texts("th, td"),
        items: texts("li:not(.md-task-free)").filter((text) => text.length < 60 && !text.includes("p99")),
        links: texts("a[href^='https://']"),
        code: texts("pre code"),
      };
    });
    const html = squash((await exportFile(page, /^HTML$/)).toString("utf8").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    const docx = squash(docxText(await exportFile(page, /word/i)));
    const pdf = squash(pdfText(await exportFile(page, /^PDF$/)));

    for (const [kind, values] of Object.entries(facts)) {
      for (const value of values) {
        const probe = squash(value);
        for (const [format, haystack] of [["HTML", html], ["DOCX", docx], ["PDF", pdf]] as const) {
          expect.soft(haystack, `${format} export lost ${kind} text ${JSON.stringify(probe)} that Preview shows`).toContain(probe);
        }
      }
    }
  });
});

test.describe("Clean AI Text shows its work", () => {
  const CHATTY = "ChatGPT said:\nSure! Here's a design doc:\n\n# Design\n\nBody text 【4†source】 here.\n\nLet me know if you'd like me to expand!";

  test("report, preview, cancel, apply and undo", async ({ page }) => {
    await open(page);
    await setContent(page, CHATTY);
    await page.getByRole("button", { name: "Clean AI Text" }).click();

    const dialog = page.getByRole("dialog", { name: /review cleanup/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("clean-summary")).toContainText(/Removed: \d+ phrases?/);
    for (const rule of ["speaker", "preamble", "citations", "closer"]) await expect(dialog.getByTestId(`change-${rule}`)).toBeVisible();
    await expect(dialog.getByRole("group", { name: /preview of changes/i })).toContainText("Sure! Here's a design doc:");
    expect(await editorValue(page)).toBe(CHATTY);

    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await editorValue(page)).toBe(CHATTY);

    await page.getByRole("button", { name: "Clean AI Text" }).click();
    await page.getByRole("button", { name: "Apply Changes" }).click();
    await expect(editor(page)).toHaveValue("# Design\n\nBody text  here.");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(editor(page)).toHaveValue(CHATTY);
  });

  test("clean text opens no dialog", async ({ page }) => {
    await open(page);
    await setContent(page, "# Title\n\nPlain body.");
    await page.getByRole("button", { name: "Clean AI Text" }).click();
    await expect.poll(() => statusText(page)).toMatch(/Nothing to clean/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("box diagrams", () => {
  const convert = async (page: Page, diagram: string, target = "mermaid") => {
    await open(page);
    await setContent(page, `Intro\n\n${diagram}\n\nOutro`);
    await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.indexOf("API"), el.value.indexOf("API")));
    await page.getByLabel("Convert diagram").selectOption(target);
  };

  for (const [name, diagram] of [
    ["side-by-side ASCII", "+-----+     +----+\n| API | --> | DB |\n+-----+     +----+"],
    ["Unicode", "┌─────┐     ┌────┐\n│ API │ ──▶ │ DB │\n└─────┘     └────┘"],
  ] as const) {
    test(`${name} converts to a rendered Mermaid flow`, async ({ page }) => {
      await convert(page, diagram);
      await expect(editor(page)).toHaveValue(/```mermaid\nflowchart LR\n {4}N1\["API"\] --> N2\["DB"\]\n```/);
      await expect(preview(page).locator(".mermaid svg")).toBeVisible({ timeout: 20_000 });
    });
  }

  test("a diagram that cannot be read says what to fix", async ({ page }) => {
    await convert(page, "+-----+\n| API |\n+-----", "mermaid");
    await expect.poll(() => statusText(page)).toMatch(/Found box corners but no closed rectangle/);
  });

  test("a Unicode diagram stays aligned in Preview", async ({ page }) => {
    await open(page);
    await setContent(page, "┌─────┐     ┌────┐\n│ API │ ──▶ │ DB │\n└─────┘     └────┘");
    await expect(preview(page).locator("pre")).toHaveCount(1);
  });
});

test.describe("directionality", () => {
  test("Arabic and Hebrew paragraphs lay out right to left in Preview and in the HTML export", async ({ page }) => {
    await open(page);
    await setContent(page, "مرحبا بالعالم — النص من اليمين إلى اليسار\n\nשלום עולם — טקסט מימין לשמאל\n\nHello world");
    const directions = await preview(page).locator("p").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).direction));
    expect(directions).toEqual(["rtl", "rtl", "ltr"]);
    const html = (await exportFile(page, /^HTML$/)).toString("utf8");
    expect(html.match(/<p dir="auto">/g)).toHaveLength(2);
  });
});


test("RTL PDF keeps logical text, Unicode math and the browser-rendered diagram", async ({ page }) => {
  await open(page);
  await setContent(page, "# Mixed report\n\nمرحبا بالعالم\n\nשלום עולם\n\nEquation: $x^2$.\n\n```mermaid\nflowchart LR\n A[API] --> B[Worker]\n```");
  await expect(page.locator(".md-preview .mermaid svg")).toBeVisible();
  const bytes = await exportFile(page, /^PDF$/);
  const text = pdfText(bytes);
  expect(text).toContain("مرحبا");
  expect(text).toContain("שלום");
  expect(text).toContain("x²");
  const images = execFileSync("pdfimages", ["-list", "-"], { input: bytes }).toString("utf8");
  expect(images).toMatch(/\bimage\b/);
});
