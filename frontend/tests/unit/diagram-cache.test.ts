import { describe, expect, it, vi } from "vitest";
import { cachedDiagram } from "../../lib/diagram-cache";
import { renderMermaid } from "../../lib/diagrams";
vi.mock("../../lib/diagrams", () => ({ renderMermaid: vi.fn(async () => '<svg id="root"><defs><marker id="arrow"></marker></defs><path marker-end="url(#arrow)"/></svg>') }));

describe("diagram cache", () => {
  it("shares render work but gives duplicate diagrams unique ids", async () => {
    const [one, two] = await Promise.all([cachedDiagram("graph LR; A-->B", "one"), cachedDiagram("graph LR; A-->B", "two")]);
    expect(renderMermaid).toHaveBeenCalledTimes(1);
    expect(one).toContain('id="one-arrow"');
    expect(one).toContain('url(#one-arrow)');
    expect(two).toContain('url(#two-arrow)');
  });
  it("retries a failed rendering instead of caching the failure", async () => {
    vi.mocked(renderMermaid).mockRejectedValueOnce(new Error("bad diagram"));
    await expect(cachedDiagram("bad", "first")).rejects.toThrow("bad diagram");
    await expect(cachedDiagram("bad", "second")).resolves.toContain("svg");
  });
});
