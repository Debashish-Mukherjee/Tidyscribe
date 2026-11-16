"use client";

import { useState } from "react";
import { btnPrimary, btnSecondary } from "./ui";

type Action = { label: string; onClick: () => void };

type Props = {
  heading: string;
  description: string;
  /** Stored draft text; shown only as inert plain text. */
  draft: string | null;
  primary: Action;
  secondary?: Action;
};

export function RecoveryDialog({ heading, description, draft, primary, secondary }: Props) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const hasDraft = draft !== null && draft.trim() !== "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft ?? "");
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([draft ?? ""], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "recovered-draft.md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="recovery-heading"
        aria-describedby="recovery-description"
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border border-[#30363d] bg-[#161b22] p-5 text-[#c9d1d9] shadow-xl"
      >
        <h2 id="recovery-heading" className="text-lg font-semibold">
          {heading}
        </h2>
        <p id="recovery-description" className="text-sm text-[#8b949e]">
          {description}
        </p>

        {hasDraft ? (
          <>
            <textarea
              readOnly
              aria-label="Saved draft (read-only)"
              value={draft}
              spellCheck={false}
              className="h-48 w-full resize-y rounded border border-[#30363d] bg-[#0d1117] p-2 font-mono text-xs text-[#c9d1d9]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void copy()} className={btnSecondary}>
                Copy draft
              </button>
              <button type="button" onClick={download} className={btnSecondary}>
                Download draft
              </button>
              <span role="status" className="text-xs text-[#8b949e]">
                {copied === "done" ? "Copied to the clipboard" : copied === "failed" ? "Clipboard access unavailable" : ""}
              </span>
            </div>
          </>
        ) : (
          <p className="text-sm text-[#8b949e]">There is no saved draft in this browser.</p>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#30363d] pt-3">
          {secondary ? (
            <button type="button" onClick={secondary.onClick} className={btnSecondary}>
              {secondary.label}
            </button>
          ) : null}
          <button type="button" autoFocus onClick={primary.onClick} className={btnPrimary}>
            {primary.label}
          </button>
        </div>
      </div>
    </div>
  );
}
