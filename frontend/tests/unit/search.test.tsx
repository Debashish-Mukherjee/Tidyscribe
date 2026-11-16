import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FindBar } from "../../components/find-bar";
import { findMatches, nextIndex, previousIndex, replaceAll, replaceMatch } from "../../lib/search";

const plain = { caseSensitive: false, regex: false };

describe("search helpers", () => {
  it("finds literal matches case-insensitively by default and escapes regex characters", () => {
    expect(findMatches("Foo foo (x) FOO", "foo", plain)).toHaveLength(3);
    expect(findMatches("a.b axb", "a.b", plain)).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches("Foo foo", "foo", { caseSensitive: true, regex: false })).toEqual([{ start: 4, end: 7 }]);
  });

  it("returns nothing for an empty query, an invalid pattern or only empty matches", () => {
    expect(findMatches("abc", "", plain)).toEqual([]);
    expect(findMatches("abc", "(", { caseSensitive: false, regex: true })).toEqual([]);
    expect(findMatches("abc", "x*", { caseSensitive: false, regex: true })).toEqual([]);
  });

  it("walks matches forwards and backwards with wrap-around", () => {
    const matches = findMatches("a a a", "a", plain);
    expect(nextIndex(matches, 0)).toBe(0);
    expect(nextIndex(matches, 1)).toBe(1);
    expect(nextIndex(matches, 5)).toBe(0);
    expect(previousIndex(matches, 5)).toBe(2);
    expect(previousIndex(matches, 0)).toBe(2);
    expect(nextIndex([], 0)).toBe(-1);
    expect(previousIndex([], 0)).toBe(-1);
  });

  it("replaces literally, treating $ as plain text", () => {
    expect(replaceAll("a b a", "a", "$&!", plain)).toEqual({ text: "$&! b $&!", count: 2 });
    expect(replaceAll("abc", "z", "y", plain)).toEqual({ text: "abc", count: 0 });
  });

  it("expands capture groups in regex mode, for all matches and for a single match", () => {
    const options = { caseSensitive: false, regex: true };
    expect(replaceAll("a1 b2", "(\\w)(\\d)", "$2$1", options).text).toBe("1a 2b");
    const matches = findMatches("a1 b2", "(\\w)(\\d)", options);
    expect(replaceMatch("a1 b2", matches[1], "(\\w)(\\d)", "<$1>", options)).toBe("a1 <b>");
  });

  it("keeps anchors working when replacing a single match", () => {
    const options = { caseSensitive: false, regex: true };
    const matches = findMatches("x\nx", "^x", options);
    expect(replaceMatch("x\nx", matches[1], "^x", "y", options)).toBe("x\ny");
  });
});

function Harness({ initial, onClose = () => undefined }: { initial: string; onClose?: () => void }) {
  const [content, setContent] = useState(initial);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <>
      <textarea ref={editorRef} aria-label="editor" value={content} onChange={(event) => setContent(event.target.value)} />
      <FindBar content={content} setContent={setContent} editorRef={editorRef} onClose={onClose} onStatus={() => undefined} />
    </>
  );
}

describe("FindBar", () => {
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("shows the match count and selects matches in the editor", () => {
    render(<Harness initial="one two one" />);
    expect(screen.getByLabelText("Replace with")).toBeInTheDocument();
    type("Find", "one");
    expect(screen.getByText("2 found")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Next match"));
    const editor = screen.getByLabelText("editor") as HTMLTextAreaElement;
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 3]);
    fireEvent.click(screen.getByLabelText("Next match"));
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([8, 11]);
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 3]);
  });

  it("reports no results and invalid patterns", () => {
    render(<Harness initial="abc" />);
    type("Find", "zzz");
    expect(screen.getByText("No results")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Regular expression"));
    type("Find", "(");
    expect(screen.getByText("Invalid pattern")).toBeInTheDocument();
  });

  it("replaces the current match, then the next, and can replace all", () => {
    render(<Harness initial="cat cat cat" />);
    const editor = screen.getByLabelText("editor") as HTMLTextAreaElement;
    type("Find", "cat");
    type("Replace with", "dog");
    fireEvent.click(screen.getByLabelText("Next match"));
    fireEvent.click(screen.getByText("Replace"));
    expect(editor.value).toBe("dog cat cat");
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([4, 7]);
    fireEvent.click(screen.getByText("Replace all"));
    expect(editor.value).toBe("dog dog dog");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness initial="abc" onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
