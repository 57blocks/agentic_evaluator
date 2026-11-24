/**
 * A check's headline numbers: the few measures its report leads with, each
 * with a count or an interval, instead of every measure on one line. The
 * check declares them in the spec (`report.headline`); a built-in kind has
 * its own. Descriptive only, as measures are: nothing here gates or picks.
 *
 * A headline with `of` is a share: the measure summed over graded trials,
 * out of another summed (defects caught out of defects there were). Its 95%
 * interval is Wilson's, counted per input as the required check's is, so
 * repeated trials of one input do not narrow it. Without `of` it is the mean
 * over inputs of each input's mean, with a t-interval over those means.
 *
 * Candidates are compared on a headline input by input with an exact sign
 * test, as the selector compares task success.
 *
 * Pure: no fs.
 */

import type { InputLabels } from "./about.js";
import type { MeasureRow } from "./measures.js";
import type { PartsDecl } from "./parts.js";
import { SIGNIFICANCE, signTestP, tInterval95, wilson } from "./stats.js";
import { FINDINGS_MATCH_REPORT } from "../code-review/check-report.js";

export interface HeadlineDecl {
  label: string;
  /** A measure, or several summed. */
  measure: string | string[];
  /** Makes it a share: `measure` out of this measure, or of these summed. */
  of?: string | string[];
  /** Only the inputs carrying this tag (the reviewable defects, not every defect). */
  tag?: string;
  /** Also shown per input tag and split. */
  by_slice?: boolean;
}

export interface SliceGroupDecl {
  title: string;
  tags: string[];
}

/** A check's `report` block, as the spec declares it and the manifest freezes it. */
export interface CheckReport {
  headline: HeadlineDecl[];
  slice_groups?: SliceGroupDecl[];
  /** What the check's parts are called and how their tags are grouped (canon/parts.ts). */
  parts?: PartsDecl;
  /** The per-input table under titles, each saying what a pass means for those inputs. */
  input_groups?: InputGroupDecl[];
}

/** Inputs carrying `tag`, under `title`; `pass` says what a pass of the check means there. */
export interface InputGroupDecl {
  tag: string;
  title: string;
  pass: string;
}

export interface InputGroup {
  title: string;
  pass: string;
  inputs: Set<string>;
}

/** The declared groups that hold an input, in order; an input goes to the first group whose tag it carries. */
export function inputGroups(labels: InputLabels | null, decl: readonly InputGroupDecl[] | undefined): InputGroup[] {
  if (!labels || !decl) return [];
  const taken = new Set<string>();
  return decl
    .map((g) => {
      const inputs = new Set(Object.entries(labels).filter(([input, l]) => !taken.has(input) && l.tags.includes(g.tag)).map(([input]) => input));
      for (const input of inputs) taken.add(input);
      return { title: g.title, pass: g.pass, inputs };
    })
    .filter((g) => g.inputs.size > 0);
}

export type HeadlineValue =
  | { kind: "share"; value: number; numerator: number; denominator: number; inputs: number; low: number | null; high: number | null }
  | { kind: "mean"; value: number; inputs: number; low: number | null; high: number | null };

const namesOf = (m: string | string[]): string[] => (Array.isArray(m) ? m : [m]);

interface InputSum {
  numerator: number;
  denominator: number;
  trials: number;
}

/** Per input: the headline's measures summed over the graded trials that reported all of them. */
function sumsByInput(rows: readonly MeasureRow[], candidate: string, decl: HeadlineDecl, inputs?: ReadonlySet<string>): Map<string, InputSum> {
  const over = namesOf(decl.measure);
  const under = decl.of === undefined ? [] : namesOf(decl.of);
  const out = new Map<string, InputSum>();
  for (const row of rows) {
    if (row.candidate !== candidate || (inputs && !inputs.has(row.input))) continue;
    for (const cell of Object.values(row.checks ?? {})) {
      const m = cell.measures;
      if ((cell.state !== "pass" && cell.state !== "fail") || !m) continue;
      if (![...over, ...under].every((n) => typeof m[n] === "number")) continue;
      const sum = (names: string[]) => names.reduce((s, n) => s + m[n]!, 0);
      const cur = out.get(row.input) ?? { numerator: 0, denominator: 0, trials: 0 };
      out.set(row.input, { numerator: cur.numerator + sum(over), denominator: cur.denominator + sum(under), trials: cur.trials + 1 });
    }
  }
  return out;
}

/** Each input's own value: its share when the headline is one (none with nothing to be out of), else its mean. */
function valuesByInput(rows: readonly MeasureRow[], candidate: string, decl: HeadlineDecl, inputs?: ReadonlySet<string>): Map<string, number> {
  const share = decl.of !== undefined;
  return new Map(
    [...sumsByInput(rows, candidate, decl, inputs)].flatMap(([input, s]): Array<[string, number]> =>
      share ? (s.denominator > 0 ? [[input, s.numerator / s.denominator]] : []) : [[input, s.numerator / s.trials]],
    ),
  );
}

/** One candidate's headline over these inputs (all of them when none are given); null when nothing reported it. */
export function headlineValue(rows: readonly MeasureRow[], candidate: string, decl: HeadlineDecl, inputs?: ReadonlySet<string>): HeadlineValue | null {
  const sums = [...sumsByInput(rows, candidate, decl, inputs).values()];
  if (decl.of !== undefined) {
    const counted = sums.filter((s) => s.denominator > 0);
    const numerator = counted.reduce((s, v) => s + v.numerator, 0);
    const denominator = counted.reduce((s, v) => s + v.denominator, 0);
    if (denominator === 0) return null;
    const value = numerator / denominator;
    const ci = wilson(Math.min(1, value) * counted.length, counted.length);
    return { kind: "share", value, numerator, denominator, inputs: counted.length, low: ci?.low ?? null, high: ci?.high ?? null };
  }
  if (sums.length === 0) return null;
  const means = sums.map((s) => s.numerator / s.trials);
  const ci = tInterval95(means);
  return { kind: "mean", value: means.reduce((s, v) => s + v, 0) / means.length, inputs: means.length, low: ci?.low ?? null, high: ci?.high ?? null };
}

export interface HeadlineDifference {
  a: string;
  b: string;
  /** Inputs where both have a value. */
  compared: number;
  a_better: number;
  b_better: number;
  same: number;
  p_value: number;
  significant: boolean;
}

/** Every pair of candidates on one headline: who had the higher value on each input both have, and the sign test's p. */
export function headlineDifferences(rows: readonly MeasureRow[], candidates: readonly string[], decl: HeadlineDecl, inputs?: ReadonlySet<string>): HeadlineDifference[] {
  const values = new Map(candidates.map((c) => [c, valuesByInput(rows, c, decl, inputs)]));
  return candidates.flatMap((a, i) =>
    candidates.slice(i + 1).map((b): HeadlineDifference => {
      const va = values.get(a)!;
      const vb = values.get(b)!;
      const shared = [...va.keys()].filter((input) => vb.has(input));
      const aBetter = shared.filter((input) => va.get(input)! > vb.get(input)!).length;
      const bBetter = shared.filter((input) => va.get(input)! < vb.get(input)!).length;
      const p = signTestP(aBetter, bBetter);
      return { a, b, compared: shared.length, a_better: aBetter, b_better: bBetter, same: shared.length - aBetter - bBetter, p_value: p, significant: p < SIGNIFICANCE };
    }),
  );
}

export interface SliceGroup {
  /** Null when the check declares no groups: every slice, in the order its tag first appears. */
  title: string | null;
  slices: Array<{ label: string; inputs: Set<string> }>;
}

export const OTHER_SLICES = "Other";

/**
 * The labelled slices in the check's groups: each group's tags in the order
 * it lists them, only those some input carries; every other tag, then each
 * split as "split: <name>", last under "Other". No labels: no slices.
 */
export function sliceGroups(labels: InputLabels | null, groups: readonly SliceGroupDecl[] | undefined): SliceGroup[] {
  if (!labels) return [];
  const members = new Map<string, Set<string>>();
  const add = (label: string, input: string) => members.set(label, (members.get(label) ?? new Set()).add(input));
  for (const [input, l] of Object.entries(labels)) for (const t of l.tags) add(t, input);
  for (const [input, l] of Object.entries(labels)) if (l.split) add(`split: ${l.split}`, input);
  const slice = (label: string) => ({ label, inputs: members.get(label)! });
  if (!groups || groups.length === 0) return [{ title: null, slices: [...members.keys()].map(slice) }];
  const grouped = new Set(groups.flatMap((g) => g.tags));
  const declared = groups.map((g) => ({ title: g.title, slices: g.tags.filter((t) => members.has(t)).map(slice) }));
  const rest = [...members.keys()].filter((label) => !grouped.has(label)).map(slice);
  return [...declared, { title: OTHER_SLICES, slices: rest }].filter((g) => g.slices.length > 0);
}

export interface HeadlineRow {
  label: string;
  /** Inputs carrying this tag or split. */
  inputs: number;
  cells: Record<string, HeadlineValue | null>;
}

/** One headline, ready to draw: every candidate over all inputs, who differs, and its slices when it asks for them. */
export interface HeadlineEntry {
  decl: HeadlineDecl;
  all: Record<string, HeadlineValue | null>;
  /** Every pair of candidates, over all inputs. */
  differences: HeadlineDifference[];
  /** Slices where some candidate has a value, in the check's groups; empty unless `by_slice`. */
  groups: Array<{ title: string | null; rows: HeadlineRow[] }>;
}

/**
 * The check's headlines over a run's rows; empty when the check has no
 * report. A headline with a `tag` is over that tag's inputs only, and one no
 * candidate has a value for (a tag this test set does not use) is left out.
 */
export function headlineBoard(report: CheckReport | null, labels: InputLabels | null, rows: readonly MeasureRow[], candidates: readonly string[]): HeadlineEntry[] {
  if (!report) return [];
  const groups = sliceGroups(labels, report.slice_groups);
  const tagged = (tag: string): Set<string> => new Set(Object.entries(labels ?? {}).filter(([, l]) => l.tags.includes(tag)).map(([input]) => input));
  const cellsOf = (decl: HeadlineDecl, inputs?: ReadonlySet<string>) => Object.fromEntries(candidates.map((c) => [c, headlineValue(rows, c, decl, inputs)]));
  const entries = report.headline.map((decl): HeadlineEntry => {
    const own = decl.tag === undefined ? undefined : tagged(decl.tag);
    return {
    decl,
    all: cellsOf(decl, own),
    differences: headlineDifferences(rows, candidates, decl, own),
    groups: !decl.by_slice
      ? []
      : groups
          .map((g) => ({
            title: g.title,
            rows: g.slices
              .map((s): HeadlineRow => ({ label: s.label, inputs: s.inputs.size, cells: cellsOf(decl, own ? new Set([...s.inputs].filter((input) => own.has(input))) : s.inputs) }))
              .filter((r) => Object.values(r.cells).some((v) => v !== null)),
          }))
          .filter((g) => g.rows.length > 0),
    };
  });
  return entries.filter((h) => Object.values(h.all).some((v) => v !== null));
}

/** The report a check leads with: what the run froze from its spec, else what its kind has built in, else none. */
export function checkReportFor(declared: CheckReport | null | undefined, checkVersion: string | null | undefined): CheckReport | null {
  if (declared) return declared;
  return checkVersion?.startsWith("findings-match-") ? FINDINGS_MATCH_REPORT : null;
}
