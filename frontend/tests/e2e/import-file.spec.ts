import { expect, test } from "@playwright/test";
import { editor, open, preview, setContent } from "../support/app";

const markdown = { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Imported notes\n\nمرحبا 日本語\n\n- [x] Ready\n") };

test("imports Markdown locally and restores it after reload", async ({ page }) => {
  await open(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import file", exact: true }).click();
  await (await chooser).setFiles(markdown);
  await expect(editor(page)).toHaveValue(markdown.buffer.toString());
  await expect(preview(page).locator("h1")).toHaveText("Imported notes");
  await expect(page.getByTestId("save-state")).toHaveText("Not saved");
  await page.reload();
  await expect(editor(page)).toHaveValue(markdown.buffer.toString());
});

test("Cancel keeps unsaved work and choosing the same file again permits discard", async ({ page }) => {
  await open(page);
  await setContent(page, "# Keep my work");
  const input = page.getByLabel("Choose a document file");
  await input.setInputFiles(markdown);
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("notes.md");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor(page)).toHaveValue("# Keep my work");
  await input.setInputFiles(markdown);
  await dialog.getByRole("button", { name: "Discard and open", exact: true }).click();
  await expect(editor(page)).toHaveValue(markdown.buffer.toString());
});

test("HTML imports retain formatting and remove active content", async ({ page }) => {
  await open(page);
  await page.getByLabel("Choose a document file").setInputFiles({ name: "report.html", mimeType: "text/html", buffer: Buffer.from('<h1>Imported report</h1><p><strong>Important</strong> details</p><script>window.__importExecuted=true</script><iframe srcdoc="oops"></iframe><a href="javascript:alert(1)">Link</a>') });
  await expect(preview(page).locator("h1")).toHaveText("Imported report");
  await expect(preview(page).locator("strong")).toHaveText("Important");
  expect(await editor(page).inputValue()).not.toMatch(/script|iframe|javascript/);
  expect(await page.evaluate(() => "__importExecuted" in window)).toBe(false);
});

test("invalid and oversized files leave the editor intact", async ({ page }) => {
  await open(page);
  const before = await editor(page).inputValue();
  const input = page.getByLabel("Choose a document file");
  await input.setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await expect(page.getByRole("status")).toContainText("Import failed: Choose a Markdown");
  await input.setInputFiles({ name: "large.md", mimeType: "text/markdown", buffer: Buffer.alloc(2_000_001, "a") });
  await expect(page.getByRole("status")).toContainText("File is too large");
  await expect(editor(page)).toHaveValue(before);
});
