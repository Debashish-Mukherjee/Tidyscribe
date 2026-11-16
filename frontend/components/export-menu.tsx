"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { btnPrimary } from "./ui";

export type ExportChoice = "docx" | "pdf" | "html" | "markdown";

const CHOICES: { id: ExportChoice; label: string }[] = [
  { id: "docx", label: "Word (.docx)" },
  { id: "pdf", label: "PDF" },
  { id: "html", label: "HTML" },
  { id: "markdown", label: "Markdown (.md)" },
];

export function ExportMenu({ onChoose, disabled }: { onChoose: (choice: ExportChoice) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((value) => !value)} className={btnPrimary}>
        Export
        <ChevronDown className="h-4 w-4" />
      </button>
      {open ? (
        <div role="menu" aria-label="Export format" className="absolute right-0 z-20 mt-1 w-44 rounded border border-[#30363d] bg-[#0d1117] py-1 shadow-lg">
          {CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onChoose(choice.id);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[#161b22]"
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
