/** A line-by-line comparison of two versions of a draft, for the version compare view. */

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Longest common subsequence, from the end, so the walk below goes forwards.
  if (a.length * b.length > 4_000_000) return [...a.map((text) => ({ kind: "removed" as const, text })), ...b.map((text) => ({ kind: "added" as const, text }))];
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) out.push({ kind: "removed", text: a[i++] });
    else out.push({ kind: "added", text: b[j++] });
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

export function diffCounts(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((line) => line.kind === "added").length, removed: lines.filter((line) => line.kind === "removed").length };
}
