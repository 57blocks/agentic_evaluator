/**
 * Two runs of a step, side by side: did the conclusion change, and why.
 *
 * Everything here is what each run recorded — its recommendation, its gate
 * reasons, its rates — never re-decided, so a diff of two old runs says what
 * they concluded at the time. Four answers:
 *
 *   recommendation  who was picked, how firmly, before and after
 *   gates           who entered or left the eligible set, with the run's reason
 *   rates           each candidate's task success rate with its 95% interval,
 *                   split into the inputs both runs share and the ones only
 *                   one has: 57/60 → 92/100 mixes the two
 *   flips           shared inputs whose outcome moved, and whether the answer
 *                   itself changed or the same answer was graded differently
 *
 * "Shared" means the same input content (the manifest's input hash), not the
 * same name. "Same answer" needs proof — the later trial reused the earlier
 * one, or both saved outputs are identical; an equal trial hash is not proof,
 * since it is fixed before the call. Without proof the cause is "unknown".
 *
 * Pure: no fs. src/core/run-diff-load.ts reads a run directory into a side.
 */

import { INFRA_COMPLETION_STATES } from "./states.js";
import { wilson } from "./stats.js";
import type { Rate } from "./rates.js";
import type { Recommendation } from "./select.js";
import type { TrialRow } from "./rows.js";

export type DiffRow = Pick<TrialRow, "candidate" | "input" | "trial" | "task_outcome" | "completion_state" | "reused_from" | "checks">;

/** The parts of manifest.json a diff compares; every field may be missing in an older run. */
export interface DiffManifest {
  step?: { version?: string | null };
  spec?: { sha256?: string };
  test_set?: { inputs?: Record<string, string> };
  evaluators?: { check_version?: string; producer_template_sha256?: string | null };
  execution?: { trials_per_case?: number };
  operating_mode?: string | null;
  eligibility?: unknown;
  judge?: { model?: string };
  candidates?: Record<string, unknown>;
}

export interface RunSide {
  run: string;
  step: string;
  manifest: DiffManifest;
  /** recommendation.json as recorded; any field may be missing in an older run. */
  recommendation: Partial<Pick<Recommendation, "rule_version" | "chosen" | "firmness" | "eligible" | "filters">> | null;
  /** summary.json's per-candidate rates. */
  rates: ReadonlyArray<{ candidate: string; task_success_rate: Rate }>;
  rows: readonly DiffRow[];
  /** A hash of each saved output, by `trialKey`; empty when the run kept none. */
  outputs: ReadonlyMap<string, string>;
}

export interface SetupChange {
  what: string;
  a: string;
  b: string;
}

export type GateStatus = { state: "in" } | { state: "out"; reason?: string } | { state: "absent" };

export interface RateWithInterval extends Rate {
  low: number | null;
  high: number | null;
}

export interface Count {
  numerator: number;
  denominator: number;
}

export interface RateChange {
  candidate: string;
  /** As each run recorded it; null when the candidate was not in that run. */
  a: RateWithInterval | null;
  b: RateWithInterval | null;
  /** Counted on the inputs both runs share. */
  shared: { a: Count; b: Count };
  /** Counted on the inputs only that run has; null when there are none. */
  onlyA: Count | null;
  onlyB: Count | null;
}

export type FlipCause = "same-answer" | "new-answer" | "unknown";

export interface Flip {
  candidate: string;
  input: string;
  direction: "fail-to-pass" | "pass-to-fail";
  a: { pass: number; n: number };
  b: { pass: number; n: number };
  cause: FlipCause;
  /** The required checks' versions on each side, when they differ. */
  checkVersion: { a: string; b: string } | null;
}

export interface RunDiff {
  a: { run: string; step: string };
  b: { run: string; step: string };
  setup: SetupChange[];
  inputs: { shared: number; added: string[]; removed: string[]; changed: string[] };
  recommendation: {
    a: { chosen: string | null; firmness: string | null };
    b: { chosen: string | null; firmness: string | null };
    changed: boolean;
  };
  gates: Array<{ candidate: string; a: GateStatus; b: GateStatus }>;
  rates: RateChange[];
  flips: Flip[];
  /** Shared inputs a candidate has on both sides but that did not run, or was not graded, on one of them. */
  notCompared: number;
}

export const trialKey = (candidate: string, input: string, trial: number): string => `${candidate}\0${input}\0${trial}`;

const UNRECORDED = "(unrecorded)";

export function diffRuns(a: RunSide, b: RunSide): RunDiff {
  const inputs = compareInputs(a, b);
  const candidates = unionInOrder(candidatesOf(a), candidatesOf(b));
  const sharedSet = new Set(inputs.sharedNames);
  const compared = candidates.map((c) => flipsOf(c, a, b, inputs.sharedNames));
  return {
    a: { run: a.run, step: a.step },
    b: { run: b.run, step: b.step },
    setup: setupChanges(a, b),
    inputs: { shared: inputs.sharedNames.length, added: inputs.added, removed: inputs.removed, changed: inputs.changed },
    recommendation: recommendationChange(a, b),
    gates: candidates.map((c) => ({ candidate: c, a: gateStatus(a, c), b: gateStatus(b, c) })),
    rates: candidates.map((c) => rateChange(c, a, b, sharedSet)),
    flips: compared.flatMap((x) => x.flips),
    notCompared: compared.reduce((s, x) => s + x.notCompared, 0),
  };
}

/* ── setup ───────────────────────────────────────────────────────────────── */

function setupChanges(a: RunSide, b: RunSide): SetupChange[] {
  const fields: Array<[string, (s: RunSide) => string | undefined]> = [
    ["step", (s) => s.step],
    ["step version", (s) => s.manifest.step?.version ?? undefined],
    ["spec", (s) => s.manifest.spec?.sha256?.slice(0, 12)],
    ["check version", (s) => s.manifest.evaluators?.check_version],
    ["prompt template", (s) => s.manifest.evaluators?.producer_template_sha256?.slice(0, 12)],
    ["trials per input", (s) => (s.manifest.execution?.trials_per_case === undefined ? undefined : String(s.manifest.execution.trials_per_case))],
    ["operating mode", (s) => s.manifest.operating_mode ?? undefined],
    ["judge", (s) => s.manifest.judge?.model],
    ["selection rule", (s) => s.recommendation?.rule_version],
  ];
  const changes = fields
    .map(([what, get]) => ({ what, a: get(a) ?? UNRECORDED, b: get(b) ?? UNRECORDED }))
    .filter((c) => c.a !== c.b);
  const gates = gateChanges(a.manifest.eligibility, b.manifest.eligibility);
  const before = candidatesOf(a);
  const after = candidatesOf(b);
  const added = after.filter((c) => !before.includes(c));
  const removed = before.filter((c) => !after.includes(c));
  const roster = added.length || removed.length ? [{ what: "candidates", a: removed.length ? `−${removed.join(", ")}` : "", b: added.length ? `+${added.join(", ")}` : "" }] : [];
  return [...changes, ...gates, ...roster];
}

/** Each gate threshold that differs; an unset threshold reads as "none". */
function gateChanges(a: unknown, b: unknown): SetupChange[] {
  const ea = (a ?? {}) as Record<string, unknown>;
  const eb = (b ?? {}) as Record<string, unknown>;
  const show = (v: unknown) => (v === undefined || v === null ? "none" : String(v));
  return unionInOrder(Object.keys(ea), Object.keys(eb))
    .filter((k) => show(ea[k]) !== show(eb[k]))
    .map((k) => ({ what: `gate ${k}`, a: show(ea[k]), b: show(eb[k]) }));
}

/* ── inputs ──────────────────────────────────────────────────────────────── */

function inputHashes(s: RunSide): Record<string, string> {
  const declared = s.manifest.test_set?.inputs;
  if (declared && Object.keys(declared).length > 0) return declared;
  // An older manifest without hashes: names are all there is to go on.
  return Object.fromEntries([...new Set(s.rows.map((r) => r.input))].map((i) => [i, i]));
}

function compareInputs(a: RunSide, b: RunSide): { sharedNames: string[]; added: string[]; removed: string[]; changed: string[] } {
  const ha = inputHashes(a);
  const hb = inputHashes(b);
  const namesA = Object.keys(ha);
  const namesB = Object.keys(hb);
  return {
    sharedNames: namesA.filter((i) => i in hb && hb[i] === ha[i]),
    added: namesB.filter((i) => !(i in ha)),
    removed: namesA.filter((i) => !(i in hb)),
    changed: namesA.filter((i) => i in hb && hb[i] !== ha[i]),
  };
}

/* ── recommendation and gates ────────────────────────────────────────────── */

function recommendationChange(a: RunSide, b: RunSide): RunDiff["recommendation"] {
  const pick = (s: RunSide) => ({ chosen: s.recommendation?.chosen ?? null, firmness: s.recommendation?.firmness ?? null });
  const pa = pick(a);
  const pb = pick(b);
  return { a: pa, b: pb, changed: pa.chosen !== pb.chosen || pa.firmness !== pb.firmness };
}

function gateStatus(s: RunSide, candidate: string): GateStatus {
  if (!candidatesOf(s).includes(candidate)) return { state: "absent" };
  if (s.recommendation?.eligible?.includes(candidate)) return { state: "in" };
  const removal = (s.recommendation?.filters ?? []).flatMap((f) => f.removed).find((r) => r.candidate === candidate);
  return removal ? { state: "out", reason: removal.reason } : { state: "out" };
}

/* ── rates ───────────────────────────────────────────────────────────────── */

function withInterval(r: Rate): RateWithInterval {
  const ci = wilson(r.numerator, r.denominator);
  return { ...r, low: ci?.low ?? null, high: ci?.high ?? null };
}

/** Successes over graded trials, as `task_success_rate` counts them. */
function count(rows: readonly DiffRow[]): Count {
  const graded = rows.filter((r) => r.task_outcome !== "undetermined");
  return { numerator: graded.filter((r) => r.task_outcome === "success").length, denominator: graded.length };
}

function rateChange(candidate: string, a: RunSide, b: RunSide, shared: ReadonlySet<string>): RateChange {
  const recorded = (s: RunSide) => {
    const r = s.rates.find((x) => x.candidate === candidate)?.task_success_rate;
    return r ? withInterval(r) : null;
  };
  const own = (s: RunSide) => s.rows.filter((r) => r.candidate === candidate);
  const onlyOne = (rows: readonly DiffRow[]) => {
    const rest = rows.filter((r) => !shared.has(r.input));
    return rest.length > 0 ? count(rest) : null;
  };
  return {
    candidate,
    a: recorded(a),
    b: recorded(b),
    shared: { a: count(own(a).filter((r) => shared.has(r.input))), b: count(own(b).filter((r) => shared.has(r.input))) },
    onlyA: onlyOne(own(a)),
    onlyB: onlyOne(own(b)),
  };
}

/* ── flips ───────────────────────────────────────────────────────────────── */

/** Graded trials only: a provider error, a cancel or an ungraded trial says nothing about the candidate. */
const graded = (r: DiffRow): boolean => !INFRA_COMPLETION_STATES.has(r.completion_state) && r.task_outcome !== "undetermined";

function flipsOf(candidate: string, a: RunSide, b: RunSide, shared: readonly string[]): { flips: Flip[]; notCompared: number } {
  const rowsOf = (s: RunSide, input: string) => s.rows.filter((r) => r.candidate === candidate && r.input === input);
  let notCompared = 0;
  const flips: Flip[] = [];
  for (const input of shared) {
    const ra = rowsOf(a, input);
    const rb = rowsOf(b, input);
    if (ra.length === 0 || rb.length === 0) continue; // not run by this candidate on one side at all
    const ga = ra.filter(graded);
    const gb = rb.filter(graded);
    if (ga.length === 0 || gb.length === 0) {
      notCompared += 1;
      continue;
    }
    const pa = ga.filter((r) => r.task_outcome === "success").length;
    const pb = gb.filter((r) => r.task_outcome === "success").length;
    const delta = pb / gb.length - pa / ga.length;
    if (delta === 0) continue;
    flips.push({
      candidate,
      input,
      direction: delta > 0 ? "fail-to-pass" : "pass-to-fail",
      a: { pass: pa, n: ga.length },
      b: { pass: pb, n: gb.length },
      cause: causeOf(a, b, ga, gb),
      checkVersion: checkVersions(ga, gb),
    });
  }
  return { flips, notCompared };
}

const slashed = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** Whether a reused trial came from that run (a workflow step's run id is `<run>/<step>`). */
const reusedFromRun = (from: string | null, run: string): boolean => from !== null && (slashed(from) === run || slashed(from).endsWith(`/${run}`));

/** Whether the graded trials on both sides are provably the same answers, provably not, or unknown. */
function causeOf(a: RunSide, b: RunSide, ga: readonly DiffRow[], gb: readonly DiffRow[]): FlipCause {
  const verdicts = gb.map((rb): FlipCause => {
    const ra = ga.find((r) => r.trial === rb.trial);
    if (!ra) return "unknown";
    const fromA = reusedFromRun(rb.reused_from, a.run);
    const sameSource = rb.reused_from !== null && ra.reused_from !== null && slashed(rb.reused_from) === slashed(ra.reused_from);
    if (fromA || sameSource) return "same-answer";
    const oa = a.outputs.get(trialKey(ra.candidate, ra.input, ra.trial));
    const ob = b.outputs.get(trialKey(rb.candidate, rb.input, rb.trial));
    if (oa === undefined || ob === undefined) return "unknown";
    return oa === ob ? "same-answer" : "new-answer";
  });
  if (verdicts.some((v) => v === "new-answer")) return "new-answer";
  if (verdicts.length > 0 && verdicts.every((v) => v === "same-answer")) return "same-answer";
  return "unknown";
}

function checkVersions(ga: readonly DiffRow[], gb: readonly DiffRow[]): { a: string; b: string } | null {
  const versions = (rows: readonly DiffRow[]) => [...new Set(rows.flatMap((r) => Object.values(r.checks).map((c) => c.version)))].sort().join(", ");
  const va = versions(ga);
  const vb = versions(gb);
  return va !== vb ? { a: va, b: vb } : null;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function candidatesOf(s: RunSide): string[] {
  const declared = Object.keys(s.manifest.candidates ?? {});
  return declared.length > 0 ? declared : unionInOrder(s.rates.map((r) => r.candidate), s.rows.map((r) => r.candidate));
}

function unionInOrder(first: readonly string[], second: readonly string[]): string[] {
  return [...new Set([...first, ...second])];
}
