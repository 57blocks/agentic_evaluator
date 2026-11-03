/**
 * `agenteval replay <run>...` — decide finished runs again under the rules
 * the protocol argues against, from the recorded rows only.
 *
 * Two questions per step: would a baseline rule (leaderboard, weighted
 * cost-quality blend, "close enough to the best") have picked a candidate the
 * gates reject? And would the decision move if ungraded checks were blamed on
 * the candidate? Never calls a model and never writes into a run.
 */

import path from "node:path";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { replayRunDir, type StepReplay } from "../../core/replay.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { isWorkflowRun, resolveRunDir, stepRunDirs } from "../run-target.js";

export const REPLAY_HELP = `agenteval replay <run>... [options]

  Decide finished runs again, without calling a model or changing the run:
  - baselines: leaderboard, weighted success − λ·cost, and the cheapest
    candidate within q of the best — each pick checked against the run's
    frozen gates, naming the gate it fails. Quality means task-success
    rate: where candidates tie on it the baselines break the tie on cost,
    while highest-assurance breaks it on the judge
  - ablation: ungraded required checks (evaluator_error, not_evaluated)
    counted as candidate failures, and whether the decision moves

  <run>...            run ids or run directories; a workflow run replays each step
  --json              print the per-step results and totals as JSON
  --workspace DIR     workspace to look run ids up in`;

export interface RuleTally {
  rule: string;
  /** Steps where the rule picked anyone. */
  picked: number;
  /** Of those, steps where the pick fails a gate of the run's own eligibility. */
  failed_gate: number;
}

export interface ReplayTotals {
  steps: number;
  rules: RuleTally[];
  ablation_flipped: number;
}

export function replayTotals(steps: readonly StepReplay[]): ReplayTotals {
  const rules = steps[0]?.baselines.picks.map((p) => p.rule) ?? [];
  return {
    steps: steps.length,
    rules: rules.map((rule) => {
      const picks = steps.flatMap((s) => s.baselines.picks.filter((p) => p.rule === rule && p.chosen !== null));
      return { rule, picked: picks.length, failed_gate: picks.filter((p) => p.failed_gates.length > 0).length };
    }),
    ablation_flipped: steps.filter((s) => s.ablation.flipped).length,
  };
}

const RULE_WIDTH = 20;
const PICK_WIDTH = 22;

const orNone = (c: string | null): string => c ?? "none";

function formatStep(s: StepReplay): string {
  const lines = [`${s.run} · ${s.step} (${s.operating_mode ?? "no operating mode"})`];
  const g = s.baselines.gated;
  lines.push(`  ${"gated (protocol)".padEnd(RULE_WIDTH)}${orNone(g.chosen).padEnd(PICK_WIDTH)}${g.reason ?? ""}`);
  for (const p of s.baselines.picks) {
    const verdict = p.chosen === null
      ? p.reason
      : p.failed_gates.length === 0
        ? "passes the gates"
        : `✗ ${p.failed_gates.map((g) => `${g.gate}: ${g.reason}`).join("; ")}`;
    lines.push(`  ${p.rule.padEnd(RULE_WIDTH)}${orNone(p.chosen).padEnd(PICK_WIDTH)}${verdict}`);
  }
  const a = s.ablation;
  const moved = a.flipped
    ? `decision moved: ${orNone(a.original.chosen)} → ${orNone(a.ablated.chosen)}, eligible [${a.original.eligible.join(", ")}] → [${a.ablated.eligible.join(", ")}]`
    : "decision unchanged";
  lines.push(`  ablation: ${a.changed_trials} ungraded trial(s) counted as failures; ${moved}`);
  return lines.join("\n");
}

function formatTotals(t: ReplayTotals): string {
  const rows = t.rules.map(
    (r) => `  ${r.rule.padEnd(RULE_WIDTH)}picked a gate-failing candidate in ${r.failed_gate} of ${r.picked} step(s) it decided`,
  );
  return [
    `Across ${t.steps} step(s):`,
    ...rows,
    `  ablation moved the decision in ${t.ablation_flipped} of ${t.steps} step(s)`,
  ].join("\n");
}

async function stepDirsOf(ws: Awaited<ReturnType<typeof findWorkspace>>, target: string): Promise<string[]> {
  const runDir = await resolveRunDir(ws, target);
  return (await isWorkflowRun(runDir)) ? stepRunDirs(runDir) : [runDir];
}

export async function cmdReplay(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["json", "workspace"]);
  if (args.positional.length === 0) throw new UsageError("which run? (try `agenteval ls`)");

  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();

  const dirs = (await Promise.all(args.positional.map((t) => stepDirsOf(ws, t)))).flat();
  const steps: StepReplay[] = [];
  for (const d of dirs) {
    try {
      steps.push(await replayRunDir(d));
    } catch (err: unknown) {
      const why = err instanceof Error ? err.message : String(err);
      throw new UsageError(`cannot replay ${path.basename(d)}: ${why}`);
    }
  }
  const totals = replayTotals(steps);

  if (args.flags.json) {
    io.out(`${JSON.stringify({ steps, totals }, null, 2)}\n`);
    return EXIT.ok;
  }
  io.out(`${[...steps.map(formatStep), formatTotals(totals)].join("\n\n")}\n`);
  return EXIT.ok;
}
