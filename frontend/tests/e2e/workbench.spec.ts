import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ORDER_DOC = readFileSync(path.resolve(__dirname, "../../../backend/tests/fixtures/order_platform.md"), "utf8");
const unique = (label: string) => `${label}-${Date.now().toString(36)}`;

const editor = (page: Page) => page.getByPlaceholder(/paste ai output/i);
const preview = (page: Page) => page.locator(".md-preview");

async function open(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(preview(page)).toBeVisible();
}

async function setContent(page: Page, text: string) {
  await editor(page).fill(text);
}

async function pasteFromClipboard(page: Page, text: string) {
  await editor(page).evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test.describe("preview", () => {
  test("renders the starter document as structure, not plain text", async ({ page }) => {
    await open(page);
    await expect(preview(page).locator("h1")).toHaveText("Executive Summary");
    await expect(preview(page).locator("h2")).toHaveText("Requirements");
    expect(await preview(page).locator("li").count()).toBeGreaterThanOrEqual(7);
    await expect(preview(page).locator("[role=checkbox]")).toHaveCount(3);
    const h2Size = await preview(page).locator("h2").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(h2Size).toBeGreaterThan(20);
  });

  test("renders a full technical document: table, callouts, diagrams, code", async ({ page }) => {
    await open(page);
    await setContent(page, ORDER_DOC);
    await expect(preview(page).locator("h2")).toHaveCount(12);
    await expect(preview(page).locator("table th")).toHaveText(["Requirement", "Priority", "Status"]);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(2);
    await expect(preview(page).locator("blockquote.callout")).toHaveCount(2);
    await expect(preview(page).locator("blockquote.callout-warning")).toContainText("Warning");
    await expect(preview(page).locator("[role=checkbox][aria-checked=true]")).toHaveCount(2);
    await expect(preview(page).locator("pre", { hasText: "| API Gateway |" })).toBeVisible();
    await expect(preview(page).locator("pre", { hasText: "class OrderProcessor" })).toBeVisible();
    await expect(preview(page).locator("a[href='https://redis.io']")).toBeVisible();
  });

  test("renders PlantUML as a diagram", async ({ page }) => {
    await open(page);
    await setContent(page, "```plantuml\nactor User\nUser -> API: Submit\nAPI --> User: ok\n```");
    await expect(preview(page).locator(".mermaid svg")).toBeVisible({ timeout: 20_000 });
  });

  test("does not execute HTML pasted into the editor", async ({ page }) => {
    await open(page);
    await page.evaluate(() => ((window as unknown as { __pwned?: number }).__pwned = 0));
    await setContent(page, 'x <img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>');
    await expect(preview(page)).toContainText("x");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(0);
  });
});

test.describe("theme", () => {
  test("toggle restyles the UI and persists across reloads", async ({ page }) => {
    await open(page);
    const background = () => page.locator("main").evaluate((el) => getComputedStyle(el.closest("div.h-screen")!).backgroundColor);
    expect(await background()).toBe("rgb(13, 17, 23)");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: /^theme:/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await background()).toBe("rgb(255, 255, 255)");
    const headerBg = await page.locator("header").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(headerBg).not.toBe("rgb(22, 27, 34)");
    const headingColor = await preview(page).locator("h1").evaluate((el) => getComputedStyle(el).color);
    expect(headingColor).toBe("rgb(31, 35, 40)");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: /theme: light/i })).toBeVisible();

    await page.getByRole("button", { name: /^theme:/i }).click(); // system
    await expect(page.getByRole("button", { name: /theme: system/i })).toBeVisible();
    await page.getByRole("button", { name: /^theme:/i }).click(); // dark
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("system mode follows the OS preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await open(page);
    await page.getByRole("button", { name: /^theme:/i }).click(); // light
    await page.getByRole("button", { name: /^theme:/i }).click(); // system
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("layout", () => {
  test("panes resize by dragging and keep their size after reload", async ({ page }) => {
    await open(page);
    const widths = () =>
      page.evaluate(() => {
        const separators = [...document.querySelectorAll("[role=separator]")];
        const width = (el: Element | null) => Math.round(el!.getBoundingClientRect().width);
        return { sidebar: width(document.querySelector("aside")), editor: width(separators[1].previousElementSibling), preview: width(separators[1].nextElementSibling) };
      });
    const drag = async (index: number, dx: number) => {
      const box = (await page.locator("[role=separator]").nth(index).boundingBox())!;
      await page.mouse.move(box.x + 3, box.y + 250);
      await page.mouse.down();
      await page.mouse.move(box.x + 3 + dx, box.y + 250, { steps: 8 });
      await page.mouse.up();
    };

    const before = await widths();
    await drag(0, 80);
    await drag(1, -120);
    const after = await widths();
    expect(after.sidebar - before.sidebar).toBeGreaterThanOrEqual(78);
    expect(before.editor - after.editor).toBeGreaterThan(100);
    expect(after.preview).toBeGreaterThan(before.preview);

    await drag(1, -5000);
    expect((await widths()).editor).toBeGreaterThanOrEqual(279);
    await drag(1, 5000);
    expect((await widths()).preview).toBeGreaterThanOrEqual(279);

    await drag(1, -200);
    const saved = await widths();
    await page.reload();
    await expect(preview(page)).toBeVisible();
    const restored = await widths();
    expect(Math.abs(restored.sidebar - saved.sidebar)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.editor - saved.editor)).toBeLessThanOrEqual(2);

    await page.locator("[role=separator]").nth(0).dblclick();
    expect((await widths()).sidebar).toBe(256);
  });

  test("handles are keyboard accessible", async ({ page }) => {
    await open(page);
    const handle = page.getByRole("separator", { name: "Resize sidebar" });
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", String(256 + 16 + 64));
  });
});

test.describe("editing", () => {
  test("undo/redo and draft restore", async ({ page }) => {
    await open(page);
    await setContent(page, "# First");
    await page.waitForTimeout(900);
    await setContent(page, "# Second");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page)).toHaveValue("# First");
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(editor(page)).toHaveValue("# Second");
    await editor(page).press("Control+z");
    await expect(editor(page)).toHaveValue("# First");

    await page.waitForTimeout(800);
    await page.reload();
    await expect(editor(page)).toHaveValue("# First");
    await expect(page.getByText("Restored your last draft")).toBeVisible();
  });

  test("converts an ASCII diagram to Mermaid and renders it", async ({ page }) => {
    await open(page);
    await setContent(page, "Intro\n\n+-----+\n| API |\n+-----+\n   |\n   v\n+-----+\n| DB  |\n+-----+\n");
    await editor(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await page.getByLabel("Convert diagram").selectOption("mermaid");
    await expect(editor(page)).toHaveValue(/```mermaid\nflowchart TD\n {4}N1\["API"\] --> N2\["DB"\]\n```/);
    await expect(preview(page).locator(".mermaid svg")).toBeVisible();
  });

  test("downloads ASCII diagrams as SVG and Draw.io", async ({ page }) => {
    await open(page);
    await setContent(page, "+-----+\n| API |\n+-----+\n   |\n+-----+\n| DB  |\n+-----+");
    for (const [option, filename, marker] of [["svg", "diagram.svg", "<svg"], ["drawio", "diagram.drawio", "<mxfile"]] as const) {
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByLabel("Convert diagram").selectOption(option)]);
      expect(download.suggestedFilename()).toBe(filename);
      const file = await download.path();
      expect(readFileSync(file!, "utf8")).toContain(marker);
    }
  });
});

test.describe("sidebar CRUD", () => {
  test("snippets: save, search, favourite, archive, delete", async ({ page }) => {
    await open(page);
    const title = unique("Snippet");
    await page.getByRole("button", { name: "Snippets" }).click();
    await expect(page.getByText("SQL index")).toBeVisible();

    await setContent(page, "select 1;");
    await page.getByLabel("Snippet title").fill(title);
    await page.getByLabel("Snippet category").selectOption("SQL");
    await page.getByLabel("Snippet tags").fill("e2e, Probe");
    await page.getByRole("button", { name: "Save snippet" }).click();
    const row = page.locator("aside div", { hasText: title }).filter({ has: page.getByRole("button", { name: "Favourite" }) }).last();
    await expect(page.getByText(`SQL #e2e #probe`)).toBeVisible();

    await page.getByLabel(/search snippets/i).fill(title);
    await expect(page.getByText("SQL index")).toHaveCount(0);
    await row.getByRole("button", { name: "Favourite" }).click();
    await expect(row.getByRole("button", { name: "Remove favourite" })).toBeVisible();

    await row.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("No snippets found.")).toBeVisible();
    await page.getByLabel("Show archived").check();
    await expect(page.locator("aside").getByText(title)).toBeVisible();

    await page.getByRole("button", { name: `Delete ${title}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("aside").getByText(title)).toHaveCount(0);
  });

  test("templates: insert, save the editor as a template, delete it", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Templates" }).click();
    await page.getByRole("button", { name: "ADR", exact: true }).click();
    await expect(editor(page)).toHaveValue(/## Alternatives/);

    const name = unique("Template");
    await page.getByLabel("Template name").fill(name);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  });

  test("clipboard history captures pastes; pin, delete and undo", async ({ page }) => {
    await open(page);
    const text = unique("copied text");
    await page.getByRole("button", { name: "Clipboard History" }).click();
    await pasteFromClipboard(page, text);
    const item = page.locator("aside div", { has: page.getByRole("button", { name: text }) }).last();
    await expect(page.getByRole("button", { name: text })).toBeVisible();

    await item.getByRole("button", { name: "Pin" }).click();
    await expect(item.getByRole("button", { name: "Unpin" })).toBeVisible();
    await item.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: text })).toHaveCount(0);
    await page.getByRole("button", { name: /undo delete/i }).click();
    await expect(page.getByRole("button", { name: text })).toBeVisible();
  });

  test("documents: save, reopen, version history, delete", async ({ page }) => {
    await open(page);
    const title = unique("Doc");
    await page.getByRole("button", { name: "Documents" }).click();
    await setContent(page, `# ${title}\n\nversion one`);
    await page.getByRole("button", { name: /save as new document/i }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();

    await setContent(page, `# ${title}\n\nversion two`);
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText("Versions")).toBeVisible();

    await setContent(page, "# unrelated");
    await page.getByRole("button", { name: title, exact: true }).click();
    await page.getByRole("button", { name: "Discard and open" }).click();
    await expect(editor(page)).toHaveValue(new RegExp(`version two`));

    await page.getByRole("button", { name: "Restore this version" }).first().click();
    await expect(editor(page)).toHaveValue(/version one/);

    await page.getByRole("button", { name: `Delete ${title}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  });
});

test.describe("rich paste", () => {
  // The paste mode is a saved server setting; pin it to the default for these tests and put the user's choice back afterwards.
  const MODE_URL = "http://localhost:8000/api/settings/editor.paste_mode";
  let originalMode: string | null = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    const current = await api.get(MODE_URL);
    originalMode = current.ok() ? ((await current.json()) as { value: string }).value : null;
    await api.put(MODE_URL, { data: { value: "auto" } });
    await api.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    if (originalMode) await api.put(MODE_URL, { data: { value: originalMode } });
    else await api.delete(MODE_URL);
    await api.dispose();
  });

  const RICH_HTML =
    '<h2>Release plan</h2><ul><li>Ship <strong>v2</strong></li><li>Write <a href="https://example.com">docs</a></li></ul>' +
    "<table><tr><th>Owner</th><th>Due</th></tr><tr><td>Ann</td><td>Fri</td></tr></table>";

  // Puts real rich content on the system clipboard the way copying from a web page or document does.
  async function copyRenderedContent(page: Page, html: string) {
    await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.appendChild(host);
      const range = document.createRange();
      range.selectNodeContents(host);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, html);
    await page.keyboard.press("Control+c");
    await editor(page).fill("");
    await editor(page).focus();
  }

  test("pasting copied formatted content keeps bullets, headings, bold, links and tables", async ({ page }) => {
    await open(page);
    await copyRenderedContent(page, RICH_HTML);
    await page.keyboard.press("Control+v");

    await expect(editor(page)).toHaveValue(/## Release plan/);
    const value = await editor(page).inputValue();
    expect(value).toContain("- Ship **v2**");
    expect(value).toContain("- Write [docs](https://example.com/)"); // Chromium normalises the URL on copy
    expect(value).toContain("| Owner | Due |");
    expect(value).toContain("| Ann | Fri |");

    await expect(preview(page).locator("h2")).toHaveText("Release plan");
    await expect(preview(page).locator("li")).toHaveCount(2);
    await expect(preview(page).locator("table th")).toHaveText(["Owner", "Due"]);
    await expect(page.getByText(/pasted formatted text as markdown/i)).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(editor(page)).toHaveValue("");
  });

  test("numbered headings paste without a stray backslash and render as headings", async ({ page }) => {
    await open(page);
    await copyRenderedContent(page, "<h2>1. Concise Findings Summary</h2><p>Body text</p><h2>2. Pass-1 Repair</h2><p>1. literal number</p><p>- literal dash</p>");
    await page.keyboard.press("Control+v");

    await expect(editor(page)).toHaveValue(/## 1\. Concise Findings Summary/);
    const value = await editor(page).inputValue();
    expect(value).toContain("## 2. Pass-1 Repair");
    expect(value).not.toMatch(/\\\d/); // "\1." was the bug
    await expect(preview(page).locator("h2")).toHaveText(["1. Concise Findings Summary", "2. Pass-1 Repair"]);
    await expect(preview(page)).not.toContainText("\\");
  });

  const GOLDEN = [
    "# Equipment Golden Template",
    "",
    "## Objective",
    "",
    "For each equipment type:",
    "",
    "* Generate a template from `config.json`.",
    "* **Divide** the configuration into sections.",
    "",
    "1. Compare the hashes.",
    "2. If they match, render the sections.",
    "",
    "```text",
    "Incoming JSON",
    "     |",
    "     v",
    "```",
    "",
    "| Status | Meaning |",
    "|---|---|",
    "| `no_drift` | Matches the baseline. |",
  ].join("\n");

  test("Markdown copied from a code block pastes exactly as written", async ({ page }) => {
    await open(page);
    const escaped = GOLDEN.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    await copyRenderedContent(page, `<pre><code>${escaped}</code></pre>`);
    await page.keyboard.press("Control+v");

    await expect(editor(page)).toHaveValue(GOLDEN);
    await expect(preview(page).locator("h1")).toHaveText("Equipment Golden Template");
    await expect(preview(page).locator("h2")).toHaveText("Objective");
    await expect(preview(page).locator("table th")).toHaveText(["Status", "Meaning"]);
    await expect(preview(page).locator("ol li")).toHaveCount(2);
  });

  test("paste mode selector: plain text, rich conversion and Auto, saved across reloads", async ({ page }) => {
    await open(page);
    const mode = page.getByLabel("Paste mode");
    await expect(mode).toHaveValue("auto");

    await mode.selectOption("plain");
    await copyRenderedContent(page, "<h2>Plan</h2><ul><li>One</li></ul>");
    await page.keyboard.press("Control+v");
    expect(await editor(page).inputValue()).not.toContain("##");

    const saved = page.waitForResponse((r) => r.url().includes("/api/settings/editor.paste_mode") && r.request().method() === "PUT");
    await mode.selectOption("rich");
    await saved;
    await copyRenderedContent(page, "<h2>Plan</h2><ul><li>One</li></ul>");
    await page.keyboard.press("Control+v");
    await expect(editor(page)).toHaveValue(/## Plan/);

    await page.reload();
    await expect(page.getByLabel("Paste mode")).toHaveValue("rich");
    await page.getByLabel("Paste mode").selectOption("auto"); // leave the shared server setting at its default
    await expect(page.getByLabel("Paste mode")).toHaveValue("auto");
  });

  test("Clean AI Text keeps heading levels", async ({ page }) => {
    await open(page);
    await setContent(page, "# Title\n\n## Objective\n\n### Detail\n\nText.");
    await page.getByRole("button", { name: /clean ai text/i }).click();
    await expect(page.getByText("Nothing to clean: no AI chatter found")).toBeVisible();
    await expect(editor(page)).toHaveValue("# Title\n\n## Objective\n\n### Detail\n\nText.");
  });

  test("Ctrl+Shift+V still pastes plain text", async ({ page }) => {
    await open(page);
    await copyRenderedContent(page, RICH_HTML);
    await page.keyboard.press("Control+Shift+V");
    await expect(editor(page)).toHaveValue(/Release plan/);
    const value = await editor(page).inputValue();
    expect(value).not.toContain("##");
    expect(value).not.toContain("**");
    expect(value).not.toContain("](");
  });

  test("copied code with indentation is not mangled", async ({ page }) => {
    await open(page);
    await copyRenderedContent(page, '<div style="white-space:pre;font-family:monospace"><span>def f():</span>\n<span>    return 1</span></div>');
    await page.keyboard.press("Control+v");
    await expect(editor(page)).toHaveValue(/def f\(\):\n {4}return 1/);
    expect(await editor(page).inputValue()).not.toContain("```");
  });
});

test.describe("settings", () => {
  test.afterEach(async ({ request }) => {
    for (const key of ["ui.theme", "editor.default_tone"]) await request.delete(`http://localhost:8000/api/settings/${key}`);
  });

  test("theme and writing style are saved on the server and follow the user into a fresh browser", async ({ page, browser }) => {
    await open(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Light", { exact: true }).check();
    await page.getByLabel("Default writing style").selectOption("Runbook");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await expect
      .poll(async () => (await page.request.get("http://localhost:8000/api/settings")).json())
      .toMatchObject({ "ui.theme": "light", "editor.default_tone": "Runbook" });

    const fresh = await browser.newContext({ viewport: { width: 1500, height: 900 } }); // no localStorage at all
    const other = await fresh.newPage();
    await other.goto("/");
    await expect(other.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(other.getByLabel("Writing style")).toHaveValue("Runbook");
    await fresh.close();
  });

  test("Reset pane sizes returns the layout to its defaults", async ({ page }) => {
    await open(page);
    const handle = page.getByRole("separator", { name: "Resize sidebar" });
    await handle.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(handle).toHaveAttribute("aria-valuenow", "320");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: /reset pane sizes/i }).click();
    await expect(handle).toHaveAttribute("aria-valuenow", "256");
  });
});

test.describe("exports", () => {
  for (const [tab, title] of [["HTML", "HTML export"], ["PDF", "PDF export"]] as const) {
    for (const height of [600, 1000]) {
      test(`${tab} tab fills the pane at ${height}px tall and scrolls once, like Preview`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height });
        await open(page);
        await setContent(page, ORDER_DOC);
        await page.getByRole("tab", { name: tab, exact: true }).click();
        const frame = page.locator(`iframe[title='${title}']`);
        await expect(frame).toBeVisible({ timeout: 60_000 });

        const pane = (await page.getByRole("tablist").locator("xpath=..").boundingBox())!;
        const box = (await frame.boundingBox())!;
        const footer = (await page.locator("footer").boundingBox())!;
        expect(Math.abs(box.y + box.height - footer.y)).toBeLessThanOrEqual(1.5); // runs down to the status bar, no dead space
        expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
        expect(box.height).toBeGreaterThan(height * 0.4);
        const scrolls = await page.evaluate(() => ({ page: document.documentElement.scrollHeight > window.innerHeight }));
        expect(scrolls.page).toBe(false);
      });
    }
  }

  test("the pane has no inner scrollbar of its own while an export frame is shown", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await open(page);
    await setContent(page, ORDER_DOC);
    await page.getByRole("tab", { name: "HTML", exact: true }).click();
    await expect(page.locator("iframe[title='HTML export']")).toBeVisible({ timeout: 60_000 });
    const nested = await page.locator("iframe[title='HTML export']").evaluate((frame) => {
      const holder = frame.parentElement!.parentElement!;
      return holder.scrollHeight > holder.clientHeight + 1;
    });
    expect(nested).toBe(false);
  });

  test("HTML tab shows the real export with styled structure and diagram images", async ({ page }) => {
    await open(page);
    await setContent(page, ORDER_DOC);
    await page.getByRole("tab", { name: "HTML", exact: true }).click();
    const frame = page.frameLocator("iframe[title='HTML export']");
    await expect(frame.locator("h1")).toHaveText("Order Processing Platform", { timeout: 60_000 });
    await expect(frame.locator("h2")).toHaveCount(12);
    await expect(frame.locator("table")).toHaveCount(1);
    await expect(frame.locator("blockquote.callout")).toHaveCount(2);
    await expect(frame.locator("input[type=checkbox]")).toHaveCount(5);
    await expect(frame.locator("pre")).toHaveCount(3);
    const images = frame.locator("img");
    await expect(images).toHaveCount(2);
    for (const natural of await images.evaluateAll((list) => list.map((img) => (img as HTMLImageElement).naturalWidth))) {
      expect(natural).toBeGreaterThan(100);
    }
    expect(await frame.locator("h2").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(20);
  });

  for (const [tab, extension, magic] of [["DOCX", "docx", "PK"], ["PDF", "pdf", "%PDF-"]] as const) {
    test(`${tab} tab generates a downloadable ${extension} file`, async ({ page }) => {
      await open(page);
      await setContent(page, ORDER_DOC);
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const link = page.getByRole("link", { name: new RegExp(`download order-processing-platform\\.${extension}`, "i") });
      await expect(link).toBeVisible({ timeout: 60_000 });
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
      expect(download.suggestedFilename()).toBe(`order-processing-platform.${extension}`);
      const bytes = readFileSync((await download.path())!);
      expect(bytes.subarray(0, magic.length).toString("latin1")).toBe(magic);
      expect(bytes.length).toBeGreaterThan(5_000);
    });
  }

  test("PDF text keeps Unicode characters", async ({ page }) => {
    await open(page);
    await setContent(page, "# Caf\u00e9 \u2192 \u03a9\n\nStatus \u2714 \u041f\u0440\u0438\u0432\u0435\u0442");
    await page.getByRole("tab", { name: "PDF", exact: true }).click();
    const link = page.getByRole("link", { name: /download .*\.pdf/i });
    await expect(link).toBeVisible({ timeout: 60_000 });
    const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
    const bytes = readFileSync((await download.path())!);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("DejaVuSans");
  });

  test("a changed document is flagged as stale", async ({ page }) => {
    await open(page);
    await setContent(page, "# Stale check");
    await page.getByRole("tab", { name: "DOCX", exact: true }).click();
    await expect(page.getByRole("link", { name: /download stale-check\.docx/i })).toBeVisible({ timeout: 60_000 });
    await editor(page).press("End");
    await editor(page).pressSequentially(" more");
    await expect(page.getByText("Content changed since this was generated")).toBeVisible();
  });
});

test.describe("AI actions", () => {
  test("Clean AI Text removes preambles and Smart Paste keeps indentation", async ({ page }) => {
    await open(page);
    await setContent(page, "Certainly!\n\n# Notes\n\n- parent\n    - child\n\nHope this helps!");
    await page.getByRole("button", { name: /smart paste/i }).click();
    await expect(editor(page)).not.toHaveValue(/Certainly!/);
    await expect(editor(page)).toHaveValue(/ {4}- child/);
  });
});

test.describe("layout and header", () => {
  const inside = async (page: Page, locator: ReturnType<Page["locator"]>, width: number) => {
    const box = (await locator.boundingBox())!;
    expect(box, "element is rendered").not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
  };

  for (const width of [1024, 1440]) {
    test(`every tool and preview tab is reachable at ${width}px without horizontal scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 768 });
      await open(page);
      for (const control of [
        page.getByRole("button", { name: "Smart Paste" }),
        page.getByRole("button", { name: "Clean AI Text" }),
        page.getByLabel("Paste mode"),
        page.getByLabel("Writing style"),
        page.getByLabel("Convert diagram"),
        page.getByRole("tab", { name: "PDF" }),
        page.getByRole("button", { name: "Export", exact: true }),
      ]) {
        await expect(control).toBeVisible();
        await inside(page, control, width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("editor and preview headers line up and the page itself does not scroll", async ({ page }) => {
    await open(page);
    const tabs = (await page.getByRole("tablist").boundingBox())!;
    const undo = (await page.getByRole("button", { name: "Undo" }).boundingBox())!;
    expect(tabs.y + tabs.height / 2).toBeGreaterThan(undo.y - 1);
    expect(undo.y + undo.height).toBeLessThanOrEqual(tabs.y + tabs.height + 1);
    const heights = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, view: window.innerHeight }));
    expect(heights.doc).toBeLessThanOrEqual(heights.view);
  });

  test("only one solid-blue action is visible in the default view", async ({ page }) => {
    await open(page);
    const solid = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => getComputedStyle(b).backgroundColor === "rgb(88, 166, 255)").map((b) => b.textContent?.trim()),
    );
    expect(solid).toEqual(["Export"]);
  });

  test("header Save stores the document, shows its state, and the list updates without a reload", async ({ page }) => {
    await open(page);
    const title = unique("Header");
    await setContent(page, `# ${title}\n\nbody`);
    await expect(page.getByTestId("save-state")).toHaveText("Not saved");
    await page.getByRole("button", { name: "Save as new document" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await expect(page.locator("aside").getByRole("button", { name: title, exact: true })).toBeVisible();
    await editor(page).press("End");
    await editor(page).type(" more");
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved changes");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await page.locator("aside").getByRole("button", { name: `Delete ${title}` }).click({ force: true });
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  });

  test("Export menu downloads Markdown and DOCX", async ({ page }) => {
    await open(page);
    const title = unique("Menu");
    await setContent(page, `# ${title}\n\nhello`);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const md = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /markdown/i }).click();
    const mdFile = await md;
    expect(mdFile.suggestedFilename()).toBe(`${title.toLowerCase()}.md`);
    expect(readFileSync((await mdFile.path())!, "utf8")).toBe(`# ${title}\n\nhello`);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const docx = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /word/i }).click();
    expect((await docx).suggestedFilename()).toBe(`${title.toLowerCase()}.docx`);
  });

  test("the side panel collapses to an icon rail and stays collapsed after a reload", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("Search documents")).toBeVisible();
    await page.getByRole("button", { name: "Collapse side panel" }).click();
    await expect(page.getByLabel("Search documents")).toHaveCount(0);
    expect(Math.round((await page.locator("aside").boundingBox())!.width)).toBe(48);

    await page.reload();
    await expect(page.getByLabel("Search documents")).toHaveCount(0);
    await page.getByRole("button", { name: "Documents" }).click();
    await expect(page.getByLabel("Search documents")).toBeVisible();
    expect(Math.round((await page.locator("aside").boundingBox())!.width)).toBe(256);
  });

  test("Copy Markdown copies the source", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await setContent(page, "# Copy check");
    await page.getByRole("button", { name: "Copy Markdown" }).click();
    await expect(page.getByText("Copied Markdown to clipboard")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("# Copy check");
  });
});

test.describe("pasted Mermaid diagrams", () => {
  // AI tools often leave parentheses in unquoted node labels, which Mermaid itself rejects.
  const AI_DIAGRAM = [
    "```mermaid",
    "flowchart LR",
    '  subgraph DataPlane["Data plane (unchanged, no model)"]',
    "    C[cmd/client runSession] -->|UDP probes| R[cmd/reflector / twampproto.ServeTwampUDP]",
    "  end",
    "  C -->|TwampResults| K[(Kafka)]",
    "  K --> TC[cmd/twamp-consumer] --> VM[(VictoriaMetrics)]",
    "  C -->|status sync| O[cmd/orchestrator alerts.go<br/>deterministic thresholds]",
    "  O -->|GET /api/v1/alerts poll, read-only| T[triage-advisor sidecar<br/>bounded queue, rate-limited]",
    "  T -->|typed Choice+Score| J[Decision model API]",
    "  T -->|annotation write: advisory field only| O",
    "  O --> UI[UI: shows 'suggested domain (advisory)']",
    "```",
  ].join("\n");

  test("a diagram with parentheses in an unquoted label renders at a readable size, and the source is left as pasted", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await setContent(page, AI_DIAGRAM);
    const svg = page.locator(".md-preview .mermaid svg");
    await expect(svg).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator(".md-preview .mermaid-error")).toHaveCount(0);
    await expect(editor(page)).toHaveValue(AI_DIAGRAM);

    const box = (await svg.boundingBox())!;
    expect(box.width).toBeGreaterThan(900); // not squeezed into the 440px pane
    const block = page.locator(".md-preview .mermaid");
    expect(await block.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // scrolls inside the block
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the Word export embeds a diagram that needed repairing, without a warning", async ({ page }) => {
    await open(page);
    await setContent(page, `# Repaired diagram\n\n${AI_DIAGRAM}`);
    await expect(page.locator(".md-preview .mermaid svg")).toHaveCount(1, { timeout: 20_000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: /word/i }).click();
    await expect(page.getByRole("status")).toContainText(/docx export ready/i, { timeout: 60_000 });
    await expect(page.getByRole("status")).not.toContainText(/could not be rendered/i);
  });

  test("a diagram that is genuinely broken says why and shows its source", async ({ page }) => {
    await open(page);
    await setContent(page, "```mermaid\nflowchart LR\n  A -->\n```");
    const alert = page.locator(".md-preview").getByRole("alert");
    await expect(alert).toContainText("Diagram could not be rendered");
    await expect(page.locator(".md-preview .mermaid pre")).toContainText("flowchart LR");
  });

  // Copying through a Markdown converter can leave bold markers around punctuation and backslash-escaped arrows.
  const ARTIFACT_DIAGRAM = [
    "```mermaid",
    "flowchart LR",
    '  subgraph DataPlane["Data plane **(**unchanged**,** no model**)**"]',
    "    C[cmd/client runSession] -->|UDP probes| R[cmd/reflector]",
    "  end",
    "  C -->|TwampResults| K[**(**Kafka**)**]",
    "  K --\\> TC[cmd/twamp-consumer] --\\> VM[**(**VictoriaMetrics**)**]",
    "  O --\\> UI[UI: shows 'suggested domain advisory']",
    "```",
  ].join("\n");

  test("a diagram with escaped arrows and bold-wrapped parentheses renders, exports, and the source is left as pasted", async ({ page }) => {
    await open(page);
    await setContent(page, `# Artifacts\n\n${ARTIFACT_DIAGRAM}`);
    const svg = page.locator(".md-preview .mermaid svg");
    await expect(svg).toHaveCount(1, { timeout: 20_000 });
    await expect(page.locator(".md-preview .mermaid-error")).toHaveCount(0);
    await expect(editor(page)).toHaveValue(`# Artifacts\n\n${ARTIFACT_DIAGRAM}`);
    const labels = await svg.evaluate((el) => [...el.querySelectorAll("text")].map((t) => t.textContent));
    expect(labels).toContain("Data plane (unchanged, no model)");
    expect(labels.some((t) => t?.includes("*") || t?.includes("\\"))).toBe(false);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: /word/i }).click();
    await expect(page.getByRole("status")).toContainText(/docx export ready/i, { timeout: 60_000 });
    await expect(page.getByRole("status")).not.toContainText(/could not be rendered/i);
  });

  test("failed diagrams leave nothing behind in the page and the page does not grow a scrollbar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const box = editor(page);
    await box.fill("```mermaid\nflowchart LR\n  A -->\n```");
    await expect(page.locator(".md-preview").getByRole("alert")).toContainText("Diagram could not be rendered");
    for (const dangling of ["A -->", "A --> -->", "A --> B -->"]) {
      await box.fill(`\`\`\`mermaid\nflowchart LR\n  ${dangling}\n\`\`\``);
      await expect(page.locator(".md-preview").getByRole("alert")).toContainText("Diagram could not be rendered");
    }
    await box.fill(`# T\n\n${ARTIFACT_DIAGRAM.replace("K --\\> TC", "K --\\> ]")}`); // broken even after clean-up
    await expect(page.locator(".md-preview").getByRole("alert")).toBeVisible();

    expect(await page.evaluate(() => document.querySelectorAll("body > [id^=dmermaid], body > [id^=mermaid]").length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  });
});

test.describe("hostile content and recovery", () => {
  const STYLE_PAYLOAD = "<style>body{display:none !important}</style>\n\n# Still visible\n\n<form action=\"https://evil.example\"><input name=x><button>Go</button></form>";

  test("a pasted <style> cannot blank the page, now or after a reload", async ({ page }) => {
    await open(page);
    await setContent(page, STYLE_PAYLOAD);
    await expect(preview(page).locator("h1")).toHaveText("Still visible");
    await expect(preview(page).locator("style, form, input, button")).toHaveCount(0);
    await expect(page.getByTestId("sanitizer-notice")).toContainText("<style>");
    await expect(page.getByRole("button", { name: "Save as new document" })).toBeVisible();

    await page.waitForTimeout(800); // draft autosave is debounced
    await page.reload();
    await expect(editor(page)).toHaveValue(STYLE_PAYLOAD);
    await expect(preview(page).locator("h1")).toHaveText("Still visible");
    await expect(page.getByRole("button", { name: "Save as new document" })).toBeVisible();
  });

  test("the preview is a contained shadow root; stray fixed-position markup cannot cover the app", async ({ page }) => {
    await open(page);
    await setContent(page, '<div style="position:fixed;inset:0;background:red">overlay</div>\n\ntext');
    await expect(preview(page)).toContainText("text");
    const covered = await page.evaluate(() => {
      const box = document.querySelector("header")!.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + 5, box.y + 5);
      return !document.querySelector("header")!.contains(top);
    });
    expect(covered).toBe(false);
  });

  test("a load that never finished opens recovery mode without rendering the draft", async ({ page }) => {
    await open(page);
    // Seeded before the app starts: the page being left would otherwise flush its own draft over it on unload.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      sessionStorage.setItem("workbench.tab.v1", "seeded-tab");
      localStorage.setItem("workbench.drafts.v2", JSON.stringify({ "seeded-tab": { text: "# Precious draft", at: Date.now() } }));
      sessionStorage.setItem("workbench.boot.v1", "previous-load");
    });
    await page.reload();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/saved draft/i)).toHaveValue("# Precious draft");
    await expect(page.getByTestId("preview-host")).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("workbench.drafts.v2") ?? "{}")).map((d) => (d as { text: string }).text))).toEqual(["# Precious draft"]);

    await page.reload(); // still in recovery until the user decides
    await expect(page.getByRole("alertdialog")).toBeVisible();

    await page.getByRole("button", { name: "Restore draft" }).click();
    await expect(editor(page)).toHaveValue("# Precious draft");
    await expect(page.getByTestId("preview-fallback")).toBeVisible();
    await page.getByRole("button", { name: "Render preview" }).click();
    await expect(preview(page).locator("h1")).toHaveText("Precious draft");

    await page.reload();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(preview(page).locator("h1")).toHaveText("Precious draft");
  });
});
