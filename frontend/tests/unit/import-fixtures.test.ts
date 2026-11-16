import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importHtml, resolvePasteDetailed } from "../../lib/richpaste";

const dir = path.resolve(__dirname, "../../../test-fixtures/imports");

type Expectation = { mustContain?: string[]; mustNotContain?: string[]; noLineMatches?: string[]; paste?: "plain" | "untouched" };
const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, Expectation>;

function convert(name: string, expectation: Expectation): string {
  const raw = readFileSync(path.join(dir, name), "utf8");
  if (name.endsWith(".html")) {
    const imported = importHtml(raw);
    expect(imported.markdown, `${name} produced no Markdown`).not.toBeNull();
    return imported.markdown as string;
  }
  const outcome = resolvePasteDetailed("auto", "", raw);
  if (expectation.paste === "untouched") {
    expect(outcome.markdown, "Markdown that is already clean must be pasted exactly as copied").toBeNull();
    return raw;
  }
  return outcome.markdown ?? raw;
}

describe.each(Object.entries(manifest))("import fixture %s", (name, expectation) => {
  const markdown = convert(name, expectation);

  it("keeps everything that matters", () => {
    for (const wanted of expectation.mustContain ?? []) expect(markdown, `missing ${JSON.stringify(wanted)}`).toContain(wanted);
  });

  it("drops the tool's own chrome", () => {
    for (const junk of expectation.mustNotContain ?? []) expect(markdown, `unexpected ${JSON.stringify(junk)}`).not.toContain(junk);
    for (const pattern of expectation.noLineMatches ?? []) expect(markdown, `a line matched ${pattern}`).not.toMatch(new RegExp(pattern, "m"));
  });

  it("is stable: converting the result again changes nothing", () => {
    if (!name.endsWith(".html")) return;
    const again = resolvePasteDetailed("auto", "", markdown);
    expect(again.markdown ?? markdown).toBe(markdown);
  });
});

describe("what the user is told", () => {
  const notices = (name: string) => importHtml(readFileSync(path.join(dir, name), "utf8")).notices.join(" | ");

  it("reports table handling for Word", () => expect(notices("word.html")).toMatch(/converted 2 tables, 1 kept as HTML/));
  it("reports unwrapped Outlook links", () => expect(notices("outlook.html")).toMatch(/unwrapped 2 tracking links/));
  it("reports Confluence panels and tasks", () => expect(notices("confluence.html")).toMatch(/5 Confluence panels.*2 tasks/));
  it("reports removed Gemini citations and code bars", () => expect(notices("gemini.html")).toMatch(/2 source citation markers.*2 Copy-code headers/));
  it("reports the source in the status message", () => {
    const html = readFileSync(path.join(dir, "word.html"), "utf8");
    expect(resolvePasteDetailed("auto", html, "x").message).toMatch(/^Pasted from Word as Markdown: converted 2 tables/);
    expect(resolvePasteDetailed("auto", readFileSync(path.join(dir, "outlook.html"), "utf8"), "x").message).toMatch(/^Pasted from Outlook/);
  });
});
