/**
 * Run halt: stop a run that is only producing calls nobody answered.
 *
 * A provider error (`INFRA_COMPLETION_STATES`) is a trial the candidate never
 * got: the transport or the gateway failed after retries. One is noise. Ten
 * in a row, across candidates, means the network is gone — the outage gate
 * (src/transport-gate.ts) has already waited as long as it was allowed — and
 * every further trial would burn wall-clock and budget to record the same
 * nothing. The halt counts consecutive provider errors over the whole step;
 * any completed call of another kind resets it.
 *
 * A network that hangs instead of failing shows up as timeouts, not provider
 * errors, and each one holds a slot for the full time limit. A timeout is
 * also a candidate's own result, though: a slow model times out on its own,
 * and that must never halt a run. So timeouts trip the halt only when the
 * streak of unanswered calls (timeouts and provider errors, nothing else in
 * between) reaches its limit *and* at least two candidates timed out in it —
 * one slow model cannot do that, even beside a stray provider error; a dead
 * link does. A step with a single candidate is therefore never halted by
 * timeouts.
 *
 * Once tripped, nothing new is started: in-flight calls finish and are
 * recorded, every unit not started is counted by kind, and the run is
 * partial (GAPS.md, exit 3), exactly like a budget stop. `run --reuse` picks
 * up the trials that never ran, and generates again the timeouts the halt
 * blamed on the link (`halted_timeouts`), instead of keeping them as the
 * candidates' results.
 *
 * Reused trials are not counted at all: they say nothing about the link now.
 */

import type { CompletionState } from "./types.js";

export const DEFAULT_MAX_CONSECUTIVE_PROVIDER_ERRORS = 10;
export const DEFAULT_MAX_CONSECUTIVE_TIMEOUTS = 10;

/** A generation trial, as the halt names it. */
export interface HaltTrial {
  candidate: string;
  input: string;
  trial: number;
}

/** Who made a finished call: the candidate, and the trial when it was a generation. */
export interface HaltCaller {
  candidate: string;
  trial?: HaltTrial;
}

export type HaltReason = "provider_errors" | "timeouts";

export interface HaltState {
  /** Consecutive provider errors that trip the halt; null when the halt is off. */
  max_consecutive_provider_errors: number | null;
  /** The longest run of consecutive provider errors seen. */
  longest_provider_error_run: number;
  /** Consecutive unanswered calls, timeouts among them, that trip the halt; null when off. Absent before it existed. */
  max_consecutive_timeouts?: number | null;
  /** The longest run of unanswered calls (timeouts and provider errors) seen. */
  longest_timeout_run?: number;
  /** True once the halt tripped. */
  stopped: boolean;
  /** What tripped it; absent when it did not trip, and before timeouts could. */
  reason?: HaltReason;
  /** Timeouts the halt blamed on the link: `run --reuse` generates them again. */
  halted_timeouts?: HaltTrial[];
  /** Units not started because of it, by kind. */
  skipped: { generation: number; judging: number; scoring: number };
}

export type HaltUnit = keyof HaltState["skipped"];

export class ProviderErrorHalt {
  private consecutive = 0;
  private longest = 0;
  /** The current streak of unanswered calls. */
  private unanswered = 0;
  private longestUnanswered = 0;
  /** Candidates that timed out in the current streak. */
  private streakTimedOut = new Set<string>();
  private streakTimeouts: HaltTrial[] = [];
  private stopped = false;
  private reason: HaltReason | undefined;
  private haltedTimeouts: HaltTrial[] = [];
  private readonly skipped = { generation: 0, judging: 0, scoring: 0 };

  /** `null` turns either limit off. */
  constructor(
    private readonly maxConsecutive: number | null = DEFAULT_MAX_CONSECUTIVE_PROVIDER_ERRORS,
    private readonly maxTimeouts: number | null = DEFAULT_MAX_CONSECUTIVE_TIMEOUTS,
  ) {}

  /** Count a finished call: a completion state, or whether an evaluator call hit the transport. */
  record(outcome: CompletionState | "provider_error" | "answered", caller?: HaltCaller): void {
    this.countProviderErrors(outcome);
    this.countUnanswered(outcome, caller);
  }

  private countProviderErrors(outcome: CompletionState | "provider_error" | "answered"): void {
    if (outcome !== "provider_error") {
      this.consecutive = 0;
      return;
    }
    this.consecutive += 1;
    this.longest = Math.max(this.longest, this.consecutive);
    if (this.maxConsecutive !== null && this.consecutive >= this.maxConsecutive) this.trip("provider_errors");
  }

  private countUnanswered(outcome: CompletionState | "provider_error" | "answered", caller?: HaltCaller): void {
    if (outcome !== "timeout" && outcome !== "provider_error") {
      this.unanswered = 0;
      this.streakTimedOut = new Set();
      this.streakTimeouts = [];
      return;
    }
    this.unanswered += 1;
    this.longestUnanswered = Math.max(this.longestUnanswered, this.unanswered);
    if (outcome === "timeout" && caller) this.streakTimedOut = new Set([...this.streakTimedOut, caller.candidate]);
    // Only a generation names its trial; an end-to-end arm's timeout counts but is not regenerated by reuse.
    if (outcome === "timeout" && caller?.trial) {
      // Once halted, a timeout still in flight is blamed on the link too.
      if (this.stopped && this.reason === "timeouts") this.haltedTimeouts = [...this.haltedTimeouts, caller.trial];
      else this.streakTimeouts = [...this.streakTimeouts, caller.trial];
    }
    const reached = this.maxTimeouts !== null && this.unanswered >= this.maxTimeouts;
    if (reached && this.streakTimedOut.size >= 2 && !this.stopped) {
      this.trip("timeouts");
      this.haltedTimeouts = [...this.streakTimeouts];
    }
  }

  private trip(reason: HaltReason): void {
    if (this.stopped) return;
    this.stopped = true;
    this.reason = reason;
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

  /** What tripped the halt, once it has. */
  get trippedBy(): HaltReason | undefined {
    return this.reason;
  }

  state(): HaltState {
    return {
      max_consecutive_provider_errors: this.maxConsecutive,
      longest_provider_error_run: this.longest,
      max_consecutive_timeouts: this.maxTimeouts,
      longest_timeout_run: this.longestUnanswered,
      stopped: this.stopped,
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.haltedTimeouts.length > 0 ? { halted_timeouts: [...this.haltedTimeouts] } : {}),
      skipped: { ...this.skipped },
    };
  }
}

/** How a halt reads in one phrase: "consecutive provider errors" or "consecutive timeouts". */
export function haltCause(reason: HaltReason | undefined): string {
  return reason === "timeouts" ? "consecutive timeouts" : "consecutive provider errors";
}

/** The streak that tripped the halt, for messages. */
export function haltStreak(state: HaltState): number {
  return state.reason === "timeouts" ? (state.longest_timeout_run ?? 0) : state.longest_provider_error_run;
}

/** Whether the halt blamed this trial's timeout on the link (it is then generated again). */
export function isHaltedTimeout(state: HaltState | undefined, t: HaltTrial): boolean {
  return (state?.halted_timeouts ?? []).some((h) => h.candidate === t.candidate && h.input === t.input && h.trial === t.trial);
}

/** One GAPS.md line when the halt tripped; null when it did not. */
export function haltGap(state: HaltState): string | null {
  if (!state.stopped) return null;
  const { generation, judging, scoring } = state.skipped;
  const notStarted = `${generation} generation(s), ${judging} judgement(s) and ${scoring} scoring call(s) were never started. `;
  if (state.reason === "timeouts") {
    const blamed = state.halted_timeouts?.length ?? 0;
    const counted =
      blamed > 0
        ? `The ${blamed} generation timeout(s) in that streak count as their candidates' failures in the rates below, though the link is the likelier cause — ` +
          "fix the network or the endpoint and `run --reuse`: it generates those timeouts again rather than keeping them, and runs what never started."
        : "Fix the network or the endpoint and `run --reuse` to run what never started.";
    return (
      `- **timeouts halted the run**: ${haltStreak(state)} consecutive calls timed out or failed at the provider, with more than one candidate timing out (limit ${state.max_consecutive_timeouts}); ` +
      notStarted +
      counted
    );
  }
  return (
    `- **provider errors halted the run**: ${state.longest_provider_error_run} consecutive calls failed at the transport or the gateway (limit ${state.max_consecutive_provider_errors}); ` +
    notStarted +
    "Provider errors sit outside every candidate's denominators, so no rate below is wrong, but the run is partial — fix the network or the endpoint and `run --reuse` to finish it."
  );
}
