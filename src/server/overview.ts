/**
 * The cross-run view: one row per step, from whichever run produced it last.
 *
 * This is the one thing `dashboard.ts` did that no canonical page could —
 * scan the whole workspace and keep the newest run per step — and it is the
 * first half of the legacy renderer's retirement gate.
 *
 * It leads with what has **not** been measured. A task that was defined and
 * never run, and a step whose latest run could not choose anybody, are the
 * two ways this workspace can be quietly telling you nothing while looking
 * busy. A listing that shows only the steps with answers turns both of them
 * into blank space, and blank space reads as "fine".
 */

import { listTasks } from "../demo/catalog.js";
import type { RunView, TaskView } from "../demo/catalog.js";
import type { Workspace } from "../core/workspace.js";

export interface StepStanding {
  step: string;
  /** Task that owns the run, or null for a legacy top-level run. */
  task: string | null;
  runId: string;
  startedAt: string | null;
  chosen: string | null;
  firmness: string;
  operatingMode: string | null;
  eligible: string[];
  gated: Array<{ candidate: string; reason: string }>;
  ledgerTotal: number | null;
  /** Every candidate was a scripted stand-in: a smoke run, not evidence. */
  synthetic: boolean;
}

export interface Unobserved {
  /** Defined, never run. Not "0 runs" — nothing was asked of it. */
  tasksNeverRun: string[];
  /** Ran, and could not choose: eligibility removed everyone, or nobody qualified. */
  stepsWithNoChoice: Array<{ step: string; task: string | null; runId: string }>;
}

export interface Overview {
  workspace: string;
  tasks: { total: number; run: number };
  spend: { totalUsd: number | null; runs: number };
  /** Newest run per step id, newest first. */
  steps: StepStanding[];
  unobserved: Unobserved;
}

function standingsOf(task: TaskView | null, run: RunView): StepStanding[] {
  return run.steps.map((step) => ({
    step: step.id,
    task: task?.name ?? run.task,
    runId: run.id,
    startedAt: run.startedAt,
    chosen: step.chosen,
    firmness: step.firmness,
    operatingMode: step.operatingMode,
    // Who cleared the eligibility gate, and who was removed and why. The
    // gated list is the half a ranking table drops, and it is usually the
    // half that explains the ranking.
    eligible: [...step.eligible],
    gated: step.gated.map((g) => ({ ...g })),
    ledgerTotal: step.ledgerTotal,
    synthetic: run.synthetic,
  }));
}

export async function buildOverview(ws: Workspace): Promise<Overview> {
  const { tasks, unfiled } = await listTasks({ ws });

  // Committed fixtures ship with the harness as samples. They are somebody
  // else's evidence, and counting them here would answer "what has this
  // workspace measured" with the tool's own demo data — and could let a
  // sample outrank a real run for a step of the same name. Legacy top-level
  // runs are not samples and do belong.
  const local = unfiled.filter((run) => !run.sample);

  // Newest run wins per step id, no matter which task produced it.
  const newest = new Map<string, StepStanding>();
  const consider = (standing: StepStanding): void => {
    const held = newest.get(standing.step);
    if (held && (held.startedAt ?? "") >= (standing.startedAt ?? "")) return;
    newest.set(standing.step, standing);
  };
  for (const task of tasks) for (const run of task.runs) for (const s of standingsOf(task, run)) consider(s);
  for (const run of local) for (const s of standingsOf(null, run)) consider(s);

  const everyRun = [...tasks.flatMap((t) => t.runs), ...local];
  const spent = everyRun.reduce<number | null>(
    (acc, r) => (r.totalUsd === null ? acc : (acc ?? 0) + r.totalUsd),
    null,
  );

  const steps = [...newest.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  return {
    workspace: ws.root,
    tasks: { total: tasks.length, run: tasks.filter((t) => t.runs.length > 0).length },
    spend: { totalUsd: spent, runs: everyRun.length },
    steps,
    unobserved: {
      tasksNeverRun: tasks.filter((t) => t.runs.length === 0).map((t) => t.name),
      stepsWithNoChoice: steps
        .filter((s) => s.chosen === null)
        .map((s) => ({ step: s.step, task: s.task, runId: s.runId })),
    },
  };
}
