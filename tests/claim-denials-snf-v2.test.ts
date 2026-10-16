/** tasks/claim-denials-snf-v2: the rules in RULES.md as code, and the check that grades by them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TASK = path.resolve("tasks/claim-denials-snf-v2");
const rules = () => import(pathToFileURL(path.join(TASK, "gen", "rules.mjs")).href);
const CHECK = path.join(TASK, "checks", "triage-check.mjs");

test("R1: timely through the anniversary of the Through date, late the day after", async () => {
  const { filingDeadline, isTimely } = await rules();
  assert.equal(filingDeadline("2024-03-15"), "2025-03-15");
  assert.equal(isTimely("2025-03-15", "2024-03-15"), true);
  assert.equal(isTimely("2025-03-16", "2024-03-15"), false);
});

test("R1: the From date does not start the clock", async () => {
  const { isTimely } = await rules();
  assert.equal(isTimely("2025-10-05", "2024-10-10"), true, "a stay from 2024-09-20 through 2024-10-10, filed 2025-10-05");
});

test("R2: redetermination is due 125 days after the remittance (120 from presumed receipt 5 days later)", async () => {
  const { redeterminationDeadline } = await rules();
  assert.equal(redeterminationDeadline("2025-08-28"), "2025-12-31");
});

test("R4: the admission day counts, the discharge day and observation time do not", async () => {
  const { inpatientDays, qualifyingStayMet } = await rules();
  assert.equal(inpatientDays("2025-03-03", "2025-03-06"), 3);
  assert.equal(inpatientDays("2025-03-04", "2025-03-06"), 2);
  assert.equal(qualifyingStayMet({ admitOrder: "2025-03-03", discharge: "2025-03-06", snfAdmit: "2025-03-06" }), true);
  assert.equal(qualifyingStayMet({ admitOrder: "2025-03-03", discharge: "2025-03-06", snfAdmit: "2025-04-07" }), false, "more than 30 days after discharge");
});

test("R5: a 75-day gap starts a new benefit period, a 40-day gap does not", async () => {
  const { newBenefitPeriod } = await rules();
  assert.equal(newBenefitPeriod("2025-01-10", "2025-03-26"), true);
  assert.equal(newBenefitPeriod("2025-01-10", "2025-02-19"), false);
});

function runCheck(input: string, output: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cd2-check-"));
  fs.writeFileSync(path.join(work, "output.txt"), output);
  fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ step: "triage", candidate: "c", input, trial: 0 }));
  const r = spawnSync(process.execPath, [CHECK], { cwd: work, encoding: "utf-8", env: { ...process.env, EVAL_REFERENCES_DIR: path.join(TASK, "references") } });
  return { code: r.status, out: r.stdout };
}
const ids = () => fs.readdirSync(path.join(TASK, "references")).map((f) => f.replace(/\.txt$/, ""));
const reference = (id: string) => JSON.parse(fs.readFileSync(path.join(TASK, "references", `${id}.txt`), "utf-8"));

test("check: every reference answer passes", () => {
  assert.ok(ids().length >= 30);
  for (const id of ids()) {
    const r = runCheck(id, JSON.stringify({ ...reference(id), action_note: "anything" }));
    assert.equal(r.code, 0, `${id}: ${r.out}`);
  }
});

test("check: an appeal dated 120 days after the remittance, not 125, fails", () => {
  const id = ids().find((i) => reference(i).next_action === "appeal")!;
  const ref = reference(id);
  const [y, m, d] = ref.deadline.split("-").map(Number);
  const fiveEarlier = new Date(Date.UTC(y, m - 1, d) - 5 * 86_400_000).toISOString().slice(0, 10);
  const r = runCheck(id, JSON.stringify({ ...ref, deadline: fiveEarlier }));
  assert.equal(r.code, 1);
  assert.match(r.out, /deadline/);
});

test("check: appealing an unprocessable claim fails", () => {
  const id = ids().find((i) => reference(i).root_cause === "missing_or_invalid_information")!;
  assert.equal(runCheck(id, JSON.stringify({ ...reference(id), next_action: "appeal" })).code, 1);
});
