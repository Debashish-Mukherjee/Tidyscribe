/** A line made of box tops: `+---+`, `┌───┐` (also double and rounded), possibly several side by side joined by arrows. */
export const BOX_EDGE_LINE = /^\s*(?:\+[-=]{2,}\+|[┌╔╭┏][─═━]{2,}[┐╗╮┓])(?:[\s─━═\-=<>▶►→←]*(?:\+[-=]{2,}\+|[┌╔╭┏][─═━]{2,}[┐╗╮┓]))*\s*$/;

/** Wraps bare box drawings (ASCII or Unicode) in a ```text fence so their spacing survives rendering. */
export const fenceAsciiDiagrams = (markdown: string) => {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (!inFence && BOX_EDGE_LINE.test(line)) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !/^\s*```/.test(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      out.push("```text", ...block, "```");
      continue;
    }
    out.push(line);
    i += 1;
  }
  return out.join("\n");
};

/** Also fences bare `@startuml ... @enduml` blocks, which a rich editor would otherwise flatten into a paragraph. */
export const fenceBareDiagrams = (markdown: string) => {
  const lines = fenceAsciiDiagrams(markdown).split("\n");
  const out: string[] = [];
  let inFence = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
    } else if (!inFence && /^\s*@startuml\b/i.test(line)) {
      let end = i + 1;
      while (end < lines.length && !/^\s*@enduml\b/i.test(lines[end])) end += 1;
      out.push("```plantuml", ...lines.slice(i, Math.min(end + 1, lines.length)), "```");
      i = end + 1;
    } else {
      out.push(line);
      i += 1;
    }
  }
  return out.join("\n");
};
