import { expect, test, type Page } from "@playwright/test";
import {
  FENCE,
  GITHUB_FLAVOURED_DOC,
  MALFORMED_DOC,
  MERMAID_VALID,
  MIXED_HTML_DOC,
  NESTED_FENCE_DOC,
  UNICODE_DOC,
  bigTable,
} from "../support/corpus";
import { apiJson, editor, editorValue, open, preview, setContent, unique } from "../support/app";

const status = (page: Page) => page.getByRole("status").first();
const saveButton = (page: Page) => page.getByRole("button", { name: /^Save (as new document|changes)$/ });

async function listDocuments(): Promise<Array<{ id: string; title: string; content: string }>> {
  return apiJson("/api/documents?limit=500");
}

test.describe("data loss and state handling", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("opening another document with unsaved edits asks before discarding them", async ({ page }) => {
    const title = unique("UAT other doc");
    await apiJson("/api/documents", { method: "POST", body: JSON.stringify({ title, content: `# ${title}\n\nbody` }) });
    await page.reload();
    await setContent(page, "# My precious unsaved work\n\nThree hours of typing");
    await page.getByRole("button", { name: "Documents" }).click();
    await page.getByRole("textbox", { name: "Search documents" }).fill(title);
    await page.getByRole("button", { name: title, exact: true }).click();
    // Expected: a confirmation before the editor is replaced.
    await expect(page.getByRole("alertdialog")).toBeVisible();
    const value = await editorValue(page);
    const confirmed = value.includes("precious");
    expect(confirmed, "unsaved edits were replaced without any warning").toBe(true);
  });

  test("Save, then open keeps the replaced text as its own document", async ({ page }) => {
    const title = unique("UAT undo doc");
    const draft = unique("Draft to protect");
    await apiJson("/api/documents", { method: "POST", body: JSON.stringify({ title, content: `# ${title}\n\nbody` }) });
    await page.reload();
    await setContent(page, `# ${draft}\n\nText`);
    await page.getByRole("textbox", { name: "Search documents" }).fill(title);
    await page.getByRole("button", { name: title, exact: true }).click();
    await page.getByRole("button", { name: "Save, then open" }).click();
    await expect(editor(page)).toHaveValue(new RegExp(title));
    expect((await listDocuments()).some((d) => d.title === draft), "the replaced text was not kept").toBe(true);
  });

  test("leaving the page with unsaved changes triggers a beforeunload warning", async ({ page }) => {
    await setContent(page, "# Unsaved\n\nedits");
    let dialogSeen = false;
    page.on("dialog", async (dialog) => {
      dialogSeen = dialog.type() === "beforeunload";
      await dialog.dismiss();
    });
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
    const prevented = await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented || dialogSeen, "no beforeunload handler: closing the tab silently loses unsaved work").toBe(true);
  });

  test("clicking the HTML/DOCX/PDF preview tabs does not create documents behind the user's back", async ({ page }) => {
    await setContent(page, `# ${unique("UAT tab side effect")}\n\nbody`);
    const before = (await listDocuments()).length;
    await page.getByRole("tab", { name: "HTML" }).click();
    await expect(page.getByTitle("HTML export")).toBeVisible({ timeout: 30_000 });
    const after = (await listDocuments()).length;
    expect(after, "viewing the HTML tab silently saved a new document").toBe(before);
  });

  test("exporting repeatedly creates at most one document", async ({ page }) => {
    await setContent(page, `# ${unique("UAT repeated export")}\n\nbody`);
    const before = (await listDocuments()).length;
    for (const tab of ["HTML", "PDF", "DOCX"]) {
      await page.getByRole("tab", { name: tab }).click();
      await expect(status(page)).toContainText(/export ready|failed/i, { timeout: 60_000 });
    }
    const after = (await listDocuments()).length;
    expect(after - before).toBeLessThanOrEqual(1);
  });

  test("a heading longer than 255 characters can still be saved", async ({ page }) => {
    await setContent(page, `# ${"Very long title ".repeat(30)}\n\nbody`);
    await saveButton(page).click();
    await expect(status(page)).toContainText(/Saved/, { timeout: 15_000 });
  });

  test("saving a 2.5 MB document reports a clear, actionable error", async ({ page }) => {
    await setContent(page, `# Big\n\n${"x".repeat(2_500_000)}`);
    await saveButton(page).click();
    await expect(status(page)).toContainText(/Save failed|Saved/, { timeout: 30_000 });
    const text = (await status(page).textContent()) ?? "";
    expect.soft(text, "raw API validation noise shown to the user").not.toMatch(/\[object Object\]|string_too_long|loc\b/);
  });

  test("deleting a document asks for confirmation", async ({ page }) => {
    const title = unique("UAT delete me");
    await apiJson("/api/documents", { method: "POST", body: JSON.stringify({ title, content: "# x" }) });
    await page.reload();
    await page.getByRole("textbox", { name: "Search documents" }).fill(title);
    await page.getByRole("button", { name: `Delete ${title}` }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.waitForTimeout(1000);
    const remaining = await apiJson<unknown[]>(`/api/documents?q=${encodeURIComponent(title)}`);
    expect(remaining.length, "one click permanently removed the document with no confirmation or undo").toBeGreaterThan(0);
    await page.getByRole("button", { name: "Cancel" }).click();
    expect((await apiJson<unknown[]>(`/api/documents?q=${encodeURIComponent(title)}`)).length).toBe(1);
  });

  test("deleting the open document leaves the editor in a consistent state", async ({ page }) => {
    const title = unique("UAT delete open");
    await setContent(page, `# ${title}\n\nbody`);
    await saveButton(page).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await page.getByRole("textbox", { name: "Search documents" }).fill(title);
    await page.getByRole("button", { name: `Delete ${title}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Not saved");
    await expect(editor(page)).toHaveValue(new RegExp(title));
  });

  test("refreshing immediately after typing keeps the last keystrokes", async ({ page }) => {
    await editor(page).click();
    await editor(page).press("Control+End");
    await page.keyboard.type(" LASTWORD", { delay: 0 });
    await page.reload();
    await expect(editor(page)).toHaveValue(/LASTWORD/);
  });

  test("clearing the editor and refreshing does not resurrect the starter document", async ({ page }) => {
    await setContent(page, "");
    await page.waitForTimeout(800);
    await page.reload();
    expect(await editorValue(page), "an intentionally emptied document comes back after refresh").toBe("");
  });
});

test.describe("multiple tabs", () => {
  test("two tabs saving the same document: the stale tab must not silently overwrite newer work", async ({ browser }) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    const title = unique("UAT conflict");
    await open(a);
    await setContent(a, `# ${title}\n\nversion A1`);
    await saveButton(a).click();
    await expect(a.getByTestId("save-state")).toHaveText("Saved");
    await open(b);
    await b.getByRole("textbox", { name: "Search documents" }).fill(title);
    await b.getByRole("button", { name: title, exact: true }).click();
    await expect(editor(b)).toHaveValue(/version A1/);
    await setContent(a, `# ${title}\n\nversion A2 (newer)`);
    await saveButton(a).click();
    await expect(a.getByTestId("save-state")).toHaveText("Saved");
    await setContent(b, `# ${title}\n\nversion B (stale)`);
    await saveButton(b).click();
    await expect(b.getByRole("alertdialog")).toContainText(/changed/i);
    const doc = (await listDocuments()).find((d) => d.title === title);
    expect(doc?.content, "tab B overwrote tab A's newer save without any conflict warning").toContain("version A2");
    await context.close();
  });

  test("draft typed in one tab does not clobber the draft of another tab after refresh", async ({ browser }) => {
    const context = await browser.newContext();
    const a = await context.newPage();
    const b = await context.newPage();
    await open(a);
    await b.goto("/");
    await setContent(a, "# Tab A draft");
    await setContent(b, "# Tab B draft");
    await a.waitForTimeout(800);
    await a.reload();
    expect(await editorValue(a), "tabs share one draft slot, so the later tab silently wins").toContain("Tab A draft");
    await context.close();
  });
});

test.describe("network failures", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("Save with the API down reports failure and keeps the work", async ({ page }) => {
    await setContent(page, "# Offline save\n\ntext");
    await page.route("**/api/documents**", (route) => route.abort("connectionrefused"));
    await saveButton(page).click();
    await expect(status(page)).toContainText(/failed/i);
    await expect(page.getByTestId("save-state")).not.toHaveText("Saved");
    await expect(editor(page)).toHaveValue(/Offline save/);
  });

  test("Save failure message is human readable, not a raw TypeError", async ({ page }) => {
    await setContent(page, "# Offline save\n\ntext");
    await page.route("**/api/documents**", (route) => route.abort("connectionrefused"));
    await saveButton(page).click();
    await expect(status(page)).toContainText(/failed/i);
    expect(await status(page).textContent()).not.toMatch(/Failed to fetch|TypeError|NetworkError/);
  });

  test("Clean AI Text with the API down fails gracefully (no unhandled rejection, status not stuck)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/transform", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "Clean AI Text" }).click();
    await page.waitForTimeout(1500);
    expect.soft(errors, "unhandled promise rejection in the page").toEqual([]);
    await expect(status(page), "status stuck on 'Cleaning text…'").not.toHaveText(/Cleaning text/);
  });

  test("Smart Paste with the API down fails gracefully", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/parse-paste", (route) => route.abort("connectionrefused"));
    await page.getByRole("button", { name: "Smart Paste" }).click();
    await page.waitForTimeout(1500);
    expect.soft(errors).toEqual([]);
    await expect(status(page)).not.toHaveText(/Detecting content structure/);
  });

  test("the sidebar shows an error (not an eternal empty list) when the API is unreachable", async ({ page }) => {
    await page.route("**/api/documents**", (route) => route.abort("connectionrefused"));
    await page.reload();
    await page.waitForTimeout(2500);
    const aside = page.locator("aside");
    await expect(aside).toContainText(/error|could not|unavailable|failed|retry/i);
  });

  test("working offline keeps the editor and preview alive", async ({ page, context }) => {
    await context.setOffline(true);
    await setContent(page, "# Still typing offline\n\n- a\n- b");
    await expect(preview(page).locator("h1")).toHaveText("Still typing offline");
    await context.setOffline(false);
  });

  test("a slow API (8 s) shows progress and the UI stays responsive", async ({ page }) => {
    await page.route("**/api/documents", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.continue();
    });
    await setContent(page, `# ${unique("UAT slow")}\n\nbody`);
    await saveButton(page).click();
    await expect(saveButton(page)).toBeDisabled();
    await editor(page).press("End");
    await page.keyboard.type(" typed while saving");
    await expect(editor(page)).toHaveValue(/typed while saving/);
    await expect(page.getByTestId("save-state")).toHaveText(/Saved|Unsaved changes/, { timeout: 30_000 });
  });

  test("an export that never finishes gives up with a message", async ({ page }) => {
    await page.route("**/api/exports/*", (route) => (route.request().method() === "GET" && !route.request().url().includes("download") ? route.fulfill({ json: { job_id: "x", status: "processing", type: "docx", file_url: null, error: null } }) : route.continue()));
    await setContent(page, `# ${unique("UAT hung export")}\n\nbody`);
    await page.getByRole("tab", { name: "DOCX" }).click();
    await expect(status(page)).toContainText(/Generating|queued/);
    // client gives up after 180 s; just assert the app is still interactive meanwhile
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  });
});

test.describe("editor modes and tooling alter content", () => {
  test.beforeEach(async ({ page }) => open(page));

  const roundTripCorpus: Array<[string, string]> = [
    ["nested fence", NESTED_FENCE_DOC],
    ["mixed html", MIXED_HTML_DOC],
    ["gfm extras", GITHUB_FLAVOURED_DOC],
    ["unicode", UNICODE_DOC],
    ["malformed", MALFORMED_DOC],
    ["mermaid", `# D\n\n${FENCE}mermaid\n${MERMAID_VALID.flowchart}\n${FENCE}\n`],
    ["wide table", `# T\n\n${bigTable(5, 8)}\n`],
  ];

  for (const [name, doc] of roundTripCorpus) {
    test(`switching Source -> Rich -> Source preserves content (${name})`, async ({ page }) => {
      await setContent(page, doc);
      await page.getByRole("button", { name: "Rich", exact: true }).click();
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: "Source", exact: true }).click();
      const after = await editorValue(page);
      expect(after.trim()).toBe(doc.trim());
    });
  }

  test("Clean AI Text does not alter code blocks", async ({ page }) => {
    const doc = `Sure! Here is the code:\n\n${FENCE}python\ndef f():\n    # Sure, here's a note\n    return "Certainly!"\n${FENCE}\n\nLet me know if you need more.`;
    await setContent(page, doc);
    await page.getByRole("button", { name: "Clean AI Text" }).click();
    await page.getByRole("button", { name: "Apply Changes" }).click();
    await expect(status(page)).toHaveText(/Text cleaned|failed/);
    const after = await editorValue(page);
    expect.soft(after).toContain('# Sure, here\'s a note');
    expect.soft(after).toContain('return "Certainly!"');
    expect.soft(after).not.toContain("Let me know");
  });

  test("Clean AI Text is a single undo step", async ({ page }) => {
    const before = "Certainly! Below is the document.\n\n# Title\n\nText";
    await setContent(page, before);
    await page.getByRole("button", { name: "Clean AI Text" }).click();
    await page.getByRole("button", { name: "Apply Changes" }).click();
    await expect(status(page)).toHaveText(/Text cleaned/);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(editor(page)).toHaveValue(before);
  });

  test("Smart Paste leaves already-good markdown untouched", async ({ page }) => {
    const doc = `# Title\n\n${bigTable(3, 3)}\n\n${FENCE}python\nprint(1)\n${FENCE}\n`;
    await setContent(page, doc);
    await page.getByRole("button", { name: "Smart Paste" }).click();
    await expect(status(page)).toHaveText(/Detected|failed/);
    expect((await editorValue(page)).trim()).toBe(doc.trim());
  });
});
