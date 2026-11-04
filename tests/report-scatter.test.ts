/** report-scatter: cost against success, laid out once for both renderers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { costSuccessChart, gateNotesOf, renderCostSuccess, type ScatterCandidate } from "../src/report-scatter.js";

function candidate(id: string, pass: number, ran: number, cost: number | null, over: Partial<ScatterCandidate> = {}): ScatterCandidate {
  return { id, checkPass: pass, checkExecuted: ran, costPerSuccess: cost, costObserved: true, gated: false, chosen: false, isControl: false, ...over };
}

test("cheaper is further left and more passes is higher, on the cost the selector ranks on", () => {
  const chart = costSuccessChart([candidate("cheap", 8, 8, 0.001), candidate("dear", 6, 8, 0.05)], 0.9)!;
  const [cheap, dear] = chart.points;
  assert.ok(cheap.cx < dear.cx);
  assert.ok(cheap.cy < dear.cy, "SVG y grows downwards: the higher pass rate has the smaller y");
});

test("a $0 candidate and one with no cost per success get their own lanes instead of being dropped", () => {
  const chart = costSuccessChart([
    candidate("rules", 8, 8, 0),
    candidate("model", 8, 8, 0.01),
    candidate("nothing-passed", 0, 8, null),
  ], null)!;
  assert.deepEqual(chart.lanes.map((l) => l.label), ["$0", "cost n/a"]);
  const x = Object.fromEntries(chart.points.map((p) => [p.candidate, p.cx]));
  assert.ok(x.rules < chart.plot.left && x["nothing-passed"] > chart.plot.right);
  assert.ok(x.model >= chart.plot.left && x.model <= chart.plot.right);
});

test("the pass-rate axis starts just below the lowest rate or the gate, so a field of 90%+ is not one line", () => {
  const high = costSuccessChart([candidate("a", 8, 8, 0.01), candidate("b", 7, 8, 0.02)], 0.9)!;
  assert.equal(high.yTicks[0].label, "85%", "87.5% is the lowest: the axis starts one 5% step below it");
  assert.equal(high.yTicks.at(-1)!.label, "100%");
  const low = costSuccessChart([candidate("a", 8, 8, 0.01), candidate("b", 1, 8, 0.02)], 0.9)!;
  assert.equal(low.yTicks[0].label, "0%");
});

test("the gate line sits at the declared rate, and no gate draws no line", () => {
  const gated = costSuccessChart([candidate("a", 8, 8, 0.01), candidate("b", 4, 8, 0.02)], 0.5)!;
  const half = gated.points.find((p) => p.candidate === "b")!;
  assert.equal(gated.gate!.y, half.cy);
  assert.equal(costSuccessChart([candidate("a", 8, 8, 0.01), candidate("b", 4, 8, 0.02)], null)!.gate, null);
});

test("a candidate whose check never ran has no y: it is named, not plotted; under two plotted, no chart", () => {
  const chart = costSuccessChart([candidate("a", 8, 8, 0.01), candidate("b", 4, 8, 0.02), candidate("silent", 0, 0, null)], null)!;
  assert.deepEqual(chart.unplotted, ["silent"]);
  assert.equal(chart.points.length, 2);
  assert.equal(costSuccessChart([candidate("a", 8, 8, 0.01), candidate("silent", 0, 0, null)], null), null);
});

test("labels on a crowded row do not overlap each other", () => {
  const ids = ["sonnet-5", "kimi-k3", "qwen3.8-max", "opus-5.5", "gpt-5.6-sol"];
  const chart = costSuccessChart(ids.map((id, i) => candidate(id, 8, 8, 0.006 + i * 0.0008)), 0.9)!;
  const boxes = chart.points.map((p) => {
    const w = p.candidate.length * 6.4;
    const x0 = p.label.anchor === "start" ? p.label.x : p.label.x - w;
    return { x0, x1: x0 + w, y0: p.label.y - 10, y1: p.label.y + 2 };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `${ids[i]} and ${ids[j]} overlap`);
    }
  }
  assert.ok(chart.points.some((p) => p.label.leader), "a label moved off its row draws a line back to its dot");
});

test("the hover title says which gate removed a candidate, and report.html escapes names", () => {
  const notes = gateNotesOf([
    { removed: [{ candidate: "flaky", detail: "reliability 37.5% (3/8)" }] },
    { removed: [{ candidate: "flaky", detail: "a later gate" }] },
  ]);
  const chart = costSuccessChart([candidate("flaky", 3, 3, 0.02, { gated: true }), candidate("<b>", 8, 8, 0.01, { chosen: true })], 0.9, notes)!;
  assert.match(chart.points[0].title, /gated out: reliability 37\.5% \(3\/8\)$/);
  const html = renderCostSuccess(chart);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
  assert.equal(renderCostSuccess(null), "");
});
