/**
 * Starting a run from the dashboard.
 *
 * The dashboard spends money. That makes this module different from
 * everything else on the server side, and it is built around one rule:
 *
 *   **a run starts only when the caller echoes back the plan it was shown.**
 *
 * `POST /api/runs` must carry the exact call counts and declared budget that
 * `plan()` returns for that task right now. A page that has been open for an
 * hour, or that was rendered before someone edited the spec, will not match —
 * it gets a 409 and the current plan, and a human looks at the numbers again.
 * This is the `--yes` flag's intent, made harder to bypass: `--yes` can be
 * typed from muscle memory, but a stale acknowledgement cannot be replayed.
 *
 * One run at a time. Concurrency here would mean two runs competing for the
 * same provider rate limit and the same budget, and neither would be a clean
 * measurement of anything.
 */

import { randomUUID } from "node:crypto";
import { runSuite } from "../core/execute.js";
import { planWorkflow, type WorkflowPlan } from "../core/plan.js";
import { loadSuites } from "../spec/load-spec.js";
import { resolveSpecPath, type Workspace } from "../core/workspace.js";
import type { RunEvent } from "../core/events.js";

/** What a caller must echo before anything is billed. */
export interface PlanAck {
  generations: number;
  judgeCalls: number;
  scoreCalls: number;
  /** The task's declared budget, or null when it declares none. */
  budgetUsd: number | null;
}

export interface StartRequest {
  task: string;
  ack: PlanAck;
  html?: boolean;
}

export type RunStatus = "running" | "done" | "failed" | "cancelled";

export interface RunHandle {
  id: string;
  task: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

interface ActiveRun extends RunHandle {
  /** Every event so far, so a late subscriber sees the whole run, not its tail. */
  events: RunEvent[];
  subscribers: Set<(event: RunEvent) => void>;
  closers: Set<() => void>;
  abort: AbortController;
}

export class PlanMismatch extends Error {
  constructor(readonly current: PlanAck) {
    super("the plan changed since this page was shown");
  }
}

export class AlreadyRunning extends Error {
  constructor(readonly runId: string) {
    super(`a run is already in flight (${runId})`);
  }
}

/** The acknowledgement a caller must send for this task, right now. */
function ackOf(plan: WorkflowPlan): PlanAck {
  return {
    generations: plan.totalGenerations,
    judgeCalls: plan.totalJudgeCalls,
    scoreCalls: plan.totalScoreCalls,
    budgetUsd: plan.steps[0]?.budgetUsd ?? null,
  };
}

function sameAck(a: PlanAck, b: PlanAck): boolean {
  return (
    a.generations === b.generations &&
    a.judgeCalls === b.judgeCalls &&
    a.scoreCalls === b.scoreCalls &&
    a.budgetUsd === b.budgetUsd
  );
}

/** Keeps at most this many finished runs, so a long-lived server does not grow without bound. */
const HISTORY_LIMIT = 20;

export class RunRegistry {
  private readonly runs = new Map<string, ActiveRun>();
  private order: string[] = [];

  constructor(private readonly ws: Workspace) {}

  get active(): RunHandle | null {
    for (const id of this.order) {
      const run = this.runs.get(id);
      if (run?.status === "running") return handleOf(run);
    }
    return null;
  }

  list(): RunHandle[] {
    return this.order.map((id) => handleOf(this.runs.get(id)!));
  }

  get(id: string): RunHandle | null {
    const run = this.runs.get(id);
    return run ? handleOf(run) : null;
  }

  /** The plan a caller must acknowledge, computed fresh from what is on disk. */
  async planFor(task: string): Promise<{ plan: WorkflowPlan; ack: PlanAck; spec: string }> {
    const spec = await resolveSpecPath(this.ws, task);
    const plan = planWorkflow(await loadSuites(spec));
    return { plan, ack: ackOf(plan), spec };
  }

  async start(request: StartRequest): Promise<RunHandle> {
    const inFlight = this.active;
    if (inFlight) throw new AlreadyRunning(inFlight.id);

    const { ack, spec } = await this.planFor(request.task);
    if (!sameAck(ack, request.ack)) throw new PlanMismatch(ack);

    const run: ActiveRun = {
      id: randomUUID(),
      task: request.task,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      events: [],
      subscribers: new Set(),
      closers: new Set(),
      abort: new AbortController(),
    };
    this.remember(run);

    const emit = (event: RunEvent): void => {
      run.events.push(event);
      for (const send of run.subscribers) send(event);
    };

    // Deliberately not awaited: the caller gets the id, and follows the run
    // over SSE. Failures land on the handle, never as an unhandled rejection.
    void runSuite(spec, request.html === true, { yes: true, onEvent: emit, signal: run.abort.signal })
      .then(() => {
        run.status = run.abort.signal.aborted ? "cancelled" : "done";
      })
      .catch((err: unknown) => {
        run.status = "failed";
        run.error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        run.finishedAt = new Date().toISOString();
        for (const close of run.closers) close();
        run.subscribers.clear();
        run.closers.clear();
      });

    return handleOf(run);
  }

  /**
   * Follow a run. Every event so far is replayed first, so a subscriber that
   * arrives late — or reconnects — sees the whole run rather than its tail.
   * Returns null when there is no such run.
   */
  subscribe(id: string, onEvent: (event: RunEvent) => void, onClose: () => void): (() => void) | null {
    const run = this.runs.get(id);
    if (!run) return null;
    for (const event of run.events) onEvent(event);
    if (run.status !== "running") {
      onClose();
      return () => {};
    }
    run.subscribers.add(onEvent);
    run.closers.add(onClose);
    return () => {
      run.subscribers.delete(onEvent);
      run.closers.delete(onClose);
    };
  }

  /** Stop dispatching. Calls in flight finish and are recorded. */
  cancel(id: string): boolean {
    const run = this.runs.get(id);
    if (!run || run.status !== "running") return false;
    run.abort.abort();
    return true;
  }

  private remember(run: ActiveRun): void {
    this.runs.set(run.id, run);
    this.order = [run.id, ...this.order];
    for (const id of this.order.slice(HISTORY_LIMIT)) {
      if (this.runs.get(id)?.status !== "running") this.runs.delete(id);
    }
    this.order = this.order.filter((id) => this.runs.has(id));
  }
}

function handleOf(run: ActiveRun): RunHandle {
  return {
    id: run.id,
    task: run.task,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
  };
}
