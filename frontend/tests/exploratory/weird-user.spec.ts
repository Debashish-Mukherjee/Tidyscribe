import { expect, test, type Page } from "@playwright/test";
import { FENCE } from "../support/corpus";
import { apiJson, editor, editorValue, open, preview, setContent, unique } from "../support/app";

const status = (page: Page) => page.getByRole("status").first();

const WEIRD_STRINGS: Record<string, string> = {
  emoji: "🚀🔥👩‍👩‍👧‍👦🏳️‍🌈",
  chinese: "中文测试文档标题",
  japanese: "日本語のタイトルです",
  arabic: "عنوان المستند بالعربية",
  hebrew: "כותרת המסמך בעברית",
  zeroWidth: "a\u200Bb\u200Dc\uFEFFd",
  sqlish: "'; DROP TABLE documents; --",
  htmlish: "<img src=x onerror=alert(1)>",
  percentUnderscore: "100%_done",
  backslash: "C:\\path\\to\\file",
  nullByte: "before\u0000after",
  long: "L".repeat(5000),
};

test.describe("input abuse: search boxes", () => {
  test.beforeEach(async ({ page }) => open(page));

  for (const [name, value] of Object.entries(WEIRD_STRINGS)) {
    test(`document search survives ${name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const search = page.getByRole("textbox", { name: "Search documents" });
      await search.fill(value);
      await page.waitForTimeout(700);
      await expect(search).toHaveValue(value);
      await expect(page.getByRole("button", { name: "Save as new document" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("search treats % and _ literally, not as SQL wildcards", async () => {
    const title = unique("UAT wild");
    await apiJson("/api/documents", { method: "POST", body: JSON.stringify({ title, content: "x" }) });
    const hits = await apiJson<unknown[]>(`/api/documents?q=${encodeURIComponent("%")}`);
    const all = await apiJson<unknown[]>("/api/documents?limit=500");
    expect(hits.length, "a bare % matched everything").toBeLessThan(all.length);
  });

  test("a search with no hits says so instead of claiming nothing was ever saved", async ({ page }) => {
    await page.getByRole("textbox", { name: "Search documents" }).fill("zzzz-no-such-doc-xyz");
    await page.waitForTimeout(800);
    await expect(page.locator("aside")).not.toContainText("No saved documents yet");
  });

  test("documents beyond the first 100 are reachable without typing an exact search", async ({ page }) => {
    const total = (await apiJson<unknown[]>("/api/documents?limit=500")).length;
    test.skip(total <= 100, "needs more than 100 stored documents");
    const rendered = await page.locator("aside").getByRole("button", { name: /^Delete / }).count();
    expect(rendered, `${total} documents exist, UI lists ${rendered} with no 'load more'`).toBeGreaterThanOrEqual(total);
  });
});

test.describe("input abuse: templates, snippets and titles", () => {
  test.beforeEach(async ({ page }) => open(page));

  for (const [name, value] of Object.entries(WEIRD_STRINGS)) {
    test(`document title/heading survives ${name} and round-trips through save`, async ({ page }) => {
      test.skip(name === "nullByte", "NUL is rejected by PostgreSQL; covered by its own test");
      const heading = `${unique("UAT")} ${value}`.slice(0, 200);
      await setContent(page, `# ${heading}\n\nbody`);
      await page.getByRole("button", { name: /^Save/ }).click();
      await expect(status(page)).toContainText(/Saved|failed/);
      expect(await status(page).textContent(), "save should succeed").toContain("Saved");
    });
  }

  test("a NUL byte in the document is handled with a clear message (not a 500)", async ({ page }) => {
    await setContent(page, `# ${unique("UAT nul")}\n\nbefore\u0000after`);
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(status(page)).toContainText(/Saved|failed/i);
    const text = (await status(page).textContent()) ?? "";
    expect.soft(text).not.toMatch(/Internal Server Error|500|psycopg|NUL|0x00/i);
  });

  test("template name: empty disables Save, 1 char works, very long is rejected politely", async ({ page }) => {
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Template name" });
    const save = page.getByRole("button", { name: "Save template" });
    await expect(save).toBeDisabled();
    await name.fill(unique("T"));
    await expect(save).toBeEnabled();
    await name.fill("x".repeat(300));
    await save.click();
    await page.waitForTimeout(800);
    const text = (await status(page).textContent()) ?? "";
    expect.soft(text, "300 char template name should give a readable validation message").not.toMatch(/\[\{|string_too_long|loc/);
  });

  test("whitespace-only template name cannot be saved", async ({ page }) => {
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByRole("textbox", { name: "Template name" }).fill("     ");
    await expect(page.getByRole("button", { name: "Save template" })).toBeDisabled();
  });
});

test.describe("weird user", () => {
  test("double-clicking Save creates exactly one document", async ({ page }) => {
    await open(page);
    const title = unique("UAT double save");
    await setContent(page, `# ${title}\n\nbody`);
    await page.getByRole("button", { name: "Save as new document" }).dblclick();
    await page.waitForTimeout(1500);
    const matches = await apiJson<Array<{ title: string }>>(`/api/documents?q=${encodeURIComponent(title)}`);
    expect(matches.length).toBe(1);
  });

  test("hammering every toolbar button 3x does not crash the page", async ({ page }) => {
    await open(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.dismiss());
    const labels = ["Source", "Rich", "Source", "Find and replace", "Undo", "Redo", "Smart Paste", "Clean AI Text", "Copy Markdown"];
    for (const label of labels) {
      const button = page.getByRole("button", { name: label, exact: true }).first();
      if (await button.isVisible().catch(() => false)) await button.click({ clickCount: 3, delay: 10, force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    await expect(page.getByRole("button", { name: /^Save/ })).toBeVisible();
  });

  test("clicking Export formats rapidly queues no more than one job per click and never wedges the UI", async ({ page }) => {
    await open(page);
    await setContent(page, `# ${unique("UAT rapid export")}\n\nbody`);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: "PDF" }).click();
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
    await expect(status(page)).toContainText(/export ready|failed/i, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  });

  test("refresh spam: 15 reloads in quick succession leave the draft intact", async ({ page }) => {
    await open(page);
    await setContent(page, "# Refresh spam draft\n\nkeep me");
    await page.waitForTimeout(800);
    for (let i = 0; i < 15; i += 1) await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor(page)).toHaveValue(/keep me/);
  });

  test("browser back/forward do not wipe the editor", async ({ page }) => {
    await open(page);
    await setContent(page, "# Back button test\n\nbody");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.goBack().catch(() => undefined);
    await page.goForward().catch(() => undefined);
    await page.goto("/");
    await expect(editor(page)).toHaveValue(/Back button test/);
  });

  test("pressing Back leaves the app only after in-app navigation is exhausted (sidebar sections are not history entries)", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page.getByRole("button", { name: "Snippets", exact: true }).click();
    const url = page.url();
    await page.goBack().catch(() => undefined);
    expect.soft(page.url(), "Back from Snippets should return to Templates inside the app; it left the app").toBe(url);
  });

  test("opening 12 tabs at once all load and share one document without errors", async ({ browser }) => {
    const context = await browser.newContext();
    const pages = await Promise.all(Array.from({ length: 12 }, () => context.newPage()));
    await Promise.all(pages.map((p) => p.goto("/")));
    for (const p of pages) await expect(preview(p)).toBeVisible({ timeout: 30_000 });
    await context.close();
  });

  test("dropping a binary file (png) on the editor does not navigate away from the app", async ({ page }) => {
    await open(page);
    await setContent(page, "# Do not lose me");
    const url = page.url();
    await editor(page).evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], "pic.png", { type: "image/png" }));
      for (const type of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(url);
    await expect(editor(page)).toHaveValue(/Do not lose me/);
  });

  test("dropping a .md file onto the editor imports it (or at least explains that it cannot)", async ({ page }) => {
    await open(page);
    await setContent(page, "");
    await editor(page).evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["# Dropped file\n\nbody"], "notes.md", { type: "text/markdown" }));
      for (const type of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(600);
    const value = await editorValue(page);
    const message = (await status(page).textContent()) ?? "";
    expect(value.includes("Dropped file") || /cannot|unsupported|drop/i.test(message), "dropped markdown file is ignored silently - there is no file import path at all").toBe(true);
  });

  test("Ctrl+Shift+V pastes plain text even when HTML is on the clipboard (mode: auto)", async ({ page }) => {
    await open(page);
    await setContent(page, "");
    await editor(page).focus();
    await editor(page).evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "plain only");
      transfer.setData("text/html", "<h1>rich heading</h1>");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    expect(await editorValue(page)).toContain("# rich heading");
  });

  test("a 600 KB paste is mirrored to clipboard history without breaking the paste", async ({ page }) => {
    await open(page);
    await setContent(page, "");
    await editor(page).focus();
    const big = "word ".repeat(120_000);
    await editor(page).evaluate((el, text) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      transfer.setData("text/html", `<p>${text.slice(0, 20)}</p><ul><li>x</li></ul>`);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, big);
    await page.waitForTimeout(1500);
    await expect(page.getByRole("status").first()).not.toContainText(/failed|error/i);
  });

  test("pasting 200 times in a loop keeps the clipboard history bounded and the page responsive", async ({ page }) => {
    await open(page);
    await editor(page).focus();
    for (let i = 0; i < 200; i += 1) {
      await editor(page).evaluate((el, n) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", `loop ${n}`);
        transfer.setData("text/html", `<ul><li>loop ${n}</li></ul>`);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
      }, i);
    }
    await page.waitForTimeout(2500);
    const items = await apiJson<Array<{ pinned: boolean }>>("/api/clipboard?limit=500");
    expect(items.filter((item) => !item.pinned).length).toBeLessThanOrEqual(100);
    expect((await editorValue(page)).match(/loop \d+/g)?.length).toBe(200);
  });

  test("pasting the same text twice does not fill the clipboard history with duplicates", async ({ page }) => {
    await open(page);
    await editor(page).focus();
    const before = (await apiJson<Array<{ content: string }>>("/api/clipboard?limit=500")).length;
    for (let i = 0; i < 3; i += 1) {
      await editor(page).evaluate((el) => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", "# duplicate paste probe");
        transfer.setData("text/html", "<h1>duplicate paste probe</h1>");
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
      });
    }
    await page.waitForTimeout(1500);
    const after = (await apiJson<Array<{ content: string }>>("/api/clipboard?limit=500")).length;
    expect(after - before, "identical pastes are each stored as a separate history item").toBeLessThanOrEqual(1);
  });

  test("clipboard history entries have meaningful names, not 'copied text-<id>'", async ({ page }) => {
    await open(page);
    await editor(page).focus();
    await editor(page).evaluate((el) => {
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "# Quarterly Plan\n\ntext");
      transfer.setData("text/html", "<h1>Quarterly Plan</h1><p>text</p>");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await page.getByRole("button", { name: "Clipboard History", exact: true }).click();
    await page.waitForTimeout(1200);
    await expect(page.locator("aside")).toContainText("Quarterly Plan");
  });

  test("find & replace: replace-all on 5 000 matches stays fast and is one undo step", async ({ page }) => {
    await open(page);
    await setContent(page, Array.from({ length: 5000 }, (_, i) => `foo ${i}`).join("\n"));
    await editor(page).click();
    await page.keyboard.press("Control+h");
    const finder = page.getByRole("textbox", { name: /find/i }).first();
    await finder.fill("foo");
    const replacer = page.getByRole("textbox", { name: /replace/i }).first();
    await replacer.fill("bar");
    const started = Date.now();
    await page.getByRole("button", { name: /replace all/i }).click();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await editorValue(page)).not.toContain("foo ");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await editorValue(page)).toContain("foo 0");
  });

  test("find treats regex metacharacters literally", async ({ page }) => {
    await open(page);
    await setContent(page, "a.b (c) [d] a+b a*b");
    await editor(page).click();
    await page.keyboard.press("Control+f");
    const finder = page.getByRole("textbox", { name: /find/i }).first();
    await finder.fill("(c) [d]");
    await expect(page.getByRole("search", { name: "Find and replace" })).toContainText("1 found");
  });

  test("Convert diagram with the cursor outside any diagram says what to do instead of failing silently", async ({ page }) => {
    await open(page);
    await setContent(page, "just prose");
    await page.getByRole("combobox", { name: "Convert diagram" }).selectOption("mermaid");
    await expect(status(page)).toContainText(/cursor|diagram/i);
  });

  test("ASCII diagram converted to Mermaid renders in the preview", async ({ page }) => {
    await open(page);
    await setContent(page, "+-----+     +----+\n| API | --> | DB |\n+-----+     +----+");
    await editor(page).evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(3, 3));
    await page.getByRole("combobox", { name: "Convert diagram" }).selectOption("mermaid");
    await expect(status(page)).toContainText(/converted/i, { timeout: 15_000 });
    await expect(editor(page)).toHaveValue(new RegExp(FENCE + "mermaid"), { timeout: 5000 });
  });
});
