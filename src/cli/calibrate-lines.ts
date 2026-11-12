/**
 * A judge calibration (src/canon/judge-calibration.ts) as terminal lines.
 * Worded as what the score does, never as the judge being right or wrong:
 * the labels are one review, and the judge may have been asked something
 * else (a rubric that grades the explanation, not the answer).
 */

import { MIN_LABELS_PER_SIDE, TOP_SCORE, type CalibrationVerdict, type JudgeCalibration, type MeasureCalibration, type ScoreDistribution } from "../canon/judge-calibration.js";

const VERDICT: Record<CalibrationVerdict, string> = {
  separates: "separates right from wrong",
  "does-not-separate": "does not separate right from wrong",
  backwards: "does not separate; if anything, wrong answers score higher",
  "too-few": `too few labels to say (needs ${MIN_LABELS_PER_SIDE}+ on each side)`,
};

export interface CalibrateContext {
  run: string;
  step: string;
  labelsFile: string;
  judge: string | null;
  rubric: string | null;
}

const num = (v: number | null, digits = 2): string => (v === null ? "—" : v.toFixed(digits));
const side = (d: ScoreDistribution): string => `${d.n} · ${num(d.mean)}`;
const counts = (d: ScoreDistribution): string => Object.entries(d.counts).map(([s, n]) => `${s}:${n}`).join(" ") || "—";

function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => `  ${r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join("  ")}`.trimEnd());
}

function measureTable(measures: readonly MeasureCalibration[]): string[] {
  const head = ["score", "right (n · mean)", "wrong (n · mean)", "AUC [95%]", `wrong at ${TOP_SCORE}`, ""];
  const rows = measures.map((m) => [
    m.measure,
    side(m.right),
    side(m.wrong),
    m.auc === null ? "—" : `${num(m.auc)} [${num(m.interval?.low ?? null)}–${num(m.interval?.high ?? null)}]`,
    `${m.wrongAtTop} of ${m.wrong.n}`,
    VERDICT[m.verdict],
  ]);
  return table([head, ...rows]);
}

function checkLine(c: JudgeCalibration): string {
  const total = c.check.agree + c.check.disagree;
  if (total === 0) return "against the check: no labelled answer was graded by a check";
  if (c.check.disagree === 0) {
    return `against the check: the labels agree with it on all ${total} answers — they are the check's verdicts, so this measures the judge against the check`;
  }
  return `against the check: the labels overrule it on ${c.check.disagree} of ${total} answers`;
}

export function calibrateLines(c: JudgeCalibration, ctx: CalibrateContext): string[] {
  const unmatched = c.unmatched.length > 0 ? `; ${c.unmatched.length} with no row in this run (first: ${c.unmatched[0]!.candidate} on ${c.unmatched[0]!.input})` : "";
  const unscored = Math.max(...c.measures.map((m) => m.unscored), 0);
  const groups = c.groups.length > 0
    ? ["", "by group (overall score)", ...measureTable(c.groups.map((g) => ({ ...g.measures[0]!, measure: g.group })))]
    : [];
  return [
    `calibrate ${ctx.run} (step ${ctx.step})`,
    `judge ${ctx.judge ?? "(unrecorded)"} · rubric ${ctx.rubric ?? "(unrecorded)"} · labels ${ctx.labelsFile}`,
    "",
    `labels: ${c.matched} of ${c.labels} matched${unmatched}; ${c.noAnswer} with no answer to score${unscored > 0 ? `; up to ${unscored} answer(s) the judge left unscored` : ""}`,
    checkLine(c),
    "",
    ...measureTable(c.measures),
    "",
    "scores given",
    ...table(c.measures.map((m) => [m.measure, `right ${counts(m.right)}`, `| wrong ${counts(m.wrong)}`])),
    ...groups,
  ];
}
