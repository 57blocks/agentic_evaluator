/**
 * Early stop: stop running a candidate once a declared gate is out of its
 * reach.
 *
 * Arithmetic, not statistics. Given what a candidate has done and how many of
 * its planned trials are left, assume every remaining trial succeeds; if a
 * gate still cannot be met, the selector would remove it whatever happened
 * next, so the rest of its trials are spent on nothing. With a gate of 1.0
 * that is "stop at the first failure". No guess about the future is made, so
 * stopping never changes who is eligible or who is chosen.
 *
 * What it does cost: a stopped candidate has no rows on later inputs. Its
 * rates are over what it ran, and the per-input views (effective N, inputs
 * every candidate failed) see fewer candidates there. GAPS.md says so.
 */

import type { TrialRow } from "./rows.js";
import { INFRA_COMPLETION_STATES } from "./states.js";
import type { EligibilityThresholds } from "./types.js";

export interface StoppedCandidate {
  candidate: string;
  /** Trials it had finished when it was stopped. */
  after_trials: number;
  /** Planned trials it never ran. */
  skipped: number;
  reason: string;
}

export interface EarlyStopRecord {
  enabled: boolean;
  stopped: StoppedCandidate[];
}

export interface Plan {
  /** Planned trials for this candidate on this step. */
  trials: number;
  /** Planned inputs. */
  inputs: number;
}

const EPS = 1e-12;

const fmt = (x: number): string => x.toFixed(3);

/**
 * The first gate `own` can no longer reach with `remaining` trials left, as a
 * sentence; null while every gate is still reachable. `own` are the
 * candidate's rows so far.
 */
export function unreachableGate(own: readonly TrialRow[], plan: Plan, e: EligibilityThresholds): string | null {
  const remaining = Math.max(0, plan.trials - own.length);

  if (e.minimum_required_check_pass_rate !== null) {
    const cells = own.flatMap((r) => Object.values(r.checks));
    const pass = cells.filter((c) => c.state === "pass").length;
    const fail = cells.filter((c) => c.state === "fail").length;
    const best = (pass + remaining) / (pass + fail + remaining);
    if (fail > 0 && best + EPS < e.minimum_required_check_pass_rate) {
      return `required-check pass rate can reach at most ${fmt(best)} (${fail} failed), below the gate ${e.minimum_required_check_pass_rate}`;
    }
  }

  if (e.minimum_reliability !== null) {
    const counted = own.filter((r) => !INFRA_COMPLETION_STATES.has(r.completion_state));
    const success = counted.filter((r) => r.task_outcome === "success").length;
    const failed = counted.length - success;
    const best = (success + remaining) / (counted.length + remaining);
    if (failed > 0 && best + EPS < e.minimum_reliability) {
      return `reliability can reach at most ${fmt(best)} (${failed} failed), below the gate ${e.minimum_reliability}`;
    }
  }

  if (e.minimum_all_trials_pass_rate !== null && plan.inputs > 0) {
    const failedInputs = new Set(own.filter((r) => r.task_outcome === "failure").map((r) => r.input)).size;
    const best = (plan.inputs - failedInputs) / plan.inputs;
    if (failedInputs > 0 && best + EPS < e.minimum_all_trials_pass_rate) {
      return `pass^k can reach at most ${fmt(best)} (${failedInputs} input(s) failed), below the gate ${e.minimum_all_trials_pass_rate}`;
    }
  }
  return null;
}

/** GAPS.md lines; empty when early stop was off or stopped nobody. */
export function earlyStopGaps(r: EarlyStopRecord | undefined): string[] {
  if (!r?.enabled || r.stopped.length === 0) return [];
  const who = r.stopped.map((s) => `${s.candidate} after ${s.after_trials} trial(s), ${s.skipped} not run (${s.reason})`);
  return [
    `- **early stop**: ${who.join("; ")}. Their rates cover only the trials they ran, and on later inputs effective N and "every candidate failed" are computed without them.`,
  ];
}
