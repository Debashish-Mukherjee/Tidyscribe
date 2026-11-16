"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { errorMessage } from "../lib/api";
import { naturalSize, renderMermaid } from "../lib/diagrams";
import { PREVIEW_CSS } from "../lib/preview-styles";
import type { SafeHtml } from "../lib/sanitize";

/**
 * Renders sanitised document HTML inside a shadow root so it cannot restyle the application, and
 * contained (layout + paint) so even a stray `position: fixed` stays inside this box.
 */
export function SafePreview({ html }: { html: SafeHtml }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PREVIEW_CSS;
    const body = document.createElement("div");
    shadow.replaceChildren(style, body);
    bodyRef.current = body;
    // Footnote links point at ids inside this shadow root, which the document cannot scroll to by itself.
    const onClick = (event: Event) => {
      const anchor = (event.target as Element).closest?.("a[href^='#']");
      if (!anchor) return;
      event.preventDefault();
      shadow.getElementById(decodeURIComponent((anchor.getAttribute("href") ?? "").slice(1)))?.scrollIntoView({ block: "center" });
    };
    body.addEventListener("click", onClick);
    return () => {
      body.removeEventListener("click", onClick);
      bodyRef.current = null;
      shadow.replaceChildren();
    };
  }, []);

  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = `<article class="md-preview">${html}</article>`;
  }, [html]);

  useEffect(() => {
    bodyRef.current?.querySelectorAll(".mermaid").forEach((block, index) => {
      const source = (block.textContent || "").trim();
      if (!source) return;

      renderMermaid(`mermaid-${index}-${Date.now()}`, source)
        .then((svg) => {
          block.innerHTML = naturalSize(svg);
        })
        .catch((error: unknown) => {
          // Built from text nodes, never HTML: the message and source come from user content.
          const message = document.createElement("div");
          message.className = "mermaid-error";
          message.setAttribute("role", "alert");
          message.textContent = `Diagram could not be rendered: ${errorMessage(error).split("\n")[0]}`;
          const raw = document.createElement("pre");
          raw.textContent = source;
          block.replaceChildren(message, raw);
        });
    });
  }, [html]);

  return <div ref={hostRef} data-testid="preview-host" style={{ display: "block", contain: "layout paint", overflowX: "auto" }} />;
}
