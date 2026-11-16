"use client";

import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage, waitForExport, type DiagramTarget, type TransformResult } from "../lib/api";
import { extractMermaidSources, findDiagramRange, hasPlantUml, mermaidFence, renderDiagramPngs, type DiagramImage } from "../lib/diagrams";
import { useUndoableText } from "../lib/history";
import { backupAndClearDraft, readDraft, writeDraft } from "../lib/drafts";
import { renderPreview } from "../lib/preview";
import { armBoot, beginBoot, clearBootMarker, flagCrash, markHealthy } from "../lib/recovery";
import { EMPTY_HTML } from "../lib/sanitize";
import { PASTE_MODES, PASTE_MODE_LABELS, isPasteMode, resolvePasteDetailed, type PasteMode } from "../lib/richpaste";
import { nextThemeMode, isThemeMode, useThemeStore, useThemeSync, type ThemeMode } from "../lib/theme";
import { PREF_PASTE_MODE, PREF_THEME, PREF_TONE, TONES, isTone, type Tone } from "../lib/preferences";
import { wordCount } from "../lib/format";
import { ErrorBoundary } from "./error-boundary";
import { ConfirmDialog } from "./confirm-dialog";
import { CleanDialog } from "./clean-dialog";
import { ExportMenu, type ExportChoice } from "./export-menu";
import { FindBar } from "./find-bar";
import { RecoveryDialog } from "./recovery-dialog";
import { ResizeHandle, useElementWidth } from "./resizable";
import { SafePreview } from "./safe-preview";
import { SidebarPanel } from "./sidebar-panels";
import { btnGhost, btnSecondary, selectClass } from "./ui";
import {
  ChevronsLeft,
  Copy,
  FileText,
  Monitor,
  Moon,
  NotebookText,
  Redo2,
  Save,
  Search,
  Sparkles,
  Sun,
  Undo2,
  Wand2,
  FileCode2,
  PanelsTopLeft,
  Clipboard,
  Settings,
} from "lucide-react";

const queryClient = new QueryClient();

// TipTap is only needed once someone switches to rich editing.
const RichEditor = lazy(() => import("./rich-editor"));

const LAYOUT_KEY = "workbench.layout.v1";
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256;
const RAIL_WIDTH = 48;
// Below this width a first-time visitor starts with the side panel collapsed so the editor and preview have room.
const NARROW_SCREEN = 1100;
const PANE_MIN = 280;
const HANDLE_PX = 6;
const EDITOR_FRACTION_DEFAULT = 0.58;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const initialContent = `# Executive Summary

This document explains the design of the Tidyscribe and how it helps technical teams convert AI-generated content into reliable documentation.

## Requirements

- Convert pasted content from ChatGPT / Claude / Copilot.
- Normalize formatting and remove AI preambles.
- Render Mermaid diagrams and ASCII diagrams.
- Export to Markdown, HTML, DOCX, and PDF.

> AI cleanup is essential for reducing noise before formal review.

\`\`\`python
print("Documentation workflow")
\`\`\`

- [ ] Review architecture
- [ ] Validate export pipeline
- [ ] Share final preview`;

type ExportFormat = "html" | "docx" | "pdf";
type ExportResult = { content: string; blobUrl: string; filename: string; html?: string };

const titleFromMarkdown = (markdown: string) => {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || "Workbench draft").slice(0, 200);
};

const slugify = (value: string) => value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 80) || "document";

const triggerDownload = (url: string, filename: string) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
};

const downloadText = (text: string, filename: string, mediaType: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: mediaType }));
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function WorkbenchShell() {
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);
  useThemeSync();
  const history = useUndoableText(initialContent);
  const content = history.value;
  const setContent = history.set;
  const [selectedPreview, setSelectedPreview] = useState("Preview");
  const [selectedTone, setSelectedTone] = useState<Tone>("Solution Design");
  const [pasteMode, setPasteMode] = useState<PasteMode>("auto");
  const [activeNav, setActiveNav] = useState("Documents");
  const [statusMessage, setStatusMessage] = useState("Ready to work");
  const [exportResults, setExportResults] = useState<Partial<Record<ExportFormat, ExportResult>>>({});
  const [exporting, setExporting] = useState(false);
  // False during server render and hydration, true afterwards (DOMPurify and storage need the browser).
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const bootRef = useRef<ReturnType<typeof beginBoot> | null>(null);
  // Set when the previous load never finished: the stored draft is held back until the user decides what to do with it.
  const [recovery, setRecovery] = useState<{ draft: string | null } | null>(null);
  // While held, nothing is rendered from the document; the source is shown as plain text instead.
  const [previewHeld, setPreviewHeld] = useState(false);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const splitWidth = useElementWidth(splitRef);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [editorFraction, setEditorFraction] = useState(EDITOR_FRACTION_DEFAULT);
  const [restored, setRestored] = useState(false);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  // Content as last stored on the server; differs from the editor when there are unsaved edits.
  const [savedContent, setSavedContent] = useState<string | null>(null);
  // The server's `updated_at` for the open document; sent back on save so a newer save elsewhere is detected.
  const savedUpdatedAt = useRef<string | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<{ before: string; result: TransformResult } | null>(null);
  const [pendingOpen, setPendingOpen] = useState<{ id: string; title: string; content: string; updated_at?: string | null } | null>(null);
  const hasUnsavedWork = content.trim() !== "" && (currentDocId === null ? content !== initialContent : content !== savedContent);
  const [saving, setSaving] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [expanded, setExpanded] = useState<{ source: string; markdown: string } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [find, setFind] = useState<{ seed: string; nonce: number } | null>(null);
  const [richMode, setRichMode] = useState(false);
  const queryClient = useQueryClient();

  // After inserting converted text the caret belongs right behind it, not at the end of the document.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    editorRef.current?.setSelectionRange(caret, caret);
  }, [content]);

  const plainTextContent = useMemo(() => content.trim(), [content]);
  const needsExpansion = useMemo(() => hasPlantUml(content), [content]);
  // PlantUML blocks are converted to Mermaid by the backend; show the converted version once it arrives.
  const previewSource = needsExpansion && expanded?.source === content ? expanded.markdown : content;

  useEffect(() => {
    if (!needsExpansion) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .expandDiagrams(content)
        .then((result) => !cancelled && setExpanded({ source: content, markdown: result.markdown }))
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [content, needsExpansion]);

  // Restoring saved layout/draft must happen after hydration, so the server and first client render agree.
  useEffect(() => {
    try {
      const layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (typeof layout?.sidebar === "number") setSidebarWidth(clamp(layout.sidebar, SIDEBAR_MIN, SIDEBAR_MAX));
      if (typeof layout?.editor === "number") setEditorFraction(clamp(layout.editor, 0.15, 0.85));
      if (layout?.panel === false || (layout?.panel === undefined && window.innerWidth < NARROW_SCREEN)) setPanelOpen(false);
    } catch {
      // Storage can be unavailable (private mode); the app still works without it.
    }
    // The ref survives Strict Mode's second effect run, so the marker written by the first run is not mistaken for a crash.
    const boot = (bootRef.current ??= beginBoot());
    if (boot.recovering) {
      setRecovery({ draft: readDraft() });
      setPreviewHeld(true);
      setStatusMessage("Recovery mode: your saved draft was not loaded");
    } else {
      const draft = readDraft();
      if (draft !== null) {
        history.reset(draft);
        setStatusMessage("Restored your last draft");
      }
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side preferences win over the browser's copy so settings follow the user between browsers.
  useEffect(() => {
    let cancelled = false;
    api.settings
      .list()
      .then((saved) => {
        if (cancelled) return;
        if (isThemeMode(saved[PREF_THEME])) setThemeMode(saved[PREF_THEME]);
        if (isTone(saved[PREF_TONE])) setSelectedTone(saved[PREF_TONE]);
        if (isPasteMode(saved[PREF_PASTE_MODE])) setPasteMode(saved[PREF_PASTE_MODE]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setThemeMode]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebar: sidebarWidth, editor: editorFraction, panel: panelOpen }));
    } catch {
      // ignore
    }
  }, [restored, sidebarWidth, editorFraction, panelOpen]);

  useEffect(() => {
    // Autosave stays off in recovery mode so the starter text cannot overwrite the draft being recovered.
    if (!restored || recovery) return;
    const timer = setTimeout(() => writeDraft(content), 500);
    return () => clearTimeout(timer);
  }, [restored, recovery, content]);

  // The debounced write above would miss the last keystrokes of a refresh or tab close, so also write when the page hides.
  const latestContent = useRef(content);
  useEffect(() => {
    latestContent.current = content;
  });
  useEffect(() => {
    if (!restored || recovery) return;
    const flush = () => writeDraft(latestContent.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [restored, recovery]);

  useEffect(() => {
    if (!hasUnsavedWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);

  // Passive effects run after the commit has painted, so reaching this means the restored draft rendered without hanging or throwing.
  // (A timer or animation frame would never fire in a background tab and leave a false crash marker behind.)
  useEffect(() => {
    if (!restored || recovery || !bootRef.current) return;
    markHealthy(bootRef.current.id);
  }, [restored, recovery, previewHeld]);

  const preview = useMemo(() => (mounted && !previewHeld ? renderPreview(previewSource) : null), [mounted, previewHeld, previewSource]);

  const navItems = [
    { label: "Documents", icon: <NotebookText className="h-4 w-4" /> },
    { label: "Templates", icon: <PanelsTopLeft className="h-4 w-4" /> },
    { label: "Snippets", icon: <Sparkles className="h-4 w-4" /> },
    { label: "Clipboard History", icon: <Clipboard className="h-4 w-4" /> },
    { label: "Settings", icon: <Settings className="h-4 w-4" /> },
  ];

  const previewTabs = ["Preview", "HTML", "DOCX", "PDF"];
  const themeIcons: Record<ThemeMode, React.ReactNode> = {
    dark: <Moon className="h-4 w-4" />,
    light: <Sun className="h-4 w-4" />,
    system: <Monitor className="h-4 w-4" />,
  };

  const insertIntoEditor = (text: string, label: string) => {
    if (!text.trim()) return;
    setContent(`${content.trim()}\n\n${text.trim()}\n`, { checkpoint: true });
    setStatusMessage(`Inserted ${label}`);
  };

  const savePreference = (key: string, value: string) => {
    api.settings.put(key, value).catch(() => setStatusMessage("Could not save the setting on the server"));
  };

  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    savePreference(PREF_THEME, mode);
  };

  const changeTone = (tone: Tone) => {
    setSelectedTone(tone);
    savePreference(PREF_TONE, tone);
  };

  const changePasteMode = (mode: PasteMode) => {
    setPasteMode(mode);
    savePreference(PREF_PASTE_MODE, mode);
  };

  const resetLayout = () => {
    setSidebarWidth(SIDEBAR_DEFAULT);
    setEditorFraction(EDITOR_FRACTION_DEFAULT);
    setStatusMessage("Pane sizes reset");
  };

  const restoreRecoveredDraft = () => {
    if (bootRef.current) armBoot(bootRef.current.id);
    if (recovery?.draft?.trim()) history.reset(recovery.draft);
    setRecovery(null);
    setStatusMessage("Draft restored. The preview is paused until you choose to render it");
  };

  const startFresh = () => {
    backupAndClearDraft();
    clearBootMarker();
    setRecovery(null);
    setPreviewHeld(false);
    setStatusMessage("Started fresh. The previous draft is kept as a backup in this browser");
  };

  const renderHeldPreview = () => {
    if (bootRef.current) armBoot(bootRef.current.id);
    setPreviewHeld(false);
  };

  const handleNavClick = (label: string) => {
    setActiveNav(label);
    setPanelOpen(true);
    setStatusMessage(`${label} view selected`);
  };

  const syncEditorMarkdown = (markdown: string) => {
    setContent(markdown, { checkpoint: true });
  };

  const persistDocument = async (title: string, options: { force?: boolean; asNew?: boolean } = {}) => {
    const store = async () => {
      if (currentDocId && !options.asNew) {
        try {
          return await api.documents.update(currentDocId, { title, content, expected_updated_at: options.force ? undefined : savedUpdatedAt.current });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
      }
      const created = await api.documents.create({ title, content });
      setCurrentDocId(created.id);
      return created;
    };
    const stored = await store();
    setSavedContent(content);
    savedUpdatedAt.current = stored.updated_at ?? null;
    void queryClient.invalidateQueries({ queryKey: ["documents"] });
    void queryClient.invalidateQueries({ queryKey: ["versions"] });
    return stored;
  };

  const saveDocument = async (options: { force?: boolean; asNew?: boolean } = {}) => {
    setSaving(true);
    try {
      const saved = await persistDocument(titleFromMarkdown(content), options);
      setStatusMessage(`Saved “${saved.title}”`);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setSaveConflict(true);
        setStatusMessage("Not saved: this document was changed somewhere else");
      } else {
        setStatusMessage(`Save failed: ${errorMessage(error)}`);
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const applyOpen = (saved: { id: string; title: string; content: string; updated_at?: string | null }) => {
    history.reset(saved.content);
    setCurrentDocId(saved.id);
    setSavedContent(saved.content);
    savedUpdatedAt.current = saved.updated_at ?? null;
    setStatusMessage(`Opened “${saved.title}”`);
  };

  // Opening replaces the editor text, so unsaved work is never discarded without a choice.
  const openDocument = (saved: { id: string; title: string; content: string; updated_at?: string | null }) => {
    if (hasUnsavedWork) setPendingOpen(saved);
    else applyOpen(saved);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const plain = event.clipboardData.getData("text");
    // Browsers paste only plain text into a textarea, dropping bullets, headings, bold, tables and links.
    const outcome = resolvePasteDetailed(pasteMode, event.clipboardData.getData("text/html"), plain);
    const markdown = outcome.markdown;
    if (markdown) {
      event.preventDefault();
      const { selectionStart, selectionEnd } = event.currentTarget;
      setContent(content.slice(0, selectionStart) + markdown + content.slice(selectionEnd), { checkpoint: true });
      pendingCaret.current = selectionStart + markdown.length;
      setStatusMessage(outcome.message ?? "Pasted formatted text as Markdown (Ctrl+Shift+V pastes plain text)");
    } else if (outcome.message) {
      setStatusMessage(outcome.message);
    }
    const pasted = markdown ?? plain;
    if (!pasted.trim()) return;
    api.clipboard
      .create({ content: pasted, source: "editor paste" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["clipboard"] }))
      .catch(() => undefined);
  };

  const getSelection = () => {
    const editor = editorRef.current;
    return editor ? content.slice(editor.selectionStart, editor.selectionEnd) : "";
  };

  const handleConvertDiagram = async (target: DiagramTarget) => {
    const editor = editorRef.current;
    const range = findDiagramRange(content, editor?.selectionStart ?? 0, editor?.selectionEnd ?? 0);
    if (!range) {
      setStatusMessage("No diagram at the cursor. Click inside a box diagram (+-----+ or ┌───┐), a PlantUML, Terraform, Kubernetes or Draw.io block, or select the diagram first, then convert");
      return;
    }
    try {
      setStatusMessage(`Converting diagram to ${target}…`);
      const result = await api.convertDiagram(range.text, target);
      const note = result.warnings?.length ? ` (${result.warnings.join(" ")})` : "";
      if (target === "mermaid") {
        setContent(content.slice(0, range.start) + mermaidFence(result.content) + content.slice(range.end), { checkpoint: true });
        setStatusMessage(`Diagram converted to Mermaid${note}`);
      } else {
        downloadText(result.content, `diagram.${result.extension}`, result.media_type);
        setStatusMessage(`Downloaded diagram.${result.extension}${note}`);
      }
    } catch (error) {
      setStatusMessage(`Diagram conversion failed: ${errorMessage(error)}`);
    }
  };

  const handleClean = async () => {
    if (!plainTextContent.trim()) {
      setStatusMessage("Add content before cleaning");
      return;
    }

    setStatusMessage("Cleaning text…");
    try {
      const result = await api.transform(plainTextContent, selectedTone);
      if (!result.changed) {
        setStatusMessage("Nothing to clean: no AI chatter found");
        return;
      }
      setCleanPreview({ before: plainTextContent, result });
      setStatusMessage("Review the cleanup, then apply or cancel it");
    } catch (error) {
      setStatusMessage(`Clean failed: ${errorMessage(error)}`);
    }
  };

  const applyClean = () => {
    const preview = cleanPreview;
    setCleanPreview(null);
    if (!preview) return;
    if (content.trim() !== preview.before) {
      setStatusMessage("The text changed while you were reviewing; run Clean AI Text again");
      return;
    }
    syncEditorMarkdown(preview.result.cleaned_text.trim());
    const { removed, changes } = preview.result;
    setStatusMessage(`Text cleaned: ${removed > 0 ? `removed ${removed} phrase${removed === 1 ? "" : "s"}` : `applied ${changes.length} rule${changes.length === 1 ? "" : "s"}`}`);
  };

  const handleSmartPaste = async () => {
    if (!plainTextContent.trim()) {
      setStatusMessage("Add some content to analyze");
      return;
    }

    setStatusMessage("Detecting content structure…");
    try {
      const result = await api.parsePaste(plainTextContent);
      setStatusMessage(`Detected: ${result.detected_types.join(", ")}`);
      if (result.normalized_markdown) {
        syncEditorMarkdown(result.normalized_markdown.trim());
      }
    } catch (error) {
      setStatusMessage(`Smart Paste failed: ${errorMessage(error)}`);
    }
  };

  const runExport = async (format: ExportFormat, download = false) => {
    if (!content.trim()) {
      setStatusMessage("Add content before exporting");
      return;
    }

    setExporting(true);
    try {
      setStatusMessage(`Creating ${format.toUpperCase()} export…`);
      const title = titleFromMarkdown(content);

      let diagrams: DiagramImage[] = [];
      let failedDiagrams = 0;
      // The backend expands PlantUML the same way, so Mermaid sources match the rendered images.
      const expandedMarkdown = hasPlantUml(content) ? (await api.expandDiagrams(content)).markdown : content;
      if (extractMermaidSources(expandedMarkdown).length > 0) {
        setStatusMessage("Rendering diagrams…");
        ({ images: diagrams, failed: failedDiagrams } = await renderDiagramPngs(expandedMarkdown));
      }

      // Exports are built from the editor text and never save or create a document. The Preview's own HTML goes along so
      // every format follows what the user saw, not a second rendering of the Markdown.
      const rendered = renderPreview(expandedMarkdown);
      const queued = await api.exports.create({ title, content, html: rendered.ok ? rendered.html : undefined, format, diagrams });
      const job = await waitForExport(queued, {
        onStatus: (status) => setStatusMessage(status === "processing" ? `Generating ${format.toUpperCase()}…` : `${format.toUpperCase()} export queued…`),
      });

      const file = await fetch(job.file_url as string);
      if (!file.ok) throw new Error(`download failed (${file.status})`);
      const blob = await file.blob();
      const filename = `${slugify(title)}.${format}`;

      const previous = exportResults[format];
      if (previous) URL.revokeObjectURL(previous.blobUrl);
      const blobUrl = URL.createObjectURL(blob);
      const html = format === "html" ? await blob.text() : undefined;
      setExportResults((current) => ({ ...current, [format]: { content, blobUrl, filename, html } }));

      const note = failedDiagrams > 0 ? ` (${failedDiagrams} diagram(s) could not be rendered and were included as source)` : "";
      setStatusMessage(`${format.toUpperCase()} export ready: ${filename}${note}`);
      if (download) triggerDownload(blobUrl, filename);
    } catch (error) {
      setStatusMessage(`Export failed: ${errorMessage(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const handleTabClick = (tab: string) => {
    setSelectedPreview(tab);
    if (tab === "Preview") return;
    const format = tab.toLowerCase() as ExportFormat;
    const existing = exportResults[format];
    if (!exporting && (!existing || existing.content !== content)) {
      void runExport(format);
    }
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(plainTextContent || content);
      setStatusMessage("Copied Markdown to clipboard");
    } catch {
      setStatusMessage("Clipboard access unavailable");
    }
  };

  const handleExportChoice = (choice: ExportChoice) => {
    if (choice !== "markdown") {
      void runExport(choice, true);
    } else if (!content.trim()) {
      setStatusMessage("Add content before exporting");
    } else {
      const filename = `${slugify(titleFromMarkdown(content))}.md`;
      downloadText(content, filename, "text/markdown");
      setStatusMessage(`Downloaded ${filename}`);
    }
  };

  const docTitle = titleFromMarkdown(content);
  const saveState = currentDocId === null ? "Not saved" : content === savedContent ? "Saved" : "Unsaved changes";

  return (
    <>
    <div inert={recovery !== null}>
      <div className="flex h-screen min-h-[520px] flex-col bg-[#0d1117] text-[#c9d1d9]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[#30363d] bg-[#161b22]/90 px-4">
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#58a6ff]/15 text-[#58a6ff]">
              <FileText className="h-4 w-4" />
            </div>
            <span className="hidden whitespace-nowrap text-sm font-semibold lg:inline">Tidyscribe</span>
          </div>

          <div className="min-w-0 flex-1 border-l border-[#30363d] pl-3">
            <div className="truncate text-sm font-medium" title={docTitle}>
              {docTitle}
            </div>
            <div className={`text-xs ${saveState === "Unsaved changes" ? "text-[#d29922]" : "text-[#8b949e]"}`} data-testid="save-state">
              {saveState}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void saveDocument()}
              disabled={saving || !content.trim()}
              aria-label={currentDocId ? "Save changes" : "Save as new document"}
              title={currentDocId ? "Save changes to this document" : "Save as a new document"}
              className={btnSecondary}
            >
              <Save className="h-4 w-4" />
              Save
            </button>
            <ExportMenu onChoose={handleExportChoice} disabled={exporting} />
            <button type="button" onClick={() => void handleCopyMarkdown()} aria-label="Copy Markdown" title="Copy the Markdown source to the clipboard" className={btnGhost}>
              <Copy className="h-4 w-4" />
            </button>
            <button
              className={btnGhost}
              onClick={() => changeTheme(nextThemeMode(themeMode))}
              aria-label={`Theme: ${themeMode}. Click to switch.`}
              title={`Theme: ${themeMode} (click to switch)`}
            >
              {themeIcons[themeMode]}
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside style={{ width: panelOpen ? sidebarWidth : RAIL_WIDTH }} className="flex shrink-0 bg-[#0d1117]">
            <nav aria-label="Sections" className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#30363d] py-2">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  onClick={() => handleNavClick(item.label)}
                  aria-label={item.label}
                  aria-current={activeNav === item.label ? "page" : undefined}
                  title={item.label}
                  className={`flex h-10 w-10 items-center justify-center rounded-md ${activeNav === item.label ? "bg-[#161b22] text-[#58a6ff]" : "text-[#8b949e] hover:bg-[#161b22]"}`}
                >
                  {item.icon}
                </button>
              ))}
            </nav>

            {panelOpen ? (
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-3">
                <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[#8b949e]">
                  <span>{activeNav}</span>
                  <button type="button" onClick={() => setPanelOpen(false)} aria-label="Collapse side panel" title="Collapse side panel" className={btnGhost}>
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-sm text-[#c9d1d9]">
                  <SidebarPanel
                    section={activeNav}
                    content={content}
                    getSelection={getSelection}
                    insert={insertIntoEditor}
                    currentDocId={currentDocId}
                    onOpenDocument={openDocument}
                    onDocumentDeleted={(id) => {
                      if (id !== currentDocId) return;
                      setCurrentDocId(null);
                      setSavedContent(null);
                      savedUpdatedAt.current = null;
                    }}
                    notify={setStatusMessage}
                    preferences={{ theme: themeMode, onThemeChange: changeTheme, tone: selectedTone, onToneChange: changeTone, onResetLayout: resetLayout }}
                  />
                </div>
              </div>
            ) : null}
          </aside>

          {panelOpen ? (
            <ResizeHandle
              label="Resize sidebar"
              value={sidebarWidth}
              min={SIDEBAR_MIN}
              max={SIDEBAR_MAX}
              onChange={(next) => setSidebarWidth(clamp(next, SIDEBAR_MIN, SIDEBAR_MAX))}
              onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
            />
          ) : (
            <div className="w-px shrink-0 bg-[#30363d]" />
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div ref={splitRef} className="flex min-h-0 min-w-0 flex-1">
              <section style={{ width: `${editorFraction * 100}%`, minWidth: PANE_MIN }} className="flex shrink-0 flex-col bg-[#0d1117]">
                <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#30363d] px-3 text-sm text-[#8b949e]">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4" />
                    Editor
                  </div>
                  <div className="flex items-center gap-1">
                    <div role="group" aria-label="Editor mode" className="mr-1 inline-flex rounded border border-[#30363d] text-xs">
                      <button type="button" aria-pressed={!richMode} onClick={() => setRichMode(false)} title="Edit the Markdown source" className={`rounded-l px-2 py-1 ${richMode ? "hover:bg-[#161b22]" : "bg-[#161b22] text-[#58a6ff]"}`}>
                        Source
                      </button>
                      <button type="button" aria-pressed={richMode} onClick={() => { setRichMode(true); setFind(null); }} title="Edit with formatting (rewrites the Markdown in a normalised form)" className={`rounded-r border-l border-[#30363d] px-2 py-1 ${richMode ? "bg-[#161b22] text-[#58a6ff]" : "hover:bg-[#161b22]"}`}>
                        Rich
                      </button>
                    </div>
                    {!richMode && (
                      <>
                        <button onClick={() => setFind(find ? null : { seed: "", nonce: 0 })} aria-pressed={find !== null} aria-label="Find and replace" title="Find and replace (Ctrl+F)" className={btnGhost}>
                          <Search className="h-4 w-4" />
                        </button>
                        <button onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className={btnGhost}>
                          <Undo2 className="h-4 w-4" />
                        </button>
                        <button onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className={btnGhost}>
                          <Redo2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#30363d] px-3 py-2">
                  <select
                    aria-label="Paste mode"
                    value={pasteMode}
                    disabled={richMode}
                    onChange={(event) => isPasteMode(event.target.value) && changePasteMode(event.target.value)}
                    title="Auto keeps Markdown as written and converts formatted text (Word, web pages) to Markdown. Ctrl+Shift+V always pastes plain text."
                    className={selectClass}
                  >
                    {PASTE_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {PASTE_MODE_LABELS[mode]}
                      </option>
                    ))}
                  </select>
                  <button onClick={handleSmartPaste} title="Detect the structure of the whole document and tidy it" className={btnSecondary}>
                    <FileCode2 className="h-4 w-4" />
                    Smart Paste
                  </button>
                  <div className="inline-flex items-stretch rounded border border-[#30363d]">
                    <select
                      aria-label="Writing style"
                      value={selectedTone}
                      onChange={(event) => isTone(event.target.value) && changeTone(event.target.value)}
                      title="Writing style applied by Clean AI Text"
                      className="rounded-l bg-[#0d1117] px-2 py-1.5 text-sm text-[#c9d1d9]"
                    >
                      {TONES.map((tone) => (
                        <option key={tone} value={tone}>
                          {tone}
                        </option>
                      ))}
                    </select>
                    <button onClick={handleClean} title="Remove AI preambles and apply the writing style" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-r border-l border-[#30363d] px-3 py-1.5 text-sm font-medium hover:bg-[#161b22]">
                      <Wand2 className="h-4 w-4" />
                      Clean AI Text
                    </button>
                  </div>
                  <select
                    aria-label="Convert diagram"
                    value=""
                    disabled={richMode}
                    onChange={(event) => {
                      if (event.target.value) void handleConvertDiagram(event.target.value as DiagramTarget);
                    }}
                    title="Convert the ASCII, PlantUML, Terraform, Kubernetes or Draw.io diagram at the cursor (or the selection)"
                    className={selectClass}
                  >
                    <option value="">Convert diagram…</option>
                    <option value="mermaid">To Mermaid (replace)</option>
                    <option value="svg">To SVG (download)</option>
                    <option value="drawio">To Draw.io XML (download)</option>
                  </select>
                </div>

                {find && !richMode && (
                  <FindBar
                    key={find.nonce}
                    content={content}
                    setContent={setContent}
                    editorRef={editorRef}
                    initialQuery={find.seed}
                    onClose={() => setFind(null)}
                    onStatus={setStatusMessage}
                  />
                )}

                {richMode ? (
                  <Suspense fallback={<div className="flex-1 p-4 text-sm text-[#8b949e]">Loading editor…</div>}>
                    <RichEditor value={content} onChange={(markdown) => setContent(markdown)} />
                  </Suspense>
                ) : (
                <textarea
                  ref={editorRef}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && find) {
                      setFind(null);
                      return;
                    }
                    if (!(event.ctrlKey || event.metaKey)) return;
                    const key = event.key.toLowerCase();
                    if (key === "f" || key === "h") {
                      event.preventDefault();
                      const { selectionStart, selectionEnd, value } = event.currentTarget;
                      const selected = value.slice(selectionStart, selectionEnd);
                      setFind((current) => ({ seed: selected && !selected.includes("\n") ? selected : "", nonce: (current?.nonce ?? 0) + 1 }));
                    } else if (key === "z" && !event.shiftKey) {
                      event.preventDefault();
                      history.undo();
                    } else if ((key === "z" && event.shiftKey) || key === "y") {
                      event.preventDefault();
                      history.redo();
                    }
                  }}
                  spellCheck={false}
                  dir="auto"
                  className="block min-h-0 w-full flex-1 resize-none border-0 bg-[#0d1117] px-4 py-3 font-mono text-sm leading-6 text-[#c9d1d9] outline-none placeholder:text-[#8b949e]"
                  placeholder="Paste AI output and shape it into a document…"
                />
                )}
              </section>

              <ResizeHandle
                label="Resize editor and preview"
                value={editorFraction * splitWidth}
                min={PANE_MIN}
                max={splitWidth - PANE_MIN - HANDLE_PX}
                onChange={(next) => splitWidth > 0 && setEditorFraction(clamp(next / splitWidth, 0.1, 0.9))}
                onReset={() => setEditorFraction(EDITOR_FRACTION_DEFAULT)}
              />

              <section style={{ minWidth: PANE_MIN }} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0d1117]">
                <div role="tablist" aria-label="Preview type" className="flex h-11 shrink-0 items-end gap-1 overflow-x-auto border-b border-[#30363d] px-3">
                  {previewTabs.map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={selectedPreview === tab}
                      onClick={() => handleTabClick(tab)}
                      className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${selectedPreview === tab ? "border-[#58a6ff] font-medium text-[#58a6ff]" : "border-transparent text-[#8b949e] hover:bg-[#161b22]"}`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className={`min-h-0 flex-1 ${selectedPreview === "Preview" ? "overflow-auto" : "flex flex-col overflow-hidden"}`}>
                {selectedPreview === "Preview" ? (
                  <div className="mx-auto max-w-3xl px-6 py-4">
                    {previewHeld ? (
                      <PlainSource
                        title="Preview paused"
                        detail="Nothing is rendered from this document until you ask for it. The source is shown as plain text."
                        source={content}
                        action={{ label: "Render preview", onClick: renderHeldPreview }}
                      />
                    ) : preview && !preview.ok ? (
                      <PlainSource title="The preview could not be rendered" detail={preview.error} source={content} />
                    ) : (
                      <>
                        {preview?.ok && preview.blocked.length > 0 ? (
                          <div data-testid="sanitizer-notice" className="mb-3 rounded border border-[#d29922] px-3 py-2 text-xs text-[#d29922]">
                            HTML that is not supported was removed from the preview: {preview.blocked.slice(0, 8).join(", ")}
                            {preview.blocked.length > 8 ? ", …" : ""}
                          </div>
                        ) : null}
                        <ErrorBoundary
                          resetKey={preview}
                          fallback={(error) => <PlainSource title="The preview stopped working" detail={error.message} source={content} />}
                        >
                          <SafePreview html={preview?.ok ? preview.html : EMPTY_HTML} />
                        </ErrorBoundary>
                      </>
                    )}
                  </div>
                ) : (
                  (() => {
                    const format = selectedPreview.toLowerCase() as ExportFormat;
                    const result = exportResults[format];
                    const stale = result !== undefined && result.content !== content;
                    return (
                      <div className="flex min-h-0 flex-1 flex-col text-sm text-[#8b949e]">
                        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#30363d] px-4 py-2">
                          <button onClick={() => runExport(format)} disabled={exporting} className={btnSecondary}>
                            {exporting ? "Generating…" : result ? `Regenerate ${selectedPreview}` : `Generate ${selectedPreview}`}
                          </button>
                          {result ? (
                            <a href={result.blobUrl} download={result.filename} title={result.filename} className="min-w-0 max-w-full truncate text-[#58a6ff] underline">
                              Download {result.filename}
                            </a>
                          ) : null}
                          {stale ? <span className="text-[#d29922]">Content changed since this was generated</span> : null}
                        </div>
                        {!result ? (
                          <span className="p-4">{exporting ? `Generating ${selectedPreview}…` : `${selectedPreview} has not been generated yet.`}</span>
                        ) : format === "html" ? (
                          <iframe title="HTML export" sandbox="" srcDoc={result.html} className="min-h-[240px] w-full flex-1 border-0 bg-white" />
                        ) : format === "pdf" ? (
                          <iframe title="PDF export" src={result.blobUrl} className="min-h-[240px] w-full flex-1 border-0 bg-white" />
                        ) : (
                          <span className="p-4">Word documents cannot be previewed in the browser. Use the download link to open it in Word.</span>
                        )}
                      </div>
                    );
                  })()
                )}
                </div>
              </section>
            </div>

            <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-[#30363d] bg-[#161b22] px-4 text-xs text-[#8b949e]">
              <span role="status" aria-live="polite" className="min-w-0 truncate">
                {statusMessage}
              </span>
              <span className="shrink-0">{wordCount(content).toLocaleString()} words</span>
            </footer>
          </main>
        </div>
      </div>
    </div>
    {pendingOpen ? (
      <ConfirmDialog
        title="Discard unsaved changes?"
        message={`You have unsaved changes in the editor. Opening “${pendingOpen.title}” replaces them.`}
        actions={[
          {
            label: "Save, then open",
            primary: true,
            onClick: () => {
              const target = pendingOpen;
              setPendingOpen(null);
              void saveDocument().then((saved) => saved && applyOpen(target));
            },
          },
          {
            label: "Discard and open",
            onClick: () => {
              applyOpen(pendingOpen);
              setPendingOpen(null);
            },
          },
        ]}
        onCancel={() => setPendingOpen(null)}
      />
    ) : null}
    {cleanPreview ? (
      <CleanDialog
        before={cleanPreview.before}
        after={cleanPreview.result.cleaned_text.trim()}
        changes={cleanPreview.result.changes}
        removed={cleanPreview.result.removed}
        onApply={applyClean}
        onCancel={() => setCleanPreview(null)}
      />
    ) : null}
    {saveConflict ? (
      <ConfirmDialog
        title="This document changed elsewhere"
        message="It was saved from another tab or device after you opened it. Overwriting would discard that newer version."
        actions={[
          {
            label: "Save mine as a new document",
            primary: true,
            onClick: () => {
              setSaveConflict(false);
              void saveDocument({ asNew: true });
            },
          },
          {
            label: "Overwrite with mine",
            onClick: () => {
              setSaveConflict(false);
              void saveDocument({ force: true });
            },
          },
        ]}
        onCancel={() => setSaveConflict(false)}
      />
    ) : null}
    {recovery ? (
      <RecoveryDialog
        heading="Recovery mode"
        description="The last time this page loaded it did not finish starting, so your saved draft was not opened or rendered. Copy or download it, restore it into the editor (the preview stays off until you choose to render it), or start fresh. Starting fresh keeps the draft as a backup in this browser."
        draft={recovery.draft}
        primary={recovery.draft?.trim() ? { label: "Restore draft", onClick: restoreRecoveredDraft } : { label: "Continue", onClick: startFresh }}
        secondary={recovery.draft?.trim() ? { label: "Start fresh", onClick: startFresh } : undefined}
      />
    ) : null}
    </>
  );
}

function PlainSource({ title, detail, source, action }: { title: string; detail: string; source: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div data-testid="preview-fallback">
      <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded border border-[#d29922] px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[#d29922]">{title}</div>
          <div className="text-xs text-[#8b949e]">{detail}</div>
        </div>
        {action ? (
          <button type="button" onClick={action.onClick} className={btnSecondary}>
            {action.label}
          </button>
        ) : null}
      </div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{source}</pre>
    </div>
  );
}

function CrashScreen({ error }: { error: Error }) {
  return (
    <RecoveryDialog
      heading="The workbench stopped unexpectedly"
      description={`${error.message || "Unknown error"}. Your saved draft is below. Reloading opens recovery mode, which does not render the draft.`}
      draft={readDraft()}
      primary={{ label: "Reload in recovery mode", onClick: () => window.location.reload() }}
    />
  );
}

export function Workbench() {
  return (
    <ErrorBoundary fallback={(error) => <CrashScreen error={error} />} onError={flagCrash}>
      <QueryClientProvider client={queryClient}>
        <WorkbenchShell />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
