import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import emojiMap from "../../lib/emoji-map.json";
import { renderPreview } from "../../lib/preview";
import { ALLOWED_ATTRIBUTES, ALLOWED_TAGS, BLOCK_TAGS, INLINE_TAGS, MATHML_TAGS } from "../../lib/sanitize";

const html = (markdown: string) => {
  const result = renderPreview(markdown);
  if (!result.ok) throw new Error(result.error);
  return result.html as string;
};
const dom = (markdown: string) => new DOMParser().parseFromString(html(markdown), "text/html").body;

describe("footnotes", () => {
  const out = dom("Claim[^a] and another[^b].\n\n[^a]: First note.\n[^b]: Second with `code`.\n");

  it("renders numbered references, a footnote list and back references", () => {
    expect(Array.from(out.querySelectorAll("sup.footnote-ref a")).map((a) => a.textContent)).toEqual(["1", "2"]);
    expect(out.querySelectorAll("section.footnotes li")).toHaveLength(2);
    expect(out.querySelector("section.footnotes li#fn-b code")?.textContent).toBe("code");
    expect(out.querySelectorAll("a.footnote-backref")).toHaveLength(2);
    expect(out.textContent).not.toContain("[^");
  });

  it("leaves a reference without a definition as text", () => {
    expect(dom("See[^missing] here.").textContent).toContain("[^missing]");
  });

  it("does not touch footnote syntax inside code", () => {
    expect(dom("```\n[^1]: not a note\n```\n\n`[^1]`").querySelectorAll("section.footnotes")).toHaveLength(0);
  });
});

describe("definition lists", () => {
  it("renders terms and several definitions", () => {
    const out = dom("Term\n: First meaning\n: Second meaning\n\nOther\n: **Bold** meaning\n");
    expect(Array.from(out.querySelectorAll("dt")).map((n) => n.textContent)).toEqual(["Term", "Other"]);
    expect(Array.from(out.querySelectorAll("dd")).map((n) => n.textContent)).toEqual(["First meaning", "Second meaning", "Bold meaning"]);
    expect(out.querySelector("dd strong")?.textContent).toBe("Bold");
  });

  it("does not turn ordinary paragraphs or code into definitions", () => {
    expect(dom("Just text: with a colon").querySelector("dl")).toBeNull();
    expect(dom("```\nTerm\n: not a definition\n```").querySelector("dl")).toBeNull();
  });
});

describe("emoji shortcodes", () => {
  it("replaces known shortcodes in text only", () => {
    const out = dom("Ship it :rocket: :tada: :unknown_code: `:rocket:`\n\n```\n:rocket:\n```");
    expect(out.querySelector("p")?.textContent).toBe("Ship it \u{1f680} \u{1f389} :unknown_code: :rocket:");
    expect(out.querySelector("pre code")?.textContent).toContain(":rocket:");
  });

  it("uses the same table as the server", () => {
    const server = JSON.parse(readFileSync(path.resolve(__dirname, "../../../backend/app/data/emoji.json"), "utf8"));
    expect(emojiMap).toEqual(server);
  });
});

describe("math", () => {
  it("renders every notation as MathML that keeps the TeX source", () => {
    const out = dom("Inline $E=mc^2$ and \\(a^2+b^2\\).\n\n$$\\int_0^1 x\\,dx$$\n\n\\[\\sum_{i=1}^{n} i\\]\n");
    expect(Array.from(out.querySelectorAll("span.math-inline")).map((n) => n.getAttribute("data-tex"))).toEqual(["E=mc^2", "a^2+b^2"]);
    expect(Array.from(out.querySelectorAll("div.math-block")).map((n) => n.getAttribute("data-tex"))).toEqual(["\\int_0^1 x\\,dx", "\\sum_{i=1}^{n} i"]);
    expect(out.querySelectorAll("math").length).toBe(4);
    expect(out.querySelector("annotation")?.getAttribute("encoding")).toBe("application/x-tex");
    expect(out.textContent).not.toContain("\\(");
  });

  it("leaves currency alone", () => {
    const out = dom("It costs $5 and $10 total.\n\nAlso 5$ and 6$ more.");
    expect(out.querySelector("math")).toBeNull();
    expect(out.textContent).toContain("$5 and $10");
  });

  it("does not parse math in code or escaped dollars", () => {
    const out = dom("`$x$` and \\$y\\$ and\n\n```\n\\(z\\) $w$\n```");
    expect(out.querySelector("math")).toBeNull();
  });

  it("survives broken TeX without losing the source", () => {
    const out = dom("Bad $\\frac{1$ here.");
    expect(out.textContent).toContain("frac");
  });
});

describe("single raw-HTML policy (D16)", () => {
  it("keeps the semantic subset", () => {
    const out = dom(
      "<details open><summary>S</summary>\n\nbody\n\n</details>\n\nPress <kbd>Ctrl</kbd>, H<sub>2</sub>O, 10<sup>3</sup>, <mark>hi</mark><br>next\n\n" +
        '<table><tr><th colspan="2">T</th></tr><tr><td>a</td><td>b</td></tr></table>',
    );
    expect(out.querySelector("details[open] summary")?.textContent).toBe("S");
    expect(out.querySelectorAll("kbd, sub, sup, mark, br").length).toBeGreaterThanOrEqual(5);
    expect(out.querySelector("th")?.getAttribute("colspan")).toBe("2");
  });

  it("removes everything else but keeps the text", () => {
    const result = renderPreview('<font color="red">warm</font> <center>mid</center> <svg onload="x()"><circle/></svg> <script>bad()</script>');
    if (!result.ok) throw new Error("render failed");
    expect(result.html).toContain("warm");
    expect(result.html).toContain("mid");
    expect(result.html).not.toMatch(/<font|<center|<svg|<script|onload|bad\(\)/);
    expect(result.blocked).toEqual(expect.arrayContaining(["<font>", "<center>", "<svg>", "<script>"]));
  });

  it("lists exactly the elements and attributes the server accepts", () => {
    const python = readFileSync(path.resolve(__dirname, "../../../backend/app/services/html_policy.py"), "utf8");
    const list = (name: string) => {
      const block = new RegExp(`${name} = \\(([\\s\\S]*?)\\)\\n`).exec(python)?.[1] ?? "";
      return Array.from(block.matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    };
    expect(list("BLOCK_TAGS")).toEqual(BLOCK_TAGS);
    expect(list("INLINE_TAGS")).toEqual(INLINE_TAGS);
    expect(list("MATHML_TAGS")).toEqual(MATHML_TAGS);
    expect(list("ALLOWED_ATTRIBUTES")).toEqual(ALLOWED_ATTRIBUTES);
    expect(ALLOWED_TAGS.length).toBe(BLOCK_TAGS.length + INLINE_TAGS.length + MATHML_TAGS.length);
  });
});

describe("directionality", () => {
  it("gives every block dir=auto so Arabic and Hebrew paragraphs lay out right to left", () => {
    const out = dom("# שלום\n\nمرحبا بالعالم\n\n- פריט\n\n| a |\n|---|\n| ب |");
    for (const selector of ["h1", "p", "li", "th", "td"]) expect(out.querySelector(selector)?.getAttribute("dir")).toBe("auto");
  });
});

describe("callout and task markup consumed by the exporter", () => {
  it("marks callouts with data-callout and tasks with role=checkbox", () => {
    const out = dom("> [!WARNING]\n> Careful\n\n- [x] done\n- [ ] todo");
    expect(out.querySelector("blockquote")?.getAttribute("data-callout")).toBe("warning");
    expect(Array.from(out.querySelectorAll("[role=checkbox]")).map((n) => n.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });
});
