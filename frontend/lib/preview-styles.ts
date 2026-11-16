// Single source for the rendered-document styles. The preview lives in a shadow root, which page CSS cannot reach, so
// this text is injected both there (SafePreview) and into the document (layout.tsx) for the rich editor.
export const PREVIEW_CSS = `
.md-preview { line-height: 1.7; font-size: 0.95rem; }
.md-preview *, .md-preview ::before, .md-preview ::after { box-sizing: border-box; }
.md-preview img, .md-preview svg { display: block; }
.md-preview img { max-width: 100%; height: auto; }
.md-preview h4, .md-preview h5, .md-preview h6 { font-size: inherit; font-weight: inherit; margin: 0; }
.md-preview h1 { font-size: 1.75rem; font-weight: 700; color: var(--heading); margin: 0.2em 0 0.6em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); line-height: 1.25; }
.md-preview h2 { font-size: 1.35rem; font-weight: 700; color: var(--heading); margin: 1.4em 0 0.6em; padding-bottom: 0.3em; border-bottom: 1px solid var(--border); line-height: 1.3; }
.md-preview h3 { font-size: 1.15rem; font-weight: 600; color: var(--heading); margin: 1.2em 0 0.5em; }
.md-preview p { margin: 0.8em 0; }
.md-preview ul { list-style: disc; padding-left: 1.6em; margin: 0.8em 0; }
.md-preview ol { list-style: decimal; padding-left: 1.6em; margin: 0.8em 0; }
.md-preview li { margin: 0.25em 0; }
.md-preview li:has(> .md-task), .md-preview li:has(> p > .md-task) { list-style: none; margin-left: -1.2em; }
.md-preview .md-task { display: inline-block; width: 0.9em; height: 0.9em; margin-right: 0.5em; border: 1px solid var(--muted); border-radius: 3px; vertical-align: -0.1em; position: relative; }
.md-preview .md-task[aria-checked="true"] { background: var(--primary); border-color: var(--primary); }
.md-preview .md-task[aria-checked="true"]::after { content: ""; position: absolute; left: 0.28em; top: 0.05em; width: 0.25em; height: 0.5em; border: solid var(--background); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.md-preview input[type="checkbox"] { margin-right: 0.5em; }
.md-preview a { color: var(--primary); text-decoration: underline; }
.md-preview hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
.md-preview table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.md-preview th, .md-preview td { border: 1px solid var(--border); padding: 6px 12px; text-align: left; }
.md-preview th { background: var(--panel); font-weight: 600; color: var(--heading); }
.md-preview blockquote { border-left: 4px solid var(--border); padding: 0.2em 1em; color: var(--muted); margin: 1em 0; }
.md-preview blockquote.callout { border-radius: 4px; background: var(--panel); color: var(--text); }
.md-preview .callout-warning, .md-preview .callout-caution { border-left-color: var(--warning); }
.md-preview .callout-tip { border-left-color: var(--success); }
.md-preview .callout-note, .md-preview .callout-important { border-left-color: var(--primary); }
.md-preview pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px; overflow: auto; font-size: 0.85rem; margin: 1em 0; }
.md-preview code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.md-preview p code, .md-preview li code { background: var(--panel); padding: 2px 6px; border-radius: 4px; }
.md-preview .mermaid { background: #fff; border-radius: 6px; padding: 12px; margin: 1em 0; overflow: auto; }
.md-preview .mermaid:has(.mermaid-error) { background: var(--panel); border: 1px solid var(--error); color: var(--text); }
.md-preview .mermaid-error { color: var(--error); font-weight: 600; font-size: 0.85rem; margin-bottom: 0.5em; }
.md-preview .mermaid pre { margin: 0; }
.md-preview details { margin: 1em 0; border: 1px solid var(--border); border-radius: 6px; padding: 0.4em 1em; }
.md-preview summary { cursor: pointer; font-weight: 600; }
.md-preview kbd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; padding: 0.15em 0.4em; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; background: var(--panel); }
.md-preview mark { background: #fff8c5; color: #1f2328; padding: 0 0.15em; }
.md-preview dt { font-weight: 600; margin-top: 0.6em; }
.md-preview dd { margin: 0 0 0.4em 1.5em; }
.md-preview .footnotes { font-size: 0.9em; color: var(--muted); }
.md-preview .footnotes ol { list-style: decimal; padding-left: 1.6em; }
.md-preview .footnotes hr { margin: 1.5em 0 0.8em; }
.md-preview sup.footnote-ref a, .md-preview a.footnote-backref { text-decoration: none; }
.md-preview .math-block { text-align: center; margin: 1em 0; overflow-x: auto; }
.md-preview math { font-size: 1.1em; }
.md-preview caption { font-weight: 600; text-align: left; padding-bottom: 0.4em; }
`;
