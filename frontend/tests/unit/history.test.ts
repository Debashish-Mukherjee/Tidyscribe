import { describe, expect, it } from "vitest";
import { historyReducer } from "../../lib/history";

type HistoryState = Parameters<typeof historyReducer>[0];

const start: HistoryState = { past: [], present: "a", future: [], lastEdit: 0 };
const set = (state: HistoryState, value: string, now: number, checkpoint = false) =>
  historyReducer(state, { type: "set", value, now, checkpoint, groupMs: 700 });

describe("historyReducer", () => {
  it("groups rapid edits into one undo step and separates slow ones", () => {
    let state = set(start, "ab", 1000);
    state = set(state, "abc", 1200); // within 700ms: grouped
    expect(state.past).toEqual(["a"]);
    state = set(state, "abcd", 2500); // gap: new step
    expect(state.past).toEqual(["a", "abc"]);
  });

  it("checkpoint edits always start a new step", () => {
    let state = set(start, "ab", 1000);
    state = set(state, "replaced", 1100, true);
    expect(state.past).toEqual(["a", "ab"]);
  });

  it("ignores no-op edits", () => {
    expect(set(start, "a", 5)).toBe(start);
  });

  it("undo and redo walk the history and a new edit clears redo", () => {
    let state = set(set(start, "b", 1000, true), "c", 2000, true);
    state = historyReducer(state, { type: "undo" });
    expect(state.present).toBe("b");
    state = historyReducer(state, { type: "undo" });
    expect(state.present).toBe("a");
    expect(historyReducer(state, { type: "undo" })).toBe(state); // nothing left
    state = historyReducer(state, { type: "redo" });
    expect(state.present).toBe("b");
    state = set(state, "x", 3000, true);
    expect(state.future).toEqual([]);
    expect(historyReducer(state, { type: "redo" })).toBe(state);
  });

  it("caps history length", () => {
    let state = start;
    for (let i = 0; i < 250; i += 1) state = set(state, `v${i}`, i * 1000, true);
    expect(state.past).toHaveLength(200);
    expect(state.past[0]).toBe("v49");
  });

  it("reset drops all history", () => {
    const state = historyReducer(set(start, "b", 1, true), { type: "reset", value: "fresh" });
    expect(state).toEqual({ past: [], present: "fresh", future: [], lastEdit: 0 });
  });
});
