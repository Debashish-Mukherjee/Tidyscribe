import { beforeEach, describe, expect, it } from "vitest";
import { backupAndClearDraft, readDraft, tabId, writeDraft } from "../../lib/drafts";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const asOtherTab = (action: () => void) => {
  const own = sessionStorage.getItem("workbench.tab.v1");
  sessionStorage.setItem("workbench.tab.v1", "other-tab");
  try {
    action();
  } finally {
    if (own) sessionStorage.setItem("workbench.tab.v1", own);
    else sessionStorage.removeItem("workbench.tab.v1");
  }
};

describe("drafts", () => {
  it("round-trips and reports absence as null", () => {
    expect(readDraft()).toBeNull();
    writeDraft("# hi");
    expect(readDraft()).toBe("# hi");
  });

  it("an emptied draft is a real draft, not an absent one", () => {
    writeDraft("# text");
    writeDraft("");
    expect(readDraft()).toBe("");
  });

  it("each tab keeps its own draft", () => {
    writeDraft("# tab one");
    asOtherTab(() => writeDraft("# tab two"));
    expect(readDraft()).toBe("# tab one");
  });

  it("a tab without a draft adopts the newest one", () => {
    asOtherTab(() => writeDraft("# from elsewhere"));
    expect(tabId()).not.toBe("other-tab");
    expect(readDraft()).toBe("# from elsewhere");
  });

  it("still reads a draft saved by the previous single-slot format", () => {
    localStorage.setItem("workbench.draft.v1", "# legacy");
    expect(readDraft()).toBe("# legacy");
  });

  it("keeps only the most recent drafts", () => {
    for (let i = 0; i < 15; i += 1) asOtherTab(() => {
      sessionStorage.setItem("workbench.tab.v1", `tab-${i}`);
      writeDraft(`# ${i}`);
    });
    expect(Object.keys(JSON.parse(localStorage.getItem("workbench.drafts.v2") ?? "{}")).length).toBeLessThanOrEqual(10);
  });

  it("backing up never loses the draft", () => {
    writeDraft("# precious");
    backupAndClearDraft();
    expect(readDraft()).toBeNull();
    expect(localStorage.getItem("workbench.draft.backup.v1")).toBe("# precious");
  });
});
