import { describe, expect, it } from "vitest";
import { timeAgo, wordCount } from "../../lib/format";

describe("wordCount", () => {
  it("counts whitespace-separated words and ignores blank text", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  \n\t ")).toBe(0);
    expect(wordCount("# Title\n\nOne  two\nthree")).toBe(5);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("describes recent times in the largest sensible unit", () => {
    expect(timeAgo(ago(5_000), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe("2 d ago");
  });

  it("falls back to a date after a month", () => {
    expect(timeAgo(ago(90 * 86_400_000), now)).toBe(new Date(now - 90 * 86_400_000).toLocaleDateString());
  });

  it("is empty for missing or invalid input and never negative for future times", () => {
    expect(timeAgo(null, now)).toBe("");
    expect(timeAgo(undefined, now)).toBe("");
    expect(timeAgo("not a date", now)).toBe("");
    expect(timeAgo(ago(-60_000), now)).toBe("just now");
  });
});
