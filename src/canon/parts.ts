/**
 * Check parts: what a check looked for on one trial, each named and passed
 * or not (`{"parts": [{"id": "D1", "pass": true, "label": "…", "tags":
 * ["calculation"]}]}`) — the known defects of a PR, the fields of a form.
 * Descriptive only, as measures are: the verdict still decides.
 *
 * They let a report show each part across candidates, and a pass rate per
 * part tag. An input's own tags cannot give that: an input with a logic
 * defect and a crash would count both under each tag.
 *
 * A part is one (input, id). Its rate per tag is passes over graded trials;
 * the 95% interval is Wilson's counted per part, so repeated trials of one
 * part do not narrow it.
 *
 * Pure: no fs.
 */

import type { HeadlineValue, SliceGroupDecl } from "./headline.js";
import type { CheckCell, TrialRow } from "./rows.js";
import { wilson } from "./stats.js";

export interface CheckPart {
  id: string;
  pass: boolean;
  /** What it is, in a line. */
  label?: string;
  tags?: string[];
}

/** More than this many parts on one trial is a bug in the check: the rest are dropped. */
export const MAX_PARTS = 64;
const MAX_ID_CHARS = 80;
const MAX_LABEL_CHARS = 200;
const MAX_TAGS = 12;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What a check printed under `parts`, kept only as well-formed parts with
 * distinct ids. Anything else is dropped, never an evaluator error.
 * Undefined when nothing is left.
 */
export function partsOf(value: unknown): CheckPart[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const kept: CheckPart[] = [];
  for (const v of value) {
    if (kept.length === MAX_PARTS) break;
    if (!isRecord(v) || typeof v.id !== "string" || v.id === "" || v.id.length > MAX_ID_CHARS || typeof v.pass !== "boolean" || seen.has(v.id)) continue;
    seen.add(v.id);
    const tags = Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string" && t !== "").slice(0, MAX_TAGS) : [];
    kept.push({
      id: v.id,
      pass: v.pass,
      ...(typeof v.label === "string" && v.label !== "" ? { label: v.label.slice(0, MAX_LABEL_CHARS) } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
  }
  return kept.length === 0 ? undefined : kept;
}

/** A check's `report.parts`: what the parts are called, and how their tags are grouped. */
export interface PartsDecl {
  title: string;
  tag_groups?: SliceGroupDecl[];
}

export interface PartRow {
  input: string;
  id: string;
  label: string | null;
  tags: string[];
  /** Per candidate: trials that passed this part, of the graded trials that reported it. */
  cells: Record<string, { pass: number; graded: number }>;
}

export interface PartTagRow {
  /** The tag. */
  label: string;
  /** Parts carrying it. */
  parts: number;
  /** Per candidate: a share whose `inputs` is the parts it is over; null when none was graded. */
  cells: Record<string, HeadlineValue | null>;
}

export interface PartBoard {
  title: string;
  rows: PartRow[];
  groups: Array<{ title: string | null; rows: PartTagRow[] }>;
}

export const DEFAULT_PARTS_TITLE = "Parts of the check";

const isGraded = (c: CheckCell): boolean => c.state === "pass" || c.state === "fail";

function shareOver(rows: readonly PartRow[], candidate: string): HeadlineValue | null {
  const counted = rows.map((r) => r.cells[candidate]).filter((c): c is { pass: number; graded: number } => c !== undefined && c.graded > 0);
  const numerator = counted.reduce((s, c) => s + c.pass, 0);
  const denominator = counted.reduce((s, c) => s + c.graded, 0);
  if (denominator === 0) return null;
  const value = numerator / denominator;
  const ci = wilson(value * counted.length, counted.length);
  return { kind: "share", value, numerator, denominator, inputs: counted.length, low: ci?.low ?? null, high: ci?.high ?? null };
}

/**
 * Every part any graded trial reported, and the pass rate per part tag. Rows
 * are ordered by the first tag group (its tags in order, untagged last),
 * then the highest pass rate first. Null when no trial reported a part.
 */
export function partBoard(decl: PartsDecl | undefined, trials: readonly TrialRow[], candidates: readonly string[]): PartBoard | null {
  const byKey = new Map<string, PartRow>();
  for (const t of trials) {
    if (!candidates.includes(t.candidate)) continue;
    for (const cell of Object.values(t.checks ?? {})) {
      if (!isGraded(cell)) continue;
      for (const p of cell.parts ?? []) {
        const key = `${t.input}\0${p.id}`;
        const row = byKey.get(key) ?? { input: t.input, id: p.id, label: p.label ?? null, tags: p.tags ?? [], cells: Object.fromEntries(candidates.map((c) => [c, { pass: 0, graded: 0 }])) };
        const cur = row.cells[t.candidate]!;
        byKey.set(key, { ...row, cells: { ...row.cells, [t.candidate]: { pass: cur.pass + (p.pass ? 1 : 0), graded: cur.graded + 1 } } });
      }
    }
  }
  if (byKey.size === 0) return null;
  const lead = decl?.tag_groups?.[0]?.tags ?? [];
  const rank = (r: PartRow): number => {
    const i = lead.findIndex((t) => r.tags.includes(t));
    return i === -1 ? lead.length : i;
  };
  const passes = (r: PartRow): number => {
    const graded = Object.values(r.cells).reduce((s, c) => s + c.graded, 0);
    return graded === 0 ? 0 : Object.values(r.cells).reduce((s, c) => s + c.pass, 0) / graded;
  };
  const rows = [...byKey.values()].sort((a, b) => rank(a) - rank(b) || passes(b) - passes(a) || a.input.localeCompare(b.input) || a.id.localeCompare(b.id));
  const tagRow = (tag: string): PartTagRow => {
    const own = rows.filter((r) => r.tags.includes(tag));
    return { label: tag, parts: own.length, cells: Object.fromEntries(candidates.map((c) => [c, shareOver(own, c)])) };
  };
  const present = new Set(rows.flatMap((r) => r.tags));
  const declared = decl?.tag_groups ?? [];
  const grouped = new Set(declared.flatMap((g) => g.tags));
  const rest = [...present].filter((t) => !grouped.has(t));
  const groups = [
    ...declared.map((g) => ({ title: g.title as string | null, rows: g.tags.filter((t) => present.has(t)).map(tagRow) })),
    { title: declared.length > 0 ? "Other" : null, rows: rest.map(tagRow) },
  ].filter((g) => g.rows.length > 0);
  return { title: decl?.title ?? DEFAULT_PARTS_TITLE, rows, groups };
}
