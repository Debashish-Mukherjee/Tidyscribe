import { describe, expect, it } from "vitest";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "../../lib/richedit";
import { fenceAsciiDiagrams, fenceBareDiagrams } from "../../lib/markdown";

// Stands in for TipTap's own output for the structures it renders differently from marked.
const roundTrip = (markdown: string) => editorHtmlToMarkdown(markdownToEditorHtml(markdown));

describe("markdown fencing", () => {
  it("fences ASCII boxes outside code but leaves fenced ones alone", () => {
    const boxes = "+---+\n| A |\n+---+";
    expect(fenceAsciiDiagrams(boxes)).toBe(`\`\`\`text\n${boxes}\n\`\`\``);
    const already = `\`\`\`text\n${boxes}\n\`\`\``;
    expect(fenceAsciiDiagrams(already)).toBe(already);
  });

  it("fences bare @startuml blocks, even without @enduml, and skips ones inside fences", () => {
    expect(fenceBareDiagrams("a\n@startuml\nA -> B\n@enduml\nb")).toBe("a\n```plantuml\n@startuml\nA -> B\n@enduml\n```\nb");
    expect(fenceBareDiagrams("@startuml\nA -> B")).toBe("```plantuml\n@startuml\nA -> B\n```");
    const inside = "```python\n@startuml\n```";
    expect(fenceBareDiagrams(inside)).toBe(inside);
  });
});

describe("Markdown round trip through the rich editor format", () => {
  it.each([
    ["headings", "# One\n\n## Two\n\n### Three"],
    ["inline formatting", "Some **bold**, *italic*, ~~gone~~ and `code` with a [link](https://example.com)."],
    ["bullet and numbered lists", "- a\n- b\n  - nested\n\n1. first\n2. second"],
    ["a quote", "> quoted text"],
    ["a rule", "before\n\n---\n\nafter"],
    ["snake_case and asterisks in technical text", "Call my_function_name with a*b"],
  ])("keeps %s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps fenced code with its language, including mermaid and plantuml", () => {
    const markdown = '```python\nprint("hi")\n  indented\n```\n\n```mermaid\nflowchart LR\n  A --> B\n```';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps ASCII diagrams intact by fencing them", () => {
    expect(roundTrip("+---+\n| A |\n+---+")).toBe("```text\n+---+\n| A |\n+---+\n```");
  });

  it("keeps a table", () => {
    const markdown = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps callout markers and line breaks inside a paragraph", () => {
    expect(roundTrip("> [!NOTE]\n> Mind the gap")).toBe("> [!NOTE]\n> Mind the gap");
    expect(roundTrip("line one\nline two")).toBe("line one\nline two");
  });

  it("keeps task lists, including checked state", () => {
    expect(roundTrip("- [ ] open\n- [x] done")).toBe("- [ ] open\n- [x] done");
  });

  it("marks task lists for the editor", () => {
    const html = markdownToEditorHtml("- [x] done\n- [ ] open");
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
    expect(html).not.toContain("<input");
  });

  it("serialises the HTML TipTap writes for task items and table cells", () => {
    const tasks = '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>ship it</p></div></li></ul>';
    expect(editorHtmlToMarkdown(tasks)).toBe("- [x] ship it");
    const table =
      '<table><colgroup><col></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>a</p></th><th colspan="1" rowspan="1"><p>b</p></th></tr><tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>2</p></td></tr></tbody></table>';
    expect(editorHtmlToMarkdown(table)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("handles empty content", () => {
    expect(markdownToEditorHtml("")).toBe("");
    expect(editorHtmlToMarkdown("<p></p>")).toBe("");
  });
});
