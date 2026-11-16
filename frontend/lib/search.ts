export type FindOptions = { caseSensitive: boolean; regex: boolean };
export type Match = { start: number; end: number };

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compiles the query; null when empty or an invalid regular expression. */
export function buildPattern(query: string, options: FindOptions): RegExp | null {
  if (!query) return null;
  try {
    return new RegExp(options.regex ? query : escapeRegex(query), options.caseSensitive ? "gm" : "gim");
  } catch {
    return null;
  }
}

export function findMatches(text: string, query: string, options: FindOptions): Match[] {
  const pattern = buildPattern(query, options);
  if (!pattern) return [];
  const matches: Match[] = [];
  for (const found of text.matchAll(pattern)) {
    // Zero-length matches (e.g. /^/) cannot be selected or replaced meaningfully.
    if (found[0].length === 0) continue;
    matches.push({ start: found.index, end: found.index + found[0].length });
  }
  return matches;
}

/** Index of the first match at or after `from`, wrapping to the start; -1 when there are none. */
export function nextIndex(matches: Match[], from: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.start >= from);
  return index === -1 ? 0 : index;
}

/** Index of the last match that ends at or before `from`, wrapping to the end; -1 when there are none. */
export function previousIndex(matches: Match[], from: number): number {
  if (matches.length === 0) return -1;
  for (let index = matches.length - 1; index >= 0; index -= 1) if (matches[index].end <= from) return index;
  return matches.length - 1;
}

// Regex mode honours $1 / $& in the replacement; literal mode inserts it verbatim.
const substitute = (text: string, pattern: RegExp, replacement: string, options: FindOptions) =>
  options.regex ? text.replace(pattern, replacement) : text.replace(pattern, () => replacement);

export function replaceAll(text: string, query: string, replacement: string, options: FindOptions): { text: string; count: number } {
  const matches = findMatches(text, query, options);
  const pattern = buildPattern(query, options);
  if (!pattern || matches.length === 0) return { text, count: 0 };
  return { text: substitute(text, pattern, replacement, options), count: matches.length };
}

export function replaceMatch(text: string, match: Match, query: string, replacement: string, options: FindOptions): string {
  const pattern = buildPattern(query, options);
  if (!pattern) return text;
  // A sticky regex replaces only the match starting at lastIndex, so lookarounds and anchors still see the whole text.
  const sticky = new RegExp(pattern.source, pattern.flags.replace("g", "") + "y");
  sticky.lastIndex = match.start;
  return substitute(text, sticky, replacement, options);
}
