import { describe, expect, it } from "vitest";
import { FORBIDDEN_TAGS, sanitizeHtml } from "../../lib/sanitize";
import { renderPreview } from "../../lib/preview";

const clean = (html: string) => sanitizeHtml(html).html as string;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html").body;

describe("sanitizeHtml", () => {
  it.each(["style", "form", "input", "button", "link", "meta", "base"])("removes <%s>", (tag) => {
    expect(FORBIDDEN_TAGS).toContain(tag);
    const sample = `<p>keep</p><${tag} name="x" href="https://evil.example" action="https://evil.example"></${tag}>`;
    const body = parse(clean(sample));
    expect(body.querySelector(tag)).toBeNull();
    expect(body.textContent).toContain("keep");
  });

  it("drops the contents of a <style> element, not just the tag", () => {
    const html = clean("<p>a</p><style>body{display:none !important}</style>");
    expect(html).not.toContain("display");
    expect(html).not.toContain("<style");
  });

  it("strips inline style so a pasted element cannot cover the page", () => {
    const body = parse(clean('<div style="position:fixed;inset:0;background:#000">overlay</div>'));
    expect(body.querySelector("div")?.hasAttribute("style")).toBe(false);
  });

  it("removes scripts, event handlers and javascript: links", () => {
    const html = clean('<img src=x onerror="window.__pwned=1"><a href="javascript:alert(1)">x</a><script>alert(1)</script>');
    expect(html).not.toMatch(/onerror|javascript:|<script/i);
  });

  it("reports what it removed", () => {
    const { blocked } = sanitizeHtml("<style>a{}</style><form><input></form><p>text</p>");
    expect(blocked).toEqual(expect.arrayContaining(["<style>", "<form>", "<input>"]));
  });

  it("reports nothing for clean markup", () => {
    expect(sanitizeHtml("<h1>Title</h1><p>text <strong>bold</strong></p>").blocked).toEqual([]);
  });
});

describe("renderPreview", () => {
  it("renders task items without form controls", () => {
    const result = renderPreview("- [x] done\n- [ ] todo");
    if (!result.ok) throw new Error("expected a rendered preview");
    const body = parse(result.html);
    expect(body.querySelector("input")).toBeNull();
    const boxes = Array.from(body.querySelectorAll("[role=checkbox]"));
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(result.blocked).toEqual([]);
  });

  it("neutralises the UAT D1 payload and says so", () => {
    const result = renderPreview("# Title\n\n<style>\nbody { display:none !important; }\n</style>\n\ntext");
    if (!result.ok) throw new Error("expected a rendered preview");
    expect(result.html).not.toContain("display");
    expect(result.html).toContain("Title");
    expect(result.blocked).toContain("<style>");
  });

  it("keeps Mermaid source available for the diagram renderer", () => {
    const result = renderPreview("```mermaid\nflowchart LR\nA --> B\n```");
    if (!result.ok) throw new Error("expected a rendered preview");
    expect(parse(result.html).querySelector(".mermaid")?.textContent).toContain("A --> B");
  });

  it("shows a placeholder for empty input", () => {
    const result = renderPreview("   ");
    expect(result.ok && result.html).toContain("Start pasting content");
  });
});
