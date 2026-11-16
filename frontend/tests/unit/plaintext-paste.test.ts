import { describe, expect, it } from "vitest";
import { resolvePasteDetailed } from "../../lib/richpaste";

const CSS = `a {
    text-decoration: none;
    color: #464feb;
}
tr th, tr td {
    border: 1px solid #e6e6e6;
}
tr th {
    background-color: #f5f5f5;
}
`;

const BODY = `That changes the model. Think of **two parallel outputs**:

               +--> MySQL
               |
Zabbix Proxy -> Zabbix Server
               |
               +--> Golang Producer -> Kafka

## Domains

Add:

{
  "event_time": "..."
}

Trace:

Zabbix Event
    ↓
Producer Log
    ↓
Kafka Message
`;

describe("pasting Markdown copied from a page", () => {
  const outcome = resolvePasteDetailed("auto", "<style>a{}</style><div>x</div>", CSS + BODY);
  const markdown = outcome.markdown ?? "";

  it("drops the leaked style sheet", () => {
    expect(markdown.startsWith("That changes the model")).toBe(true);
    expect(markdown).not.toContain("text-decoration");
    expect(outcome.message).toMatch(/removed 3 leaked CSS rules/);
  });

  it("fences flow diagrams and bare JSON", () => {
    expect(markdown).toContain("```text\n               +--> MySQL");
    expect(markdown).toContain("```text\nZabbix Event\n    ↓\nProducer Log\n    ↓\nKafka Message\n```");
    expect(markdown).toContain('```json\n{\n  "event_time": "..."\n}\n```');
  });

  it("is stable on a second paste", () => {
    expect(resolvePasteDetailed("auto", "", markdown).markdown).toBeNull();
  });

  it("keeps a CSS snippet that has nothing after it", () => {
    expect(resolvePasteDetailed("auto", "", "a {\n  color: red;\n}\n").markdown).toBeNull();
  });

  it("leaves ordinary lists and tables alone", () => {
    expect(resolvePasteDetailed("auto", "", "## T\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |\n").markdown).toBeNull();
  });

  it("restores code blocks whose fences were lost, but not prose", () => {
    const text = "## Metrics\n\nAdd a view for:\n\nitems processed/sec\nhistory writes/sec\n\nThese are baselines.\n\nand\n\nexport_latency_seconds\n\nAlert if below:\n\n99.9%\n\nDone.\n";
    const markdown = resolvePasteDetailed("auto", "", text).markdown ?? "";
    expect(markdown).toContain("```text\nitems processed/sec\nhistory writes/sec\n```");
    expect(markdown).toContain("\nand\n\n```text\nexport_latency_seconds\n```");
    expect(markdown).toContain("```text\n99.9%\n```");
    expect(markdown).toContain("These are baselines.");
    expect(markdown).not.toContain("```text\nThese");
  });

  it("restores code blocks when every line arrives as its own paragraph", () => {
    const lines = ["## A", "Add:", "consumer healthy", "Kafka healthy", "but", "VictoriaMetrics rejected writes", "Done here.", "## B", "{", '  "event_time": "..."', "}", "Tail.", "## C", "x", "y", "z"];
    const markdown = resolvePasteDetailed("auto", "", lines.join("\n\n")).markdown ?? "";
    expect(markdown).toContain("```text\nconsumer healthy\nKafka healthy\nbut\nVictoriaMetrics rejected writes\n```");
    expect(markdown).toContain('```json\n{\n  "event_time": "..."\n}\n```');
    expect(markdown).toContain("Done here.");
  });

  it("does not touch Markdown that already has fences", () => {
    expect(resolvePasteDetailed("auto", "", "## T\n\n```\nitems\nthings\n```\n\nloose_name\n").markdown).toBeNull();
  });

  it("prefers the HTML's real code blocks when the text lost its fences", () => {
    const html = "<h2>T</h2><p>Add:</p><pre><code>a_b\nc_d</code></pre>";
    expect(resolvePasteDetailed("auto", html, "## T\n\nAdd:\n\na_b\nc_d\n").markdown).toMatch(/```\na_b\nc_d\n```/);
  });
});
