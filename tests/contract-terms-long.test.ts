/** tasks/contract-terms-long: amendments apply by effective date and status, noise never alters a graded value, the check grades every field. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TASK = path.resolve("datasets/tasks/contract-terms-long");
const mod = (file: string) => import(pathToFileURL(path.join(TASK, "gen", file)).href);
const CHECK = path.join(TASK, "checks", "terms-check.mjs");

const base = {
  statusDate: "2026-10-01",
  parties: [{ name: "A Inc." }, { name: "B LLC" }],
  effective: { date: "2024-03-03" },
  term: { months: 36 },
  renewal: { kind: "auto", months: 12, noticeDays: 90 },
  cap: { type: "fixed", amount: 1000000 },
  law: "Delaware",
  amendments: [] as unknown[],
};
const amend = (effective: string, changes: object, extra: object = {}) => ({ number: 1, effective, signed: true, changes, ...extra });

test("solve: a signed amendment in force changes the term it names", async () => {
  const { solve } = await mod("solve.mjs");
  const r = solve({ ...base, amendments: [amend("2025-08-12", { noticeDays: 60 })] });
  assert.equal(r.non_renewal_notice_days, 60);
  assert.equal(r.renewal_term_months, 12);
});

test("solve: an unsigned draft changes nothing", async () => {
  const { solve } = await mod("solve.mjs");
  const r = solve({ ...base, amendments: [amend("2026-05-06", { law: "Georgia" }, { signed: false, draft: true })] });
  assert.equal(r.governing_law, "Delaware");
});

test("solve: a signed amendment effective after the status date changes nothing yet", async () => {
  const { solve } = await mod("solve.mjs");
  const r = solve({ ...base, amendments: [amend("2027-01-01", { cap: { type: "fixed", amount: 2000000 } })] });
  assert.deepEqual(r.liability_cap, { type: "fixed", amount_usd: 1000000 });
});

test("solve: amendments filed out of order apply in effective-date order", async () => {
  const { solve } = await mod("solve.mjs");
  const r = solve({ ...base, amendments: [amend("2025-11-04", { noticeDays: 45 }), amend("2023-03-01", { noticeDays: 120 })] });
  assert.equal(r.non_renewal_notice_days, 45, "the later-effective amendment wins, though it is filed first");
});

test("solve: no automatic renewal leaves renewal term and notice null", async () => {
  const { solve } = await mod("solve.mjs");
  const r = solve({ ...base, renewal: { kind: "mutual", months: 12, daysBefore: 60 } });
  assert.equal(r.auto_renewal, false);
  assert.equal(r.renewal_term_months, null);
  assert.equal(r.non_renewal_notice_days, null);
});

test("noise: heavy damage never alters a protected string, and layout damage is undone by readable()", async () => {
  const { addNoise, readable } = await mod("noise.mjs");
  const protectedStrings = ["Northwind Analytics, Inc.", "sixty (60) days", "the State of Delaware", "$2,500,000"];
  const text = Array.from({ length: 400 }, (_, i) => (i % 50 === 7 ? `Notice of non-renewal is due sixty (60) days before expiry under the State of Delaware law; cap $2,500,000; party Northwind Analytics, Inc.` : "The vendor shall provide role-based access for all user groups within the agreed maintenance windows.")).join("\n");
  for (let seed = 1; seed <= 20; seed++) {
    let a = seed;
    const rng = () => ((a = (a * 16807) % 2147483647) / 2147483647);
    const noised = addNoise(rng, text, protectedStrings, "heavy", "Test Agreement");
    assert.notEqual(noised, text);
    const flat = readable(noised);
    for (const s of protectedStrings) assert.ok(flat.includes(s), `seed ${seed}: lost "${s}"`);
  }
});

function runCheck(input: string, output: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "terms-check-"));
  fs.writeFileSync(path.join(work, "output.txt"), output);
  fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ step: "extract", candidate: "c", input, trial: 0 }));
  const r = spawnSync(process.execPath, [CHECK], { cwd: work, encoding: "utf-8", env: { ...process.env, EVAL_REFERENCES_DIR: path.join(TASK, "references") } });
  return { code: r.status, out: r.stdout };
}
const ids = () => fs.readdirSync(path.join(TASK, "references")).map((f) => f.replace(/\.txt$/, ""));
const reference = (id: string) => JSON.parse(fs.readFileSync(path.join(TASK, "references", `${id}.txt`), "utf-8"));

test("check: every reference passes, with names in other case and punctuation and the law as 'State of X'", () => {
  for (const id of ids()) {
    const ref = reference(id);
    const reworded = { ...ref, parties: [...ref.parties].reverse().map((p: string) => p.toUpperCase().replace(/[.,]/g, "")), governing_law: ref.governing_law && `the State of ${ref.governing_law}` };
    const r = runCheck(id, JSON.stringify(reworded));
    assert.equal(r.code, 0, `${id}: ${r.out}`);
  }
});

test("check: one wrong field fails and the evidence names it", () => {
  const id = ids()[0];
  const ref = reference(id);
  const r = runCheck(id, JSON.stringify({ ...ref, initial_term_months: ref.initial_term_months + 12 }));
  assert.equal(r.code, 1);
  assert.match(r.out, /7\/8 fields right/);
  assert.match(r.out, /initial_term_months/);
});

test("check: the right amount under the wrong cap type fails", () => {
  const id = ids().find((i) => ["greater_of", "lesser_of"].includes(reference(i).liability_cap.type))!;
  const ref = reference(id);
  const flipped = { ...ref.liability_cap, type: ref.liability_cap.type === "greater_of" ? "lesser_of" : "greater_of" };
  assert.equal(runCheck(id, JSON.stringify({ ...ref, liability_cap: flipped })).code, 1);
});

test("check: a renewal notice invented for an agreement that does not renew automatically fails", () => {
  const id = ids().find((i) => reference(i).auto_renewal === false)!;
  assert.equal(runCheck(id, JSON.stringify({ ...reference(id), non_renewal_notice_days: 60 })).code, 1);
});
