import { describe, expect, it } from "vitest";
import { importFile, MAX_IMPORT_BYTES } from "../../lib/import-file";

describe("local file import", () => {
  it.each(["notes.md", "NOTES.MARKDOWN", "notes.txt"])("preserves UTF-8 Markdown/text in %s", async (name) => {
    const content = "# Notes\r\n\r\nمرحبا 日本語 **bold**\n\n```js\nconst x = 1;\n```\n";
    expect((await importFile(new File([content], name))).content).toBe(content);
  });

  it("decodes UTF-8 with a BOM", async () => {
    expect((await importFile(new File(["\ufeff# Notes"], "notes.md"))).content).toBe("# Notes");
  });

  it("converts HTML structure and strips active content", async () => {
    const result = await importFile(new File(['<h1>Report</h1><p><strong>Bold</strong> body</p><script>alert(1)</script><iframe src="https://example.com"></iframe><a href="javascript:alert(2)">Link</a><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'], "report.html"));
    expect(result.content).toContain("# Report");
    expect(result.content).toContain("**Bold**");
    expect(result.content).toContain("| A | B |");
    expect(result.content).not.toMatch(/alert|javascript|iframe|script/);
    expect(result.message).toContain("converted HTML to Markdown");
  });

  it.each<[string, string, RegExp]>([
    ["report.pdf", "data", /Choose a Markdown/],
    ["empty.md", "  \n", /no importable text/],
    ["empty.html", "<script>alert(1)</script>", /no importable text/],
    ["binary.txt", "hello\0world", /binary data/],
  ])("rejects %s", async (name, content, message) => {
    await expect(importFile(new File([content], name))).rejects.toThrow(message);
  });

  it("rejects invalid UTF-8 rather than corrupting text", async () => {
    await expect(importFile(new File([new Uint8Array([0xff, 0xfe, 0x41])], "notes.txt"))).rejects.toThrow(/not UTF-8/);
  });

  it("rejects an oversized file before reading it", async () => {
    await expect(importFile(new File([new Uint8Array(MAX_IMPORT_BYTES + 1)], "large.md"))).rejects.toThrow(/too large/);
  });
});
