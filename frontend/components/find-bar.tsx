"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { buildPattern, findMatches, nextIndex, previousIndex, replaceAll, replaceMatch, type FindOptions } from "../lib/search";
import { btnGhost, btnSecondary } from "./ui";

type Props = {
  content: string;
  setContent: (value: string, options?: { checkpoint?: boolean }) => void;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  initialQuery?: string;
  onClose: () => void;
  onStatus: (message: string) => void;
};

const input = "min-w-0 flex-1 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-sm text-[#c9d1d9] outline-none focus:border-[#58a6ff]";
const toggle = (on: boolean) => `rounded border px-1.5 py-0.5 text-xs ${on ? "border-[#58a6ff] text-[#58a6ff]" : "border-[#30363d] text-[#8b949e] hover:border-[#58a6ff]"}`;

export function FindBar({ content, setContent, editorRef, initialQuery = "", onClose, onStatus }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const findRef = useRef<HTMLInputElement | null>(null);
  // Selection to apply once the textarea shows the replaced text.
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  const options: FindOptions = useMemo(() => ({ caseSensitive, regex }), [caseSensitive, regex]);
  const matches = useMemo(() => findMatches(content, query, options), [content, query, options]);
  const invalid = query !== "" && buildPattern(query, options) === null;

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, []);

  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const editor = editorRef.current;
    if (!selection || !editor) return;
    pendingSelection.current = null;
    editor.focus();
    editor.setSelectionRange(selection.start, selection.end);
  }, [content, editorRef]);

  const select = (index: number) => {
    const editor = editorRef.current;
    const match = matches[index];
    if (!editor || !match) return;
    // A textarea only paints its selection while focused, so focus moves to the editor.
    editor.focus();
    editor.setSelectionRange(match.start, match.end);
  };

  const goNext = () => select(nextIndex(matches, editorRef.current?.selectionEnd ?? 0));
  const goPrevious = () => select(previousIndex(matches, editorRef.current?.selectionStart ?? content.length));

  const handleReplace = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = matches.find((match) => match.start === editor.selectionStart && match.end === editor.selectionEnd);
    if (!current) return goNext();
    const updated = replaceMatch(content, current, query, replacement, options);
    const caret = current.start + (updated.length - (content.length - (current.end - current.start)));
    const upcoming = findMatches(updated, query, options);
    const next = upcoming[nextIndex(upcoming, caret)];
    pendingSelection.current = next ? { start: next.start, end: next.end } : { start: caret, end: caret };
    setContent(updated, { checkpoint: true });
  };

  const handleReplaceAll = () => {
    const result = replaceAll(content, query, replacement, options);
    if (result.count === 0) return;
    setContent(result.text, { checkpoint: true });
    onStatus(`Replaced ${result.count} occurrence${result.count === 1 ? "" : "s"}`);
  };

  const close = () => {
    onClose();
    editorRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) goPrevious();
      else if (event.currentTarget === findRef.current) goNext();
      else handleReplace();
    }
  };

  const summary = invalid ? "Invalid pattern" : !query ? "" : matches.length === 0 ? "No results" : `${matches.length} found`;

  return (
    <div role="search" aria-label="Find and replace" className="flex shrink-0 flex-col gap-1.5 border-b border-[#30363d] bg-[#161b22] px-3 py-2" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1.5">
        <input ref={findRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find" placeholder="Find" className={input} />
        <button type="button" aria-pressed={caseSensitive} aria-label="Match case" title="Match case" onClick={() => setCaseSensitive(!caseSensitive)} className={toggle(caseSensitive)}>
          Aa
        </button>
        <button type="button" aria-pressed={regex} aria-label="Regular expression" title="Regular expression" onClick={() => setRegex(!regex)} className={toggle(regex)}>
          .*
        </button>
        <span aria-live="polite" className={`w-20 shrink-0 text-xs ${invalid ? "text-[#f85149]" : "text-[#8b949e]"}`}>
          {summary}
        </span>
        <button type="button" onClick={goPrevious} disabled={matches.length === 0} aria-label="Previous match" title="Previous match (Shift+Enter)" className={btnGhost}>
          <ChevronUp className="h-4 w-4" />
        </button>
        <button type="button" onClick={goNext} disabled={matches.length === 0} aria-label="Next match" title="Next match (Enter)" className={btnGhost}>
          <ChevronDown className="h-4 w-4" />
        </button>
        <button type="button" onClick={close} aria-label="Close find" title="Close (Esc)" className={btnGhost}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <input value={replacement} onChange={(event) => setReplacement(event.target.value)} aria-label="Replace with" placeholder="Replace with" className={input} />
        <button type="button" onClick={handleReplace} disabled={matches.length === 0} className={btnSecondary}>
          Replace
        </button>
        <button type="button" onClick={handleReplaceAll} disabled={matches.length === 0} className={btnSecondary}>
          Replace all
        </button>
      </div>
    </div>
  );
}
