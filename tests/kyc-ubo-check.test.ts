/** datasets/tasks/kyc-ubo-v1: the generator's answers pass the check, and each kind of wrong answer fails it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TASK = path.resolve("datasets/tasks/kyc-ubo-v1");
const CHECK = path.join(TASK, "checks", "ubo-check.mjs");
const SOLVER = pathToFileURL(path.join(TASK, "gen", "solve.mjs")).href;

function reference(id: string) {
  return JSON.parse(fs.readFileSync(path.join(TASK, "references", `${id}.txt`), "utf-8"));
}

function runCheck(input: string, output: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ubo-check-"));
  fs.writeFileSync(path.join(work, "output.txt"), output);
  fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ step: "ubo", candidate: "c", input, trial: 0 }));
  const r = spawnSync(process.execPath, [CHECK], { cwd: work, encoding: "utf-8", env: { ...process.env, EVAL_REFERENCES_DIR: path.join(TASK, "references") } });
  return { code: r.status, out: r.stdout };
}

function idWhere(pred: (ref: ReturnType<typeof reference>) => boolean) {
  const ids = fs.readdirSync(path.join(TASK, "references")).map((f) => f.replace(/\.txt$/, ""));
  const id = ids.find((i) => pred(reference(i)));
  assert.ok(id, "the set has an item of this kind");
  return id;
}

test("every reference answer passes", () => {
  const ids = fs.readdirSync(path.join(TASK, "references")).map((f) => f.replace(/\.txt$/, ""));
  assert.ok(ids.length >= 30);
  for (const id of ids) {
    const r = runCheck(id, fs.readFileSync(path.join(TASK, "references", `${id}.txt`), "utf-8"));
    assert.equal(r.code, 0, `${id}: ${r.out}`);
  }
});

test("an answer in a fenced block with prose around it is still read", () => {
  const id = idWhere((ref) => !ref.fallback);
  const r = runCheck(id, `Here is my analysis.\n\n\`\`\`json\n${JSON.stringify({ ...reference(id), reasoning: "see {notes}" })}\n\`\`\`\nDone.`);
  assert.equal(r.code, 0, r.out);
});

test("names match whatever the case, spacing and owner order", () => {
  const id = idWhere((ref) => ref.beneficial_owners.length > 1);
  const ref = reference(id);
  const owners = [...ref.beneficial_owners].reverse().map((o: { name: string; basis: string }) => ({ ...o, name: ` ${o.name.toUpperCase()} ` }));
  assert.equal(runCheck(id, JSON.stringify({ ...ref, beneficial_owners: owners })).code, 0);
});

test("an extra owner fails", () => {
  const id = idWhere((ref) => !ref.fallback);
  const ref = reference(id);
  const r = runCheck(id, JSON.stringify({ ...ref, beneficial_owners: [...ref.beneficial_owners, { name: "Someone Else", basis: "direct" }] }));
  assert.equal(r.code, 1);
  assert.match(r.out, /Someone Else/);
});

test("a missing owner fails", () => {
  const id = idWhere((ref) => !ref.fallback);
  const ref = reference(id);
  assert.equal(runCheck(id, JSON.stringify({ ...ref, beneficial_owners: ref.beneficial_owners.slice(1) })).code, 1);
});

test("the right owner on the wrong basis fails", () => {
  const id = idWhere((ref) => ref.beneficial_owners.some((o: { basis: string }) => o.basis === "control"));
  const ref = reference(id);
  const owners = ref.beneficial_owners.map((o: { name: string; basis: string }) => ({ ...o, basis: o.basis === "control" ? "direct" : o.basis }));
  assert.equal(runCheck(id, JSON.stringify({ ...ref, beneficial_owners: owners })).code, 1);
});

test("listing the largest shareholders instead of applying the fallback fails", () => {
  const id = idWhere((ref) => ref.fallback);
  const r = runCheck(id, JSON.stringify({ beneficial_owners: [{ name: "Anyone", basis: "direct" }], fallback: false, recorded_under_fallback: [] }));
  assert.equal(r.code, 1);
});

test("the fallback without the managing directors fails", () => {
  const id = idWhere((ref) => ref.fallback);
  assert.equal(runCheck(id, JSON.stringify({ ...reference(id), recorded_under_fallback: [] })).code, 1);
});

test("no JSON at all fails, empty output fails", () => {
  const id = idWhere(() => true);
  assert.equal(runCheck(id, "I cannot determine the owners.").code, 1);
  assert.equal(runCheck(id, "").code, 1);
});

test("an input with no reference is an evaluator error, not the candidate's", () => {
  assert.equal(runCheck("ubo-999", "{}").code, 3);
});

const person = (holder: string, percent: number) => ({ holder, percent, person: true });

test("the solver reproduces the page's two worked examples", async () => {
  const { solve } = await import(SOLVER);

  const layered = solve({
    target: "Brunnfeld Logistik GmbH",
    directors: ["Lena Vogt"],
    holdings: {
      "Brunnfeld Logistik GmbH": [{ holder: "Althaus Holding GmbH", percent: 45, person: false }, person("Jana Roth", 30), person("Tobias Wendt", 25)],
      "Althaus Holding GmbH": [person("Mara Althaus", 60), person("Felix Brandt", 40)],
    },
  });
  assert.deepEqual(layered.beneficial_owners, [{ name: "Mara Althaus", basis: "control" }, { name: "Jana Roth", basis: "direct" }]);
  assert.equal(layered.fallback, false);

  const flat = solve({
    target: "Kestrel Werkstoffe GmbH",
    directors: ["Lena Vogt"],
    holdings: { "Kestrel Werkstoffe GmbH": ["A", "B", "C", "D", "E"].map((n) => person(n, 20)) },
  });
  assert.deepEqual(flat, { beneficial_owners: [], fallback: true, recorded_under_fallback: ["Lena Vogt"] });
});

test("the solver: 50% is not control, and a multiplied stake alone is not ownership", async () => {
  const { solve } = await import(SOLVER);
  const r = solve({
    target: "T",
    directors: ["MD"],
    holdings: {
      T: [{ holder: "H", percent: 80, person: false }, person("P", 20)],
      H: [person("X", 50), person("Y", 50)],
    },
  });
  assert.equal(r.fallback, true, "X and Y each reach 40% by multiplication, but neither controls H");
});
