import { test } from "node:test";
import assert from "node:assert/strict";
import { diffRuns, type DiffRow, type RunSide } from "../src/canon/run-diff.js";

/** One trial row; a success unless said otherwise. */
function row(candidate: string, input: string, outcome: "success" | "failure" | "undetermined" = "success", over: Partial<DiffRow> = {}): DiffRow {
  return {
    candidate,
    input,
    trial: 0,
    task_outcome: outcome,
    completion_state: "success",
    reused_from: null,
    checks: { key: { state: outcome === "success" ? "pass" : "fail", version: "v1" } },
    ...over,
  };
}

/** A side whose recorded rates are counted from its rows, as `summary.json` records them. */
function side(run: string, rows: DiffRow[], over: Partial<RunSide> = {}): RunSide {
  const candidates = [...new Set(rows.map((r) => r.candidate))];
  const inputs = [...new Set(rows.map((r) => r.input))];
  return {
    run,
    step: "extract",
    manifest: {
      test_set: { inputs: Object.fromEntries(inputs.map((i) => [i, `sha-${i}`])) },
      evaluators: { check_version: "v1", producer_template_sha256: "p1" },
      execution: { trials_per_case: 1 },
      candidates: Object.fromEntries(candidates.map((c) => [c, {}])),
    },
    recommendation: { rule_version: "select-v4", chosen: candidates[0] ?? null, firmness: "directional", eligible: candidates, filters: [] },
    rates: candidates.map((c) => {
      const own = rows.filter((r) => r.candidate === c);
      const pass = own.filter((r) => r.task_outcome === "success").length;
      const classified = own.filter((r) => r.task_outcome !== "undetermined").length;
      return { candidate: c, task_success_rate: { value: classified ? pass / classified : null, numerator: pass, denominator: classified } };
    }),
    rows,
    outputs: new Map(),
    ...over,
  };
}

test("says the recommendation changed, from what to what", () => {
  const a = side("run-a", [row("flash", "i1"), row("sonnet", "i1")], { recommendation: { chosen: "flash", firmness: "directional", eligible: ["flash", "sonnet"], filters: [] } });
  const b = side("run-b", [row("flash", "i1"), row("sonnet", "i1")], { recommendation: { chosen: "sonnet", firmness: "firm", eligible: ["sonnet"], filters: [] } });

  const d = diffRuns(a, b);

  assert.equal(d.recommendation.changed, true);
  assert.deepEqual(d.recommendation.a, { chosen: "flash", firmness: "directional" });
  assert.deepEqual(d.recommendation.b, { chosen: "sonnet", firmness: "firm" });
});

test("lists who left or entered the gates, with the run's own reason", () => {
  const rows = [row("glm", "i1"), row("kimi", "i1"), row("sonnet", "i1")];
  const a = side("run-a", rows, { recommendation: { chosen: "sonnet", eligible: ["sonnet", "kimi"], filters: [{ id: "g", description: "", removed: [{ candidate: "glm", reason: "pass rate 0.7 < 0.9" }], remaining: [] }] } });
  const b = side("run-b", rows, { recommendation: { chosen: "sonnet", eligible: ["sonnet", "glm"], filters: [{ id: "g", description: "", removed: [{ candidate: "kimi", reason: "pass rate 0.89 < 0.9" }], remaining: [] }] } });

  const d = diffRuns(a, b);
  const gate = (c: string) => d.gates.find((g) => g.candidate === c);

  assert.deepEqual(gate("kimi"), { candidate: "kimi", a: { state: "in" }, b: { state: "out", reason: "pass rate 0.89 < 0.9" }, move: "LEFT" });
  assert.deepEqual(gate("glm"), { candidate: "glm", a: { state: "out", reason: "pass rate 0.7 < 0.9" }, b: { state: "in" }, move: "ENTERED" });
  assert.deepEqual(gate("sonnet"), { candidate: "sonnet", a: { state: "in" }, b: { state: "in" }, move: "stayed in" });
  assert.deepEqual(d.gates.map((g) => g.move), ["LEFT", "ENTERED", "stayed in"], "changes are listed first");
});

test("a candidate in only one run is absent on the other side", () => {
  const d = diffRuns(side("run-a", [row("sonnet", "i1")]), side("run-b", [row("sonnet", "i1"), row("opus", "i1")]));
  assert.deepEqual(d.gates.find((g) => g.candidate === "opus")?.a, { state: "absent" });
  assert.equal(d.rates.find((r) => r.candidate === "opus")?.a, null);
});

test("splits each pass rate into the inputs both runs share and the inputs only one has", () => {
  // Arrange: i1, i2 shared; i3 new in b. Sonnet fails i2 in a, passes it in b, and fails i3.
  const a = side("run-a", [row("sonnet", "i1"), row("sonnet", "i2", "failure")]);
  const b = side("run-b", [row("sonnet", "i1"), row("sonnet", "i2"), row("sonnet", "i3", "failure")]);

  // Act
  const r = diffRuns(a, b).rates.find((x) => x.candidate === "sonnet")!;

  // Assert: recorded 1/2 → 2/3, which is shared 1/2 → 2/2 plus 0/1 on the new input
  assert.deepEqual([r.a?.numerator, r.a?.denominator, r.b?.numerator, r.b?.denominator], [1, 2, 2, 3]);
  assert.deepEqual(r.shared, { a: { numerator: 1, denominator: 2 }, b: { numerator: 2, denominator: 2 } });
  assert.deepEqual(r.onlyB, { numerator: 0, denominator: 1 });
  assert.equal(r.onlyA, null);
});

test("gives each recorded rate its Wilson 95% interval", () => {
  const rows = Array.from({ length: 100 }, (_, i) => row("sonnet", `i${i}`, i < 92 ? "success" : "failure"));
  const r = diffRuns(side("run-a", rows), side("run-b", rows)).rates[0]!;
  assert.equal(r.b?.low?.toFixed(3), "0.850");
  assert.equal(r.b?.high?.toFixed(3), "0.959");
});

test("an input whose content changed is not shared, and its outcome is never a flip", () => {
  const a = side("run-a", [row("sonnet", "i1", "failure")]);
  const b = side("run-b", [row("sonnet", "i1")]);
  const changed = { ...b, manifest: { ...b.manifest, test_set: { inputs: { i1: "sha-other" } } } };

  const d = diffRuns(a, changed);

  assert.deepEqual(d.inputs.changed, ["i1"]);
  assert.equal(d.inputs.shared, 0);
  assert.deepEqual(d.flips, []);
});

test("flips are the shared inputs whose outcome moved, both ways", () => {
  const a = side("run-a", [row("opus", "i1", "failure"), row("opus", "i2"), row("opus", "i3")]);
  const b = side("run-b", [row("opus", "i1"), row("opus", "i2", "failure"), row("opus", "i3")]);

  const flips = diffRuns(a, b).flips.map((f) => [f.candidate, f.input, f.direction]);

  assert.deepEqual(flips, [
    ["opus", "i1", "fail-to-pass"],
    ["opus", "i2", "pass-to-fail"],
  ]);
});

test("a trial that did not run on either side is never a flip", () => {
  const a = side("run-a", [row("opus", "i1", "failure")]);
  const b = side("run-b", [row("opus", "i1", "undetermined", { completion_state: "provider_error" })]);
  const d = diffRuns(a, b);
  assert.deepEqual(d.flips, []);
  assert.equal(d.notCompared, 1);
});

test("a flip on a reused answer is the same answer graded again, and says how the check changed", () => {
  // Arrange: b reused a's generation and graded it under a new answer key.
  const a = side("run-a", [row("opus", "i1", "failure")]);
  const b = side("run-b", [row("opus", "i1", "success", { reused_from: "datasets/tasks/t/runs/run-a", checks: { key: { state: "pass", version: "v2" } } })]);

  const [flip] = diffRuns(a, b).flips;

  assert.equal(flip?.cause, "same-answer");
  assert.deepEqual(flip?.checkVersion, { a: "v1", b: "v2" });
});

test("identical saved outputs make the same answer; different ones a new answer; neither, unknown", () => {
  const a = side("run-a", [row("opus", "i1", "failure"), row("opus", "i2", "failure"), row("opus", "i3", "failure")], {
    outputs: new Map([["opus\0i1\0" + "0", "x"], ["opus\0i2\0" + "0", "y"]]),
  });
  const b = side("run-b", [row("opus", "i1"), row("opus", "i2"), row("opus", "i3")], {
    outputs: new Map([["opus\0i1\0" + "0", "x"], ["opus\0i2\0" + "0", "z"]]),
  });

  const cause = Object.fromEntries(diffRuns(a, b).flips.map((f) => [f.input, f.cause]));

  assert.deepEqual(cause, { i1: "same-answer", i2: "new-answer", i3: "unknown" });
});

test("with several trials an input flips when its pass count moves", () => {
  const two = (outcomes: Array<"success" | "failure">) => outcomes.map((o, t) => row("opus", "i1", o, { trial: t }));
  const a = side("run-a", two(["success", "failure"]));
  const b = side("run-b", two(["failure", "success"]));
  assert.deepEqual(diffRuns(a, b).flips, [], "1/2 → 1/2 is no flip");

  const c = side("run-c", two(["success", "success"]));
  const [flip] = diffRuns(a, c).flips;
  assert.deepEqual(flip && { direction: flip.direction, a: flip.a, b: flip.b }, { direction: "fail-to-pass", a: { pass: 1, n: 2 }, b: { pass: 2, n: 2 } });
});

test("names what changed between the two setups, and nothing that did not", () => {
  const a = side("run-a", [row("sonnet", "i1")]);
  const b0 = side("run-b", [row("sonnet", "i1"), row("sonnet", "i2")]);
  const b = { ...b0, manifest: { ...b0.manifest, evaluators: { check_version: "v2", producer_template_sha256: "p1" } } };

  const d = diffRuns(a, b);

  assert.deepEqual(d.inputs.added, ["i2"]);
  assert.deepEqual(d.setup, [{ what: "check version", a: "v1", b: "v2" }]);
});

test("an older run without firmness or rule version still diffs, and the rule versions are compared", () => {
  const a = side("run-a", [row("sonnet", "i1")], { recommendation: { chosen: "sonnet", eligible: ["sonnet"], filters: [] } });
  const b = side("run-b", [row("sonnet", "i1")]);

  const d = diffRuns(a, b);

  assert.deepEqual(d.recommendation.a, { chosen: "sonnet", firmness: null });
  assert.deepEqual(d.setup.find((s) => s.what === "selection rule"), { what: "selection rule", a: "(unrecorded)", b: "select-v4" });
});

test("a workflow step reused from the earlier run is the same answer too", () => {
  const a = side("wf-a/extract", [row("opus", "i1", "failure")]);
  const b = side("wf-b/extract", [row("opus", "i1", "success", { reused_from: "datasets/tasks/t/runs/wf-a/extract" })]);
  assert.equal(diffRuns(a, b).flips[0]?.cause, "same-answer");
});

test("a changed gate threshold is named on its own; a threshold unset on both sides is not", () => {
  const a = side("run-a", [row("sonnet", "i1")]);
  const b = side("run-b", [row("sonnet", "i1")]);
  const withGates = (s: RunSide, eligibility: unknown): RunSide => ({ ...s, manifest: { ...s.manifest, eligibility } });

  const d = diffRuns(withGates(a, { minimum_reliability: 1, maximum_p95_ms: null }), withGates(b, { minimum_reliability: 0.9 }));

  assert.deepEqual(d.setup, [{ what: "gate minimum_reliability", a: "1", b: "0.9" }]);
});

test("a run without a recommendation says so, rather than reading as nobody passing", () => {
  const a = side("run-a", [row("sonnet", "i1")], { recommendation: null });
  const b = side("run-b", [row("sonnet", "i1")]);

  const d = diffRuns(a, b);

  assert.equal(d.recommendation.a, null);
  assert.equal(d.recommendation.changed, false);
  assert.deepEqual(d.gates[0]?.a, { state: "unrecorded" });
});

test("flips are grouped by candidate, direction and cause, with the cause in words", () => {
  const a = side("run-a", [row("opus", "i1", "failure"), row("opus", "i2", "failure"), row("opus", "i3")]);
  const b = side("run-b", [row("opus", "i1"), row("opus", "i2"), row("opus", "i3", "failure")]);

  const groups = diffRuns(a, b).flipGroups.map((g) => [g.candidate, g.direction, g.causeText, g.inputs]);

  assert.deepEqual(groups, [
    ["opus", "fail-to-pass", "answer not kept, cause unknown", ["i1", "i2"]],
    ["opus", "pass-to-fail", "answer not kept, cause unknown", ["i3"]],
  ]);
});

test("an answer on one side and a timeout on the other is a new answer, and its check version says none ran", () => {
  const a = side("run-a", [row("opus", "i1")]);
  const b = side("run-b", [row("opus", "i1", "failure", { completion_state: "timeout", checks: {} })]);

  const [flip] = diffRuns(a, b).flips;

  assert.equal(flip?.cause, "new-answer");
  assert.deepEqual(flip?.checkVersion, { a: "v1", b: "no check ran" });
});
