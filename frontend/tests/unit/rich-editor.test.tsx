import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import RichEditor from "../../components/rich-editor";

beforeAll(() => {
  // ProseMirror measures text through Range/Element geometry, which jsdom does not implement.
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

const editorBody = async () => screen.findByRole("textbox", { name: "Rich text editor" });

describe("RichEditor", () => {
  it("loads Markdown as formatted content", async () => {
    render(<RichEditor value={"# Title\n\n- one\n- two\n\nTasks:\n\n- [x] done"} onChange={() => undefined} />);
    const body = await editorBody();
    await waitFor(() => expect(body.querySelector("h1")?.textContent).toBe("Title"));
    expect(body.querySelectorAll("ul:not([data-type=taskList]) li")).toHaveLength(2);
    expect(body.querySelector("ul[data-type=taskList] li[data-checked=true]")).not.toBeNull();
  });

  it("reports edits as Markdown", async () => {
    const onChange = vi.fn();
    render(<RichEditor value="plain text" onChange={onChange} />);
    await editorBody();
    await waitFor(() => expect(screen.getByRole("button", { name: "Bullet list" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("- plain text"));
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("plain text"));
  });

  it("converts the line to a task list and inserts a table", async () => {
    const onChange = vi.fn();
    render(<RichEditor value="todo" onChange={onChange} />);
    await editorBody();
    await waitFor(() => expect(screen.getByRole("button", { name: "Task list" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Task list" }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("- [ ] todo"));
  });

  it("replaces its content when the value changes elsewhere, without echoing the change back", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichEditor value="first" onChange={onChange} />);
    const body = await editorBody();
    rerender(<RichEditor value={"## Replaced"} onChange={onChange} />);
    await waitFor(() => expect(body.querySelector("h2")?.textContent).toBe("Replaced"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers undo and redo for its own edits", async () => {
    const onChange = vi.fn();
    render(<RichEditor value="text" onChange={onChange} />);
    await editorBody();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Bullet list" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("text"));
  });
});
