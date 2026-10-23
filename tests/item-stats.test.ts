import { test } from "node:test";
import assert from "node:assert/strict";
import { itemGaps, itemStats } from "../src/canon/item-stats.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { TaskOutcome } from "../src/canon/types.js";

function row(candidate: string, input: string, trial: number, outcome: TaskOutcome): TrialRow {
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input, trial, trial_hash: `${candidate}-${input}-${trial}`,
    completion_state: "success", truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v1",
    checks: {}, judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: null, reused_from: null,
  };
}

const S = "success" as const;
const F = "failure" as const;

// Three candidates: strong passes all, mid misses "hard", weak misses "hard" and "medium".
const trials: TrialRow[] = [
  ...["strong", "mid", "weak"].map((c) => row(c, "easy", 0, S)),
  row("strong", "medium", 0, S), row("mid", "medium", 0, S), row("weak", "medium", 0, F),
  row("strong", "hard", 0, S), row("mid", "hard", 0, F), row("weak", "hard", 0, F),
  ...["strong", "mid", "weak"].map((c) => row(c, "broken", 0, F)),
  // noisy: everyone 1 of 2
  ...["strong", "mid", "weak"].flatMap((c) => [row(c, "noisy", 0, S), row(c, "noisy", 1, F)]),
  // only one candidate classified
  row("strong", "lonely", 0, S), row("mid", "lonely", 0, "undetermined"),
];

test("classifies each input by how candidates did on it", () => {
  const s = itemStats(trials);
  const cls = Object.fromEntries(s.items.map((i) => [i.input, i.class]));
  assert.deepEqual(cls, {
    broken: "all-fail", easy: "all-pass", hard: "splits", lonely: "unscored", medium: "splits", noisy: "flat",
  });
  assert.equal(s.inputs, 6);
  assert.equal(s.effective_n, 2);
});

test("discriminating inputs correlate with overall strength", () => {
  const hard = itemStats(trials).items.find((i) => i.input === "hard")!;
  assert.ok(hard.discrimination !== null && hard.discrimination > 0.5, String(hard.discrimination));
  assert.equal(hard.pass_rate, 1 / 3);
  const easy = itemStats(trials).items.find((i) => i.input === "easy")!;
  assert.equal(easy.discrimination, null);
});

test("GAPS names effective N and the inputs every candidate failed", () => {
  const lines = itemGaps(itemStats(trials));
  assert.match(lines[0], /effective N: 2 of 6/);
  assert.match(lines[1], /every candidate failed 1 input\(s\): broken/);
});
