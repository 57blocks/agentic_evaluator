/**
 * Outage gate for model calls (src/llm.ts `complete`).
 *
 * A single call retries a transport failure twice, a second or two apart.
 * That recovers a flapping gateway and nothing else: when the network is
 * down for a minute, every trial in flight burns its retries inside three
 * seconds and is recorded as a provider error — on 2026-10-30 a run lost
 * 1,569 trials that way. The gate is the run-wide view those per-call
 * retries lack. Every call reports its transport failures and successes
 * here; once failures arrive back to back from different calls, the gate
 * closes and every call waits (5 s, then 10, 20, 40, 60 s between probes)
 * until one succeeds. Waiting at the gate does not spend a call's own
 * retries. After `maxPauseMs` of waiting in one outage, the gate gives up and
 * lets calls fail, so a dead network ends the run (src/canon/halt.ts)
 * instead of holding it forever; the next success re-arms it for the next
 * outage.
 *
 * Each pause stays under the wall-clock integrity threshold (5 min,
 * src/canon/trace.ts), and every probe writes a trace event, so a handled
 * outage is never reported as a suspended host. The wait happens outside
 * `attempt`, so trial durations never include it.
 */

export interface TransportGateOptions {
  /** Consecutive transport failures, across every call in flight, before the gate closes. */
  pauseAfter?: number;
  /** First pause; each further pause in the same outage doubles it, up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Time the gate may hold calls in one outage before it gives up. 0 turns pausing off. */
  maxPauseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface TransportGateState {
  /** Times the gate closed. */
  pauses: number;
  /** Time calls were held, over every outage. */
  paused_ms: number;
  /** True once an outage outlasted `maxPauseMs` and calls were let fail. */
  gave_up: boolean;
}

export type TransportGateEvent =
  | { type: "paused"; consecutive: number; delayMs: number; pausedMs: number }
  | { type: "resumed"; pausedMs: number }
  | { type: "gave_up"; consecutive: number; pausedMs: number };

export const DEFAULT_PAUSE_AFTER = 3;
export const DEFAULT_BASE_DELAY_MS = 5_000;
export const DEFAULT_MAX_DELAY_MS = 60_000;
export const DEFAULT_MAX_PAUSE_MS = 10 * 60 * 1000;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class TransportGate {
  private pauseAfter = DEFAULT_PAUSE_AFTER;
  private baseDelayMs = DEFAULT_BASE_DELAY_MS;
  private maxDelayMs = DEFAULT_MAX_DELAY_MS;
  private maxPauseMs = DEFAULT_MAX_PAUSE_MS;
  private now: () => number = Date.now;
  private sleep: (ms: number) => Promise<void> = realSleep;

  private consecutive = 0;
  private pausedUntil = 0;
  private nextDelayMs = DEFAULT_BASE_DELAY_MS;
  private pauses = 0;
  private pausedMs = 0;
  /** Waiting spent in the current outage, against `maxPauseMs`. */
  private outageMs = 0;
  /** The current outage outlasted `maxPauseMs`; cleared by the next success. */
  private exhausted = false;
  /** Any outage did, for the record. */
  private gaveUp = false;
  private closed = false;
  private readonly listeners = new Set<(event: TransportGateEvent) => void>();

  constructor(options: TransportGateOptions = {}) {
    this.configure(options);
  }

  /** Apply options and clear every counter: the start of a run. Listeners stay. */
  configure(options: TransportGateOptions = {}): void {
    this.pauseAfter = options.pauseAfter ?? DEFAULT_PAUSE_AFTER;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.maxPauseMs = options.maxPauseMs ?? DEFAULT_MAX_PAUSE_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.consecutive = 0;
    this.pausedUntil = 0;
    this.nextDelayMs = this.baseDelayMs;
    this.pauses = 0;
    this.pausedMs = 0;
    this.outageMs = 0;
    this.exhausted = false;
    this.gaveUp = false;
    this.closed = false;
  }

  subscribe(listener: (event: TransportGateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Hold the caller while the gate is closed; resolves at once when it is open. */
  async wait(): Promise<void> {
    for (;;) {
      const remaining = this.pausedUntil - this.now();
      if (remaining <= 0) return;
      await this.sleep(remaining);
    }
  }

  /** How long `wait()` would hold a caller right now. */
  remainingMs(): number {
    return Math.max(0, this.pausedUntil - this.now());
  }

  /** A call came back from the provider: the outage, if any, is over, and the gate is armed for the next. */
  succeeded(): void {
    this.consecutive = 0;
    this.outageMs = 0;
    this.exhausted = false;
    this.nextDelayMs = this.baseDelayMs;
    if (!this.closed) return;
    this.closed = false;
    this.emit({ type: "resumed", pausedMs: this.pausedMs });
  }

  /**
   * A call hit a transport failure. True when the caller should wait at the
   * gate and try again without spending one of its own retries; false when
   * it is on its own (too few failures to call it an outage, pausing off, or
   * the gate has given up).
   */
  failed(): boolean {
    this.consecutive += 1;
    if (this.maxPauseMs <= 0 || this.exhausted || this.consecutive < this.pauseAfter) return false;
    const now = this.now();
    if (this.pausedUntil > now) return true;
    if (this.outageMs >= this.maxPauseMs) {
      this.exhausted = true;
      this.gaveUp = true;
      this.closed = false;
      this.emit({ type: "gave_up", consecutive: this.consecutive, pausedMs: this.pausedMs });
      return false;
    }
    const delayMs = Math.min(this.nextDelayMs, this.maxPauseMs - this.outageMs);
    this.pausedUntil = now + delayMs;
    this.pausedMs += delayMs;
    this.outageMs += delayMs;
    this.pauses += 1;
    this.closed = true;
    this.nextDelayMs = Math.min(this.nextDelayMs * 2, this.maxDelayMs);
    this.emit({ type: "paused", consecutive: this.consecutive, delayMs, pausedMs: this.pausedMs });
    return true;
  }

  state(): TransportGateState {
    return { pauses: this.pauses, paused_ms: this.pausedMs, gave_up: this.gaveUp };
  }

  private emit(event: TransportGateEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

/**
 * The gate every `complete()` call shares unless it is handed another one.
 * Off until a run turns it on (src/core/execute.ts `runSuite`), so a judge
 * call from `agenteval review` or a preflight probe fails in seconds as it
 * always did instead of holding for minutes.
 */
export const transportGate = new TransportGate({ maxPauseMs: 0 });

/** One GAPS.md line when the gate held the run; null when it never closed. */
export function transportGap(state: TransportGateState): string | null {
  if (state.pauses === 0) return null;
  const minutes = (state.paused_ms / 60000).toFixed(1);
  const ending = state.gave_up
    ? "At least one outage outlasted the wait, so the gate gave up and calls failed as provider errors until the network answered again."
    : "The network came back each time and the run went on.";
  return (
    `- **network outage**: calls were paused ${state.pauses} time(s), ${minutes} min in all, after consecutive transport failures. ` +
    `Trial durations exclude the waits. ${ending}`
  );
}
