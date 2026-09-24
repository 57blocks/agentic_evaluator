/**
 * Runtime acceptance tests for the `code-reactive` task (inputs/code-reactive.txt).
 *
 * The harness cannot run these yet — its only required check is `tsc --noEmit`.
 * Run them by hand against one candidate's artifacts:
 *
 *   cp runs/<runId>/raw/<candidate>__<input>__t0/*.ts /tmp/try/
 *   cp tasks/code-reactive/spec.test.ts /tmp/try/
 *   node --import tsx --test /tmp/try/spec.test.ts
 *
 * Validated against tasks/code-reactive/reference/signals.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signal, computed, effect, batch, untracked, CycleError } from "./signals.js";

test("1 · computed is lazy and caches until a dependency changes", () => {
  let runs = 0;
  const a = signal(1);
  const double = computed(() => {
    runs += 1;
    return a() * 2;
  });
  assert.equal(runs, 0, "body ran before the first read");
  assert.equal(double(), 2);
  assert.equal(double(), 2);
  assert.equal(runs, 1, "body ran again without a dependency change");
  a.set(2);
  assert.equal(double(), 4);
  assert.equal(runs, 2);
});

test("2 · a diamond recomputes the join exactly once per write", () => {
  const a = signal(1);
  const b = computed(() => a() + 1);
  const c = computed(() => a() + 10);
  let joinRuns = 0;
  const d = computed(() => {
    joinRuns += 1;
    return b() + c();
  });
  const seen: number[] = [];
  const stop = effect(() => void seen.push(d()));
  assert.deepEqual(seen, [13]);
  assert.equal(joinRuns, 1);
  a.set(2);
  assert.deepEqual(seen, [13, 15]);
  assert.equal(joinRuns, 2, "join recomputed more than once for one write");
  stop();
});

test("3 · dependencies are re-collected, dropped sources stop notifying", () => {
  const useX = signal(true);
  const x = signal(1);
  const y = signal(100);
  let runs = 0;
  const v = computed(() => {
    runs += 1;
    return useX() ? x() : y();
  });
  let effectRuns = 0;
  const stop = effect(() => {
    v();
    effectRuns += 1;
  });
  assert.equal(effectRuns, 1);
  useX.set(false);
  assert.equal(v(), 100);
  assert.equal(effectRuns, 2);
  const runsBefore = runs;
  x.set(5);
  assert.equal(effectRuns, 2, "a dropped dependency still notified");
  assert.equal(runs, runsBefore, "a dropped dependency still forced a recompute");
  y.set(7);
  assert.equal(effectRuns, 3);
  stop();
});

test("4 · equal writes do not propagate, custom equals is honoured", () => {
  const s = signal(1);
  let runs = 0;
  const stop = effect(() => {
    s();
    runs += 1;
  });
  s.set(1);
  assert.equal(runs, 1);
  s.set(2);
  assert.equal(runs, 2);
  stop();

  const label = signal("ab", (p, q) => p.length === q.length);
  let labelRuns = 0;
  const stopLabel = effect(() => {
    label();
    labelRuns += 1;
  });
  label.set("cd");
  assert.equal(labelRuns, 1, "custom equals did not suppress the write");
  label.set("e");
  assert.equal(labelRuns, 2);
  stopLabel();
});

test("5 · a computed that re-evaluates to an equal value does not wake dependents", () => {
  const a = signal(1);
  const parity = computed(() => a() % 2);
  let runs = 0;
  const stop = effect(() => {
    parity();
    runs += 1;
  });
  assert.equal(runs, 1);
  a.set(3);
  assert.equal(runs, 1, "dependent re-ran although the computed value was unchanged");
  a.set(4);
  assert.equal(runs, 2);
  stop();
});

test("6 · batch flushes once, nests, returns the body value and reads its own writes", () => {
  const a = signal(1);
  const b = signal(2);
  let runs = 0;
  const stop = effect(() => {
    a();
    b();
    runs += 1;
  });
  assert.equal(runs, 1);
  const returned = batch(() => {
    a.set(10);
    b.set(20);
    assert.equal(a(), 10, "a write was not visible inside its own batch");
    assert.equal(runs, 1, "the effect ran before the batch closed");
    return "done";
  });
  assert.equal(returned, "done");
  assert.equal(runs, 2);

  batch(() => {
    a.set(11);
    batch(() => {
      b.set(21);
    });
    assert.equal(runs, 2, "an inner batch flushed early");
  });
  assert.equal(runs, 3);
  stop();
});

test("7 · cleanups run before every re-run and once on dispose", () => {
  const s = signal(0);
  const log: string[] = [];
  const stop = effect((onCleanup) => {
    const seen = s();
    log.push(`run ${seen}`);
    onCleanup(() => void log.push(`cleanup ${seen}`));
  });
  assert.deepEqual(log, ["run 0"]);
  s.set(1);
  assert.deepEqual(log, ["run 0", "cleanup 0", "run 1"]);
  stop();
  assert.deepEqual(log, ["run 0", "cleanup 0", "run 1", "cleanup 1"]);
  s.set(2);
  assert.equal(log.length, 4, "a disposed effect ran again");
  stop();
  assert.equal(log.length, 4, "disposing twice ran the cleanup twice");
});

test("8 · no effect ever observes a stale value", () => {
  const a = signal(1);
  const b = computed(() => a() * 2);
  const seen: Array<[number, number]> = [];
  const stop = effect(() => void seen.push([a(), b()]));
  a.set(2);
  assert.equal(seen.length, 2, "the effect ran more than once for one write");
  assert.deepEqual(seen[1], [2, 4]);
  stop();
});

test("9 · a self-referential computed throws CycleError and leaves the graph usable", () => {
  let selfRef!: () => number;
  selfRef = computed(() => selfRef() + 1);
  assert.throws(() => selfRef(), CycleError);

  const a = signal(1);
  const double = computed(() => a() * 2);
  let runs = 0;
  const stop = effect(() => {
    double();
    runs += 1;
  });
  a.set(5);
  assert.equal(double(), 10);
  assert.equal(runs, 2, "the graph stopped working after a cycle");
  stop();
});

test("10 · untracked reads without subscribing and returns the value", () => {
  const t = signal(1);
  let runs = 0;
  const stop = effect(() => {
    untracked(() => t());
    runs += 1;
  });
  assert.equal(runs, 1);
  t.set(2);
  assert.equal(runs, 1, "untracked created a subscription");
  assert.equal(untracked(() => t()), 2, "untracked did not return the body value");
  stop();
});
