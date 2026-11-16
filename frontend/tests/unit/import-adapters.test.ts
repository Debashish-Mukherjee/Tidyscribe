import { describe, expect, it } from "vitest";
import { unwrapTrackingUrl } from "../../lib/import/adapters";
import { cleanChatChrome, plainTablesToMarkdown } from "../../lib/import/plaintext";
import { importHtml, resolvePasteDetailed } from "../../lib/richpaste";

const md = (html: string) => importHtml(`<meta charset="utf-8">${html}`).markdown ?? "";

describe("tables (D2)", () => {
  it("flattens paragraph wrappers so every row stays on one line", () => {
    const out = md("<table><tr><td><p>Name</p></td><td><p>Role</p></td></tr><tr><td><p>Ada</p></td><td><p>Engineer</p></td></tr></table>");
    expect(out).toBe("| Name | Role |\n| --- | --- |\n| Ada | Engineer |");
  });

  it("joins several paragraphs in a cell with <br> and keeps formatting and links", () => {
    const out = md("<table><tr><th>A</th></tr><tr><td><p><b>one</b></p><p>two <a href='https://x.dev'>link</a></p></td></tr></table>");
    expect(out).toContain("| **one**<br>two [link](https://x.dev) |");
  });

  it("escapes pipes inside cells", () => {
    expect(md("<table><tr><th>a|b</th></tr><tr><td>c|d</td></tr></table>")).toContain("| a\\|b |");
  });

  it("keeps merged cells as an HTML table instead of corrupting the cells", () => {
    const out = md('<table><tr><th colspan="2">Team</th></tr><tr><td rowspan="2">Ops</td><td>Ada</td></tr><tr><td>Bob</td></tr></table>');
    expect(out).toBe('<table><tbody><tr><th colspan="2">Team</th></tr><tr><td rowspan="2">Ops</td><td>Ada</td></tr><tr><td>Bob</td></tr></tbody></table>');
  });

  it("keeps lists, code and nested tables in cells as HTML", () => {
    expect(md("<table><tr><th>H</th></tr><tr><td><ul><li>a</li><li>b</li></ul></td></tr></table>")).toContain("<ul><li>a</li><li>b</li></ul>");
    expect(md("<table><tr><th>H</th></tr><tr><td><pre><code>x = 1\ny = 2</code></pre></td></tr></table>")).toContain("<pre><code>x = 1&#10;y = 2</code></pre>");
    expect(md("<table><tr><td><table><tr><td>in</td></tr></table></td><td>out</td></tr></table>")).toContain("<table><tbody><tr><td>in</td></tr></tbody></table>");
  });

  it("never emits a blank line inside an HTML table (it would end the HTML block)", () => {
    const out = md('<table><tr><td colspan="2"><p>a</p><p>b</p></td></tr></table>');
    expect(out).not.toMatch(/\n\s*\n/);
  });

  it("drops unsafe markup and links from HTML tables", () => {
    const out = md('<table><tr><td colspan="2"><a href="javascript:alert(1)" onclick="x()">go</a><script>alert(1)</script><img src="x" onerror="y()"></td></tr></table>');
    expect(out).toContain("go");
    expect(out).not.toMatch(/javascript:|onclick|onerror|<script|<img/i);
  });

  it("promotes the first row of a headerless table and keeps alignment", () => {
    const out = md('<table><tr><td align="right">n</td><td align="center">v</td></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(out).toBe("| n | v |\n| ---: | :---: |\n| 1 | 2 |");
  });

  it("pads short rows", () => {
    expect(md("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td></tr></table>")).toContain("| 1 |  |");
  });
});

describe("Confluence (D3)", () => {
  it("maps every panel type to a callout", () => {
    const panel = (kind: string) => `<div class="confluence-information-macro confluence-information-macro-${kind}"><div class="confluence-information-macro-body"><p>${kind} text</p></div></div>`;
    const out = md(["information", "note", "warning", "tip", "success"].map(panel).join(""));
    expect(out).toContain("> [!NOTE]\n> information text");
    expect(out).toContain("> [!IMPORTANT]\n> note text");
    expect(out).toContain("> [!WARNING]\n> warning text");
    expect(out.match(/> \[!TIP\]/g)).toHaveLength(2);
  });

  it("converts checkbox glyphs in list items and paragraphs", () => {
    expect(md("<ul><li>☐ open</li><li>☑ done</li></ul>")).toBe("- [ ] open\n- [x] done");
    expect(md("<p>☐ solo</p><p>☑ finished</p>")).toBe("- [ ] solo\n- [x] finished");
  });

  it("reads the language from the macro parameters", () => {
    expect(md('<pre data-syntaxhighlighter-params="brush: sql; gutter: false">SELECT 1;</pre>')).toBe("```sql\nSELECT 1;\n```");
  });
});

describe("tracking links (D4)", () => {
  it("unwraps Outlook Safe Links", () => {
    expect(unwrapTrackingUrl("https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&data=05")).toBe("https://example.com/a?b=1");
  });

  it("unwraps Proofpoint URL Defense v2", () => {
    expect(unwrapTrackingUrl("https://urldefense.proofpoint.com/v2/url?u=https-3A__example.com_path-2Dx&d=DwI")).toBe("https://example.com/path-x");
  });

  it("leaves other links alone", () => {
    expect(unwrapTrackingUrl("https://example.com/?url=https%3A%2F%2Fother.dev")).toBeNull();
    expect(unwrapTrackingUrl("not a url")).toBeNull();
  });

  it("drops links that show nothing", () => {
    expect(md('<h2>Install<a href="#install"><svg></svg></a></h2><p><a href="https://x.dev"></a>text</p>')).toBe("## Install\n\ntext");
  });
});

describe("chat chrome and plain-text fidelity (D5, D7)", () => {
  it("never removes real content that merely looks like chrome", () => {
    const html = "<p>Press Copy to copy the link.</p><ul><li>Expand the cluster</li><li>Collapse old shards</li></ul><p><a href='https://x.dev'>Python</a></p>";
    expect(md(html)).toBe("Press Copy to copy the link.\n\n- Expand the cluster\n- Collapse old shards\n\n[Python](https://x.dev)");
    const text = "I like python.\nCopy and paste works.\nExpand\n";
    expect(cleanChatChrome(text).changed).toBe(false);
  });

  it("removes a code bar only next to its Copy button and fences the code under it", () => {
    const out = cleanChatChrome("Intro\n\npython\nCopy code\nprint('x')\nprint('y')\n\nAfter");
    expect(out.text).toBe("Intro\n\n```python\nprint('x')\nprint('y')\n```\n\nAfter");
    expect(out.notices.join(" ")).toMatch(/Copy-code bar.*fenced 1 code block/);
  });

  it("keeps indented code together across blank lines", () => {
    const out = cleanChatChrome("bash\nCopy code\nif true; then\n\n  echo hi\nfi\n\nDone");
    expect(out.text).toContain("```bash\nif true; then\n\n  echo hi\nfi\n```");
  });

  it("keeps a two-sided transcript as bold speaker labels", () => {
    const out = cleanChatChrome("You said:\nWhat is 2+2?\nChatGPT said:\nFour.");
    expect(out.text).toBe("**You:**\nWhat is 2+2?\n**ChatGPT:**\nFour.");
  });

  it("drops a lone assistant label, including the inline form", () => {
    expect(cleanChatChrome("Claude responded: Here is the doc\n\n# T").text).toBe("Here is the doc\n\n# T");
  });

  it("turns spreadsheet text into a table, but not tab-indented code", () => {
    expect(plainTablesToMarkdown("Name\tRole\nAda\tEngineer").text).toBe("| Name | Role |\n| --- | --- |\n| Ada | Engineer |");
    const code = "func main() {\n\tfmt.Println(1)\n\tfmt.Println(2)\n}";
    expect(plainTablesToMarkdown(code).changed).toBe(false);
  });

  it("recognises ruled plain-text tables (fixed width and psql)", () => {
    expect(plainTablesToMarkdown("Name   Role\n-----  --------\nAda    Engineer\nBob    Designer").text).toBe(
      "| Name | Role |\n| --- | --- |\n| Ada | Engineer |\n| Bob | Designer |",
    );
    expect(plainTablesToMarkdown(" id | name\n----+------\n  1 | Ada").text).toBe("| id | name |\n| --- | --- |\n| 1 | Ada |");
  });

  it("leaves Markdown tables and setext headings alone", () => {
    const text = "| a | b |\n|---|---|\n| 1 | 2 |\n\nTitle\n-----\n";
    expect(plainTablesToMarkdown(text).changed).toBe(false);
  });

  it("tells the user when HTML is too large to convert", () => {
    const outcome = resolvePasteDetailed("auto", `<ul><li>${"x".repeat(1_600_000)}</li></ul>`, "x");
    expect(outcome.markdown).toBeNull();
    expect(outcome.message).toMatch(/over 1.5 MB.*plain text/);
  });

  it("strips ChatGPT citation markers from HTML and says so", () => {
    const imported = importHtml('<div data-message-author-role="assistant"><p>Fact \ue200cite\ue202turn0search0\ue201 and 【4†source】 more.</p><ul><li>x</li></ul></div>');
    expect(imported.markdown).toContain("Fact and more.");
    expect(imported.notices.join(" ")).toMatch(/2 citation markers/);
  });

  it("keeps TeX from KaTeX markup", () => {
    const html = '<p>Area <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">\\pi r^2</annotation></semantics></math></span></span>.</p><ul><li>x</li></ul>';
    expect(md(html)).toContain("Area $\\pi r^2$.");
  });
});
