"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Bold, Code, Code2, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table2, Undo2 } from "lucide-react";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "../lib/richedit";
import { btnGhost } from "./ui";

type Props = {
  value: string;
  onChange: (markdown: string) => void;
};

type ToolbarItem = { label: string; icon: React.ReactNode; run: (editor: Editor) => void; active?: (editor: Editor) => boolean };

const promptLink = (editor: Editor) => {
  const previous = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt("Link URL (leave empty to remove)", previous ?? "https://");
  if (url === null) return;
  if (url.trim() === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
  else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
};

const TOOLBAR: (ToolbarItem | "separator")[] = [
  { label: "Bold", icon: <Bold className="h-4 w-4" />, run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { label: "Italic", icon: <Italic className="h-4 w-4" />, run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { label: "Strikethrough", icon: <Strikethrough className="h-4 w-4" />, run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
  { label: "Inline code", icon: <Code className="h-4 w-4" />, run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { label: "Link", icon: <Link2 className="h-4 w-4" />, run: promptLink, active: (e) => e.isActive("link") },
  "separator",
  { label: "Heading 1", icon: <Heading1 className="h-4 w-4" />, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { label: "Heading 2", icon: <Heading2 className="h-4 w-4" />, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { label: "Heading 3", icon: <Heading3 className="h-4 w-4" />, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  "separator",
  { label: "Bullet list", icon: <List className="h-4 w-4" />, run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { label: "Numbered list", icon: <ListOrdered className="h-4 w-4" />, run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { label: "Task list", icon: <ListChecks className="h-4 w-4" />, run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive("taskList") },
  { label: "Quote", icon: <Quote className="h-4 w-4" />, run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { label: "Code block", icon: <Code2 className="h-4 w-4" />, run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  { label: "Table", icon: <Table2 className="h-4 w-4" />, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: "Horizontal rule", icon: <Minus className="h-4 w-4" />, run: (e) => e.chain().focus().setHorizontalRule().run() },
];

export default function RichEditor({ value, onChange }: Props) {
  // The Markdown last produced by (or loaded into) the editor, so our own edits are not echoed back as external changes.
  const synced = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer nofollow" } } }),
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    content: markdownToEditorHtml(value),
    editorProps: { attributes: { class: "md-preview rich-editor mx-auto min-h-full max-w-3xl px-6 py-4 outline-none", "aria-label": "Rich text editor", id: "document-editor" } },
    onUpdate: ({ editor: current }) => {
      const markdown = editorHtmlToMarkdown(current.getHTML());
      synced.current = markdown;
      onChangeRef.current(markdown);
    },
  });

  // Changes made elsewhere (opening a document, Clean AI Text, snippets) replace the editor content.
  useEffect(() => {
    if (!editor || value === synced.current) return;
    synced.current = value;
    editor.commands.setContent(markdownToEditorHtml(value), { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label="Formatting" className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-[#30363d] px-3 py-1.5">
        <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()} className={btnGhost}>
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()} className={btnGhost}>
          <Redo2 className="h-4 w-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-[#30363d]" />
        {TOOLBAR.map((item, index) =>
          item === "separator" ? (
            <span key={`sep-${index}`} className="mx-1 h-4 w-px bg-[#30363d]" />
          ) : (
            <button
              key={item.label}
              type="button"
              aria-label={item.label}
              aria-pressed={editor ? (item.active?.(editor) ?? false) : false}
              title={item.label}
              disabled={!editor}
              onClick={() => editor && item.run(editor)}
              className={`${btnGhost} aria-pressed:bg-[#161b22] aria-pressed:text-[#58a6ff]`}
            >
              {item.icon}
            </button>
          ),
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[#0d1117]">
        <EditorContent editor={editor} className="min-h-full" />
      </div>
    </div>
  );
}
