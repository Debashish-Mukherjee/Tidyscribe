import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Workbench } from "../../components/workbench";
import { createFakeApi, type FakeApi } from "../fake-api";

vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg></svg>" })) } }));

const ORIGINAL = { id: "saved", title: "Original", content: "# Original", updated_at: "rev-0" };
let fake: FakeApi;
const editor = () => screen.getByRole("textbox", { name: "Document source" });
const choose = (file = new File(["# Imported\n\nNew content"], "notes.md")) => fireEvent.change(screen.getByLabelText("Choose a document file"), { target: { files: [file] } });

beforeEach(() => {
  fake = createFakeApi({ documents: [{ ...ORIGINAL }] as never });
  vi.stubGlobal("fetch", fake.fetch);
});

it("imports as an unsaved document; saving cannot overwrite the previously opened document", async () => {
  render(<Workbench />);
  await userEvent.click(await screen.findByRole("button", { name: "Original" }));
  choose();
  await waitFor(() => expect(editor()).toHaveValue("# Imported\n\nNew content"));
  expect(screen.getByTestId("save-state")).toHaveTextContent("Not saved");
  expect(fake.db.documents).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Save as new document" }));
  await waitFor(() => expect(fake.db.documents).toHaveLength(2));
  expect(fake.db.documents[0].content).toBe(ORIGINAL.content);
  expect(fake.db.documents[1].content).toContain("Imported");
});

it("Cancel retains unsaved text and the same file can be selected again", async () => {
  render(<Workbench />);
  fireEvent.change(editor(), { target: { value: "# Precious work" } });
  choose();
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(editor()).toHaveValue("# Precious work");
  choose();
  await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard and open" }));
  expect(editor()).toHaveValue("# Imported\n\nNew content");
});

it("saves unsaved work before importing", async () => {
  render(<Workbench />);
  fireEvent.change(editor(), { target: { value: "# Precious work" } });
  choose();
  await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Save, then open" }));
  await waitFor(() => expect(editor()).toHaveValue("# Imported\n\nNew content"));
  expect(fake.db.documents.some((doc) => doc.content === "# Precious work")).toBe(true);
});

it("preserves the editor when saving before import fails", async () => {
  render(<Workbench />);
  await screen.findByRole("button", { name: "Original" });
  fireEvent.change(editor(), { target: { value: "# Precious work" } });
  choose();
  const dialog = await screen.findByRole("alertdialog");
  fake.fetch.mockImplementationOnce(async () => { throw new TypeError("Failed to fetch"); });
  await userEvent.click(within(dialog).getByRole("button", { name: "Save, then open" }));
  await waitFor(() => expect(screen.getByText(/Save failed:/)).toBeInTheDocument());
  expect(editor()).toHaveValue("# Precious work");
});

it("reports import failures without replacing the editor", async () => {
  render(<Workbench />);
  const before = (editor() as HTMLTextAreaElement).value;
  choose(new File(["binary"], "file.pdf"));
  await screen.findByText(/Import failed: Choose a Markdown/);
  expect(editor()).toHaveValue(before);
});

it("protects edits made while the file is still being read", async () => {
  const read = FileReader.prototype.readAsArrayBuffer;
  let complete: (() => void) | undefined;
  vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader, blob) {
    complete = () => read.call(this, blob);
  });
  render(<Workbench />);
  choose();
  expect(screen.getByRole("button", { name: "Import file" })).toBeDisabled();
  fireEvent.change(editor(), { target: { value: "# Typed during read" } });
  complete!();
  await screen.findByRole("alertdialog");
  expect(editor()).toHaveValue("# Typed during read");
});
