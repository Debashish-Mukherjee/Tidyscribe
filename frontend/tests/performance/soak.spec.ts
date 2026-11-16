import { expect, test } from "@playwright/test";
import { FENCE, MERMAID_VALID, bigDocument } from "../support/corpus";
import { apiJson, editor, open, preview, setContent, unique } from "../support/app";

// Default 3 minutes so it can run in a normal pass; `UAT_SOAK_MINUTES=120 npm run test:uat:performance -- -g soak` simulates 2 hours.
const MINUTES = Number(process.env.UAT_SOAK_MINUTES ?? 3);

test.describe("reliability soak", () => {
  test(`soak: edit, search, switch theme, save and export for ${MINUTES} min without degradation`, async ({ page }, info) => {
    test.setTimeout((MINUTES + 5) * 60_000);
    await open(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const title = unique("UAT soak");
    const base = `# ${title}\n\n${bigDocument(300)}\n\n${FENCE}mermaid\n${MERMAID_VALID.sequence}\n${FENCE}\n`;
    await setContent(page, base);
    await expect(preview(page).locator(".mermaid svg")).toHaveCount(1, { timeout: 30_000 });

    const deadline = Date.now() + MINUTES * 60_000;
    const cycleMs: number[] = [];
    let cycle = 0;
    while (Date.now() < deadline) {
      const started = Date.now();
      cycle += 1;
      await editor(page).click();
      await editor(page).press("Control+End");
      await page.keyboard.type(`\n\ncycle ${cycle} marker`, { delay: 0 });
      await expect(preview(page)).toContainText(`cycle ${cycle} marker`);

      await page.keyboard.press("Control+f");
      await page.getByRole("textbox", { name: "Find", exact: true }).fill(`cycle ${cycle} marker`);
      await expect(page.getByRole("search", { name: "Find and replace" })).toContainText("1 found");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /^Theme:/ }).click();
      if (cycle % 5 === 0) {
        await page.getByRole("button", { name: /^Save/ }).click();
        await expect(page.getByTestId("save-state")).toHaveText("Saved");
      }
      if (cycle % 10 === 0) {
        const download = page.waitForEvent("download", { timeout: 60_000 });
        await page.getByRole("button", { name: "Export", exact: true }).click();
        await page.getByRole("menuitem", { name: "PDF" }).click();
        await download;
      }
      cycleMs.push(Date.now() - started);
    }

    const third = Math.max(1, Math.floor(cycleMs.length / 3));
    const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(values.length, 1);
    const early = avg(cycleMs.slice(0, third));
    const late = avg(cycleMs.slice(-third));
    info.annotations.push({ type: "soak", description: `${cycle} cycles, early ${early.toFixed(0)} ms, late ${late.toFixed(0)} ms` });
    expect.soft(late, "cycle time degraded by more than 50 %").toBeLessThan(early * 1.5 + 200);
    expect(errors).toEqual([]);

    const content = await editor(page).inputValue();
    for (let i = 1; i <= cycle; i += 1) expect(content, `marker ${i} lost`).toContain(`cycle ${i} marker`);
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
    const saved = (await apiJson<Array<{ title: string; content: string }>>(`/api/documents?q=${encodeURIComponent(title)}`))[0];
    expect(saved.content).toBe(content);
  });
});
