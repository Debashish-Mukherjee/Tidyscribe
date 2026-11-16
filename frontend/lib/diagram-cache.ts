import { renderMermaid } from "./diagrams";

// Cache render work, including in-flight work, while keeping SVG ids unique per insertion.
const cache = new Map<string, Promise<string>>();
let sequence = 0;
const MAX_ENTRIES = 32;

export async function cachedDiagram(source: string, instance: string): Promise<string> {
  let pending = cache.get(source);
  if (!pending) {
    pending = renderMermaid(`cached-diagram-${sequence++}`, source);
    cache.set(source, pending);
    const current = pending;
    void pending.catch(() => { if (cache.get(source) === current) cache.delete(source); });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  } else {
    cache.delete(source);
    cache.set(source, pending);
  }
  const svg = await pending;
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  // Mermaid uses ids in attributes, marker URLs and CSS selectors. Replace a whole
  // identifier only, longest first, so overlapping ids cannot corrupt one another.
  let result = svg;
  for (const id of [...new Set(ids)].sort((a, b) => b.length - a.length)) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(?<=[#"'(])${escaped}(?=["')\\s{.:>]|$)`, "g"), `${instance}-${id}`);
  }
  return result;
}
