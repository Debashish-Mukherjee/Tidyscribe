import mermaid from "mermaid";
import { BOX_EDGE_LINE } from "./markdown";

export type DiagramImage = { source: string; png_base64: string };

// Must match PNG_SCALE in backend/app/services/export_service.py.
const PNG_SCALE = 3;
const MAX_CANVAS_PX = 12000;

let mermaidReady = false;

export function initMermaid() {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "strict",
    suppressErrorRendering: true,
    // Plain SVG text (no foreignObject) so the diagram can be drawn onto a canvas.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });
  mermaidReady = true;
}

export function extractMermaidSources(markdown: string): string[] {
  const sources: string[] = [];
  // CommonMark: a closing fence has no info string (so "```mermaid" does not close one); an unclosed fence runs to the end.
  const pattern = /^```mermaid[^\n]*\n([\s\S]*?)(?:^```[ \t]*$|(?![\s\S]))/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    sources.push(match[1]);
  }
  return sources;
}

export const hasPlantUml = (markdown: string) => /^[ \t]*(```|~~~)[ \t]*(plantuml|puml|uml)\b|^[ \t]*@startuml\b/im.test(markdown);

// Mermaid rejects these in an unquoted [label]; quoting the label is the documented fix.
const UNSAFE_LABEL_CHARS = /[(){}|@]/;
// A plain rectangle node: an id, then [label] that is not a special shape ([(..)], [[..]], [/..\], quoted) and has no bracket inside.
const PLAIN_NODE = /(\b[\w.-]+)\[(?![[(/\\"])([^[\]"\n]+)\](?![\]])/g;

/** Quotes flowchart labels that Mermaid would reject (parentheses, braces, pipes, @) so AI-written diagrams still render. */
export function repairMermaid(source: string): string {
  if (!/^\s*(flowchart|graph)\b/m.test(source.replace(/^\s*%%.*$/gm, ""))) return source;
  return source
    .split("\n")
    .map((line) =>
      /^\s*%%/.test(line)
        ? line
        : line.replace(PLAIN_NODE, (whole, id: string, label: string) => (UNSAFE_LABEL_CHARS.test(label) ? `${id}["${label.replace(/"/g, "#quot;")}"]` : whole)),
    )
    .join("\n");
}

/** Removes Markdown escapes and bold markers (`--\>`, `**(**`) that a copy through a Markdown converter leaves inside a diagram. */
export function stripMarkdownArtifacts(source: string): string {
  return source.replace(/\\([>_*()#+.!~|-])/g, "$1").replace(/\*\*/g, "");
}

// A leftover fence line (e.g. a closing "```mermaid") is not Mermaid syntax and would be drawn as a node.
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})[\w-]*[ \t]*$/gm;

/**
 * Renders Mermaid source to SVG. If Mermaid rejects it, retries once with Markdown artifacts removed and
 * reports the first error otherwise, so line numbers match the text the user sees.
 */
export async function renderMermaid(id: string, rawSource: string): Promise<string> {
  initMermaid();
  const source = rawSource.replace(FENCE_LINE, "");
  const cleaned = stripMarkdownArtifacts(source);
  const attempts = cleaned === source ? [source] : [source, cleaned];
  let firstError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    const attemptId = `${id}-${index}`;
    try {
      return (await mermaid.render(attemptId, repairMermaid(attempt))).svg;
    } catch (error) {
      firstError ??= error;
      // A failed render leaves its temporary container (with an error drawing) appended to <body>.
      document.getElementById(`d${attemptId}`)?.remove();
      document.getElementById(attemptId)?.remove();
    }
  }
  throw firstError;
}

/** `start`/`end` is the span to replace; `text` is the diagram source to convert. */
export type DiagramRange = { start: number; end: number; text: string };

const ASCII_EDGE = BOX_EDGE_LINE;
const FENCE = /^\s*(```|~~~)/;
// Code fences in these languages are only converted when the caret is inside them; elsewhere they are ordinary code.
const CONVERTIBLE_CODE = new Set(["terraform", "tf", "hcl", "yaml", "yml", "drawio", "xml"]);

export function findDiagramRange(markdown: string, selectionStart = 0, selectionEnd = selectionStart): DiagramRange | null {
  if (selectionEnd > selectionStart) {
    const text = markdown.slice(selectionStart, selectionEnd);
    return text.trim() ? { start: selectionStart, end: selectionEnd, text } : null;
  }

  const lines = markdown.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const lineEnd = (index: number) => offsets[index] + lines[index].length;

  const found: { first: number; last: number; fenced: boolean; optIn: boolean }[] = [];
  let index = 0;
  while (index < lines.length) {
    const fence = lines[index].match(/^\s*(```|~~~)\s*(\w*)/);
    if (fence) {
      let close = index + 1;
      while (close < lines.length && !FENCE.test(lines[close])) close += 1;
      const language = fence[2].toLowerCase();
      if (["plantuml", "puml", "uml"].includes(language)) found.push({ first: index, last: Math.min(close, lines.length - 1), fenced: true, optIn: false });
      else if (CONVERTIBLE_CODE.has(language)) found.push({ first: index, last: Math.min(close, lines.length - 1), fenced: true, optIn: true });
      index = close + 1;
    } else if (ASCII_EDGE.test(lines[index])) {
      let last = index;
      while (last + 1 < lines.length && lines[last + 1].trim() !== "" && !FENCE.test(lines[last + 1])) last += 1;
      found.push({ first: index, last, fenced: false, optIn: false });
      index = last + 1;
    } else {
      index += 1;
    }
  }
  if (found.length === 0) return null;

  const caret = selectionStart;
  const hit = found.find((block) => caret >= offsets[block.first] && caret <= lineEnd(block.last)) ?? found.find((block) => !block.optIn);
  if (!hit) return null;
  const start = offsets[hit.first];
  const end = lineEnd(hit.last);
  if (hit.fenced) {
    const inner = lines.slice(hit.first + 1, hit.last).join("\n");
    return { start, end, text: inner };
  }
  return { start, end, text: markdown.slice(start, end) };
}

export const mermaidFence = (source: string) => `\`\`\`mermaid\n${source.trim()}\n\`\`\``;

/** Mermaid emits width="100%", which squeezes wide diagrams to a pane's width; use the natural size and let the block scroll. */
export function naturalSize(svg: string): string {
  try {
    return withPixelSize(svg).svg;
  } catch {
    return svg;
  }
}

export function withPixelSize(svg: string): { svg: string; width: number; height: number } {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0];
  const viewBox = tag?.match(/viewBox="([^"]+)"/)?.[1]?.trim().split(/\s+/).map(Number);
  if (!tag || !viewBox || viewBox.length !== 4 || !(viewBox[2] > 0) || !(viewBox[3] > 0)) {
    throw new Error("Diagram SVG has no usable viewBox");
  }
  const [, , width, height] = viewBox;
  const sized = tag.replace(/\s(width|height|style)="[^"]*"/g, "").replace("<svg", `<svg width="${width}" height="${height}"`);
  return { svg: svg.replace(tag, sized), width, height };
}

async function svgToPngBase64(rawSvg: string): Promise<string> {
  const { svg, width, height } = withPixelSize(rawSvg);
  const scale = Math.min(PNG_SCALE, MAX_CANVAS_PX / Math.max(width, height));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1];
}

export async function renderDiagramPngs(markdown: string): Promise<{ images: DiagramImage[]; failed: number }> {
  initMermaid();
  const sources = Array.from(new Set(extractMermaidSources(markdown)));
  const images: DiagramImage[] = [];
  let failed = 0;
  for (const [index, source] of sources.entries()) {
    try {
      const svg = await renderMermaid(`export-diagram-${Date.now()}-${index}`, source.trim());
      images.push({ source, png_base64: await svgToPngBase64(svg) });
    } catch {
      failed += 1;
    }
  }
  return { images, failed };
}
