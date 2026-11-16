"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage, type DocumentOut } from "../lib/api";
import type { DocumentSnapshot } from "../lib/drafts";
import { titleFromMarkdown } from "../lib/document";

/** Owns the server revision and saved baseline independently of preview/layout state. */
export function useDocumentSession(content: string, initialContent: string, reset: (content: string) => void, notify: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<DocumentSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const inFlight = useRef(false);
  const queryClient = useQueryClient();
  const hasUnsavedWork = snapshot ? content !== snapshot.content : content !== initialContent && content !== "";

  const saveDocument = async (options: { force?: boolean; asNew?: boolean } = {}) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    try {
      const payload = { title: titleFromMarkdown(content), content };
      let stored: DocumentOut;
      if (snapshot && !options.asNew) {
        try {
          stored = await api.documents.update(snapshot.id, { ...payload, expected_updated_at: options.force ? undefined : snapshot.updated_at });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
          stored = await api.documents.create(payload);
        }
      } else {
        stored = await api.documents.create(payload);
      }
      setSnapshot({ id: stored.id, content: stored.content, updated_at: stored.updated_at ?? null });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
      void queryClient.invalidateQueries({ queryKey: ["versions"] });
      notify(`Saved “${stored.title}”`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveConflict(true);
        notify("Not saved: this document was changed somewhere else");
      } else notify(`Save failed: ${errorMessage(error)}`);
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const applyOpen = (document: DocumentOut) => {
    reset(document.content);
    setSnapshot({ id: document.id, content: document.content, updated_at: document.updated_at ?? null });
    notify(`Opened “${document.title}”`);
  };

  return { snapshot, restoreSnapshot: setSnapshot, currentDocId: snapshot?.id ?? null, savedContent: snapshot?.content ?? null,
    saving, saveConflict, setSaveConflict, hasUnsavedWork, saveDocument, applyOpen, clearSession: () => setSnapshot(null) };
}
