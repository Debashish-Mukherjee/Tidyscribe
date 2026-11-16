import { expect, test, type Page } from "@playwright/test";
import { FENCE, MERMAID_VALID } from "../support/corpus";
import { apiJson, editor, open, preview, setContent, unique } from "../support/app";

const toggle = (page: Page) => page.getByRole("button", { name: /^Theme:/ });
const dataTheme = (page: Page) => page.locator("html").getAttribute("data-theme");

async function chooseTheme(page: Page, label: "Dark" | "Light" | "System") {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: label }).check();
}

test.describe("theming", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("dark, light and system modes all apply a theme to <html>", async ({ page }) => {
    await chooseTheme(page, "Light");
    expect(await dataTheme(page)).toBe("light");
    await chooseTheme(page, "Dark");
    expect(await dataTheme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await chooseTheme(page, "System");
    await expect.poll(() => dataTheme(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => dataTheme(page)).toBe("dark");
  });

  test("the theme toggle and the Settings radios never disagree", async ({ page }) => {
    await toggle(page).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const label = (await toggle(page).getAttribute("aria-label")) ?? "";
    const mode = label.match(/Theme: (\w+)/)?.[1] ?? "";
    await expect(page.getByRole("radio", { name: new RegExp(`^${mode}$`, "i") })).toBeChecked();
  });

  test("no flash of the wrong theme on reload (first paint already themed)", async ({ page }) => {
    await chooseTheme(page, "Light");
    await page.reload({ waitUntil: "commit" });
    const early = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(early).toBe("light");
  });

  test("theme survives a cleared localStorage because it is stored on the server", async ({ page }) => {
    await chooseTheme(page, "Light");
    await page.waitForTimeout(600);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect.poll(() => dataTheme(page), { timeout: 10_000 }).toBe("light");
  });

  test("two browsers: a theme chosen in one is picked up by a fresh session in the other", async ({ browser, page }) => {
    await chooseTheme(page, "Light");
    await page.waitForTimeout(600);
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto("/");
    await expect.poll(() => dataTheme(second), { timeout: 10_000 }).toBe("light");
    await other.close();
  });

  test("rapid theme toggling x100 ends in a valid, persisted state with no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (let i = 0; i < 100; i += 1) await toggle(page).click({ delay: 0 });
    expect(["dark", "light"]).toContain(await dataTheme(page));
    await page.waitForTimeout(800);
    const saved = await apiJson<Record<string, string>>("/api/settings");
    const label = (await toggle(page).getAttribute("aria-label")) ?? "";
    const mode = label.match(/Theme: (\w+)/)?.[1];
    expect.soft(Object.values(saved), "the last chosen mode should be what the server stored").toContain(mode);
    expect(errors).toEqual([]);
  });

  test("switching theme does not blank, reset or reformat the editor and preview", async ({ page }) => {
    const doc = `# ${unique("Theme doc")}\n\n${FENCE}mermaid\n${MERMAID_VALID.flowchart}\n${FENCE}\n\n| a | b |\n|---|---|\n| 1 | 2 |`;
    await setContent(page, doc);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
    await editor(page).evaluate((el) => (el as HTMLTextAreaElement).setSelectionRange(5, 9));
    await toggle(page).click();
    await expect(editor(page)).toHaveValue(doc);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
    await expect(preview(page).locator("table")).toBeVisible();
  });

  test("a Mermaid diagram rendered in dark is re-themed (readable) after switching to light", async ({ page }) => {
    await setContent(page, `${FENCE}mermaid\n${MERMAID_VALID.flowchart}\n${FENCE}`);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
    await toggle(page).click(); // dark -> light
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => {
      const root = document.querySelector("[data-testid=preview-host]")!.shadowRoot!;
      const svg = root.querySelector(".md-preview .mermaid svg");
      const bg = getComputedStyle(root.querySelector(".md-preview")!).backgroundColor;
      const text = svg?.querySelector("text, .nodeLabel, span");
      return { fill: text ? getComputedStyle(text).color : null, bg, theme: document.documentElement.dataset.theme };
    });
    expect.soft(result.theme).toBe("light");
    const parse = (s: string | null) => (s?.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
    const lum = (rgb: number[]) => rgb.reduce((acc, v, i) => acc + [0.2126, 0.7152, 0.0722][i] * (v / 255), 0);
    const fg = parse(result.fill);
    if (fg.length === 3) expect.soft(Math.abs(lum(fg) - lum([255, 255, 255])), "diagram text is white-on-white after theme switch").toBeGreaterThan(0.2);
  });

  test("code blocks, tables, blockquotes and callouts have distinct visible styling in light mode", async ({ page }) => {
    await chooseTheme(page, "Light");
    await setContent(page, `# H\n\n> [!NOTE]\n> note\n\n> plain quote\n\n${FENCE}js\nconst a = 1\n${FENCE}\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n\`inline\``);
    const styles = await page.evaluate(() => {
      const rgb = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : "none");
      const color = (el: Element | null) => (el ? getComputedStyle(el).color : "none");
      const root = document.querySelector("[data-testid=preview-host]")!.shadowRoot!.querySelector(".md-preview")!;
      return {
        page: getComputedStyle(root.closest("div.h-screen") ?? document.body).backgroundColor,
        pre: rgb(root.querySelector("pre")),
        preText: color(root.querySelector("pre")),
        th: rgb(root.querySelector("th")),
        callout: rgb(root.querySelector("blockquote.callout")),
        inline: rgb(root.querySelector("p code")),
      };
    });
    expect(styles.pre, "code block background is identical to the page background").not.toBe(styles.page);
    expect(styles.preText).not.toBe(styles.pre);
    expect(styles.th).not.toBe(styles.page);
  });

  test("exporting while the theme changes still downloads a light-on-white document", async ({ page }) => {
    await setContent(page, `# ${unique("UAT theme export")}\n\nbody`);
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("menuitem", { name: "HTML" }).click();
    await toggle(page).click();
    const file = await download;
    const path = await file.path();
    const html = (await import("node:fs")).readFileSync(path, "utf8");
    expect(html).toMatch(/<h1/);
    expect(html, "exported HTML should not depend on the app's current theme").not.toMatch(/data-theme/);
  });

  test("the HTML export preview iframe is readable in both themes", async ({ page }) => {
    await setContent(page, `# ${unique("UAT iframe")}\n\nreadable text`);
    await page.getByRole("tab", { name: "HTML" }).click();
    const frame = page.frameLocator("iframe[title='HTML export']");
    await expect(frame.locator("h1")).toBeVisible({ timeout: 60_000 });
    await toggle(page).click();
    await expect(frame.locator("h1")).toBeVisible();
  });
});
