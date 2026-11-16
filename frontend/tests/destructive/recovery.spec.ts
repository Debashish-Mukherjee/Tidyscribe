import { expect, test } from "@playwright/test";
import { editor, editorValue, open, preview, setContent, unique } from "../support/app";

test.describe("recovery", () => {
  test("closing the tab mid-edit and reopening in the same browser restores the draft", async ({ context }) => {
    const first = await context.newPage();
    await open(first);
    await setContent(first, "# Crash draft\n\nlast sentence before crash");
    await first.waitForTimeout(800);
    await first.close();
    const second = await context.newPage();
    await second.goto("/");
    await expect(editor(second)).toHaveValue(/last sentence before crash/);
    await expect(second.getByRole("status").first()).toContainText(/Restored/i);
  });

  test("a different browser profile (new context) cannot see the draft, so unsaved work is single-browser only", async ({ browser, page }) => {
    await open(page);
    await setContent(page, "# Only here\n\nunsaved");
    await page.waitForTimeout(800);
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto("/");
    expect(await editorValue(second)).not.toContain("Only here");
    await other.close();
  });

  test("the app survives the API disappearing and coming back without a reload", async ({ page }) => {
    await open(page);
    await setContent(page, `# ${unique("UAT outage")}\n\nbody`);
    let down = true;
    await page.route("**/api/**", (route) => (down ? route.abort("connectionrefused") : route.continue()));
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByRole("status").first()).toContainText(/failed/i);
    down = false;
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
  });

  test("an export job that fails server side surfaces the reason and re-enables the UI", async ({ page }) => {
    await open(page);
    await setContent(page, `# ${unique("UAT failed export")}\n\nbody`);
    await page.route("**/api/exports", (route) =>
      route.request().method() === "POST" ? route.fulfill({ status: 202, json: { job_id: "j1", status: "queued", type: "pdf", file_url: null, error: null } }) : route.continue(),
    );
    await page.route("**/api/exports/j1", (route) => route.fulfill({ json: { job_id: "j1", status: "failed", type: "pdf", file_url: null, error: "renderer crashed" } }));
    await page.getByRole("tab", { name: "PDF" }).click();
    await expect(page.getByRole("status").first()).toContainText(/renderer crashed|failed/i);
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  });

  test("session expiry: a 401 from the API is reported as such, not as a generic failure", async ({ page }) => {
    await open(page);
    await setContent(page, "# Auth\n\nbody");
    await page.route("**/api/documents", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 401, json: { detail: "Not authenticated" } }) : route.continue()));
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByRole("status").first()).toContainText(/Not authenticated|sign in|session/i);
    await expect(preview(page)).toBeVisible();
  });
});
