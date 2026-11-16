"use client";

import { useEffect, useMemo } from "react";
import type { TransformChange } from "../lib/api";
import { collapseDiff, lineDiff } from "../lib/diff";
import { btnPrimary, btnSecondary } from "./ui";

type Props = {
  before: string;
  after: string;
  changes: TransformChange[];
  removed: number;
  onApply: () => void;
  onCancel: () => void;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Clean AI Text never edits silently: this lists every rule that fired and shows the exact lines that change. */
export function CleanDialog({ before, after, changes, removed, onApply, onCancel }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const diff = useMemo(() => {
    const lines = lineDiff(before, after);
    return lines ? collapseDiff(lines) : null;
  }, [before, after]);

  const total = changes.reduce((sum, change) => sum + change.count, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clean-title"
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] p-5 text-[#c9d1d9] shadow-xl"
      >
        <h2 id="clean-title" className="text-lg font-semibold">
          Review cleanup
        </h2>
        <p data-testid="clean-summary" className="text-sm text-[#8b949e]">
          {removed > 0 ? `Removed: ${plural(removed, "phrase")}. ` : ""}
          {plural(total, "change")} in {plural(changes.length, "rule")}. Nothing is changed until you apply it.
        </p>

        <ul aria-label="Transformation report" className="space-y-2 overflow-auto text-sm">
          {changes.map((change) => (
            <li key={change.rule} data-testid={`change-${change.rule}`}>
              <div className="font-medium">
                {change.label} <span className="text-[#8b949e]">({change.count})</span>
              </div>
              <ul className="ml-4 list-disc text-xs text-[#8b949e]">
                {change.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <div className="min-h-0 flex-1 overflow-auto rounded border border-[#30363d] bg-[#0d1117] p-2 font-mono text-xs" aria-label="Preview of changes" role="group">
          {diff === null ? (
            <p className="text-[#8b949e]">The document is too large to show line by line; the report above lists every change.</p>
          ) : (
            diff.map((line, index) =>
              line.type === "gap" ? (
                <div key={index} className="text-[#8b949e]">
                  … {plural(line.count, "unchanged line")}
                </div>
              ) : (
                <div key={index} className={line.type === "removed" ? "bg-[#f85149]/15 text-[#f85149]" : line.type === "added" ? "bg-[#3fb950]/15 text-[#3fb950]" : "text-[#8b949e]"}>
                  <span aria-hidden="true">{line.type === "removed" ? "- " : line.type === "added" ? "+ " : "  "}</span>
                  <span className="whitespace-pre-wrap break-words">{line.text || " "}</span>
                  <span className="sr-only">{line.type === "removed" ? " (removed)" : line.type === "added" ? " (added)" : ""}</span>
                </div>
              ),
            )
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#30363d] pt-3">
          <button type="button" autoFocus onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={onApply} className={btnPrimary}>
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
