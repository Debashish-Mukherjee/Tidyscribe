export type DiffLine = { type: "same" | "removed" | "added"; text: string };

const MAX_CELLS = 2_500_000;

/** Line diff by longest common subsequence; null when the inputs are too large to diff in the browser. */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const left = a.slice(start, endA);
  const right = b.slice(start, endB);
  if (left.length * right.length > MAX_CELLS) return null;

  const table: Uint32Array[] = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ type: "same", text }));
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      out.push({ type: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) {
      out.push({ type: "removed", text: left[i] });
      i += 1;
    } else {
      out.push({ type: "added", text: right[j] });
      j += 1;
    }
  }
  return out.concat(a.slice(endA).map((text) => ({ type: "same", text })));
}

/** Keeps changed lines with `context` unchanged lines around them; longer unchanged runs become one gap marker. */
export function collapseDiff(lines: DiffLine[], context = 1): Array<DiffLine | { type: "gap"; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.type === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true;
  });
  const out: Array<DiffLine | { type: "gap"; count: number }> = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) out.push({ type: "gap", count: skipped });
      skipped = 0;
      out.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped) out.push({ type: "gap", count: skipped });
  return out;
}
