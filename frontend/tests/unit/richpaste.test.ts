import { describe, expect, it } from "vitest";
import { htmlToMarkdown, looksLikeMarkdown, resolvePaste } from "../../lib/richpaste";

const md = (html: string) => htmlToMarkdown(`<meta charset='utf-8'><!--StartFragment-->${html}<!--EndFragment-->`);

describe("lists", () => {
  it("keeps bullets and numbers, including nesting", () => {
    const result = md("<ul><li>One</li><li>Two<ul><li>Child</li></ul></li></ul><ol><li>First</li><li>Second</li></ol>");
    expect(result).toBe("- One\n- Two\n  - Child\n\n1. First\n2. Second");
  });

  it("keeps task list checkboxes", () => {
    const result = md('<ul><li><input type="checkbox" checked> Done</li><li><input type="checkbox"> Todo</li></ul>');
    expect(result).toBe("- [x] Done\n- [ ] Todo");
  });

  it("converts Word's list paragraphs (mso-list) into a real nested list", () => {
    const item = (level: number, marker: string, text: string) =>
      `<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l0 level${level} lfo1'><span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;</span></span>${text}</p>`;
    const result = md(item(1, "·", "Alpha") + item(2, "o", "Nested") + item(1, "·", "Beta"));
    expect(result).toBe("- Alpha\n  - Nested\n- Beta");
  });

  it("detects numbered Word lists", () => {
    const item = (marker: string, text: string) => `<p style='mso-list:l1 level1 lfo2'><span style='mso-list:Ignore'>${marker}</span>${text}</p>`;
    expect(md(item("1.", "Plan") + item("2.", "Build"))).toBe("1. Plan\n1. Build");
  });
});

describe("headings, emphasis, links, quotes", () => {
  it("converts headings, bold, italic, strikethrough, inline code and links", () => {
    const result = md('<h1>Title</h1><h3>Sub</h3><p>Some <strong>bold</strong>, <em>italic</em>, <del>gone</del>, <code>code</code> and <a href="https://example.com/x?a=1">a link</a>.</p>');
    expect(result).toBe("# Title\n\n### Sub\n\nSome **bold**, *italic*, ~~gone~~, `code` and [a link](https://example.com/x?a=1).");
  });

  it("converts blockquotes and rules", () => {
    expect(md("<blockquote><p>Quoted</p></blockquote><hr><p>After <b>x</b></p>")).toBe("> Quoted\n\n---\n\nAfter **x**");
  });

  it("does not escape underscores and asterisks in technical text", () => {
    expect(md("<p>Use <b>snake_case</b> and a*b*c in my_function_name</p>")).toBe("Use **snake_case** and a*b*c in my_function_name");
  });

  it("escapes text that would otherwise turn into structure", () => {
    expect(md("<p>- not a list</p><p>1. not numbered</p><p><b>x</b></p>")).toBe("\\- not a list\n\n1\\. not numbered\n\n**x**");
  });

  it("leaves numbered and dashed headings clean (no stray backslash before the number)", () => {
    const result = md("<h2>1. Concise Findings Summary</h2><h3>2) Scope</h3><h2>- Odd</h2><p>Body</p>");
    expect(result).toBe("## 1. Concise Findings Summary\n\n### 2) Scope\n\n## - Odd\n\nBody");
    expect(result).not.toContain("\\");
  });

  it("keeps Word headings with an inline-wrapped number clean", () => {
    expect(md('<h2><span style="mso-list:Ignore">3.</span> Taxonomy</h2>')).not.toContain("\\");
  });
});

describe("Google Docs", () => {
  it("does not bold the whole document because of the normal-weight <b> wrapper", () => {
    const result = md(
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:400;">Plain </span><span style="font-weight:700;">bold</span><span style="font-style:italic;"> slanted</span></p></b>',
    );
    expect(result).toBe("Plain **bold** *slanted*");
  });
});

describe("tables", () => {
  it("converts a table with a header", () => {
    const result = md("<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Ann</td><td>Dev</td></tr></tbody></table>");
    expect(result).toBe("| Name | Role |\n| --- | --- |\n| Ann | Dev |");
  });

  it("promotes the first row to a header when the source has none", () => {
    const result = md("<table><tbody><tr><td>Name</td><td>Role</td></tr><tr><td>Ann</td><td>Dev</td></tr></tbody></table>");
    expect(result).toBe("| Name | Role |\n| --- | --- |\n| Ann | Dev |");
  });
});

describe("code blocks", () => {
  it("uses only the code text from chat UIs that put a label and Copy button inside <pre>", () => {
    const result = md(
      '<pre class="x"><div>python<button>Copy code</button></div><div><code class="hljs language-python">def f():\n    return 1\n</code></div></pre>',
    );
    expect(result).toBe("```python\ndef f():\n    return 1\n```");
  });

  it("keeps whitespace in a plain <pre>", () => {
    expect(md("<pre>  indented\n\n    more</pre>")).toBe("```\n  indented\n\n    more\n```");
  });

  it("uses a longer fence when the code contains one", () => {
    expect(md("<pre><code>```\nx\n```</code></pre>")).toBe("````\n```\nx\n```\n````");
  });
});

describe("safety and size", () => {
  it("drops scripts, styles and unsafe links but keeps their text", () => {
    const result = md('<style>p{color:red}</style><script>alert(1)</script><p><a href="javascript:alert(1)">click</a> <a href="https://ok.example">ok</a></p><ul><li>x</li></ul>');
    expect(result).toBe("click [ok](https://ok.example)\n\n- x");
    expect(result).not.toMatch(/alert|color/);
  });

  it("keeps remote images but drops inline data images", () => {
    const result = md('<ul><li>a</li></ul><img src="https://x.test/a.png" alt="Remote"><img src="data:image/png;base64,AAAA" alt="Inline">');
    expect(result).toContain("![Remote](https://x.test/a.png)");
    expect(result).not.toContain("base64");
  });

  it("returns null for oversized input", () => {
    expect(htmlToMarkdown(`<ul><li>${"x".repeat(1_600_000)}</li></ul>`)).toBeNull();
  });
});

describe("falls back to plain paste when HTML adds nothing", () => {
  it("returns null for editor-style spans and plain wrappers (keeps code whitespace intact)", () => {
    const vscode = '<div style="font-family:Consolas"><div><span style="color:#569cd6">def</span><span> f():</span></div><div><span>    return 1</span></div></div>';
    expect(md(vscode)).toBeNull();
    expect(md("<div>Just a paragraph</div><p>and another<br>with a break</p>")).toBeNull();
  });

  it("returns null for empty input and for HTML with only whitespace content", () => {
    expect(htmlToMarkdown("")).toBeNull();
    expect(md("<ul><li> </li></ul>")).toBeNull();
  });
});

describe("paste modes", () => {
  const source = "# Title\n\n## Objective\n\n* one\n* two\n\n| A | B |\n|---|---|\n| x | y |\n\n```text\nA\n  |\n```\n";
  const escaped = source.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const codeBlockHtml = `<pre><code>${escaped}</code></pre>`;

  it("recognises Markdown by headings, fences and table rules, not by bullets alone", () => {
    expect(looksLikeMarkdown("## Heading")).toBe(true);
    expect(looksLikeMarkdown("```\ncode\n```")).toBe(true);
    expect(looksLikeMarkdown("| a | b |\n|---|:--:|")).toBe(true);
    expect(looksLikeMarkdown("- just a bullet\n- another")).toBe(false);
    expect(looksLikeMarkdown("Plain sentence with a #hashtag")).toBe(false);
    expect(looksLikeMarkdown("#nospace")).toBe(false);
  });

  it("auto leaves Markdown copied from a code block exactly as written", () => {
    expect(htmlToMarkdown(codeBlockHtml)).toContain("````"); // the old behaviour: whole document fenced
    expect(resolvePaste("auto", codeBlockHtml, source)).toBeNull();
  });

  it("auto still converts formatted text that is not Markdown", () => {
    expect(resolvePaste("auto", "<h2>Plan</h2><ul><li>One</li></ul>", "Plan\nOne")).toBe("## Plan\n\n- One");
  });

  it("auto still turns a plain code block into a fence", () => {
    expect(resolvePaste("auto", "<pre><code>const a = 1;</code></pre>", "const a = 1;")).toBe("```\nconst a = 1;\n```");
  });

  it("markdown and plain modes never convert", () => {
    const html = "<h2>Plan</h2>";
    expect(resolvePaste("markdown", html, "Plan")).toBeNull();
    expect(resolvePaste("plain", html, "Plan")).toBeNull();
  });

  it("rich mode converts even when the text looks like Markdown", () => {
    expect(resolvePaste("rich", "<h2>Plan</h2>", "## Plan")).toBe("## Plan");
    expect(resolvePaste("rich", codeBlockHtml, source)).toContain("````");
  });
});
