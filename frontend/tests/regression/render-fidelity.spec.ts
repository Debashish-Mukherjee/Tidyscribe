import { expect, test, type Page } from "@playwright/test";
import {
  AI_PREAMBLE_DOC,
  FENCE,
  GITHUB_FLAVOURED_DOC,
  HOSTILE_HTML_DOC,
  MALFORMED_DOC,
  MATH_DOC,
  MERMAID_INVALID,
  MERMAID_VALID,
  MIXED_HTML_DOC,
  NESTED_FENCE_DOC,
  UNICODE_DOC,
  deeplyNestedList,
  deeplyNestedQuote,
} from "../support/corpus";
import { editor, open, preview, setContent } from "../support/app";

async function render(page: Page, markdown: string): Promise<void> {
  await setContent(page, markdown);
  await page.waitForTimeout(300);
}

test.describe("preview rendering of AI-generated markdown", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("nested four-backtick fence keeps the inner fence as literal code", async ({ page }) => {
    await render(page, NESTED_FENCE_DOC);
    const pre = preview(page).locator("pre").first();
    await expect(pre).toContainText("```python");
    await expect(pre).toContainText("print('hi')");
    await expect(preview(page)).toContainText("After the nested block.");
  });

  test("mixed markdown and HTML: details, kbd, sub/sup and inline tables survive", async ({ page }) => {
    await render(page, MIXED_HTML_DOC);
    await expect(preview(page).locator("details summary")).toHaveText("More");
    await expect(preview(page).locator("kbd")).toHaveCount(2);
    await expect(preview(page).locator("sub")).toHaveText("2");
    await expect(preview(page).locator("table th")).toHaveText(["A", "B"]);
    await expect(preview(page).locator("details strong")).toHaveText("markdown");
  });

  test("GFM features: footnotes, strike, autolink, alerts, list numbering, tasks", async ({ page }) => {
    await render(page, GITHUB_FLAVOURED_DOC);
    await expect.soft(preview(page).locator("del")).toHaveText("strike");
    await expect.soft(preview(page).locator("a[href='https://example.com']")).toBeVisible();
    await expect.soft(preview(page).locator("[role=checkbox]")).toHaveCount(2);
    // Footnote definition must not appear verbatim as body text.
    await expect.soft(preview(page), "footnote definition shown as literal text").not.toContainText("[^1]:");
    // GitHub alerts: the marker must be consumed, not shown literally.
    await expect.soft(preview(page)).not.toContainText("[!NOTE]");
    await expect.soft(preview(page)).not.toContainText("[!WARNING]");
    // Shortcodes are not standard markdown but AI output uses them constantly.
    await expect.soft(preview(page), "emoji shortcode not converted").not.toContainText(":rocket:");
    await expect.soft(preview(page).locator("dl"), "definition list not rendered").toHaveCount(1);
  });

  test("LaTeX math from AI output is rendered or at least not mangled", async ({ page }) => {
    await render(page, MATH_DOC);
    await expect(preview(page).locator(".katex, mjx-container, math")).not.toHaveCount(0);
  });

  test("Unicode, RTL, CJK and emoji render intact", async ({ page }) => {
    await render(page, UNICODE_DOC);
    await expect(preview(page).locator("h1")).toContainText("概要");
    await expect(preview(page)).toContainText("日本語のテキスト");
    await expect(preview(page)).toContainText("مرحبا بالعالم");
    await expect(preview(page)).toContainText("שלום עולם");
    await expect(preview(page).locator("table td").first()).toHaveText("テスト");
    await expect(preview(page).locator("pre code")).toContainText("こんにちは 🌍");
  });

  test("RTL paragraphs are laid out right-to-left", async ({ page }) => {
    await render(page, "مرحبا بالعالم — النص من اليمين إلى اليسار\n\nשלום עולם — טקסט מימין לשמאל");
    const direction = await preview(page).locator("p").first().evaluate((el) => getComputedStyle(el).direction);
    const align = await preview(page).locator("p").first().evaluate((el) => getComputedStyle(el).textAlign);
    expect(direction === "rtl" || align === "right" || align === "start").toBeTruthy();
    expect(direction, "RTL text should render with dir=rtl (bidi auto)").toBe("rtl");
  });

  test("single newlines inside a paragraph are preserved as line breaks (AI output is line oriented)", async ({ page }) => {
    await render(page, "Line one\nLine two\nLine three");
    await expect(preview(page).locator("br")).toHaveCount(2);
  });

  test("AI preamble and sign-off text is not silently dropped by Preview", async ({ page }) => {
    await render(page, AI_PREAMBLE_DOC);
    await expect(preview(page)).toContainText("Here's a comprehensive design document");
  });

  test("malformed markdown never blanks the preview or throws", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await render(page, MALFORMED_DOC);
    await expect(preview(page).locator("h1")).toHaveText("Broken");
    await expect(preview(page)).toContainText("seven hashes");
    await expect(preview(page)).toContainText("deepest");
    expect(errors).toEqual([]);
  });

  test("an unterminated code fence does not swallow the rest of the preview silently", async ({ page }) => {
    await render(page, `# Title\n\n${FENCE}python\ncode never closed\n\n## Later heading\n\nParagraph`);
    // Documented CommonMark behaviour: everything becomes code. The user should at least still see it.
    await expect(preview(page)).toContainText("Later heading");
  });

  test("a 60-level nested list and a 60-level blockquote render without freezing the page", async ({ page }) => {
    const started = Date.now();
    await render(page, `${deeplyNestedList(60)}\n\n${deeplyNestedQuote(60)}`);
    await expect(preview(page)).toContainText("level 60");
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test("unfenced ASCII / box-drawing diagrams keep their alignment (rendered in a preformatted block)", async ({ page }) => {
    await render(page, "┌─────┐   ┌────┐\n│ API │──▶│ DB │\n└─────┘   └────┘");
    await expect(preview(page).locator("pre"), "box drawing collapsed into a paragraph, alignment lost").toHaveCount(1);
  });

  test("a failing remote image does not break layout", async ({ page }) => {
    await render(page, "![alt text](https://invalid.example/missing.png)\n\nAfter");
    await expect(preview(page)).toContainText("After");
    const width = await preview(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(width).toBeLessThanOrEqual(1);
  });

  test("a very long unbroken heading does not cause horizontal page overflow", async ({ page }) => {
    await render(page, `# ${"Supercalifragilistic".repeat(40)}\n\nBody`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("hostile HTML/links in AI output are neutralised", async ({ page }) => {
    await page.evaluate(() => ((window as unknown as { __pwned?: number }).__pwned = 0));
    await render(page, HOSTILE_HTML_DOC);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(0);
    await expect(preview(page).locator("a[href^='javascript:' i]")).toHaveCount(0);
    await expect(preview(page).locator("a[href^='data:' i]")).toHaveCount(0);
    await expect(preview(page).locator("iframe, form, meta, style, script, input")).toHaveCount(0);
    // Injected <style> must not blank the host page.
    await expect(page.getByRole("button", { name: "Save as new document" })).toBeVisible();
  });

  test("links with target=_blank do not leak window.opener", async ({ page }) => {
    await render(page, "[ext](https://example.com)");
    const rel = await preview(page).locator("a[href='https://example.com']").getAttribute("rel");
    const target = await preview(page).locator("a[href='https://example.com']").getAttribute("target");
    if (target === "_blank") expect(rel).toMatch(/noopener/);
  });
});

test.describe("Mermaid", () => {
  test.beforeEach(async ({ page }) => open(page));

  for (const [name, source] of Object.entries(MERMAID_VALID)) {
    test(`valid ${name} diagram renders to SVG`, async ({ page }) => {
      await render(page, `# D\n\n${FENCE}mermaid\n${source}\n${FENCE}`);
      await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
      await expect(preview(page).locator(".mermaid-error")).toHaveCount(0);
    });
  }

  for (const [name, source] of Object.entries(MERMAID_INVALID)) {
    test(`invalid diagram (${name}) shows an error and keeps the source, page stays usable`, async ({ page }) => {
      await render(page, `# D\n\n${FENCE}mermaid\n${source}\n${FENCE}\n\nAfter diagram`);
      await expect(preview(page).locator(".mermaid-error, .mermaid svg").first()).toBeVisible({ timeout: 20_000 });
      await expect(preview(page)).toContainText("After diagram");
      // A syntax error must never leave mermaid's own "bomb" error SVG injected into <body>.
      await expect(page.locator("body > div[id^='dmermaid'], body > svg[id^='mermaid']")).toHaveCount(0);
    });
  }

  test("HTML inside a diagram label never executes", async ({ page }) => {
    await page.evaluate(() => ((window as unknown as { __pwned?: number }).__pwned = 0));
    await render(page, `${FENCE}mermaid\nflowchart TD\n  A["<img src=x onerror=window.__pwned=1>"] --> B\n  click B href "javascript:window.__pwned=2"\n${FENCE}`);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(0);
    await expect(preview(page).locator("a[href^='javascript:' i]")).toHaveCount(0);
  });

  test("Mermaid blocks keep working after the document is edited repeatedly", async ({ page }) => {
    await render(page, `${FENCE}mermaid\n${MERMAID_VALID.flowchart}\n${FENCE}`);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
    for (let i = 0; i < 5; i += 1) {
      await editor(page).press("End");
      await page.keyboard.type(`\nedit ${i}`);
    }
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
  });

  test("a diagram that is NOT in a mermaid fence (e.g. ```text with graph TD) is left as code", async ({ page }) => {
    await render(page, `${FENCE}text\ngraph TD\n A-->B\n${FENCE}`);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(0);
    await expect(preview(page).locator("pre")).toContainText("graph TD");
  });
});
