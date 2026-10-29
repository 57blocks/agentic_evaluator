/**
 * A line diff, for showing how a prompt variant departs from the step's
 * template. Longest common subsequence over lines; small inputs only, so the
 * quadratic table is fine, and anything longer is cut rather than diffed.
 */

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Templates longer than this are compared by their first lines only. */
export const DIFF_MAX_LINES = 400;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n").slice(0, DIFF_MAX_LINES);
  const b = after.split("\n").slice(0, DIFF_MAX_LINES);
  // lcs[i][j]: length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  for (; i < a.length; i++) out.push({ kind: "del", text: a[i] });
  for (; j < b.length; j++) out.push({ kind: "add", text: b[j] });
  return out;
}

/** How many lines changed, for a one-line summary. */
export function diffCounts(diff: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: diff.filter((d) => d.kind === "add").length,
    removed: diff.filter((d) => d.kind === "del").length,
  };
}
