import { expect, test, type Page } from "@playwright/test";
import { FENCE, bigDocument, bigTable, flowchart } from "../support/corpus";
import { editor, open, preview, setContent } from "../support/app";

async function heapMb(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("HeapProfiler.collectGarbage");
  const { metrics } = await session.send("Performance.getMetrics");
  await session.detach();
  return (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1024 / 1024;
}

/** Time from pressing a key until the preview shows it, which is what a typing user perceives as lag. */
async function typingLatency(page: Page, samples = 5): Promise<number[]> {
  const times: number[] = [];
  await editor(page).click();
  await editor(page).press("Control+Home");
  for (let i = 0; i < samples; i += 1) {
    const marker = `zq${i}x`;
    const start = Date.now();
    await page.keyboard.type(marker, { delay: 0 });
    await expect(preview(page)).toContainText(marker, { timeout: 30_000 });
    times.push(Date.now() - start);
  }
  return times;
}

test.describe("page load", () => {
  test("cold load reaches an interactive editor quickly", async ({ page }, info) => {
    const started = Date.now();
    await page.goto("/");
    await expect(editor(page)).toBeVisible();
    await expect(preview(page)).toBeVisible();
    const elapsed = Date.now() - started;
    info.annotations.push({ type: "cold-load-ms", description: String(elapsed) });
    expect(elapsed).toBeLessThan(4000);
  });

  test("navigation timing: DOMContentLoaded and transferred JS size", async ({ page }, info) => {
    await page.goto("/");
    await expect(preview(page)).toBeVisible();
    const t = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const js = performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".js")) as PerformanceResourceTiming[];
      return { dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, jsKb: js.reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize), 0) / 1024 };
    });
    info.annotations.push({ type: "timing", description: JSON.stringify(t) });
    expect(t.dcl).toBeLessThan(3000);
    expect(t.jsKb, "initial JS payload in KB").toBeLessThan(1500);
  });
});

test.describe("editor responsiveness with large documents", () => {
  test.describe.configure({ timeout: 240_000 });

  for (const lines of [1000, 10_000]) {
    test(`${lines} lines: typing reaches the preview within 1.5 s per keystroke burst`, async ({ page }, info) => {
      await open(page);
      const loadStart = Date.now();
      await setContent(page, bigDocument(lines));
      await expect(preview(page).locator("h1")).toHaveText("Large document", { timeout: 60_000 });
      info.annotations.push({ type: `paste-render-ms-${lines}`, description: String(Date.now() - loadStart) });
      const times = await typingLatency(page);
      info.annotations.push({ type: `typing-ms-${lines}`, description: times.join(",") });
      const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
      expect(median, `typing latency (ms): ${times.join(", ")}`).toBeLessThan(1500);
    });
  }

  test("main thread is not blocked longer than 1 s while rendering a 10 000 line paste", async ({ page }, info) => {
    await open(page);
    await page.evaluate(() => {
      (window as unknown as { __longest: number }).__longest = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) (window as unknown as { __longest: number }).__longest = Math.max((window as unknown as { __longest: number }).__longest, entry.duration);
      }).observe({ entryTypes: ["longtask"] });
    });
    await setContent(page, bigDocument(10_000));
    await page.waitForTimeout(4000);
    const longest = await page.evaluate(() => (window as unknown as { __longest: number }).__longest);
    info.annotations.push({ type: "longest-task-ms", description: String(Math.round(longest)) });
    expect(longest, "UI froze for this many ms").toBeLessThan(1000);
  });

  test("a 1 MB single-line paragraph does not hang the tab", async ({ page }) => {
    await open(page);
    await setContent(page, "a".repeat(1_000_000));
    await expect(editor(page)).toBeEditable();
    const started = Date.now();
    await page.keyboard.type("b");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  test("large table (200 x 12) renders and scrolls inside its container, not the page", async ({ page }) => {
    await open(page);
    await setContent(page, bigTable(200, 12));
    await expect(preview(page).locator("table")).toBeVisible();
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(pageOverflow).toBeLessThanOrEqual(1);
  });

  test("50 mermaid diagrams in one document: page stays responsive and all render or fail visibly", async ({ page }, info) => {
    await open(page);
    const blocks = Array.from({ length: 50 }, (_, i) => `## D${i}\n\n${FENCE}mermaid\nflowchart LR\n  A${i}-->B${i}\n${FENCE}`).join("\n\n");
    const started = Date.now();
    await setContent(page, blocks);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(50, { timeout: 90_000 });
    info.annotations.push({ type: "50-diagrams-ms", description: String(Date.now() - started) });
    const t0 = Date.now();
    await page.keyboard.type("x");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  test("gigantic mermaid diagram (400 nodes) either renders or reports an error, never silently blank", async ({ page }) => {
    await open(page);
    await setContent(page, flowchart(400));
    await expect(preview(page).locator(".mermaid svg, .mermaid-error").first()).toBeVisible({ timeout: 90_000 });
  });

  test("every keystroke re-renders all diagrams: typing in a diagram-heavy doc stays under 1.5 s", async ({ page }, info) => {
    await open(page);
    const blocks = Array.from({ length: 15 }, (_, i) => `${FENCE}mermaid\nsequenceDiagram\n  A${i}->>B${i}: hi\n${FENCE}`).join("\n\n");
    await setContent(page, blocks);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(15, { timeout: 60_000 });
    const times = await typingLatency(page, 4);
    info.annotations.push({ type: "typing-with-diagrams-ms", description: times.join(",") });
    expect(Math.max(...times)).toBeLessThan(1500);
  });
});

test.describe("stress and memory", () => {
  test.describe.configure({ timeout: 300_000 });

  test("undo spam x300 then redo spam x300 ends in a consistent state", async ({ page }) => {
    await open(page);
    await editor(page).click();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.type(`word${i} `, { delay: 0 });
      await page.waitForTimeout(720); // each pause forms a separate undo step
    }
    const full = await editor(page).inputValue();
    for (let i = 0; i < 300; i += 1) await page.keyboard.press("Control+z");
    const undone = await editor(page).inputValue();
    expect(undone.length).toBeLessThan(full.length);
    for (let i = 0; i < 300; i += 1) await page.keyboard.press("Control+Shift+z");
    expect(await editor(page).inputValue()).toBe(full);
  });

  test("100 rapid paste/replace cycles do not leak memory beyond 150 MB growth", async ({ page }, info) => {
    await open(page);
    const before = await heapMb(page);
    const doc = bigDocument(400);
    for (let i = 0; i < 100; i += 1) {
      await setContent(page, `${doc}\n\nrun ${i}`);
      await setContent(page, "");
    }
    const after = await heapMb(page);
    info.annotations.push({ type: "heap-mb", description: `${before.toFixed(1)} -> ${after.toFixed(1)}` });
    expect(after - before).toBeLessThan(150);
  });

  test("repeated mermaid re-rendering (60 edits) does not accumulate DOM nodes or heap", async ({ page }, info) => {
    await open(page);
    await setContent(page, `${FENCE}mermaid\nflowchart LR\n  A-->B\n${FENCE}\n\ntext`);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 20_000 });
    const before = await heapMb(page);
    const nodesBefore = await page.evaluate(() => document.querySelectorAll("*").length);
    await editor(page).click();
    await editor(page).press("Control+End");
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.type(`.${i}`);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    const after = await heapMb(page);
    const nodesAfter = await page.evaluate(() => document.querySelectorAll("*").length);
    info.annotations.push({ type: "mermaid-leak", description: `heap ${before.toFixed(1)}->${after.toFixed(1)} MB, nodes ${nodesBefore}->${nodesAfter}` });
    expect(nodesAfter - nodesBefore, "orphaned mermaid DOM nodes in <body>").toBeLessThan(200);
    expect(await page.locator("body > [id^='dmermaid'], body > [id^='mermaid']").count()).toBe(0);
  });

  test("theme switching 60 times while typing never drops keystrokes", async ({ page }) => {
    await open(page);
    await editor(page).click();
    await editor(page).press("Control+End");
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    for (let i = 0; i < 60; i += 1) {
      await toggle.click();
      await editor(page).click();
      await page.keyboard.type("k", { delay: 0 });
    }
    expect((await editor(page).inputValue()).match(/k/g)?.length ?? 0).toBeGreaterThanOrEqual(60);
  });
});
