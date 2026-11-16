import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "../../components/workbench";
import { readDraft, writeDraft } from "../../lib/drafts";
import { createFakeApi, type FakeApi } from "../fake-api";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg viewBox=\"0 0 1 1\"></svg>" })) } }));

const OTHER = { id: "d1", title: "Other", content: "# Other\n\nbody", updated_at: "rev-0" };

let fake: FakeApi;

const setup = (documents: Array<Record<string, unknown>> = [OTHER]) => {
  fake = createFakeApi({ documents: documents.map((doc) => ({ ...doc })) as never });
  vi.stubGlobal("fetch", fake.fetch);
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  return render(<Workbench />);
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const editor = () => screen.getByPlaceholderText(/paste ai output/i) as HTMLTextAreaElement;
const status = () => screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite") as HTMLElement;
const dialog = () => screen.getByRole("alertdialog");

async function paste(text: string) {
  await userEvent.clear(editor());
  await userEvent.click(editor());
  await userEvent.paste(text);
}

const openOther = async () => userEvent.click(await screen.findByRole("button", { name: "Other" }));
const beforeUnload = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("D11 destructive actions", () => {
  it("opens a document straight away when there is nothing unsaved", async () => {
    setup();
    await openOther();
    expect(editor().value).toBe(OTHER.content);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks before replacing unsaved edits, and Cancel keeps them", async () => {
    setup();
    await paste("# Mine\n\nthree hours of typing");
    await openOther();
    expect(dialog()).toHaveTextContent(/unsaved changes/i);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(editor().value).toContain("three hours of typing");
  });

  it("Discard and open replaces the text", async () => {
    setup();
    await paste("# Mine");
    await openOther();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Discard and open" }));
    expect(editor().value).toBe(OTHER.content);
  });

  it("Save, then open keeps the replaced text as its own document", async () => {
    setup();
    await paste("# Mine\n\nprecious");
    await openOther();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save, then open" }));
    await waitFor(() => expect(editor().value).toBe(OTHER.content));
    expect(fake.db.documents.map((doc) => doc.content)).toContain("# Mine\n\nprecious");
  });

  it("does not open the other document when saving first fails", async () => {
    setup();
    await paste("# Mine");
    await openOther();
    fake.fetch.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    await userEvent.click(within(dialog()).getByRole("button", { name: "Save, then open" }));
    await waitFor(() => expect(status()).toHaveTextContent(/save failed/i));
    expect(editor().value).toBe("# Mine");
  });

  it("warns before unload only when there are unsaved changes", async () => {
    setup();
    await waitFor(() => expect(editor().value).toContain("Executive Summary"));
    expect(beforeUnload()).toBe(false);
    await paste("# Unsaved");
    expect(beforeUnload()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Save as new document" }));
    await waitFor(() => expect(screen.getByTestId("save-state")).toHaveTextContent("Saved"));
    expect(beforeUnload()).toBe(false);
  });
});

describe("D12 concurrent edits", () => {
  const openAndEdit = async () => {
    setup();
    await openOther();
    await userEvent.type(editor(), " mine");
  };

  it("a stale save is blocked with a choice instead of overwriting newer work", async () => {
    await openAndEdit();
    fake.db.documents[0].updated_at = "rev-9"; // another tab saved in the meantime
    fake.db.documents[0].content = "# Theirs";
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/changed elsewhere/i);
    expect(fake.db.documents[0].content).toBe("# Theirs");
    expect(screen.getByTestId("save-state")).toHaveTextContent("Unsaved changes");
  });

  it("Save mine as a new document keeps both versions", async () => {
    await openAndEdit();
    fake.db.documents[0].updated_at = "rev-9";
    fake.db.documents[0].content = "# Theirs";
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save mine as a new document" }));

    await waitFor(() => expect(fake.db.documents).toHaveLength(2));
    expect(fake.db.documents[0].content).toBe("# Theirs");
    expect(fake.db.documents[1].content).toContain("mine");
  });

  it("Overwrite with mine replaces the other version on purpose", async () => {
    await openAndEdit();
    fake.db.documents[0].updated_at = "rev-9";
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Overwrite with mine" }));

    await waitFor(() => expect(fake.db.documents[0].content).toContain("mine"));
    expect(fake.db.documents).toHaveLength(1);
  });

  it("consecutive saves of the same document do not conflict with each other", async () => {
    await openAndEdit();
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByTestId("save-state")).toHaveTextContent("Saved"));
    await userEvent.type(editor(), " again");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fake.db.documents[0].content).toContain("again"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("D13 draft persistence", () => {
  it("flushes the draft when the page hides, without waiting for the debounce", async () => {
    setup([]);
    await paste("# Last words");
    window.dispatchEvent(new Event("pagehide"));
    expect(readDraft()).toBe("# Last words");
  });

  it("restores an emptied editor instead of bringing the starter document back", async () => {
    writeDraft("");
    setup([]);
    await waitFor(() => expect(screen.getByText(/restored your last draft/i)).toBeInTheDocument());
    expect(editor().value).toBe("");
  });
});

describe("D14 failure handling", () => {
  const apiDown = () =>
    fake.fetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

  it("Clean AI Text reports a readable failure and does not stay on 'Cleaning text'", async () => {
    setup([]);
    apiDown();
    await userEvent.click(screen.getByRole("button", { name: "Clean AI Text" }));
    await waitFor(() => expect(status()).toHaveTextContent("Clean failed: Cannot reach the server"));
    expect(status()).not.toHaveTextContent("Failed to fetch");
  });

  it("Smart Paste reports a readable failure", async () => {
    setup([]);
    apiDown();
    await userEvent.click(screen.getByRole("button", { name: "Smart Paste" }));
    await waitFor(() => expect(status()).toHaveTextContent("Smart Paste failed: Cannot reach the server"));
  });

  it("an API validation error is shown as a sentence, not raw JSON", async () => {
    setup([]);
    await paste("# Big");
    fake.fetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 422,
      statusText: "Unprocessable",
      json: async () => ({ detail: [{ loc: ["body", "content"], type: "string_too_long", msg: "String should have at most 2000000 characters", ctx: { max_length: 2000000 } }] }),
    }));
    await userEvent.click(screen.getByRole("button", { name: "Save as new document" }));
    await waitFor(() => expect(status()).toHaveTextContent("Save failed: Content is too long (limit 2,000,000 characters)"));
  });
});
