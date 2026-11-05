/** datasets/tasks/claim-denials-snf-flow: v2's claims in three steps, the check that grades each, and the non-model deadline step. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TASK = path.resolve("datasets/tasks/claim-denials-snf-flow");
const V2 = path.resolve("datasets/tasks/claim-denials-snf-v2");
const CHECK = path.join(TASK, "checks", "flow-check.mjs");
const RULES_AGENT = path.join(TASK, "agents", "deadline-rules.mjs");

const reference = (step: string, slug: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(TASK, "references", step, `${slug}.txt`), "utf-8"));

function runCheck(step: string, input: string, output: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cd-flow-check-"));
  fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ step, input }));
  fs.writeFileSync(path.join(work, "output.txt"), output);
  const r = spawnSync(process.execPath, [CHECK], { cwd: work, encoding: "utf-8", env: { ...process.env, EVAL_REFERENCES_DIR: path.join(TASK, "references") } });
  return { code: r.status, evidence: r.stdout };
}

test("every claim file is claim-denials-snf-v2's, byte for byte", () => {
  for (let i = 1; i <= 300; i++) {
    const id = `cd2-${String(i).padStart(3, "0")}`;
    assert.equal(fs.readFileSync(path.join(TASK, "inputs", `${id}.txt`), "utf-8"), fs.readFileSync(path.join(V2, "inputs", `${id}.txt`), "utf-8"), id);
  }
});

test("a step is graded the same on its own input and in the chain, where it sees the root slug", () => {
  const answer = JSON.stringify(reference("decide", "cd2-013-decide"));
  assert.equal(runCheck("decide", "cd2-013-decide", answer).code, 0);
  assert.equal(runCheck("decide", "cd2-013", answer).code, 0);
});

test("decide fails an appeal where the rules call for a reopening, naming the field", () => {
  const answer = { ...reference("decide", "cd2-013-decide"), next_action: "appeal" };
  const r = runCheck("decide", "cd2-013", JSON.stringify(answer));
  assert.equal(r.code, 1);
  assert.match(r.evidence, /next_action: got \\"appeal\\", want \\"reopening\\"/);
});

test("extract must hand on the records verbatim: a reworded line fails, curly quotes and spacing do not", () => {
  const key = reference("extract", "cd2-013") as { records: string[] };
  const restyled = { ...key, records: key.records.map((r) => `${r.replace('"', "“").replace('."', ".”")}  `) };
  assert.equal(runCheck("extract", "cd2-013", JSON.stringify(restyled)).code, 0);
  const reworded = { ...key, records: key.records.map((r) => r.replace("we probably have to write it off", "write it off")) };
  assert.equal(runCheck("extract", "cd2-013", JSON.stringify(reworded)).code, 1);
});

test("an unknown step is the check's error, never the candidate's", () => {
  assert.equal(runCheck("triage", "cd2-013", "{}").code, 3);
});

test("deadline-rules reaches the key from a correct decision, for every kind of next action", () => {
  // corrected_claim, reopening, appeal (twice), write_off, bill_patient
  for (const id of ["cd2-187", "cd2-013", "cd2-119", "cd2-169", "cd2-003", "cd2-173"]) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "cd-flow-rules-"));
    fs.copyFileSync(path.join(TASK, "inputs", `${id}-deadline.txt`), path.join(work, ".eval-input.txt"));
    const r = spawnSync(process.execPath, [RULES_AGENT], { cwd: work, encoding: "utf-8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), reference("deadline", `${id}-deadline`), id);
    // A command candidate's deliverable is a file it leaves; stdout alone reads as not completed
    assert.equal(fs.readFileSync(path.join(work, "deadline.json"), "utf-8"), r.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(work, ".eval-usage.json"), "utf-8")), { cost_usd: 0 });
  }
});
