/**
 * Spending limit (protocol §7): "when the spending or time limit is reached,
 * the run stops cleanly and records incomplete work rather than silently
 * discarding it."
 *
 * The guard is consulted before each billable unit — a generation, a judged
 * pair, a scored output — and every spent dollar is fed back in. Units not
 * run are counted, not dropped: the summary says how many and the report can
 * then say the picture is partial instead of implying the run finished.
 *
 * The limit is a ceiling on what the run may START, not a promise about the
 * final total: a unit already in flight is allowed to finish and bill.
 */

export interface BudgetState {
  limit_usd: number | null;
  spent_usd: number;
  /** True once a unit was refused because the limit had been reached. */
  stopped_early: boolean;
  /** Billable units not started because of the limit, by kind. */
  skipped: { generation: number; judging: number; scoring: number };
}

export type BudgetUnit = keyof BudgetState["skipped"];

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export class BudgetGuard {
  private spent = 0;
  private stopped = false;
  private readonly skipped = { generation: 0, judging: 0, scoring: 0 };

  constructor(private readonly limitUsd?: number) {}

  /** Record what a finished call was billed, retries included. */
  add(usd: number): void {
    if (Number.isFinite(usd) && usd > 0) this.spent += usd;
  }

  /** True while another unit of this kind may start; counts the refusal. */
  allows(unit: BudgetUnit): boolean {
    if (this.limitUsd === undefined || this.spent < this.limitUsd) return true;
    this.stopped = true;
    this.skipped[unit] += 1;
    return false;
  }

  get spentUsd(): number {
    return round(this.spent);
  }

  get stoppedEarly(): boolean {
    return this.stopped;
  }

  state(): BudgetState {
    return {
      limit_usd: this.limitUsd ?? null,
      spent_usd: round(this.spent),
      stopped_early: this.stopped,
      skipped: { ...this.skipped },
    };
  }
}

/** One GAPS.md line when a run stopped on its limit; null when it did not. */
export function budgetGap(state: BudgetState): string | null {
  if (!state.stopped_early) return null;
  const { generation, judging, scoring } = state.skipped;
  return (
    `- **budget limit reached**: spent $${state.spent_usd.toFixed(4)} of $${(state.limit_usd ?? 0).toFixed(2)}; ` +
    `${generation} generation(s), ${judging} judgement(s) and ${scoring} scoring call(s) were never started. ` +
    "Every rate below is computed over the work that ran, so this run is partial — raise the budget or narrow the spec before comparing it with a complete one."
  );
}
