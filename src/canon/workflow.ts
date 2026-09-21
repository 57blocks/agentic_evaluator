/**
 * Workflow-level record (protocol §12) — the run object above the steps.
 *
 * A multi-step run writes one of these at `runs/<runId>/workflow.json`. It is
 * the only place three things exist: the whole-workflow cost (every step's six
 * components plus both end-to-end arms), the §8 validation verdict in context,
 * and the gaps of the run as a whole. Everything here is derived, so the
 * builder is pure and the writer in `run.ts` only hands it what it already has.
 *
 * Field names kept from the first workflow.json (run_name, handoff, steps[].dir,
 * e2e_control) so existing readers — the demo catalog — keep working.
 */

import type { CostLedger } from "./cost.js";
import type { E2eValidation, StepAssignment } from "./e2e.js";
import type { CostSource } from "./types.js";
import { mergeCostSource } from "./usage.js";

export interface WorkflowStepInput {
  id: string;
  dir: string;
  operatingMode: string | null;
  chosen: string | null;
  firmness: string;
  eligible: readonly string[];
  gated: readonly { candidate: string; reason: string }[];
  trials: number;
  ledger: CostLedger;
  /** The step's GAPS.md, so the workflow gaps can carry what it says. */
  gaps: string;
}

export interface WorkflowStepRecord {
  id: string;
  dir: string;
  operating_mode: string | null;
  chosen: string | null;
  firmness: string;
  eligible: string[];
  gated: { candidate: string; reason: string }[];
  trials: number;
  ledger_total: number;
  ledger: CostLedger;
}

/** Arm totals as the workflow page shows them; the full arm file stays on disk. */
export interface WorkflowArm {
  kind: "control" | "proposed";
  candidate?: string;
  assignment?: StepAssignment;
  chain?: string[];
  cases: number;
  success: number;
  failure: number;
  undetermined: number;
  cost_usd: number;
}

/**
 * Total system cost (protocol §3): the steps' independent evaluation plus the
 * end-to-end arms. Arm cost is kept separate because those trials are extra
 * generations, not a re-count of the step evidence.
 */
export interface WorkflowLedger {
  generation: number;
  judging: number;
  scoring: number;
  checks: number;
  retries: number;
  steps_total: number;
  e2e_total: number;
  total: number;
  source: CostSource;
}

export interface WorkflowRecord {
  protocol_version: string;
  run_id: string;
  run_name: string;
  /** True when the steps are chained by `input_from` and the arms ran. */
  handoff: boolean;
  steps: WorkflowStepRecord[];
  ledger: WorkflowLedger;
  e2e_control: WorkflowArm | null;
  e2e_proposed: WorkflowArm | null;
  e2e_validation: E2eValidation | null;
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function workflowLedger(
  steps: readonly { ledger: CostLedger }[],
  arms: readonly WorkflowArm[],
): WorkflowLedger {
  const sum = (pick: (l: CostLedger) => number): number =>
    round(steps.reduce((s, x) => s + pick(x.ledger), 0));
  const stepsTotal = sum((l) => l.total);
  const e2eTotal = round(arms.reduce((s, a) => s + a.cost_usd, 0));
  return {
    generation: sum((l) => l.generation),
    judging: sum((l) => l.judging),
    scoring: sum((l) => l.scoring),
    checks: sum((l) => l.checks),
    retries: sum((l) => l.retries),
    steps_total: stepsTotal,
    e2e_total: e2eTotal,
    total: round(stepsTotal + e2eTotal),
    source: mergeCostSource(steps.map((s) => s.ledger.source)),
  };
}

export function buildWorkflowRecord(input: {
  protocolVersion: string;
  runId: string;
  runName: string;
  steps: readonly WorkflowStepInput[];
  control: WorkflowArm | null;
  proposed: WorkflowArm | null;
  validation: E2eValidation | null;
}): WorkflowRecord {
  const steps: WorkflowStepRecord[] = input.steps.map((s) => ({
    id: s.id,
    dir: s.dir,
    operating_mode: s.operatingMode,
    chosen: s.chosen,
    firmness: s.firmness,
    eligible: [...s.eligible],
    gated: s.gated.map((g) => ({ ...g })),
    trials: s.trials,
    ledger_total: s.ledger.total,
    ledger: s.ledger,
  }));
  const arms = [input.control, input.proposed].filter((a): a is WorkflowArm => a !== null);
  return {
    protocol_version: input.protocolVersion,
    run_id: input.runId,
    run_name: input.runName,
    handoff: input.control !== null,
    steps,
    ledger: workflowLedger(input.steps, arms),
    e2e_control: input.control,
    e2e_proposed: input.proposed,
    e2e_validation: input.validation,
  };
}

/** Bullet lines of a GAPS.md, without the leading marker. */
function bulletsOf(gaps: string): string[] {
  return gaps
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter((l) => l !== "");
}

/**
 * Workflow GAPS.md: what every step could not observe (stated once), what only
 * some steps could not (attributed), and the §8 comparisons this run did not
 * make. Without this, a reader who opens the workflow page never sees the
 * step-level gaps at all.
 */
export function workflowGaps(
  steps: readonly { id: string; gaps: string }[],
  validation: E2eValidation | null,
): string {
  const perStep = steps.map((s) => ({ id: s.id, bullets: bulletsOf(s.gaps) }));
  const counts = new Map<string, number>();
  for (const s of perStep) {
    for (const b of new Set(s.bullets)) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const shared = [...counts.entries()].filter(([, n]) => n === perStep.length).map(([b]) => b);
  const sharedSet = new Set(shared);

  const lines = [
    "# GAPS — what this workflow run could not observe",
    "",
    "Collected from every step plus the end-to-end pass. Each step directory keeps its own GAPS.md.",
    "",
  ];
  if (shared.length > 0) {
    lines.push("## Every step", "");
    for (const b of shared) lines.push(`- ${b}`);
    lines.push("");
  }
  const attributed = perStep
    .map((s) => ({ id: s.id, bullets: [...new Set(s.bullets)].filter((b) => !sharedSet.has(b)) }))
    .filter((s) => s.bullets.length > 0);
  if (attributed.length > 0) {
    lines.push("## Individual steps", "");
    for (const s of attributed) for (const b of s.bullets) lines.push(`- \`${s.id}\`: ${b}`);
    lines.push("");
  }
  lines.push("## End to end", "");
  if (validation === null) {
    lines.push(
      "- no end-to-end validation: the steps are independent (no `input_from`), so no workflow was assembled or compared.",
    );
  } else {
    lines.push(`- verdict \`${validation.verdict}\` is ${validation.firmness}; rule ${validation.rule_version ?? "unrecorded"}.`);
    for (const n of validation.not_compared ?? []) lines.push(`- not compared: ${n}`);
  }
  return lines.join("\n") + "\n";
}
