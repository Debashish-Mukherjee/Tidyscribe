"use client";

import { useEffect, useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Pin, PinOff, Save, Star, Trash2, Undo2 } from "lucide-react";
import { api, errorMessage, type ClipboardOut, type DocumentOut, type SnippetOut } from "../lib/api";
import { timeAgo } from "../lib/format";
import { TONES, isTone, type PreferenceControls } from "../lib/preferences";
import type { ThemeMode } from "../lib/theme";
import { ConfirmDialog } from "./confirm-dialog";

export const SNIPPET_CATEGORIES = ["Architecture", "Azure", "AWS", "Terraform", "SQL", "Python", "PowerShell", "Kubernetes", "General"];

export type SidebarPanelProps = {
  section: string;
  content: string;
  getSelection: () => string;
  insert: (text: string, label: string) => void;
  currentDocId: string | null;
  onOpenDocument: (document: DocumentOut) => void;
  onDocumentDeleted: (id: string) => void;
  notify: (message: string) => void;
  preferences?: PreferenceControls;
};

const inputClass = "w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-sm text-[#c9d1d9] outline-none focus:border-[#58a6ff]";
const rowClass = "flex items-center gap-1 rounded bg-[#0d1117] p-1";
const primaryButton = "inline-flex items-center justify-center gap-1 rounded bg-[#58a6ff] px-2 py-1 text-xs font-medium text-[#0d1117] disabled:opacity-50";

function IconButton({ label, onClick, children, active = false }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`shrink-0 rounded p-1 hover:bg-[#161b22] ${active ? "text-[#d29922]" : "text-[#8b949e]"}`}
    >
      {children}
    </button>
  );
}

function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className={inputClass} />;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-[#8b949e]">{children}</p>;
}

function useRefresh(...keys: string[]) {
  const client = useQueryClient();
  return () => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-1 rounded border border-[#f85149] p-2 text-xs">
      <div>Could not load {what}: {errorMessage(error)}</div>
      <button type="button" onClick={onRetry} className="underline">
        Retry
      </button>
    </div>
  );
}

/** Deleting is permanent, so every delete asks first. */
function useDeleteConfirm() {
  const [pending, setPending] = useState<{ name: string; run: () => void } | null>(null);
  const ask = (name: string, run: () => void) => setPending({ name, run });
  const dialog = pending ? (
    <ConfirmDialog
      title="Delete this item?"
      message={`“${pending.name}” will be deleted. This cannot be undone.`}
      actions={[
        {
          label: "Delete",
          primary: true,
          onClick: () => {
            pending.run();
            setPending(null);
          },
        },
      ]}
      onCancel={() => setPending(null)}
    />
  ) : null;
  return { ask, dialog };
}

function DocumentsPanel({ currentDocId, onOpenDocument, onDocumentDeleted, notify }: SidebarPanelProps) {
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const refresh = useRefresh("documents", "versions");
  const confirmDelete = useDeleteConfirm();
  const documents = useQuery({ queryKey: ["documents", search], queryFn: () => api.documents.list({ q: search }), retry: false, placeholderData: keepPreviousData });
  const versions = useQuery({
    queryKey: ["versions", currentDocId],
    queryFn: () => api.documents.versions(currentDocId as string),
    enabled: currentDocId !== null,
    retry: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.documents.remove(id),
    onSuccess: (_, id) => {
      onDocumentDeleted(id);
      notify("Document deleted");
      void refresh();
    },
    onError: (error) => notify(`Delete failed: ${errorMessage(error)}`),
  });
  const restore = useMutation({
    mutationFn: (versionId: string) => api.documents.restore(currentDocId as string, versionId),
    onSuccess: (document) => {
      onOpenDocument(document);
      notify("Version restored");
      void refresh();
    },
    onError: (error) => notify(`Restore failed: ${errorMessage(error)}`),
  });

  return (
    <div className="space-y-2">
      <SearchBox value={q} onChange={setQ} placeholder="Search documents" />
      {confirmDelete.dialog}
      {documents.isError && <LoadError what="documents" error={documents.error} onRetry={() => void documents.refetch()} />}
      {documents.data?.map((document) => (
        <div key={document.id} className={`group ${rowClass} ${document.id === currentDocId ? "ring-1 ring-[#58a6ff]" : ""}`}>
          <button type="button" className="min-w-0 flex-1 p-1 text-left" aria-label={document.title} title={document.title} onClick={() => onOpenDocument(document)}>
            <span className="block truncate">{document.title}</span>
            {timeAgo(document.updated_at) ? <span className="block truncate text-xs text-[#8b949e]">{timeAgo(document.updated_at)}</span> : null}
          </button>
          <span className="opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <IconButton label={`Delete ${document.title}`} onClick={() => confirmDelete.ask(document.title, () => remove.mutate(document.id))}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </span>
        </div>
      ))}
      {documents.data?.length === 0 && <Empty>No saved documents yet. Use Save in the header.</Empty>}
      {currentDocId && (versions.data?.length ?? 0) > 0 && (
        <div className="space-y-1 border-t border-[#30363d] pt-2">
          <div className="text-xs uppercase tracking-wider text-[#8b949e]">Versions</div>
          {versions.data?.map((version) => (
            <div key={version.id} className={rowClass}>
              <span className="min-w-0 flex-1 truncate p-1 text-xs text-[#8b949e]">
                {version.created_at ? new Date(version.created_at).toLocaleString() : "Earlier version"}
              </span>
              <IconButton label="Restore this version" onClick={() => restore.mutate(version.id)}>
                <Undo2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesPanel({ content, insert, notify }: SidebarPanelProps) {
  const [name, setName] = useState("");
  const refresh = useRefresh("templates");
  const confirmDelete = useDeleteConfirm();
  const templates = useQuery({ queryKey: ["templates"], queryFn: api.templates.list, retry: false });
  const create = useMutation({
    mutationFn: () => api.templates.create({ name: name.trim(), category: "custom", body: content }),
    onSuccess: () => {
      notify(`Saved template ${name.trim()}`);
      setName("");
      void refresh();
    },
    onError: (error) => notify(`Could not save template: ${errorMessage(error)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.templates.remove(id),
    onSuccess: () => void refresh(),
    onError: (error) => notify(`Delete failed: ${errorMessage(error)}`),
  });

  return (
    <div className="space-y-2">
      {confirmDelete.dialog}
      {templates.isError && <LoadError what="templates" error={templates.error} onRetry={() => void templates.refetch()} />}
      {templates.data?.map((template) => (
        <div key={template.id} className={rowClass}>
          <button type="button" className="min-w-0 flex-1 truncate p-1 text-left" onClick={() => insert(template.body, `template ${template.name}`)}>
            {template.name}
          </button>
          <IconButton label={`Delete ${template.name}`} onClick={() => confirmDelete.ask(template.name, () => remove.mutate(template.id))}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
      {templates.data?.length === 0 && <Empty>No templates.</Empty>}
      <form
        className="space-y-1 border-t border-[#30363d] pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() && content.trim()) create.mutate();
        }}
      >
        <div className="text-xs uppercase tracking-wider text-[#8b949e]">Save editor as template</div>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Template name" aria-label="Template name" className={inputClass} />
        <button type="submit" className={`${primaryButton} w-full`} disabled={!name.trim() || !content.trim() || create.isPending}>
          <Save className="h-3.5 w-3.5" /> Save template
        </button>
      </form>
    </div>
  );
}

function SnippetsPanel({ content, getSelection, insert, notify }: SidebarPanelProps) {
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(SNIPPET_CATEGORIES[0]);
  const [tags, setTags] = useState("");
  const search = useDebounced(q);
  const refresh = useRefresh("snippets");
  const confirmDelete = useDeleteConfirm();
  const snippets = useQuery({ queryKey: ["snippets", search, archived], queryFn: () => api.snippets.list({ q: search, archived }), retry: false, placeholderData: keepPreviousData });

  const update = useMutation({
    mutationFn: ({ id, ...changes }: { id: string; favorite?: boolean; archived?: boolean }) => api.snippets.update(id, changes),
    onSuccess: () => void refresh(),
    onError: (error) => notify(`Update failed: ${errorMessage(error)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.snippets.remove(id),
    onSuccess: () => void refresh(),
    onError: (error) => notify(`Delete failed: ${errorMessage(error)}`),
  });
  const create = useMutation({
    mutationFn: () =>
      api.snippets.create({
        title: title.trim(),
        category,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        body: getSelection().trim() || content,
      }),
    onSuccess: () => {
      notify(`Saved snippet ${title.trim()}`);
      setTitle("");
      setTags("");
      void refresh();
    },
    onError: (error) => notify(`Could not save snippet: ${errorMessage(error)}`),
  });

  const row = (snippet: SnippetOut) => (
    <div key={snippet.id} className={rowClass}>
      <button type="button" className="min-w-0 flex-1 p-1 text-left" onClick={() => insert(snippet.body, `snippet ${snippet.title}`)}>
        <div className="truncate">{snippet.title}</div>
        <div className="truncate text-xs text-[#8b949e]">{[snippet.category, ...snippet.tags.map((tag) => `#${tag}`)].join(" ")}</div>
      </button>
      <IconButton label={snippet.favorite ? "Remove favourite" : "Favourite"} active={snippet.favorite} onClick={() => update.mutate({ id: snippet.id, favorite: !snippet.favorite })}>
        <Star className="h-3.5 w-3.5" fill={snippet.favorite ? "currentColor" : "none"} />
      </IconButton>
      <IconButton label={snippet.archived ? "Unarchive" : "Archive"} onClick={() => update.mutate({ id: snippet.id, archived: !snippet.archived })}>
        {snippet.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
      </IconButton>
      <IconButton label={`Delete ${snippet.title}`} onClick={() => confirmDelete.ask(snippet.title, () => remove.mutate(snippet.id))}>
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );

  return (
    <div className="space-y-2">
      <SearchBox value={q} onChange={setQ} placeholder="Search snippets or #tags" />
      {confirmDelete.dialog}
      {snippets.isError && <LoadError what="snippets" error={snippets.error} onRetry={() => void snippets.refetch()} />}
      <label className="flex items-center gap-2 text-xs text-[#8b949e]">
        <input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} /> Show archived
      </label>
      {snippets.data?.map(row)}
      {snippets.data?.length === 0 && <Empty>No snippets found.</Empty>}
      <form
        className="space-y-1 border-t border-[#30363d] pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && (getSelection().trim() || content.trim())) create.mutate();
        }}
      >
        <div className="text-xs uppercase tracking-wider text-[#8b949e]">Save selection as snippet</div>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Snippet title" aria-label="Snippet title" className={inputClass} />
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Snippet category" className={inputClass}>
          {SNIPPET_CATEGORIES.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags, comma separated" aria-label="Snippet tags" className={inputClass} />
        <button type="submit" className={`${primaryButton} w-full`} disabled={!title.trim() || create.isPending}>
          <Save className="h-3.5 w-3.5" /> Save snippet
        </button>
      </form>
    </div>
  );
}

function ClipboardPanel({ insert, notify }: SidebarPanelProps) {
  const [q, setQ] = useState("");
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const search = useDebounced(q);
  const refresh = useRefresh("clipboard");
  const items = useQuery({ queryKey: ["clipboard", search], queryFn: () => api.clipboard.list({ q: search }), retry: false, placeholderData: keepPreviousData });

  const pin = useMutation({
    mutationFn: (item: ClipboardOut) => api.clipboard.update(item.id, { pinned: !item.pinned }),
    onSuccess: () => void refresh(),
    onError: (error) => notify(`Update failed: ${errorMessage(error)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.clipboard.remove(id),
    onSuccess: (_, id) => {
      setLastDeleted(id);
      void refresh();
    },
    onError: (error) => notify(`Delete failed: ${errorMessage(error)}`),
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.clipboard.restore(id),
    onSuccess: () => {
      setLastDeleted(null);
      void refresh();
    },
    onError: (error) => notify(`Undo failed: ${errorMessage(error)}`),
  });

  return (
    <div className="space-y-2">
      <SearchBox value={q} onChange={setQ} placeholder="Search clipboard history" />
      {items.isError && <LoadError what="clipboard history" error={items.error} onRetry={() => void items.refetch()} />}
      {lastDeleted && (
        <button type="button" className={`${primaryButton} w-full`} onClick={() => undo.mutate(lastDeleted)}>
          <Undo2 className="h-3.5 w-3.5" /> Undo delete
        </button>
      )}
      {items.data?.map((item) => (
        <div key={item.id} className={rowClass}>
          <button type="button" className="min-w-0 flex-1 truncate p-1 text-left" title={item.content.slice(0, 300)} onClick={() => insert(item.content, "clipboard item")}>
            {item.content.replace(/\s+/g, " ").slice(0, 80)}
          </button>
          <IconButton label={item.pinned ? "Unpin" : "Pin"} active={item.pinned} onClick={() => pin.mutate(item)}>
            {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Delete" onClick={() => remove.mutate(item.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ))}
      {items.data?.length === 0 && <Empty>Pasted text is captured here automatically (last 100 items).</Empty>}
    </div>
  );
}

const THEME_CHOICES: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function SettingsPanel({ preferences }: SidebarPanelProps) {
  if (!preferences) return <Empty>Settings are not available.</Empty>;
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs uppercase tracking-wider text-[#8b949e]">Theme</legend>
        {THEME_CHOICES.map((choice) => (
          <label key={choice.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="theme" checked={preferences.theme === choice.value} onChange={() => preferences.onThemeChange(choice.value)} />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor="default-tone" className="text-xs uppercase tracking-wider text-[#8b949e]">Default writing style</label>
        <select
          id="default-tone"
          value={preferences.tone}
          onChange={(event) => isTone(event.target.value) && preferences.onToneChange(event.target.value)}
          className={inputClass}
        >
          {TONES.map((tone) => (
            <option key={tone}>{tone}</option>
          ))}
        </select>
      </div>
      <button type="button" className={`${primaryButton} w-full`} onClick={preferences.onResetLayout}>
        Reset pane sizes
      </button>
      <p className="text-xs text-[#8b949e]">Theme and writing style are saved on the server, so they follow you to other browsers. Pane sizes and your draft stay in this browser.</p>
    </div>
  );
}

export function SidebarPanel(props: SidebarPanelProps) {
  switch (props.section) {
    case "Documents":
      return <DocumentsPanel {...props} />;
    case "Templates":
      return <TemplatesPanel {...props} />;
    case "Snippets":
      return <SnippetsPanel {...props} />;
    case "Clipboard History":
      return <ClipboardPanel {...props} />;
    default:
      return <SettingsPanel {...props} />;
  }
}
