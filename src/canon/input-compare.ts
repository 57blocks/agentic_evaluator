/**
 * One run, input by input: for each input, each candidate's required-check
 * passes k/n and the check's measures (per-input means), with every trial's
 * note — what the check said, as `agenteval diff` prints it (run-diff.ts).
 * A diff compares two runs on one candidate; this compares candidates within
 * one run, so the "flip" here is an input the candidates disagree on.
 *
 * Inputs where the candidates' pass rates differ come first, widest spread
 * first; the rest follow by name. Measures do not decide the order: they
 * differ on nearly every input.
 *
 * Pure: no fs.
 */

import { inputMeans } from "./measures.js";
import type { TrialRow } from "./rows.js";
import { trialNote, type TrialNote } from "./run-diff.js";

export interface CompareCell {
  candidate: string;
  /** Trials whose required check passed / was graded (pass or fail). */
  pass: number;
  graded: number;
  /** Each measure's mean over this input's graded trials. */
  measures: Record<string, number>;
  /** Every trial on this input, graded or not, by trial number. */
  trials: Array<TrialNote & { completion: TrialRow["completion_state"] }>;
}

export interface CompareRow {
  input: string;
  /** At least two candidates were graded here and their pass rates differ. */
  differs: boolean;
  /** Highest pass rate minus lowest, over the graded candidates; 0 when fewer than two. */
  spread: number;
  /** In the order of `candidates`. */
  cells: CompareCell[];
}

const GRADED = new Set(["pass", "fail"]);

function cellOf(trials: readonly TrialRow[], candidate: string, input: string): CompareCell {
  const own = trials.filter((t) => t.candidate === candidate && t.input === input).sort((a, b) => a.trial - b.trial);
  const states = own.flatMap((t) => Object.values(t.checks ?? {}).map((c) => c.state));
  const measures = Object.fromEntries([...inputMeans(own, candidate)].sort(([a], [b]) => a.localeCompare(b)).map(([name, byInput]) => [name, byInput.get(input)!.mean]));
  return {
    candidate,
    pass: states.filter((s) => s === "pass").length,
    graded: states.filter((s) => GRADED.has(s)).length,
    measures,
    trials: own.map((t) => ({ ...trialNote(t), completion: t.completion_state })),
  };
}

export function inputComparison(trials: readonly TrialRow[], candidates: readonly string[]): CompareRow[] {
  const inputs = [...new Set(trials.map((t) => t.input))].sort((a, b) => a.localeCompare(b));
  const rows = inputs.map((input): CompareRow => {
    const cells = candidates.map((c) => cellOf(trials, c, input));
    const rates = cells.filter((c) => c.graded > 0).map((c) => c.pass / c.graded);
    const spread = rates.length < 2 ? 0 : Math.max(...rates) - Math.min(...rates);
    return { input, differs: spread > 0, spread, cells };
  });
  // Stable: equal keys keep the name order above.
  return rows.sort((a, b) => Number(b.differs) - Number(a.differs) || b.spread - a.spread);
}
