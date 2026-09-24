import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fixturesDir } from "../src/paths.js";
import { loadBundle } from "../src/report-v2.js";
import { duelRecord, judgeFavourite } from "../src/report-model.js";
import { judgeNote } from "../src/report-copy.js";
import { workflowFindings, type CandidateMeta, type WorkflowStep } from "../src/workflow-report-model.js";
import type { EvaluationRow } from "../src/canon/rows.js";

const duel = (a: string, b: string, overall: "a" | "b" | "tie"): EvaluationRow =>
  ({ evaluator: "pairwise-swap", state: "pass", subject: { kind: "pair", a, b, input: "i" }, overall }) as unknown as EvaluationRow;

test("a duel record and its win rate come from the same rows: 3–0–3 is 75%", () => {
  const rows = [duel("x", "y", "a"), duel("x", "y", "a"), duel("x", "z", "a"), duel("x", "y", "tie"), duel("z", "x", "tie"), duel("x", "z", "tie")];
  const r = duelRecord("x", rows);
  assert.deepEqual([r.wins, r.losses, r.ties], [3, 0, 3]);
  assert.equal(r.rate, 75);
});

test("a tied top is not a favourite, and the note says nobody led", async () => {
  const b = await loadBundle(path.join(fixturesDir(), "codegen-w38"));
  const fav = judgeFavourite(b);
  assert.ok(fav);
  assert.equal(typeof fav.sole, "boolean");
  assert.match(judgeNote({ ...fav, sole: false }, null), /没有分出高下/);
});

type Row = { id: string; checkPass: number; checkExecuted: number; completed: { ok: number; total: number }; states: Array<[string, number]> };
function step(id: string, opts: {
  fav?: string; sole?: boolean; chosen?: string | null; firmness?: string; rows: Row[];
}): WorkflowStep {
  return {
    id, dir: id, error: null,
    report: {
      verdict: {
        chosen: opts.chosen ?? null,
        firmness: opts.firmness ?? "firm",
        judge: opts.fav ? { candidate: opts.fav, wins: 2, losses: 0, ties: 0, comparisons: 2, sole: opts.sole ?? true, disagrees: opts.fav !== opts.chosen } : null,
      },
      candidates: opts.rows,
      plan: { inputs: 3 },
    },
  } as unknown as WorkflowStep;
}
const ok = (id: string): Row => ({ id, checkPass: 9, checkExecuted: 9, completed: { ok: 9, total: 9 }, states: [["success", 9]] });
const CANDS: CandidateMeta[] = [
  { id: "sonnet", model: "anthropic/claude-sonnet-5", colorIndex: 0 },
  { id: "ds", model: "deepseek/deepseek-v4-pro", colorIndex: 1 },
];

test("no finding fires on a clean run", () => {
  const steps = [step("codegen", { fav: "ds", chosen: "ds", rows: [ok("sonnet"), ok("ds")] })];
  assert.deepEqual(workflowFindings(steps, "google/gemini", CANDS), []);
});

test("a judge favourite that fails the checks is called out on its step", () => {
  const steps = [step("codegen", {
    fav: "sonnet", chosen: "ds",
    rows: [{ ...ok("sonnet"), checkPass: 4 }, ok("ds")],
  })];
  const [f] = workflowFindings(steps, "google/gemini", CANDS);
  assert.equal(f.tag, "codegen");
  assert.match(f.title, /sonnet.*44%/);
});

test("a candidate that did not complete normally is gathered across steps", () => {
  const flaky = { ...ok("sonnet"), completed: { ok: 3, total: 9 }, states: [["success", 3], ["timeout", 6]] as Array<[string, number]> };
  const steps = [step("prd", { rows: [flaky, ok("ds")] }), step("codegen", { rows: [flaky, ok("ds")] })];
  const [f] = workflowFindings(steps, "google/gemini", CANDS);
  assert.equal(f.tag, "可靠性");
  assert.match(f.body, /prd 33%、codegen 33%/);
  assert.match(f.body, /timeout/);
});

test("a same-vendor judge is flagged only where it actually preferred its own", () => {
  const steps = [step("trd", { fav: "sonnet", chosen: "sonnet", rows: [ok("sonnet"), ok("ds")] })];
  assert.equal(workflowFindings(steps, "anthropic/claude-opus", CANDS)[0]?.tag, "偏置");
  assert.deepEqual(workflowFindings(steps, "google/gemini", CANDS), []);
  // A shared top is not a preference.
  const tied = [step("trd", { fav: "sonnet", sole: false, chosen: "sonnet", rows: [ok("sonnet"), ok("ds")] })];
  assert.deepEqual(workflowFindings(tied, "anthropic/claude-opus", CANDS), []);
});
