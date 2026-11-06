/**
 * Provider-error halt: stop a run that is only producing provider errors.
 *
 * A provider error (`INFRA_COMPLETION_STATES`) is a trial the candidate never
 * got: the transport or the gateway failed after retries. One is noise. Ten
 * in a row, across candidates, means the network is gone — the outage gate
 * (src/transport-gate.ts) has already waited as long as it was allowed — and
 * every further trial would burn wall-clock and budget to record the same
 * nothing. The halt counts consecutive provider errors over the whole step;
 * any completed call of another kind resets it. Once tripped, nothing new is
 * started: in-flight calls finish and are recorded, every unit not started
 * is counted by kind, and the run is partial (GAPS.md, exit 3), exactly like
 * a budget stop. `run --reuse` then picks up the trials that never ran.
 *
 * A check failure, a timeout, a refusal or an empty completion is a
 * candidate's result and never counts here — or a weak candidate could halt
 * a run.
 */

import type { CompletionState } from "./types.js";

export const DEFAULT_MAX_CONSECUTIVE_PROVIDER_ERRORS = 10;

export interface HaltState {
  /** Consecutive provider errors that trip the halt; null when the halt is off. */
  max_consecutive_provider_errors: number | null;
  /** The longest run of consecutive provider errors seen. */
  longest_provider_error_run: number;
  /** True once the halt tripped. */
  stopped: boolean;
  /** Units not started because of it, by kind. */
  skipped: { generation: number; judging: number; scoring: number };
}

export type HaltUnit = keyof HaltState["skipped"];

export class ProviderErrorHalt {
  private consecutive = 0;
  private longest = 0;
  private stopped = false;
  private readonly skipped = { generation: 0, judging: 0, scoring: 0 };

  /** `null` turns the halt off. */
  constructor(private readonly maxConsecutive: number | null = DEFAULT_MAX_CONSECUTIVE_PROVIDER_ERRORS) {}

  /** Count a finished call: a completion state, or whether an evaluator call hit the transport. */
  record(outcome: CompletionState | "provider_error" | "answered"): void {
    if (outcome !== "provider_error") {
      this.consecutive = 0;
      return;
    }
    this.consecutive += 1;
    this.longest = Math.max(this.longest, this.consecutive);
    if (this.maxConsecutive !== null && this.consecutive >= this.maxConsecutive) this.stopped = true;
  }

  /** True while another unit of this kind may start; counts the refusal. */
  allows(unit: HaltUnit): boolean {
    if (!this.stopped) return true;
    this.skipped[unit] += 1;
    return false;
  }

  get tripped(): boolean {
    return this.stopped;
  }

  state(): HaltState {
    return {
      max_consecutive_provider_errors: this.maxConsecutive,
      longest_provider_error_run: this.longest,
      stopped: this.stopped,
      skipped: { ...this.skipped },
    };
  }
}

/** One GAPS.md line when the halt tripped; null when it did not. */
export function haltGap(state: HaltState): string | null {
  if (!state.stopped) return null;
  const { generation, judging, scoring } = state.skipped;
  return (
    `- **provider errors halted the run**: ${state.longest_provider_error_run} consecutive calls failed at the transport or the gateway (limit ${state.max_consecutive_provider_errors}); ` +
    `${generation} generation(s), ${judging} judgement(s) and ${scoring} scoring call(s) were never started. ` +
    "Provider errors sit outside every candidate's denominators, so no rate below is wrong, but the run is partial — fix the network or the endpoint and `run --reuse` to finish it."
  );
}
