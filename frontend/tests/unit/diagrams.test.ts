import mermaid from "mermaid";
import { describe, expect, it, vi } from "vitest";
import { extractMermaidSources, findDiagramRange, hasPlantUml, mermaidFence, naturalSize, renderMermaid, repairMermaid, stripMarkdownArtifacts, withPixelSize } from "../../lib/diagrams";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

const ASCII = ["+-----+", "| API |", "+-----+", "   |", "   v", "+-----+", "| DB  |", "+-----+"].join("\n");

describe("extractMermaidSources", () => {
  it("returns each mermaid fence body in order and ignores other fences", () => {
    const md = "```mermaid\nflowchart LR\nA-->B\n```\n\n```python\nx=1\n```\n\n```mermaid\nsequenceDiagram\nA->>B: hi\n```\n";
    expect(extractMermaidSources(md)).toEqual(["flowchart LR\nA-->B\n", "sequenceDiagram\nA->>B: hi\n"]);
    expect(extractMermaidSources("no diagrams")).toEqual([]);
  });

  it("treats a closing fence with an info string as content, like Preview and the backend", () => {
    expect(extractMermaidSources("```mermaid\nflowchart LR\nA-->B\n```mermaid\n")).toEqual(["flowchart LR\nA-->B\n```mermaid\n"]);
  });
});

describe("hasPlantUml", () => {
  it.each([
    ["```plantuml\nA -> B\n```", true],
    ["~~~puml\nA -> B\n~~~", true],
    ["text\n@startuml\nA -> B\n@enduml", true],
    ["```python\nprint('@startuml')\n```", false],
    ["```mermaid\nflowchart TD\n```", false],
  ])("%j -> %s", (markdown, expected) => expect(hasPlantUml(markdown)).toBe(expected));
});

describe("findDiagramRange", () => {
  it("uses the selection when there is one", () => {
    const md = `intro\n${ASCII}\nend`;
    const start = md.indexOf("+");
    expect(findDiagramRange(md, start, start + 7)).toEqual({ start, end: start + 7, text: "+-----+" });
    expect(findDiagramRange("   ", 0, 3)).toBeNull();
  });

  it("finds the ASCII block around the caret, not just the first one", () => {
    const second = ["+---+", "| X |", "+---+", "  |", "+---+", "| Y |", "+---+"].join("\n");
    const md = `${ASCII}\n\ntext\n\n${second}\n`;
    const caret = md.indexOf("| X |");
    const range = findDiagramRange(md, caret);
    expect(range?.text).toBe(second);
    expect(md.slice(range!.start, range!.end)).toBe(second);
  });

  it("falls back to the first block when the caret is elsewhere", () => {
    expect(findDiagramRange(`hello\n\n${ASCII}\n`, 0)?.text).toBe(ASCII);
  });

  it("returns the whole plantuml fence for replacement but only its body for conversion", () => {
    const md = "before\n```plantuml\nA -> B: hi\n```\nafter";
    const range = findDiagramRange(md, md.indexOf("A ->"))!;
    expect(range.text).toBe("A -> B: hi");
    expect(md.slice(range.start, range.end)).toBe("```plantuml\nA -> B: hi\n```");
  });

  it("does not treat ASCII art inside other code fences as a diagram", () => {
    expect(findDiagramRange(`\`\`\`text\n${ASCII}\n\`\`\``)).toBeNull();
    expect(findDiagramRange("plain text only")).toBeNull();
  });

  it("converts Terraform, YAML and Draw.io fences only when the caret is inside them", () => {
    const md = "intro\n\n```hcl\nresource \"a\" \"b\" {}\n```\n\nouter";
    const inside = findDiagramRange(md, md.indexOf("resource"))!;
    expect(inside.text).toBe('resource "a" "b" {}');
    expect(md.slice(inside.start, inside.end)).toBe('```hcl\nresource "a" "b" {}\n```');
    expect(findDiagramRange(md, md.indexOf("outer"))).toBeNull();
    expect(findDiagramRange("```yaml\nkind: Pod\n```", 3)?.text).toBe("kind: Pod");
  });

  it("prefers a PlantUML or ASCII block over opt-in code fences when the caret is elsewhere", () => {
    const md = `\`\`\`yaml\nkind: Pod\n\`\`\`\n\n${ASCII}\n`;
    expect(findDiagramRange(md, 0 + md.length)?.text).toBe(ASCII);
  });
});

describe("mermaidFence", () => {
  it("wraps trimmed source in a mermaid fence", () => {
    expect(mermaidFence("\nflowchart TD\n  A-->B\n")).toBe("```mermaid\nflowchart TD\n  A-->B\n```");
  });
});

describe("withPixelSize", () => {
  const svg = '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" style="max-width: 320px;"><g/></svg>';

  it("replaces percentage width and inline style with the viewBox pixel size", () => {
    const result = withPixelSize(svg);
    expect([result.width, result.height]).toEqual([320, 180]);
    expect(result.svg).toContain('<svg width="320" height="180" id="m1"');
    expect(result.svg).not.toContain("100%");
    expect(result.svg).not.toContain("max-width");
    expect(result.svg).toContain("<g/></svg>");
  });

  it("rejects SVGs without a usable viewBox", () => {
    expect(() => withPixelSize('<svg width="10"></svg>')).toThrow(/viewBox/);
    expect(() => withPixelSize('<svg viewBox="0 0 0 0"></svg>')).toThrow(/viewBox/);
    expect(() => withPixelSize("not svg")).toThrow(/viewBox/);
  });
});

describe("repairMermaid", () => {
  it("quotes labels Mermaid cannot parse: parentheses, braces, pipes and @", () => {
    expect(repairMermaid("flowchart LR\n  O --> UI[UI: shows 'suggested domain (advisory)']")).toBe(
      "flowchart LR\n  O --> UI[\"UI: shows 'suggested domain (advisory)'\"]",
    );
    expect(repairMermaid("graph TD\n  A[call f(x)] --> B[set {a}] --> C[a | b] --> D[user@host]")).toBe(
      'graph TD\n  A["call f(x)"] --> B["set {a}"] --> C["a | b"] --> D["user@host"]',
    );
  });

  it("repairs several nodes on one line and keeps <br/> line breaks", () => {
    expect(repairMermaid("flowchart LR\n  A[a (1)] --> B[b<br/>(2)]")).toBe('flowchart LR\n  A["a (1)"] --> B["b<br/>(2)"]');
  });

  it("leaves every valid diagram exactly as written", () => {
    const valid = [
      "flowchart LR\n  C --> K[(Kafka)]\n  K --> VM[(Victoria Metrics)]",
      'flowchart LR\n  A["already (quoted)"] --> B[plain label: with colon & hash #1]',
      "flowchart LR\n  A([stadium (x)]) --> B((circle (y))) --> C{{hex (z)}} --> D[[sub (w)]]",
      "flowchart LR\n  A[/para (x)/] --> B[\\back (y)\\] --> C[/trap (z)\\]",
      'flowchart LR\n  subgraph DP["Data plane (unchanged)"]\n    A --> B\n  end\n  A -->|GET /a (b), c| B',
      "flowchart LR\n  %% a comment with A[x (y)] in it\n  A --> B",
    ];
    for (const source of valid) expect(repairMermaid(source)).toBe(source);
  });

  it("is idempotent and escapes a double quote already inside a label", () => {
    const once = repairMermaid('flowchart LR\n  A[say hi (and "bye")]');
    expect(once).toBe('flowchart LR\n  A[say hi (and "bye")]'); // contains a quote: left alone rather than guessed at
    const fixed = repairMermaid("flowchart LR\n  A[x (y)]");
    expect(repairMermaid(fixed)).toBe(fixed);
  });

  it("only touches flowcharts and graphs", () => {
    const sequence = "sequenceDiagram\n  A->>B: call f(x)\n  Note over A: [x (y)]";
    const klass = "classDiagram\n  class A {\n    +f(x) int\n  }\n  A : list[int]";
    expect(repairMermaid(sequence)).toBe(sequence);
    expect(repairMermaid(klass)).toBe(klass);
    expect(repairMermaid("")).toBe("");
  });

  it("recognises a flowchart that follows comment lines", () => {
    expect(repairMermaid("%% title\nflowchart LR\n  A[x (y)]")).toBe('%% title\nflowchart LR\n  A["x (y)"]');
  });
});

describe("naturalSize", () => {
  it("replaces Mermaid's width=100% and max-width with the diagram's real pixel size", () => {
    const svg = '<svg id="m" width="100%" style="max-width: 1727px;" viewBox="4 4 1727.5 383" xmlns="http://www.w3.org/2000/svg"><g/></svg>';
    const sized = naturalSize(svg);
    expect(sized).toContain('width="1727.5"');
    expect(sized).toContain('height="383"');
    expect(sized).not.toContain("100%");
    expect(sized).not.toContain("max-width");
    expect(sized).toContain("<g/>");
  });

  it("returns an SVG without a usable viewBox unchanged instead of throwing", () => {
    for (const svg of ['<svg width="100%"><g/></svg>', '<svg viewBox="0 0 0 0"></svg>', "not svg"]) expect(naturalSize(svg)).toBe(svg);
  });
});

describe("stripMarkdownArtifacts", () => {
  it("undoes escaped arrows and bold markers left by a Markdown converter", () => {
    expect(stripMarkdownArtifacts("K --\\> TC --\\> VM[**(**Kafka**)**]")).toBe("K --> TC --> VM[(Kafka)]");
    expect(stripMarkdownArtifacts('subgraph D["Data plane **(**a**,** b**)**"]')).toBe('subgraph D["Data plane (a, b)"]');
    expect(stripMarkdownArtifacts("A -->|a\\|b| B\n  C\\_D")).toBe("A -->|a|b| B\n  C_D");
  });

  it("leaves diagram syntax that merely contains a backslash alone", () => {
    const shapes = "flowchart LR\n  A[\\back\\] --> B[/slash/]\n  A --> C[\\x/]";
    expect(stripMarkdownArtifacts(shapes)).toBe(shapes);
  });
});

describe("renderMermaid", () => {
  const render = vi.mocked(mermaid.render);
  const ok = (svg: string) => ({ svg, diagramType: "flowchart-v2" });

  it("renders valid source once, untouched apart from label quoting", async () => {
    render.mockReset().mockResolvedValueOnce(ok("<svg>fine</svg>"));
    await expect(renderMermaid("d", "flowchart LR\n  A --> B[x (y)]")).resolves.toBe("<svg>fine</svg>");
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith("d-0", 'flowchart LR\n  A --> B["x (y)"]');
  });

  it("retries once without Markdown artifacts when Mermaid rejects the original", async () => {
    render.mockReset().mockRejectedValueOnce(new Error("Lexical error on line 6")).mockResolvedValueOnce(ok("<svg>cleaned</svg>"));
    await expect(renderMermaid("d", "flowchart LR\n  A --\\> B[**(**db**)**]")).resolves.toBe("<svg>cleaned</svg>");
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]).toEqual(["d-1", "flowchart LR\n  A --> B[(db)]"]);
  });

  it("reports the FIRST error, which refers to the text the user can see", async () => {
    render.mockReset().mockRejectedValueOnce(new Error("first: line 3")).mockRejectedValueOnce(new Error("second: line 9"));
    await expect(renderMermaid("d", "flowchart LR\n  A --\\> B")).rejects.toThrow("first: line 3");
  });

  it("does not retry when there is nothing to clean up", async () => {
    render.mockReset().mockRejectedValueOnce(new Error("bad"));
    await expect(renderMermaid("d", "flowchart LR\n  A -->")).rejects.toThrow("bad");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("removes the container Mermaid leaves in the page after a failed render", async () => {
    const leftover = (id: string) => {
      const node = document.createElement("div");
      node.id = id;
      document.body.appendChild(node);
    };
    render.mockReset().mockImplementation(async (id: string) => {
      leftover(`d${id}`);
      throw new Error("bad");
    });
    await expect(renderMermaid("leak", "flowchart LR\n  A --\\> B")).rejects.toThrow("bad");
    expect(document.getElementById("dleak-0")).toBeNull();
    expect(document.getElementById("dleak-1")).toBeNull();
  });
});

describe("box diagram detection (ASCII and Unicode)", () => {
  const side = "+-----+     +----+\n| API | --> | DB |\n+-----+     +----+";
  const unicode = "┌─────┐     ┌────┐\n│ API │ ──▶ │ DB │\n└─────┘     └────┘";

  it("finds side-by-side and Unicode boxes under the caret", () => {
    for (const diagram of [side, unicode]) {
      const markdown = `Intro\n\n${diagram}\n\nOutro`;
      const range = findDiagramRange(markdown, markdown.indexOf("API"));
      expect(range?.text).toBe(diagram);
    }
  });

  it("fences bare box drawings of both kinds so spacing survives rendering", async () => {
    const { fenceAsciiDiagrams } = await import("../../lib/markdown");
    for (const diagram of [side, unicode]) {
      expect(fenceAsciiDiagrams(`Intro\n\n${diagram}\n\nOutro`)).toBe(`Intro\n\n\`\`\`text\n${diagram}\n\`\`\`\n\nOutro`);
    }
  });
});
