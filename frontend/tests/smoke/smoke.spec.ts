import { expect, test } from "@playwright/test";
import { apiJson, editor, editorValue, open, preview, setContent, unique } from "../support/app";

test.describe("smoke: the application is alive end to end", () => {
  test("health endpoints report ok", async () => {
    const health = await apiJson<{ status: string }>("/api/health");
    expect(health.status).toBe("ok");
    const ready = await apiJson<{ status?: string }>("/api/ready");
    expect(JSON.stringify(ready)).toMatch(/ok|ready/i);
  });

  test("home page loads with banner, navigation, editor, preview and status bar", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
    await page.goto("/");
    await expect(page.getByRole("banner")).toContainText("Tidyscribe");
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await expect(editor(page)).toBeVisible();
    await expect(preview(page)).toBeVisible();
    await expect(page.getByRole("status").first()).toBeVisible();
    expect(errors.filter((e) => !/favicon|Failed to load resource/i.test(e))).toEqual([]);
  });

  test("typing in the editor updates the preview", async ({ page }) => {
    await open(page);
    await setContent(page, "# Smoke Heading\n\n- one\n- two");
    await expect(preview(page).locator("h1")).toHaveText("Smoke Heading");
    await expect(preview(page).locator("li")).toHaveCount(2);
  });

  test("save creates a document that can be found and reopened", async ({ page }) => {
    await open(page);
    const title = unique("UAT smoke save");
    await setContent(page, `# ${title}\n\nPersisted body`);
    await page.getByRole("button", { name: "Save as new document" }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    await page.reload();
    await page.getByRole("textbox", { name: "Search documents" }).fill(title);
    await page.getByRole("button", { name: title, exact: true }).click();
    await expect(editor(page)).toHaveValue(/Persisted body/);
  });

  test("all four preview tabs exist and Markdown export downloads a file", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("tab")).toHaveText(["Preview", "HTML", "DOCX", "PDF"]);
    await setContent(page, `# ${unique("UAT smoke md")}\n\nbody`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.md$/);
  });

  for (const [item, extension] of [["Word (.docx)", "docx"], ["PDF", "pdf"], ["HTML", "html"]] as const) {
    test(`export menu downloads a ${extension} file`, async ({ page }) => {
      await open(page);
      await setContent(page, `# ${unique("UAT smoke export")}\n\nbody`);
      const download = page.waitForEvent("download", { timeout: 60_000 });
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("menuitem", { name: item }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    });
  }

  test("a Mermaid diagram renders", async ({ page }) => {
    await open(page);
    await setContent(page, "```mermaid\nflowchart LR\n  A-->B\n```");
    await expect(preview(page).locator(".mermaid svg")).toBeVisible({ timeout: 20_000 });
  });

  test("every sidebar section opens", async ({ page }) => {
    await open(page);
    for (const section of ["Templates", "Snippets", "Clipboard History", "Settings", "Documents"]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      await expect(page.getByRole("button", { name: section, exact: true })).toHaveAttribute("aria-current", "page");
    }
  });

  test("theme toggle cycles and persists across reload", async ({ page }) => {
    await open(page);
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");
    await page.getByRole("button", { name: /^Theme:/ }).click();
    const after = await html.getAttribute("data-theme");
    expect(after).not.toBe(before);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after as string);
    await page.getByRole("button", { name: /^Theme:/ }).click();
    await page.getByRole("button", { name: /^Theme:/ }).click();
  });

  test("starter document is restored when localStorage is empty", async ({ page }) => {
    await open(page);
    expect(await editorValue(page)).toContain("Executive Summary");
  });
});
