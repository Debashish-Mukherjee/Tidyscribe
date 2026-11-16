"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { FILE_IMPORT_ACCEPT, importFile, type ImportedFile } from "../lib/import-file";
import { btnSecondary } from "./ui";

type Props = { onImport: (file: ImportedFile) => void; notify: (message: string) => void; disabled?: boolean };

export function ImportFileButton({ onImport, notify, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [reading, setReading] = useState(false);
  // Reading is asynchronous: the completion must check the current editor's
  // unsaved state, including edits made while the file was being read.
  const callbacks = useRef({ onImport, notify });
  useLayoutEffect(() => { callbacks.current = { onImport, notify }; });

  const read = async (file: File) => {
    if (busy.current) return;
    busy.current = true;
    setReading(true);
    try {
      const imported = await importFile(file);
      callbacks.current.onImport(imported);
    } catch (error) {
      callbacks.current.notify(`Import failed: ${error instanceof Error ? error.message : "Could not read the file"}`);
    } finally {
      busy.current = false;
      setReading(false);
    }
  };

  return <>
    <input ref={input} type="file" accept={FILE_IMPORT_ACCEPT} aria-label="Choose a document file" hidden onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = ""; // Allow selecting the same file again after cancellation or failure.
      if (file) void read(file);
    }} />
    <button type="button" disabled={disabled || reading} aria-label="Import file" title="Import a UTF-8 Markdown, text or HTML file (up to 2 MB)" onClick={() => input.current?.click()} className={btnSecondary}>
      <FileUp className="h-4 w-4" />
      {reading ? "Reading…" : "Import"}
    </button>
  </>;
}
