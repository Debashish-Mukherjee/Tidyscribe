import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "../../components/workbench";
import { createFakeApi } from "../fake-api";

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" viewBox="0 0 10 10"></svg>` })) },
}));

beforeAll(() => {
  // ProseMirror measures text through Range geometry, which jsdom does not implement.
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

beforeEach(() => {
  vi.stubGlobal("fetch", createFakeApi().fetch);
  localStorage.clear();
});

const source = () => screen.getByPlaceholderText(/paste ai output/i) as HTMLTextAreaElement;

describe("Workbench editor modes", () => {
  it("switches to the rich editor with the same content, and back with edits applied", async () => {
    render(<Workbench />);
    await userEvent.clear(source());
    await userEvent.click(source());
    await userEvent.paste("plain line");

    await userEvent.click(screen.getByRole("button", { name: "Rich" }));
    const rich = await screen.findByRole("textbox", { name: "Rich text editor" });
    await waitFor(() => expect(rich).toHaveTextContent("plain line"));
    expect(screen.queryByPlaceholderText(/paste ai output/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Find and replace" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Paste mode" })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Bullet list" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    await userEvent.click(screen.getByRole("button", { name: "Source" }));
    await waitFor(() => expect(source().value).toBe("- plain line"));
  });

  it("opens find and replace with Ctrl+F in the source editor and replaces text", async () => {
    render(<Workbench />);
    await userEvent.clear(source());
    await userEvent.click(source());
    await userEvent.paste("cat and cat");
    fireEvent.keyDown(source(), { key: "f", ctrlKey: true });
    const find = await screen.findByRole("search", { name: "Find and replace" });
    expect(find).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find"), { target: { value: "cat" } });
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "dog" } });
    fireEvent.click(screen.getByText("Replace all"));
    expect(source().value).toBe("dog and dog");
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
  });
});
