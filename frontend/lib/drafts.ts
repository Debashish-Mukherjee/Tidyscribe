// Drafts live in the browser, one per tab, so two tabs cannot overwrite each other's work. A tab that has no draft of its
// own (a new tab, or one opened after the old one was closed) adopts the most recently written one.

const DRAFTS_KEY = "workbench.drafts.v2";
const LEGACY_KEY = "workbench.draft.v1";
const BACKUP_KEY = "workbench.draft.backup.v1";
const TAB_KEY = "workbench.tab.v1";
const MAX_DRAFTS = 10;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type Draft = { text: string; at: number };
type Drafts = Record<string, Draft>;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const attempt = (action: () => void) => {
  try {
    action();
  } catch {
    // Storage can be unavailable or full; the app works without it.
  }
};

/** Stable across reloads of one tab, different between tabs. */
export function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return "shared";
  }
}

function load(): Drafts {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Drafts) : {};
  } catch {
    return {};
  }
}

const valid = (entry: unknown): entry is Draft => typeof entry === "object" && entry !== null && typeof (entry as Draft).text === "string" && typeof (entry as Draft).at === "number";

function save(drafts: Drafts) {
  const kept = Object.entries(drafts)
    .filter(([, entry]) => valid(entry) && Date.now() - entry.at < MAX_AGE_MS)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_DRAFTS);
  attempt(() => localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(kept))));
}

/** The text last saved by this tab, else the newest draft of any tab, else null. An empty string is a real (emptied) draft. */
export function readDraft(): string | null {
  const drafts = load();
  const own = drafts[tabId()];
  if (valid(own)) return own.text;
  const newest = Object.values(drafts).filter(valid).sort((a, b) => b.at - a.at)[0];
  if (newest) return newest.text;
  try {
    return localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

export function writeDraft(text: string) {
  const drafts = load();
  drafts[tabId()] = { text, at: Date.now() };
  save(drafts);
}

/** Moves the draft to a single backup slot, so starting fresh never destroys it. */
export function backupAndClearDraft() {
  const draft = readDraft();
  attempt(() => {
    if (draft !== null) localStorage.setItem(BACKUP_KEY, draft);
  });
  const drafts = load();
  delete drafts[tabId()];
  save(drafts);
}
