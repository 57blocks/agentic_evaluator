/**
 * A run diff (src/canon/run-diff.ts) as terminal lines: what changed in the
 * setup, then whether the conclusion moved, who crossed a gate, how each
 * rate moved, and which shared inputs flipped and why.
 */

import type { Count, RateChange, RateWithInterval, RunDiff } from "../canon/run-diff.js";

const pct = (v: number | null): string => (v === null ? "—" : v.toFixed(2));
const frac = (c: Count | null): string => (c === null || c.denominator === 0 ? "—" : `${c.numerator}/${c.denominator}`);

function rateText(r: RateWithInterval | null): string {
  if (r === null) return "absent";
  if (r.denominator === 0) return "0/0";
  return `${r.numerator}/${r.denominator} ${pct(r.value)} [${pct(r.low)}–${pct(r.high)}]`;
}

function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => `  ${r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join("  ")}`.trimEnd());
}

function setupLines(d: RunDiff): string[] {
  const { shared, added, removed, changed } = d.inputs;
  const parts = [`${shared} shared`, added.length ? `+${added.length} new` : "", removed.length ? `−${removed.length} dropped` : "", changed.length ? `${changed.length} changed content (${changed.join(", ")})` : ""].filter(Boolean);
  const rows = [["inputs", parts.join(", ")], ...d.setup.map((s) => [s.what, `${s.a || "—"} → ${s.b || "—"}`])];
  return ["changed between the runs", ...table(rows)];
}

function recommendationLine(d: RunDiff): string {
  const show = (r: { chosen: string | null; firmness: string | null } | null) => (r === null ? "not recorded" : `${r.chosen ?? "none"}${r.firmness ? ` (${r.firmness})` : ""}`);
  const { a, b, changed } = d.recommendation;
  if (a === null || b === null) return `recommendation: ${show(a)} → ${show(b)} (a run without recommendation.json cannot be compared)`;
  return changed ? `recommendation CHANGED: ${show(a)} → ${show(b)}` : `recommendation unchanged: ${show(b)}`;
}

/** The reason a candidate is out, from whichever run had it out (the later one first). */
export function gateReason(g: RunDiff["gates"][number]): string {
  const out = g.b.state === "out" ? g.b : g.a.state === "out" ? g.a : null;
  return out && "reason" in out && out.reason ? out.reason : "";
}

function gateLines(d: RunDiff): string[] {
  return ["gates", ...table(d.gates.map((g) => [g.move, g.candidate, gateReason(g)]))];
}

function rateLines(d: RunDiff): string[] {
  const head = ["candidate", "before", "after", "shared inputs", "after, not shared", "before, not shared"];
  const row = (r: RateChange) => [r.candidate, rateText(r.a), rateText(r.b), `${frac(r.shared.a)} → ${frac(r.shared.b)}`, frac(r.onlyB), frac(r.onlyA)];
  return ["task success rate, as recorded [95% interval]", ...table([head, ...d.rates.map(row)])];
}

/** Per flipped input and trial, what the check said before and after (`--why`). */
function whyLines(d: RunDiff, g: RunDiff["flipGroups"][number]): string[] {
  const flips = d.flips.filter((f) => f.candidate === g.candidate && f.direction === g.direction && f.cause === g.cause);
  return flips.flatMap((f) => {
    const trials = [...new Set([...f.trials.a, ...f.trials.b].map((t) => t.trial))].sort((x, y) => x - y);
    return trials.map((t) => {
      const side = (notes: typeof f.trials.a) => notes.find((n) => n.trial === t)?.summary ?? "—";
      return `      ${f.input} t${t}: before ${side(f.trials.a)} | after ${side(f.trials.b)}`;
    });
  });
}

function flipLines(d: RunDiff, why: boolean): string[] {
  if (d.inputs.shared === 0) return ["flips: no shared inputs to compare"];
  const lines = d.flipGroups.flatMap((g) => {
    const dir = g.direction === "fail-to-pass" ? "fail → pass" : "pass → fail";
    const cause = [g.causeText, ...g.checkVersions.map((v) => `check ${v}`)].join("; ");
    return [`  ${g.candidate}  ${dir} ×${g.inputs.length}  ${g.inputs.join(", ")}  — ${cause}`, ...(why ? whyLines(d, g) : [])];
  });
  const none = d.flips.length === 0 ? ["  none: every shared input kept its outcome"] : [];
  const skipped = d.notCompared > 0 ? [`  ${d.notCompared} candidate × input pair(s) not compared: not run or not graded on one side`] : [];
  return [`flips on the ${d.inputs.shared} shared input(s)`, ...lines, ...none, ...skipped];
}

export function diffLines(d: RunDiff, opts: { why?: boolean } = {}): string[] {
  const steps = d.a.step === d.b.step ? `step ${d.a.step}` : `steps ${d.a.step} → ${d.b.step}`;
  return [
    `diff ${d.a.run} → ${d.b.run} (${steps})`,
    "",
    recommendationLine(d),
    "",
    ...setupLines(d),
    "",
    ...gateLines(d),
    "",
    ...rateLines(d),
    "",
    ...flipLines(d, opts.why === true),
  ];
}
