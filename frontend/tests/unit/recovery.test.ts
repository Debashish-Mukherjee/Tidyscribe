import { beforeEach, describe, expect, it } from "vitest";
import { armBoot, beginBoot, clearBootMarker, flagCrash, markHealthy } from "../../lib/recovery";

beforeEach(() => sessionStorage.clear());

describe("boot guard", () => {
  it("a clean boot is not recovering and is healthy once marked", () => {
    const boot = beginBoot();
    expect(boot.recovering).toBe(false);
    expect(sessionStorage.getItem("workbench.boot.v1")).toBe(boot.id);
    markHealthy(boot.id);
    expect(sessionStorage.getItem("workbench.boot.v1")).toBeNull();
    expect(beginBoot().recovering).toBe(false);
  });

  it("a boot that never became healthy puts the next load into recovery and keeps the marker", () => {
    const first = beginBoot();
    const second = beginBoot();
    expect(second.recovering).toBe(true);
    expect(sessionStorage.getItem("workbench.boot.v1")).toBe(first.id);
    markHealthy(second.id);
    expect(sessionStorage.getItem("workbench.boot.v1")).toBe(first.id);
    expect(beginBoot().recovering).toBe(true);
  });

  it("another tab cannot clear this tab's marker", () => {
    const tabA = beginBoot();
    sessionStorage.setItem("workbench.boot.v1", "tab-b");
    markHealthy(tabA.id);
    expect(sessionStorage.getItem("workbench.boot.v1")).toBe("tab-b");
  });

  it("arming and clearing the marker is explicit", () => {
    armBoot("x");
    expect(beginBoot().recovering).toBe(true);
    clearBootMarker();
    expect(beginBoot().recovering).toBe(false);
  });

  it("a flagged crash forces recovery on the next load", () => {
    flagCrash();
    expect(beginBoot().recovering).toBe(true);
  });
});
