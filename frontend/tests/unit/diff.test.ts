import { describe, expect, it } from "vitest";
import { collapseDiff, lineDiff } from "../../lib/diff";

describe("lineDiff", () => {
  it("marks removed, added and unchanged lines", () => {
    const diff = lineDiff("a\nb\nc", "a\nc\nd");
    expect(diff).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
      { type: "added", text: "d" },
    ]);
  });

  it("reports a replaced line as removed then added", () => {
    expect(lineDiff("x\nold\ny", "x\nnew\ny")?.map((l) => l.type)).toEqual(["same", "removed", "added", "same"]);
  });

  it("gives up on inputs too large to diff", () => {
    const big = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
    const other = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
    expect(lineDiff(big, other)).toBeNull();
  });

  it("collapses long unchanged stretches", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l10", "changed");
    const collapsed = collapseDiff(lineDiff(before, after)!, 1);
    expect(collapsed.some((line) => line.type === "gap")).toBe(true);
    expect(collapsed.filter((line) => line.type === "removed" || line.type === "added")).toHaveLength(2);
  });
});
