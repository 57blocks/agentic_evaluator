/**
 * Where a fixed defect sits in the PR head, the version a reviewer sees.
 *
 * The fix removed lines from its parent; blame named, for each, the commit
 * and path that wrote it. The lines written inside the PR are looked up by
 * content in that path at the PR head: whole runs of consecutive lines
 * first (a lone `}` matches everywhere), exactly and then with whitespace
 * collapsed (blame ran with -w), the hit nearest blame's line number winning;
 * then single distinctive lines. What cannot be found keeps the file and
 * says so.
 */

import { fileLines } from "./git.js";
import type { BlamedLine } from "./types.js";

export interface Location {
  /** Path at the PR head. */
  file: string;
  start_line?: number;
  end_line?: number;
  /** Lines found, of the lines the PR wrote that the fix removed. */
  found: number;
  of: number;
  note?: string;
}

/** A line shorter than this, whitespace collapsed, is too common to place alone. */
const DISTINCTIVE = 4;
/** A common line is placed only this close to where blame says it was. */
const NEAR = 20;

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

function blockHits(hay: readonly string[], block: readonly string[], eq: (a: string, b: string) => boolean): number[] {
  const hits: number[] = [];
  for (let i = 0; i + block.length <= hay.length; i++) {
    if (block.every((line, j) => eq(hay[i + j], line))) hits.push(i);
  }
  return hits;
}

function nearest(hits: readonly number[], hint: number): number | undefined {
  return [...hits].sort((a, b) => Math.abs(a - hint) - Math.abs(b - hint) || a - b)[0];
}

/** Runs of consecutive lines in the fix's parent. */
function runs(lines: readonly BlamedLine[]): BlamedLine[][] {
  const sorted = [...lines].sort((a, b) => a.line - b.line);
  const out: BlamedLine[][] = [];
  for (const b of sorted) {
    const last = out.at(-1);
    if (last && last.at(-1)!.line + 1 === b.line) last.push(b);
    else out.push([b]);
  }
  return out;
}

/** 0-based positions in `head` for one run; missing lines are absent. */
function placeRun(head: readonly string[], texts: readonly string[], hint: number): number[] {
  for (const eq of [(a: string, b: string) => a === b, (a: string, b: string) => squash(a) === squash(b)]) {
    const at = nearest(blockHits(head, texts, eq), hint);
    if (at !== undefined && (texts.length > 1 || squash(texts[0]).length >= DISTINCTIVE || Math.abs(at - hint) <= NEAR)) {
      return texts.map((_, j) => at + j);
    }
  }
  const out: number[] = [];
  for (const [j, text] of texts.entries()) {
    const want = squash(text);
    if (want === "") continue;
    const hits = head.flatMap((line, i) => (squash(line) === want ? [i] : []));
    const at = nearest(hits, hint + j);
    if (at !== undefined && (want.length >= DISTINCTIVE || Math.abs(at - (hint + j)) <= NEAR)) out.push(at);
  }
  return out;
}

async function parentTexts(repo: string, fixParent: string, lines: readonly BlamedLine[]): Promise<Map<BlamedLine, string>> {
  const files = new Map<string, string[]>();
  for (const f of new Set(lines.map((b) => b.file))) files.set(f, (await fileLines(repo, fixParent, f)) ?? []);
  return new Map(lines.map((b) => [b, files.get(b.file)![b.line - 1] ?? ""]));
}

async function locateFile(repo: string, fixParent: string, head: string, path: string, lines: readonly BlamedLine[]): Promise<Location> {
  // The path blame names is where the PR wrote the lines; failing that, the
  // path the fix found them at.
  let file = path;
  let atHead = await fileLines(repo, head, path);
  if (!atHead && lines[0].file !== path) {
    file = lines[0].file;
    atHead = await fileLines(repo, head, file);
  }
  if (!atHead) return { file: path, found: 0, of: lines.length, note: "the file is not at the PR head" };
  const text = await parentTexts(repo, fixParent, lines);
  const found = new Set<number>();
  for (const run of runs(lines)) {
    for (const p of placeRun(atHead, run.map((b) => text.get(b)!), run[0].orig_line - 1)) found.add(p);
  }
  if (found.size === 0) return { file, found: 0, of: lines.length, note: "none of the removed lines is in the file at the PR head" };
  const sorted = [...found].sort((a, b) => a - b);
  return { file, start_line: sorted[0] + 1, end_line: sorted.at(-1)! + 1, found: found.size, of: lines.length };
}

/**
 * One location per path the PR wrote the removed lines in. `members` are the
 * PR's local commits: lines blame credits to anything else are not the PR's.
 */
export async function locateDefect(repo: string, fixParent: string, head: string, blamed: readonly BlamedLine[], members: ReadonlySet<string>): Promise<Location[]> {
  const mine = blamed.filter((b) => members.has(b.sha));
  const byPath = new Map<string, BlamedLine[]>();
  for (const b of mine) byPath.set(b.orig_file, [...(byPath.get(b.orig_file) ?? []), b]);
  const out: Location[] = [];
  for (const [path, lines] of [...byPath].sort(([a], [b]) => a.localeCompare(b))) out.push(await locateFile(repo, fixParent, head, path, lines));
  return out;
}
