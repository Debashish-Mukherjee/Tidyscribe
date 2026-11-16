"use client";

import { useEffect } from "react";
import { btnPrimary, btnSecondary } from "./ui";

export type ConfirmAction = { label: string; onClick: () => void; primary?: boolean };

type Props = {
  title: string;
  message: string;
  actions: ConfirmAction[];
  onCancel: () => void;
};

/** Modal choice with Cancel always available; focus starts on Cancel so Enter never destroys anything. */
export function ConfirmDialog({ title, message, actions, onCancel }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-[#30363d] bg-[#161b22] p-5 text-[#c9d1d9] shadow-xl"
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p id="confirm-message" className="break-words text-sm text-[#8b949e]">
          {message}
        </p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#30363d] pt-3">
          <button type="button" autoFocus onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
          {actions.map((action) => (
            <button key={action.label} type="button" onClick={action.onClick} className={action.primary ? btnPrimary : btnSecondary}>
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
