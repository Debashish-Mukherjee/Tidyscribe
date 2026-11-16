// Each tab writes a separate key: simultaneous writes cannot replace another tab's draft.
const PREFIX = "workbench.drafts.v3.";
const DRAFTS_KEY = "workbench.drafts.v2";
const LEGACY_KEY = "workbench.draft.v1";
const BACKUP_KEY = "workbench.draft.backup.v1";
const TAB_KEY = "workbench.tab.v1";
const MAX_DRAFTS = 10;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type DocumentSnapshot = { id: string; content: string; updated_at: string | null };
export type Draft = { text: string; at: number; document?: DocumentSnapshot | null };
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) sessionStorage.setItem(TAB_KEY, (id = newId()));
    return id;
  } catch { return "shared"; }
}

function decode(value: string | null): Draft | null {
  try {
    const draft = JSON.parse(value ?? "null") as Draft | null;
    if (!draft || typeof draft.text !== "string" || typeof draft.at !== "number" || Date.now() - draft.at >= MAX_AGE_MS) return null;
    const doc = draft.document;
    return { ...draft, document: doc && typeof doc.id === "string" && typeof doc.content === "string" && (doc.updated_at === null || typeof doc.updated_at === "string") ? doc : null };
  } catch { return null; }
}

function oldDrafts(): Record<string, Draft> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function entries(): Array<[string, Draft]> {
  const found: Array<[string, Draft]> = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const draft = decode(localStorage.getItem(key));
    if (draft) found.push([key, draft]);
  }
  return found.sort(([, a], [, b]) => b.at - a.at);
}

/** Reads old formats as well, so a deployment never discards an existing draft. */
export function readDraftState(): Draft | null {
  try {
    const own = decode(localStorage.getItem(PREFIX + tabId()));
    if (own) return own;
    const old = oldDrafts();
    const oldOwn = decode(JSON.stringify(old?.[tabId()]));
    if (oldOwn) return oldOwn;
    const candidates = [...entries().map(([, draft]) => draft), ...Object.values(old ?? {}).map((draft) => decode(JSON.stringify(draft))).filter((draft): draft is Draft => draft !== null)];
    const newest = candidates.sort((a, b) => b.at - a.at)[0];
    if (newest) return newest;
    const legacy = localStorage.getItem(LEGACY_KEY);
    return legacy === null ? null : { text: legacy, at: Date.now() };
  } catch { return null; }
}

export function readDraft(): string | null { return readDraftState()?.text ?? null; }

export function writeDraft(text: string, document: DocumentSnapshot | null = null) {
  try {
    const own = PREFIX + tabId();
    localStorage.setItem(own, JSON.stringify({ text, at: Date.now(), document }));
    const expired: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(PREFIX) && key !== own && !decode(localStorage.getItem(key))) expired.push(key);
    }
    for (const key of expired) localStorage.removeItem(key);
    // Bound browser storage while leaving the key currently being written intact.
    for (const [key] of entries().slice(MAX_DRAFTS)) if (key !== own) localStorage.removeItem(key);
  } catch { /* Storage can be unavailable or full; editing remains available. */ }
}

export function backupAndClearDraft() {
  try {
    const draft = readDraft();
    if (draft !== null) localStorage.setItem(BACKUP_KEY, draft);
    localStorage.removeItem(PREFIX + tabId());
    const old = oldDrafts();
    delete old[tabId()];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(old));
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* Keep working when storage is unavailable. */ }
}
