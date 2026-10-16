/** tasks/kyc-ubo-v2: the solver follows RULES.md (worked examples from the BVA FAQ), and the check grades by it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TASK = path.resolve("examples/tasks/kyc-ubo-v2");
const SOLVER = pathToFileURL(path.join(TASK, "gen", "solve.mjs")).href;
const CHECK = path.join(TASK, "checks", "ubo-check.mjs");

interface Holder { holder: string; nominal: number; person: boolean; voting?: boolean }
interface Entity { holders: Holder[]; ownShares?: number; generalPartner?: string }
interface Structure { target: string; legalReps: string[]; entities: Record<string, Entity> }
interface Answer { beneficial_owners: Array<{ name: string; basis: string }>; fictitious_beneficial_owners: string[] }

const p = (holder: string, nominal: number, voting = true): Holder => ({ holder, nominal, person: true, voting });
const e = (holder: string, nominal: number): Holder => ({ holder, nominal, person: false });

async function solve(structure: Structure): Promise<Answer> {
  const mod = await import(SOLVER);
  return mod.solve(structure);
}
const owners = (a: Answer) => a.beneficial_owners.map((o) => o.name).sort();

test("R1: 6.250 of 25.000 is not more than 25%, 6.251 is", async () => {
  const a = await solve({ target: "T", legalReps: ["GF"], entities: { T: { holders: [p("A", 6250), p("B", 6251), p("C", 12499)] } } });
  assert.deepEqual(owners(a), ["B", "C"]);
});

test("R1: non-voting capital qualifies on capital, and the others qualify on votes", async () => {
  const a = await solve({ target: "T", legalReps: ["GF"], entities: { T: { holders: [p("A", 12000), p("B", 12000), p("C", 13000, false), p("D", 13000, false)] } } });
  assert.deepEqual(owners(a), ["A", "B", "C", "D"]);
});

test("R2: several shares of one person are added", async () => {
  const a = await solve({ target: "T", legalReps: ["GF"], entities: { T: { holders: [p("A", 15000), p("B", 60000), p("A", 15000), p("C", 10000)] } } });
  assert.deepEqual(owners(a), ["A", "B"]);
});

test("R3, FAQ Teil 1 B I Nr. 6: 20% direct plus 20% through a controlled GmbH is 40%", async () => {
  const a = await solve({
    target: "GmbH 1",
    legalReps: ["GF"],
    entities: {
      "GmbH 1": { holders: [p("A", 20), e("GmbH 2", 20), p("B", 20), p("C", 20), p("D", 20)] },
      "GmbH 2": { holders: [p("A", 60), p("E", 40)] },
    },
  });
  assert.deepEqual(owners(a), ["A"]);
});

test("R3: a controlled entity's stake counts in full, never multiplied", async () => {
  const a = await solve({
    target: "T",
    legalReps: ["GF"],
    entities: { T: { holders: [e("H", 30), p("B", 25), p("C", 25), p("D", 20)] }, H: { holders: [p("A", 60), p("E", 40)] } },
  });
  assert.deepEqual(owners(a), ["A"], "A controls H, so all of H's 30% is A's, though 60% of 30% is only 18%");
});

test("R4: stakes of two controlled entities are added", async () => {
  const a = await solve({
    target: "T",
    legalReps: ["GF"],
    entities: {
      T: { holders: [e("H1", 15), e("H2", 15), e("W", 40), p("F", 20), p("G", 10)] },
      H1: { holders: [p("A", 70), p("X", 30)] },
      H2: { holders: [p("A", 55), p("Y", 45)] },
      W: { holders: [p("R", 50), p("S", 50)] },
    },
  });
  assert.deepEqual(owners(a), ["A"]);
});

test("R5: exactly 50% is not control, so a 50/50 holding goes nowhere and the fallback applies", async () => {
  const a = await solve({
    target: "T",
    legalReps: ["GF 1", "GF 2"],
    entities: { T: { holders: [e("H", 60), p("B", 20), p("C", 20)] }, H: { holders: [p("X", 50), p("Y", 50)] } },
  });
  assert.deepEqual(a, { beneficial_owners: [], fictitious_beneficial_owners: ["GF 1", "GF 2"] });
});

test("R5: control passes down a chain", async () => {
  const a = await solve({
    target: "T",
    legalReps: ["GF"],
    entities: { T: { holders: [e("H2", 30), p("B", 25), p("C", 25), p("D", 20)] }, H2: { holders: [e("H1", 75), p("Z", 25)] }, H1: { holders: [p("A", 55), p("Q", 45)] } },
  });
  assert.deepEqual(owners(a), ["A"]);
});

test("R6, FAQ Teil 1 B I Nr. 5: own shares are left out, so 25.000 of 100.000 is 50%", async () => {
  const a = await solve({ target: "T", legalReps: ["GF"], entities: { T: { holders: [p("A", 25000), p("B", 25000)], ownShares: 50000 } } });
  assert.deepEqual(owners(a), ["A", "B"]);
});

test("R7: whoever controls the general partner of a GmbH & Co. KG is an owner, whatever their KG share", async () => {
  const a = await solve({
    target: "KG",
    legalReps: ["GP GmbH"],
    entities: { KG: { holders: [p("S", 30000), p("K", 25000), p("T", 45000)], generalPartner: "GP GmbH" }, "GP GmbH": { holders: [p("K", 25000)] } },
  });
  assert.deepEqual(owners(a), ["K", "S", "T"]);
});

test("R8: the fallback lists the legal representatives only", async () => {
  const a = await solve({ target: "T", legalReps: ["GF"], entities: { T: { holders: [p("A", 25), p("B", 25), p("C", 25), p("D", 25)] } } });
  assert.deepEqual(a.fictitious_beneficial_owners, ["GF"]);
  assert.deepEqual(a.beneficial_owners, []);
});

function runCheck(input: string, output: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ubo-v2-check-"));
  fs.writeFileSync(path.join(work, "output.txt"), output);
  fs.writeFileSync(path.join(work, "meta.json"), JSON.stringify({ step: "ubo", candidate: "c", input, trial: 0 }));
  const r = spawnSync(process.execPath, [CHECK], { cwd: work, encoding: "utf-8", env: { ...process.env, EVAL_REFERENCES_DIR: path.join(TASK, "references") } });
  return { code: r.status, out: r.stdout };
}

const ids = () => fs.readdirSync(path.join(TASK, "references")).map((f) => f.replace(/\.txt$/, ""));
const reference = (id: string) => JSON.parse(fs.readFileSync(path.join(TASK, "references", `${id}.txt`), "utf-8"));

test("check: every reference answer passes, whatever basis wording it carries", () => {
  assert.ok(ids().length >= 30);
  for (const id of ids()) {
    const ref = reference(id);
    const reworded = { ...ref, beneficial_owners: ref.beneficial_owners.map((o: { name: string }) => ({ name: o.name, basis: "anything" })) };
    const r = runCheck(id, JSON.stringify(reworded));
    assert.equal(r.code, 0, `${id}: ${r.out}`);
  }
});

test("check: a missing owner fails and names who", () => {
  const id = ids().find((i) => reference(i).beneficial_owners.length > 0)!;
  const ref = reference(id);
  const r = runCheck(id, JSON.stringify({ ...ref, beneficial_owners: ref.beneficial_owners.slice(1) }));
  assert.equal(r.code, 1);
  assert.match(r.out, new RegExp(ref.beneficial_owners[0].name));
});

test("check: falling back when someone qualifies fails", () => {
  const id = ids().find((i) => reference(i).beneficial_owners.length > 0)!;
  const r = runCheck(id, JSON.stringify({ beneficial_owners: [], fictitious_beneficial_owners: ["Anyone"] }));
  assert.equal(r.code, 1);
});

test("check: naming a Prokurist under the fallback fails", () => {
  const id = ids().find((i) => reference(i).fictitious_beneficial_owners.length > 0)!;
  const ref = reference(id);
  const r = runCheck(id, JSON.stringify({ ...ref, fictitious_beneficial_owners: [...ref.fictitious_beneficial_owners, "A Prokurist"] }));
  assert.equal(r.code, 1);
});

test("check: an input with no reference is an evaluator error", () => {
  assert.equal(runCheck("ubo-999", "{}").code, 3);
});
