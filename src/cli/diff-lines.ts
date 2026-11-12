/**
 * A run diff (src/canon/run-diff.ts) as terminal lines: what changed in the
 * setup, then whether the conclusion moved, who crossed a gate, how each
 * rate moved, and which shared inputs flipped and why.
 */

import type { Count, Flip, GateStatus, RateChange, RateWithInterval, RunDiff } from "../canon/run-diff.js";

const CAUSE: Record<Flip["cause"], string> = {
  "same-answer": "same answer, graded differently",
  "new-answer": "new answer",
  unknown: "answer not kept, cause unknown",
};

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

function gateMove(a: GateStatus, b: GateStatus): string {
  if (a.state === "unrecorded" || b.state === "unrecorded") return "not recorded";
  if (a.state === "absent") return b.state === "in" ? "new, in" : "new, out";
  if (b.state === "absent") return "dropped";
  if (a.state === b.state) return a.state === "in" ? "stayed in" : "stayed out";
  return b.state === "in" ? "ENTERED" : "LEFT";
}

function gateLines(d: RunDiff): string[] {
  const order = ["LEFT", "ENTERED", "new, in", "new, out", "dropped", "stayed out", "stayed in", "not recorded"];
  const rows = d.gates
    .map((g) => ({ g, move: gateMove(g.a, g.b) }))
    .sort((x, y) => order.indexOf(x.move) - order.indexOf(y.move))
    .map(({ g, move }) => {
      const out = g.b.state === "out" ? g.b : g.a.state === "out" ? g.a : null;
      return [move, g.candidate, out && "reason" in out && out.reason ? out.reason : ""];
    });
  return ["gates", ...table(rows)];
}

function rateLines(d: RunDiff): string[] {
  const head = ["candidate", "before", "after", "shared inputs", "after, not shared", "before, not shared"];
  const row = (r: RateChange) => [r.candidate, rateText(r.a), rateText(r.b), `${frac(r.shared.a)} → ${frac(r.shared.b)}`, frac(r.onlyB), frac(r.onlyA)];
  return ["task success rate, as recorded [95% interval]", ...table([head, ...d.rates.map(row)])];
}

function flipLines(d: RunDiff): string[] {
  if (d.inputs.shared === 0) return ["flips: no shared inputs to compare"];
  const groups = new Map<string, Flip[]>();
  for (const f of d.flips) {
    const key = `${f.candidate}\0${f.direction}\0${f.cause}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const lines = [...groups.values()].map((fs) => {
    const f = fs[0]!;
    const dir = f.direction === "fail-to-pass" ? "fail → pass" : "pass → fail";
    // A check version change the whole run shares is said once, above.
    const runWide = d.setup.find((s) => s.what === "check version");
    const own = fs.flatMap((x) => (x.checkVersion && !(runWide && x.checkVersion.a === runWide.a && x.checkVersion.b === runWide.b) ? [`check ${x.checkVersion.a} → ${x.checkVersion.b}`] : []));
    const versions = [...new Set(own)];
    const why = [CAUSE[f.cause], ...versions].join("; ");
    return `  ${f.candidate}  ${dir} ×${fs.length}  ${fs.map((x) => x.input).join(", ")}  — ${why}`;
  });
  const none = d.flips.length === 0 ? ["  none: every shared input kept its outcome"] : [];
  const skipped = d.notCompared > 0 ? [`  ${d.notCompared} candidate × input pair(s) not compared: not run or not graded on one side`] : [];
  return [`flips on the ${d.inputs.shared} shared input(s)`, ...lines, ...none, ...skipped];
}

export function diffLines(d: RunDiff): string[] {
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
    ...flipLines(d),
  ];
}
