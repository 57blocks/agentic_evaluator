/**
 * Reading a run's evidence files.
 *
 * The protocol's own distinctions are what these types preserve: an
 * evaluator that crashed is not a candidate that failed, and a trial that
 * completed is not a task that succeeded. Both axes are kept separate here
 * so the UI can never collapse them by accident.
 */

import type { RunView } from "../catalog.js";

/** Protocol §5: what happened to the candidate's attempt. */
export const COMPLETION_STATES = [
  "success", "refusal", "timeout", "malformed", "cancelled", "provider_error",
] as const;

/** Protocol §5: whether the task was actually done. */
export const TASK_OUTCOMES = ["success", "failure", "undetermined"] as const;

/** Protocol §5: what happened to the evaluator, never blamed on the candidate. */
export const EVALUATION_STATES = ["pass", "fail", "not_evaluated", "evaluator_error"] as const;

export type CompletionState = (typeof COMPLETION_STATES)[number];
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

export interface TrialRow {
  step: string;
  candidate: string;
  input: string;
  trial: number;
  completion_state: string;
  task_outcome: string;
  outcome_reasons?: string[];
  cost_usd?: number;
}

export interface EvaluationRow {
  step?: string;
  evaluator_id?: string;
  candidate?: string;
  input?: string;
  state: string;
  reason?: string;
}

/** Every step's copy of `name`, tagged with the step it came from. */
export async function readJsonl<T>(run: RunView, name: string): Promise<T[]> {
  const perStep = await Promise.all(
    run.steps.map(async (step) => {
      try {
        const res = await fetch(`/artifact/${step.dir}/${name}`);
        if (!res.ok) return [];
        return (await res.text())
          .split("\n")
          .filter((l) => l.trim() !== "")
          .flatMap((l) => {
            try {
              return [{ step: step.id, ...(JSON.parse(l) as object) } as T];
            } catch {
              return [];
            }
          });
      } catch {
        return [];
      }
    }),
  );
  return perStep.flat();
}

/** First step that has `name`, as text. GAPS.md and the like. */
export async function readText(run: RunView, name: string): Promise<string> {
  for (const step of run.steps) {
    try {
      const res = await fetch(`/artifact/${step.dir}/${name}`);
      if (res.ok) return await res.text();
    } catch {
      // Try the next step.
    }
  }
  return "";
}

export interface MatrixCell {
  completion: string;
  outcome: string;
  rows: TrialRow[];
}

/**
 * completion_state × task_outcome, keeping only the rows that occurred.
 *
 * An empty cell and a zero cell mean the same thing here, so only observed
 * combinations get a column — a full 6×3 grid of mostly zeroes hides the
 * two or three cells that carry the story.
 */
export function failureMatrix(rows: readonly TrialRow[]): {
  completions: string[];
  outcomes: string[];
  cell: (c: string, o: string) => TrialRow[];
  total: number;
} {
  const seenC = new Set(rows.map((r) => r.completion_state));
  const seenO = new Set(rows.map((r) => r.task_outcome));
  const completions = COMPLETION_STATES.filter((c) => seenC.has(c));
  const outcomes = TASK_OUTCOMES.filter((o) => seenO.has(o));
  return {
    completions: [...completions],
    outcomes: [...outcomes],
    cell: (c, o) => rows.filter((r) => r.completion_state === c && r.task_outcome === o),
    total: rows.length,
  };
}

/**
 * A trial that completed but whose task outcome is not a success is the row
 * worth reading: the candidate answered, and the answer did not hold up.
 */
export function isQuietFailure(row: TrialRow): boolean {
  return row.completion_state === "success" && row.task_outcome !== "success";
}
