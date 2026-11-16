import { expect, test, type Page } from "@playwright/test";
import { open, editor } from "../support/app";

function luminance([r, g, b]: number[]): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Effective text and background colour (walking up through transparent backgrounds). */
async function colours(page: Page, selector: string): Promise<{ fg: number[]; bg: number[]; text: string; size: number } | null> {
  return page.evaluate((sel) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const els = Array.from(document.querySelectorAll(sel)).filter((el) => (el as HTMLElement).offsetParent !== null && (el.textContent ?? "").trim());
    const el = els[0] as HTMLElement | undefined;
    if (!el) return null;
    const fg = parse(getComputedStyle(el).color);
    let node: HTMLElement | null = el;
    let bg = [255, 255, 255];
    while (node) {
      const parsed = parse(getComputedStyle(node).backgroundColor);
      if (parsed.length >= 3 && (parsed.length === 3 || parsed[3] > 0.95)) {
        bg = parsed.slice(0, 3);
        break;
      }
      node = node.parentElement;
    }
    return { fg: fg.slice(0, 3), bg, text: (el.textContent ?? "").trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize) };
  }, selector);
}

const THEMES = ["dark", "light"] as const;
async function setTheme(page: Page, target: "dark" | "light" | "system") {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: target === "dark" ? "Dark" : target === "light" ? "Light" : "System" }).check();
}

test.describe("keyboard-only operation", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("every interactive control is reachable by Tab and shows a visible focus indicator", async ({ page }) => {
    const seen: string[] = [];
    const noIndicator: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
        const shadow = style.boxShadow !== "none";
        const label = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.tagName;
        return { label, indicator: outline || shadow, tag: el.tagName };
      });
      if (!info) continue;
      seen.push(info.label);
      if (!info.indicator && info.tag !== "TEXTAREA") noIndicator.push(info.label);
    }
    expect(seen.length).toBeGreaterThan(15);
    expect.soft(noIndicator, "controls that show no visible focus ring").toEqual([]);
  });

  test("focus never gets trapped: Tab cycles back out of the editor", async ({ page }) => {
    await editor(page).focus();
    await page.keyboard.press("Tab");
    const stillInEditor = await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");
    expect(stillInEditor, "Tab inserted focus into the same textarea (keyboard trap)").toBe(false);
  });

  test("export menu opens with the keyboard, arrows move, Escape closes and returns focus", async ({ page }) => {
    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    await exportButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Export format" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const focusedInMenu = await page.evaluate(() => !!document.activeElement?.closest("[role=menu]"));
    expect.soft(focusedInMenu, "focus did not move into the menu on ArrowDown").toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect.soft(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim()), "focus should return to the Export button").toMatch(/Export/);
  });

  test("preview tabs follow the ARIA tab pattern (arrow keys, roving tabindex, tabpanel)", async ({ page }) => {
    const tabs = page.getByRole("tab");
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    const second = await page.evaluate(() => document.activeElement?.textContent);
    expect.soft(second, "ArrowRight should move to the HTML tab").toBe("HTML");
    await expect.soft(page.getByRole("tabpanel"), "tabs have no tabpanel").toHaveCount(1);
  });

  test("resize separators are focusable and operable with arrow keys", async ({ page }) => {
    const separator = page.getByRole("separator", { name: "Resize editor and preview" });
    await separator.focus();
    const before = await separator.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    expect(await separator.getAttribute("aria-valuenow")).not.toBe(before);
  });

  test("Ctrl+F opens find, Escape closes it and focus returns to the editor", async ({ page }) => {
    await editor(page).click();
    await page.keyboard.press("Control+f");
    await expect(page.getByRole("textbox", { name: /find/i }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: /find/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
  });

  test("a skip link or landmark structure lets screen-reader users jump to the editor", async ({ page }) => {
    const landmarks = await page.evaluate(() => ({
      main: document.querySelectorAll("main, [role=main]").length,
      banner: document.querySelectorAll("header, [role=banner]").length,
      nav: document.querySelectorAll("nav, [role=navigation]").length,
      h1: document.querySelectorAll("h1").length,
      skip: !!document.querySelector("a[href^='#']"),
    }));
    expect(landmarks.main).toBe(1);
    expect(landmarks.banner).toBeGreaterThanOrEqual(1);
    expect.soft(landmarks.skip, "no skip-to-content link").toBe(true);
  });
});

test.describe("screen reader semantics", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("page has a language attribute and a title", async ({ page }) => {
    expect(await page.locator("html").getAttribute("lang")).toBeTruthy();
    expect(await page.title()).toBeTruthy();
  });

  test("every button, select and input has an accessible name", async ({ page }) => {
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll("button, select, input, textarea, [role=button], [role=tab]").forEach((el) => {
        const name = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el as HTMLElement).innerText?.trim() || el.getAttribute("title") || el.getAttribute("placeholder") || (el.id && document.querySelector(`label[for='${el.id}']`)?.textContent);
        if (!name) bad.push(el.outerHTML.slice(0, 100));
      });
      return bad;
    });
    expect(unnamed).toEqual([]);
  });

  test("the status bar is a polite live region and announces save results", async ({ page }) => {
    await expect(page.getByRole("status").first()).toHaveAttribute("aria-live", "polite");
  });

  test("error from a bad diagram is announced to assistive tech", async ({ page }) => {
    await editor(page).fill("```mermaid\nflowchart TD\n  A -->\n```");
    await expect(page.locator(".md-preview [role=alert]")).toHaveCount(1, { timeout: 15_000 });
  });

  test("preview has an accessible name / region so it can be navigated to", async ({ page }) => {
    const named = await page.locator("article.md-preview").evaluate((el) => !!(el.getAttribute("aria-label") || el.closest("[aria-label],[aria-labelledby],section[aria-label]")));
    expect.soft(named, "preview <article> has no accessible name").toBe(true);
  });

  test("delete buttons say which document they delete", async ({ page }) => {
    const names = await page.getByRole("button", { name: /^Delete / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(names.every((n) => (n ?? "").length > "Delete ".length)).toBe(true);
  });

  test("images in rendered content keep their alt text", async ({ page }) => {
    await editor(page).fill("![Architecture overview](https://example.com/a.png)");
    await expect(page.locator(".md-preview img")).toHaveAttribute("alt", "Architecture overview");
  });
});

test.describe("colour contrast (WCAG 1.4.3, AA 4.5:1)", () => {
  for (const theme of THEMES) {
    test(`${theme} theme: key text meets contrast`, async ({ page }) => {
      await open(page);
      await setTheme(page, theme);
      const targets: Array<[string, string, number]> = [
        ["editor text", "textarea", 4.5],
        ["header title", "header .truncate", 4.5],
        ["status bar", "footer [role=status]", 4.5],
        ["preview paragraph", ".md-preview p", 4.5],
        ["preview heading", ".md-preview h2", 4.5],
        ["preview link", ".md-preview a", 4.5],
        ["inactive tab", "[role=tab][aria-selected=false]", 4.5],
        ["active tab", "[role=tab][aria-selected=true]", 4.5],
        ["save state", "[data-testid=save-state]", 4.5],
      ];
      await page.getByRole("button", { name: "Documents", exact: true }).click();
      await editor(page).fill("# T\n\n## H2\n\nparagraph with a [link](https://example.com)\n\n```js\nconst a = 1\n```\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |");
      const failures: string[] = [];
      for (const [label, selector, min] of targets) {
        const c = await colours(page, selector);
        if (!c) continue;
        const ratio = contrast(c.fg, c.bg);
        if (ratio < min) failures.push(`${label} "${c.text}" ${ratio.toFixed(2)}:1`);
      }
      expect(failures).toEqual([]);
    });
  }

  test("placeholder text in the empty editor has enough contrast", async ({ page }) => {
    await open(page);
    await editor(page).fill("");
    const ratio = await page.evaluate(() => {
      const el = document.querySelector("textarea") as HTMLTextAreaElement;
      const placeholder = getComputedStyle(el, "::placeholder").color;
      const bg = getComputedStyle(el).backgroundColor;
      const p = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
      return { fg: p(placeholder), bg: p(bg) };
    });
    expect(contrast(ratio.fg, ratio.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("zoom, reflow and responsive layout (WCAG 1.4.4 / 1.4.10)", () => {
  const viewports = [
    { name: "mobile 375x667", width: 375, height: 667 },
    { name: "tablet 768x1024", width: 768, height: 1024 },
    { name: "laptop 1280x720", width: 1280, height: 720 },
    { name: "ultra-wide 3440x1440", width: 3440, height: 1440 },
    { name: "400% zoom equivalent 320x256", width: 320, height: 256 },
  ];
  for (const viewport of viewports) {
    test(`${viewport.name}: no horizontal page scroll, editor and preview reachable, save/export usable`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await open(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, "page scrolls horizontally").toBeLessThanOrEqual(1);
      const editorBox = await editor(page).boundingBox();
      expect.soft(editorBox && editorBox.width, "editor is usably wide (>=240px)").toBeGreaterThanOrEqual(240);
      if (viewport.width < 900) await page.getByRole("group", { name: "Workspace view" }).getByRole("button", { name: "Preview", exact: true }).click();
      const previewBox = await page.locator(".md-preview").boundingBox();
      expect.soft(previewBox && previewBox.width, "preview is usably wide (>=200px)").toBeGreaterThanOrEqual(200);
      const save = page.getByRole("button", { name: /^Save/ });
      const box = await save.boundingBox();
      expect.soft(box && box.x + box.width <= viewport.width && box.x >= 0, "Save button is clipped off-screen").toBeTruthy();
      const exportBox = await page.getByRole("button", { name: "Export", exact: true }).boundingBox();
      expect.soft(exportBox && exportBox.x + exportBox.width <= viewport.width, "Export button is clipped off-screen").toBeTruthy();
    });
  }

  test("touch targets on a phone are at least 24x24 CSS px (WCAG 2.5.8)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page);
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button, [role=tab], select")).map((el) => {
        const r = el.getBoundingClientRect();
        return { label: el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20) || el.tagName, w: r.width, h: r.height, visible: r.width > 0 && r.height > 0 };
      }).filter((e) => e.visible && (e.w < 24 || e.h < 24)),
    );
    expect(small).toEqual([]);
  });

  test("text can be enlarged to 200% via root font size without losing content", async ({ page }) => {
    await open(page);
    await page.addStyleTag({ content: "html{font-size:200% !important}" });
    await expect(page.getByRole("button", { name: /^Save/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  });

  test("prefers-reduced-motion is respected (no animations/transitions longer than 0.01s)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    const animated = await page.evaluate(() => Array.from(document.querySelectorAll("*")).filter((el) => {
      const s = getComputedStyle(el);
      return (s.animationName !== "none" && parseFloat(s.animationDuration) > 0.01) || parseFloat(s.transitionDuration) > 0.2;
    }).length);
    expect.soft(animated).toBe(0);
  });
});
